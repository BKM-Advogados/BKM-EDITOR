// Acesso à pasta do projeto, comum ao processo principal do app e ao servidor MCP que o Claude usa no terminal.
// Toda escrita em documento passa por aplicarPatch: confere a versão (lock otimista), aplica o JSON Patch de forma
// atômica (os "test" falham antes de qualquer mudança), grava, e registra a mudança com o patch inverso no diário.
import {createHash} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, closeSync, fstatSync, openSync, readSync, statSync, writeSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import jsonpatch, {type Operation} from 'fast-json-patch';
import {ehDocImagem, type ArquivoComentarios, type Comentario, type EntradaDiario, type EntradaDocumento, type EstadoEditor, type Manifesto, type Modulo, type OperacaoPatch, type ResumoDiario, compactarPatch} from './documentos';
import {ehDocAnimacao} from './animacao';
import {comNovaTentativa, gravarAtomico, renomearComRetry} from './gravar-seguro';
import {comATrava, comTrava} from './trava-escrita';
import {ARQUIVO_PESQUISA, caminhoTextoFonte, lerPesquisa, pesquisaVazia, type Pesquisa} from './pesquisa';
import {motivoDaTrava} from './travas-imagem';
import {ARQUIVO_PLANO, ErroPlano, lerPlano, type PlanoVideo} from './plano-video'; // Onda B: o Plano do vídeo

export const PASTA_INTERNA = '.estudio';

export class ErroProjeto extends Error {
  constructor(message: string, readonly codigo: 'conflito' | 'patch' | 'caminho' | 'nao_achado' = 'patch') {
    super(message);
  }
}

export const versaoDe = (texto: string) => createHash('sha256').update(texto).digest('hex').slice(0, 12);

export const serializar = (doc: unknown) => `${JSON.stringify(doc, null, 2)}\n`;

/** O formato de cada módulo, para um patch não tirar o documento do tipo dele (o app passaria a ler outra coisa). */
const FORMA_DO_MODULO: Record<Modulo, (d: unknown) => boolean> = {
  video: (d) => (d as {tipo?: unknown})?.tipo === 'cenas',
  imagem: ehDocImagem,
  '3d': (d) => Array.isArray((d as {objetos?: unknown})?.objetos),
  musica: (d) => (d as {tipo?: unknown})?.tipo === 'musica',
  animacao: ehDocAnimacao,
};
const NOME_DO_MODULO: Record<Modulo, string> = {video: 'um vídeo de cenas', imagem: 'uma imagem', '3d': 'uma cena 3D', musica: 'uma música', animacao: 'uma animação'};

/** Texto sem o BOM do UTF-8 no começo (Bloco de Notas antigo, PowerShell 5 com -Encoding utf8). */
export const semBom = (texto: string) => (texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto);

/** `alvo` está dentro de `base` (ou é a própria base)? Só pelo texto do caminho; "..notas.json" é nome legítimo. */
export const dentroDe = (base: string, alvo: string) => {
  const rel = path.relative(base, alvo);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};

/** Arquivos internos que entram no diário sem ser documento do manifesto: o Reverter e o Ctrl+Z voltam as mudanças
 *  deles pelo patch inverso (sem ajustes de módulo nem trava de camada). O aplicar_patch do MCP continua sem acesso. */
const ARQUIVOS_INTERNOS = new Set(['pesquisa/pesquisa.json', 'midia/marcas.json', '.estudio/exportacao.json', ARQUIVO_PLANO]);

export class Projeto {
  constructor(readonly raiz: string) {}

  /** Caminho absoluto de um arquivo do projeto; recusa sair da pasta. */
  caminho(rel: string): string {
    const abs = path.resolve(this.raiz, rel);
    if (!dentroDe(this.raiz, abs)) throw new ErroProjeto(`caminho fora do projeto: ${rel}`, 'caminho');
    return abs;
  }

  /** A pasta saidas/, para as exportações do app (vídeo, imagem, páginas do carrossel): é aqui que se decide a exceção
   *  à regra do caminhoParaGravar. Se saidas/ for um link para outro disco, a exportação grava lá, porque exportar
   *  direto para outro disco é uso legítimo e saidas/ não tem documento, diário nem nada que o app releia. Só a pasta
   *  em si escapa: o nome do arquivo dentro dela continua preso a ela (arquivoLivre, pastaLivre). As legendas
   *  (exportar_legendas) e a música (exportar_musica) gravam pelo caminhoParaGravar e por isso recusam o link. */
  pastaDeSaidas(): string {
    return this.caminho('saidas');
  }

  /** O mesmo caminho, para gravar, copiar, renomear ou apagar: o lugar real (seguindo links simbólicos) também tem de
   *  estar dentro do projeto. Um link em midia/ para um disco de fora funciona só para ler; nada se grava por ele. A
   *  exceção, saidas/ das exportações do app, está em pastaDeSaidas. */
  caminhoParaGravar(rel: string): string {
    const abs = this.caminho(rel);
    if (/^saidas(\/|\\|$)/.test(rel)) return abs; // exportação (legendas, música) segue a exceção de pastaDeSaidas
    const fora = () => new ErroProjeto(`${rel} passa por um link simbólico para fora do projeto: por ele só se lê, não se grava`, 'caminho');
    for (let atual = abs; ;) {
      let real: string;
      try {
        real = realpathSync(atual);
      } catch {
        // não existe (ainda, ou acabou de sair: a trava de outro processo) ou é um link quebrado, que não se sabe aonde vai
        let link = false;
        try {
          link = lstatSync(atual).isSymbolicLink();
        } catch {
          /* não existe: confere a pasta de cima */
        }
        if (link) throw fora();
        const pai = path.dirname(atual);
        if (pai === atual || !dentroDe(this.raiz, pai)) return abs; // nem a pasta do projeto existe ainda: nada a seguir
        atual = pai;
        continue;
      }
      if (!dentroDe(realpathSync(this.raiz), real)) throw fora();
      return abs;
    }
  }

  existe(rel: string) {
    return existsSync(this.caminho(rel));
  }

  lerTexto(rel: string): string {
    const abs = this.caminho(rel);
    if (!existsSync(abs)) throw new ErroProjeto(`arquivo não achado: ${rel}`, 'nao_achado');
    return semBom(readFileSync(abs, 'utf-8')); // a versão sai do texto sem BOM, e a próxima gravação o tira do arquivo
  }

  lerJson<T>(rel: string): {doc: T; versao: string} {
    const {doc, versao} = this.lerJsonComTexto<T>(rel);
    return {doc, versao};
  }

  private lerJsonComTexto<T>(rel: string): {doc: T; versao: string; texto: string} {
    const texto = this.lerTexto(rel);
    try {
      return {doc: JSON.parse(texto) as T, versao: versaoDe(texto), texto};
    } catch (e) {
      throw new ErroProjeto(`${rel} não é um JSON válido (${(e as Error).message}); desfaça a última mudança no arquivo`, 'patch');
    }
  }

  /** Grava de forma atômica (arquivo temporário + rename), para o observador nunca ler meio arquivo. */
  gravarTexto(rel: string, texto: string) {
    const abs = this.caminhoParaGravar(rel);
    mkdirSync(path.dirname(abs), {recursive: true});
    gravarAtomico(abs, texto); // arquivo preso (OneDrive, antivírus) tem nova tentativa curta: gravar-seguro.ts
  }

  /** Roda `f` com a trava de escrita do projeto (.estudio/escrita.lock, trava-escrita.ts): todo ler-mudar-gravar do
   *  projeto passa por aqui, para o app e o MCP da IDE (outro processo) não gravarem um por cima do outro. */
  comTrava<T>(f: () => T): T {
    const lock = this.caminho(`${PASTA_INTERNA}/escrita.lock`);
    if (!comATrava(lock)) mkdirSync(this.caminhoParaGravar(PASTA_INTERNA), {recursive: true});
    return comTrava(lock, f, {ocupada: () => new ErroProjeto('outro programa está gravando o projeto; tente de novo', 'conflito')});
  }

  manifesto(): Manifesto {
    const m = this.lerJson<Manifesto>('estudio.json').doc;
    if (!m || typeof m !== 'object' || !Array.isArray(m.documentos)) throw new ErroProjeto('o estudio.json não tem a lista "documentos"', 'patch');
    return m;
  }

  private gravarManifesto(m: Manifesto) {
    this.gravarTexto('estudio.json', serializar(m));
  }

  renomear(nome: string): Manifesto {
    const limpo = nome.trim().slice(0, 120);
    if (!limpo) throw new ErroProjeto('o nome do projeto não pode ficar vazio');
    return this.comTrava(() => {
      const m = {...this.manifesto(), nome: limpo};
      this.gravarManifesto(m);
      return m;
    });
  }

  /** Grava o arquivo de um documento novo e o põe no manifesto (o conteúdo vem de criar-projeto.ts). */
  adicionarDocumento(entrada: EntradaDocumento, conteudo: unknown): EntradaDocumento {
    return this.comTrava(() => {
      const m = this.manifesto();
      if (m.documentos.some((d) => d.id === entrada.id || d.caminho === entrada.caminho)) throw new ErroProjeto(`já existe o documento ${entrada.id}`, 'conflito');
      if (this.existe(entrada.caminho)) throw new ErroProjeto(`o arquivo ${entrada.caminho} já existe`, 'conflito');
      this.gravarTexto(entrada.caminho, serializar(conteudo));
      try {
        this.gravarManifesto({...m, documentos: [...m.documentos, entrada]});
      } catch (e) {
        rmSync(this.caminhoParaGravar(entrada.caminho), {force: true}); // sem órfão: o mesmo nome serve na próxima tentativa
        throw e;
      }
      return entrada;
    });
  }

  renomearDocumento(id: string, titulo: string): EntradaDocumento {
    return this.comTrava(() => {
      const m = this.manifesto();
      const i = m.documentos.findIndex((d) => d.id === id);
      if (i < 0) throw new ErroProjeto(`documento não achado: ${id}`, 'nao_achado');
      const documentos = [...m.documentos];
      documentos[i] = {...documentos[i], titulo: titulo.trim() || documentos[i].titulo};
      this.gravarManifesto({...m, documentos});
      return documentos[i];
    });
  }

  /** Caminho do arquivo de um documento, pelo id do manifesto ou pelo próprio caminho. */
  arquivoDoDocumento(idOuCaminho: string): string {
    const m = this.manifesto();
    const e = m.documentos.find((d) => d.id === idOuCaminho || d.caminho === idOuCaminho);
    if (!e) throw new ErroProjeto(`documento não achado: ${idOuCaminho} (ids: ${m.documentos.map((d) => d.id).join(', ')})`, 'nao_achado');
    return e.caminho;
  }

  // ---------- patches e diário ----------
  private readonly ajustes = new Set<(doc: unknown, patch: OperacaoPatch[]) => OperacaoPatch[]>();
  /** Registra um ajuste que soma operações ao patch na mesma gravação (idempotente: a mesma função entra uma vez). */
  adicionarAjuste(f: (doc: unknown, patch: OperacaoPatch[]) => OperacaoPatch[]) {
    this.ajustes.add(f);
  }

  aplicarPatch(entrada: {
    documento: string;
    patch: OperacaoPatch[];
    versao_base?: string;
    autor: string;
    origem: string;
    rotulo?: string;
    desfaz?: number; // frente IA: a entrada que esta reverte
    transicao?: string; // frente Música: sem ele, vale a transição aberta cujo destino é este arquivo
  }): {versao: string; entrada: EntradaDiario} {
    return this.comTrava(() => this.aplicarNoArquivo(this.arquivoDoDocumento(entrada.documento), entrada, true));
  }

  /** O arquivo de uma entrada do diário: documento do manifesto ou um dos arquivos internos (null se não há mais). */
  private arquivoDaEntrada(documento: string): {rel: string; interno: boolean} | null {
    const rel = documento.split('\\').join('/');
    if (ARQUIVOS_INTERNOS.has(rel)) return {rel, interno: true};
    try {
      return {rel: this.arquivoDoDocumento(documento), interno: false};
    } catch {
      return null;
    }
  }

  private aplicarNoArquivo(rel: string, entrada: Parameters<Projeto['aplicarPatch']>[0], documento: boolean): {versao: string; entrada: EntradaDiario} {
    const {doc, versao, texto: textoAntes} = this.lerJsonComTexto<unknown>(rel);
    if (entrada.versao_base !== undefined && entrada.versao_base !== versao) {
      throw new ErroProjeto(`o documento mudou (versão ${versao}, esperada ${entrada.versao_base}); leia de novo e refaça o patch`, 'conflito');
    }
    const erro = jsonpatch.validate(entrada.patch as Operation[], doc);
    if (erro) throw new ErroProjeto(`patch inválido: ${erro.name} em ${erro.operation?.path ?? '?'}: ${erro.message.split('\n')[0]}`);
    const trava = documento ? motivoDaTrava(doc, entrada.patch, entrada.autor) : null; // camada travada na imagem (rodada 3, B2)
    if (trava) throw new ErroProjeto(trava, 'patch');
    // ajustes de módulos (frente Som: o som acompanha as cenas) somam operações ao patch na mesma gravação: o diário fica com uma entrada só
    let patch = entrada.patch;
    for (const ajuste of documento ? this.ajustes : []) {
      try {
        patch = [...patch, ...ajuste(doc, patch)];
      } catch {
        /* um ajuste com defeito não derruba a gravação da pessoa */
      }
    }
    if (patch !== entrada.patch && jsonpatch.validate(patch as Operation[], doc)) patch = entrada.patch; // ajuste que gerou patch inválido: fica só o da pessoa
    let depois: unknown;
    try {
      depois = jsonpatch.applyPatch(doc, patch as Operation[], true, false).newDocument;
    } catch (e) {
      throw new ErroProjeto(`patch recusado: ${(e as Error).message.split('\n')[0]}`);
    }
    if (!depois || typeof depois !== 'object' || Array.isArray(depois)) throw new ErroProjeto('patch recusado: o documento deixaria de ser um objeto JSON', 'patch');
    const modulo = this.manifesto().documentos.find((d) => d.caminho === rel)?.modulo;
    const forma = modulo ? FORMA_DO_MODULO[modulo] : undefined;
    // só o que era do módulo e deixaria de ser: documento antigo fora do formato (o carrossel do vídeo) segue editável
    if (forma && forma(doc) && !forma(depois)) throw new ErroProjeto(`patch recusado: o documento deixaria de ser ${NOME_DO_MODULO[modulo!]}`, 'patch');
    const texto = serializar(depois);
    const versaoDepois = versaoDe(texto);
    const registro: EntradaDiario = {
      seq: this.proximaSeq(), // dentro da trava: ninguém acrescenta ao diário entre ler o número e gravar
      em: new Date().toISOString(),
      documento: rel,
      autor: entrada.autor,
      origem: entrada.origem,
      rotulo: entrada.rotulo ?? resumirPatch(entrada.patch),
      versao_antes: versao,
      versao_depois: versaoDepois,
      patch: patch.filter((o) => o.op !== 'test'),
      inverso: jsonpatch.compare(depois as object, doc as object) as OperacaoPatch[],
      ...(entrada.desfaz !== undefined ? {desfaz: entrada.desfaz} : {}),
    };
    const transicao = entrada.transicao ?? (documento ? this.transicaoAbertaPara(rel) : undefined); // frente Música
    if (transicao) registro.transicao = transicao;
    this.gravarComDiario(rel, textoAntes, texto, registro);
    return {versao: versaoDepois, entrada: registro};
  }

  /** Grava `texto` em `rel` e acrescenta `registro` ao diário. Se o diário falhar, o arquivo volta a `textoAntes` (null:
   *  não existia e sai): sem entrada no diário, sem mudança, e o Ctrl+Z e o Histórico continuam valendo. Chame dentro
   *  de comTrava, para a volta não apagar a gravação de outro processo. */
  gravarComDiario(rel: string, textoAntes: string | null, texto: string, registro: EntradaDiario) {
    this.gravarTexto(rel, texto);
    try {
      this.registrar(registro);
    } catch (e) {
      try {
        if (textoAntes === null) rmSync(this.caminhoParaGravar(rel), {force: true});
        else this.gravarTexto(rel, textoAntes);
      } catch {
        /* o arquivo também ficou preso: vale o erro do diário */
      }
      throw e;
    }
  }

  /** frente Música: a transição aberta (.estudio/transicoes.json, src/nucleo/transicoes.ts) cujo destino é este
   *  arquivo; as mudanças feitas lá levam o id dela no diário. */
  private transicaoAbertaPara(rel: string): string | undefined {
    const arq = path.join(PASTA_INTERNA, 'transicoes.json');
    if (!this.existe(arq)) return undefined;
    try {
      const r = JSON.parse(this.lerTexto(arq)) as {transicoes?: {id: string; estado: string; destino?: {arquivo?: string}}[]};
      return (r.transicoes ?? []).filter((t) => t.estado === 'aberta' && t.destino?.arquivo === rel).pop()?.id;
    } catch {
      return undefined;
    }
  }

  private arquivoDiario() {
    return path.join(PASTA_INTERNA, 'diario.jsonl');
  }

  // Estrito por padrão: uma linha quebrada lança (a faxina do Som conta com isso para, na dúvida, não apagar nada).
  // transversal-D2: a gravação não passa mais por aqui (ultimaSeq lê o fim do arquivo), e o Histórico e o Reverter leem
  // com tolerante, que pula a linha quebrada.
  diario(desde = 0, o: {tolerante?: boolean} = {}): EntradaDiario[] {
    if (!this.existe(this.arquivoDiario())) return [];
    const texto = this.lerTexto(this.arquivoDiario());
    const linhas = o.tolerante ? lerLinhas(texto) : texto.split('\n').filter(Boolean).map((l) => JSON.parse(l) as EntradaDiario);
    return linhas.filter((e) => e.seq > desde);
  }

  // transversal-D15: o próximo número sai do fim do arquivo, sem reler o diário inteiro a cada edição
  private proximaSeq() {
    return this.ultimaSeq() + 1;
  }

  /** O maior seq do diário, lido do fim do arquivo (0 se não há diário). */
  ultimaSeq(): number {
    const abs = this.caminho(this.arquivoDiario());
    if (!existsSync(abs)) return 0;
    const fd = openSync(abs, 'r');
    try {
      const tamanho = fstatSync(fd).size;
      for (let janela = 64 * 1024; ; janela *= 4) {
        const ini = Math.max(0, tamanho - janela);
        const buf = Buffer.alloc(tamanho - ini);
        readSync(fd, buf, 0, buf.length, ini);
        const linhas = lerLinhas(buf.toString('utf-8'), ini > 0);
        if (linhas.length) return Math.max(...linhas.map((e) => e.seq));
        if (ini === 0) return 0;
      }
    } finally {
      closeSync(fd);
    }
  }

  /** Marca do fim do diário agora (tamanho em bytes): com entradasDesde, lê só o que entrou depois. */
  marcaDoDiario(): number {
    const abs = this.caminho(this.arquivoDiario());
    return existsSync(abs) ? statSync(abs).size : 0;
  }

  entradasDesde(marca: number): EntradaDiario[] {
    const abs = this.caminho(this.arquivoDiario());
    if (!existsSync(abs)) return [];
    const fd = openSync(abs, 'r');
    try {
      const tamanho = fstatSync(fd).size;
      if (tamanho <= marca) return [];
      const buf = Buffer.alloc(tamanho - marca);
      readSync(fd, buf, 0, buf.length, marca);
      return lerLinhas(buf.toString('utf-8'));
    } finally {
      closeSync(fd);
    }
  }

  // ---------- índice leve do diário (auditoria do núcleo, N7) ----------
  // O diário passa de dezenas de MB com as edições grandes do agente. O Ctrl+Z, o Reverter e o Histórico usam este
  // índice: o que cada entrada é (seq, autor, documento, desfaz…) e onde ela está no arquivo, sem os patches. Ele cresce
  // pelo que entrou no fim do arquivo (também o que o outro processo gravou) e se refaz se o arquivo encolher ou for
  // trocado. A entrada inteira se lê pelo lugar dela, só quando vai ser revertida.
  private indice: {dev: number; ino: number; fim: number; entradas: EntradaLeve[]} | null = null;

  private indiceDoDiario(): EntradaLeve[] {
    const abs = this.caminho(this.arquivoDiario());
    if (!existsSync(abs)) {
      this.indice = null;
      return [];
    }
    const fd = openSync(abs, 'r');
    try {
      const st = fstatSync(fd);
      let ix = this.indice;
      if (ix && (ix.dev !== st.dev || ix.ino !== st.ino || st.size < ix.fim || !continuaIgual(fd, ix))) ix = null;
      ix ??= {dev: st.dev, ino: st.ino, fim: 0, entradas: []};
      if (st.size > ix.fim) {
        const buf = Buffer.allocUnsafe(st.size - ix.fim);
        const lidos = lerTudo(fd, buf, ix.fim);
        let pos = 0;
        for (let nl = buf.indexOf(0x0a); nl >= 0 && nl < lidos; nl = buf.indexOf(0x0a, pos)) {
          const e = entradaLeve(buf, pos, nl, ix.fim);
          if (e) ix.entradas.push(e);
          pos = nl + 1;
        }
        ix.fim += pos; // a linha que outro processo ainda está escrevendo fica para a próxima vez
      }
      this.indice = ix;
      return ix.entradas;
    } finally {
      closeSync(fd);
    }
  }

  /** A entrada inteira (com patch e inverso), lida do lugar dela no arquivo. */
  private lerEntrada(e: EntradaLeve): EntradaDiario | null {
    const fd = openSync(this.caminho(this.arquivoDiario()), 'r');
    try {
      const buf = Buffer.alloc(e.fim - e.ini);
      readSync(fd, buf, 0, buf.length, e.ini);
      const lida = JSON.parse(buf.toString('utf-8')) as EntradaDiario;
      return lida?.seq === e.seq ? lida : null;
    } catch {
      return null;
    } finally {
      closeSync(fd);
    }
  }

  /** O fim do diário para o painel Histórico (CANAL.diario): as últimas `limite` entradas depois de `desde`, sem os
   *  patches, com um resumo do patch e se já foram revertidas. */
  /** O patch e o inverso compactos de cada entrada já lida (a entrada não muda depois de gravada). */
  private compactosDoDiario = new Map<number, {patch: OperacaoPatch[]; inverso: OperacaoPatch[]; ops_a_mais?: number}>();

  resumoDoDiario(desde = 0, limite = 200): ResumoDiario[] {
    const todas = this.indiceDoDiario();
    const revertidas = revertidasDe(todas);
    const ultimas = todas.filter((e) => e.seq > desde).slice(-limite);
    if (!ultimas.length) return [];
    const fd = openSync(this.caminho(this.arquivoDiario()), 'r');
    try {
      return ultimas.map(({ini, fim, patchIni, tem_inverso, ...e}) => {
        let resumo = '';
        if (patchIni >= 0) {
          const buf = Buffer.alloc(Math.min(TAMANHO_DO_RESUMO + 16, fim - patchIni));
          readSync(fd, buf, 0, buf.length, patchIni);
          const t = buf.toString('utf-8');
          const corte = t.indexOf('],"inverso":');
          resumo = corte >= 0 && corte < TAMANHO_DO_RESUMO ? t.slice(0, corte + 1) : `${t.slice(0, TAMANHO_DO_RESUMO)}…`;
        }
        let compacto = this.compactosDoDiario.get(e.seq);
        if (!compacto) {
          compacto = {patch: [], inverso: []};
          try {
            const buf = Buffer.alloc(fim - ini);
            readSync(fd, buf, 0, buf.length, ini);
            const inteira = JSON.parse(buf.toString('utf-8')) as Partial<EntradaDiario>;
            const p = compactarPatch(inteira.patch);
            compacto = {patch: p.ops, inverso: compactarPatch(inteira.inverso).ops, ...(p.a_mais ? {ops_a_mais: p.a_mais} : {})};
          } catch {
            /* linha que não se lê: a tela fica só com o resumo */
          }
          this.compactosDoDiario.set(e.seq, compacto);
        }
        return {...e, resumo, tem_inverso, revertida: revertidas.has(e.seq), ...compacto};
      });
    } finally {
      closeSync(fd);
    }
  }

  registrar(e: EntradaDiario) {
    const abs = this.caminhoParaGravar(this.arquivoDiario());
    mkdirSync(path.dirname(abs), {recursive: true});
    // se a última gravação parou no meio da linha, a entrada nova começa numa linha própria (transversal-D2)
    let quebra = '';
    if (existsSync(abs)) {
      const t = statSync(abs).size;
      if (t > 0) {
        const fd = openSync(abs, 'r');
        const b = Buffer.alloc(1);
        readSync(fd, b, 0, 1, t - 1);
        closeSync(fd);
        if (b[0] !== 0x0a) quebra = '\n';
      }
    }
    const fd = comNovaTentativa(() => openSync(abs, 'a')); // diário preso pelo OneDrive ou antivírus: tenta de novo
    try {
      writeSync(fd, `${quebra}${JSON.stringify(e)}\n`);
    } finally {
      closeSync(fd);
    }
  }

  // ---------- reverter e desfazer pelo diário (frente IA, rodada 3) ----------
  /** As entradas já revertidas. Lidas de trás para a frente: um desfazer revertido depois (refazer) não conta, e a
   *  entrada que ele desfazia volta a valer (A, desfaz A, refaz: A não está revertida). */
  revertidas(): Set<number> {
    return revertidasDe(this.indiceDoDiario());
  }

  /**
   * Aplica o inverso de uma entrada. Antes, confere que os valores trocados por ela ainda estão lá (test); se alguém
   * mudou depois, devolve mudou_depois e não grava, a não ser com forcar. Entrada sem "replace" só reverte sem pergunta
   * se for a última do documento. Se o documento está como a entrada o deixou, reverte sem conferir nada.
   */
  reverter(seq: number, o: {autor: string; origem: string; forcar?: boolean}):
    {ok: true; seq: number; rotulo: string} | {ok: false; mensagem: string; mudou_depois?: boolean} {
    return this.comTrava(() => this.reverterSemTrava(seq, o));
  }

  private reverterSemTrava(seq: number, o: {autor: string; origem: string; forcar?: boolean}):
    {ok: true; seq: number; rotulo: string} | {ok: false; mensagem: string; mudou_depois?: boolean} {
    const todas = this.indiceDoDiario();
    const leve = todas.find((x) => x.seq === seq);
    if (!leve) return {ok: false, mensagem: `não há a mudança #${seq} no histórico`};
    if (revertidasDe(todas).has(seq)) return {ok: false, mensagem: `a mudança #${seq} já foi revertida`};
    if (!leve.tem_inverso) return {ok: false, mensagem: `a mudança #${seq} não tem o que reverter`};
    const e = this.lerEntrada(leve);
    if (!e?.inverso?.length) return {ok: false, mensagem: `a mudança #${seq} não tem o que reverter`};
    const alvo = this.arquivoDaEntrada(e.documento);
    if (!alvo) return {ok: false, mensagem: `o arquivo da mudança #${seq} (${e.documento}) não está mais no projeto`};
    let atual: string;
    try {
      atual = this.lerJson<unknown>(alvo.rel).versao;
    } catch (erro) {
      return {ok: false, mensagem: (erro as Error).message};
    }
    const intacto = atual === e.versao_depois; // ninguém mexeu desde esta entrada (o Ctrl+Z logo depois)
    const depois = todas.filter((x) => x.seq > seq && x.documento === e.documento);
    const soTrocas = e.patch.every((op) => op.op === 'replace');
    if (!o.forcar && !intacto && depois.length && !soTrocas) {
      return {ok: false, mudou_depois: true, mensagem: `o documento mudou depois da mudança #${seq}; reverter agora pode desfazer o que veio depois`};
    }
    const testes: OperacaoPatch[] = o.forcar || intacto ? [] : trocasFinais(e.patch).map((t) => ({op: 'test', path: t.path, value: t.value}) as OperacaoPatch);
    try {
      const r = this.aplicarNoArquivo(alvo.rel, {documento: e.documento, patch: [...testes, ...e.inverso], autor: o.autor, origem: o.origem,
        rotulo: `reverter: ${e.rotulo}`, desfaz: seq, ...(intacto ? {versao_base: atual} : {})}, !alvo.interno);
      return {ok: true, seq: r.entrada.seq, rotulo: r.entrada.rotulo};
    } catch (erro) {
      if (testes.length && /test/i.test((erro as Error).message)) {
        return {ok: false, mudou_depois: true, mensagem: `o valor mudou depois da mudança #${seq} (talvez por outra mão)`};
      }
      return {ok: false, mensagem: (erro as Error).message};
    }
  }

  /** Ctrl+Z: a última entrada desse autor e dessa origem que ainda não foi revertida (transversal-D1: vale depois de
   *  reabrir). Pula a que não tem o que reverter e a de arquivo que saiu do projeto, para não ficar preso nelas. */
  desfazerUltima(o: {autor: string; origem: string; como: {autor: string; origem: string}}) {
    return this.comTrava(() => this.desfazerUltimaSemTrava(o));
  }

  private desfazerUltimaSemTrava(o: {autor: string; origem: string; como: {autor: string; origem: string}}) {
    const todas = this.indiceDoDiario();
    const revertidas = revertidasDe(todas);
    const existe = new Map<string, boolean>();
    const ultima = todas.findLast((e) => {
      if (e.autor !== o.autor || e.origem !== o.origem || e.desfaz !== undefined || revertidas.has(e.seq) || !e.tem_inverso) return false;
      if (!existe.has(e.documento)) existe.set(e.documento, this.arquivoDaEntrada(e.documento) !== null);
      return existe.get(e.documento)!;
    });
    if (!ultima) return {ok: false as const, mensagem: 'nada para desfazer'};
    const {ini: _i, fim: _f, patchIni: _p, tem_inverso: _t, ...alvo} = ultima;
    return {...this.reverterSemTrava(ultima.seq, o.como), alvo};
  }

  // ---------- comentários ----------
  comentarios(): Comentario[] {
    if (!this.existe('comentarios.json')) return [];
    const lista = this.lerJson<Partial<ArquivoComentarios> | null>('comentarios.json').doc?.comentarios;
    // sem a lista, lança: devolver [] faria o próximo comentário gravar por cima do que o arquivo tiver
    if (!Array.isArray(lista)) throw new ErroProjeto('o comentarios.json não tem a lista "comentarios"; desfaça a última mudança no arquivo', 'patch');
    return lista;
  }

  private gravarComentarios(lista: Comentario[]) {
    this.gravarTexto('comentarios.json', serializar({formato: 1, comentarios: lista} satisfies ArquivoComentarios));
  }

  novoComentario(c: Omit<Comentario, 'id' | 'criado_em' | 'estado' | 'respostas'>): Comentario {
    return this.comTrava(() => {
      const lista = this.comentarios();
      const maior = lista.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0);
      const novo: Comentario = {...c, id: `cmt_${String(maior + 1).padStart(4, '0')}`, criado_em: new Date().toISOString(), estado: 'aberto', respostas: []};
      this.gravarComentarios([...lista, novo]);
      return novo;
    });
  }

  alterarComentario(id: string, mudar: (c: Comentario) => Comentario): Comentario {
    return this.comTrava(() => {
      const lista = this.comentarios();
      const i = lista.findIndex((c) => c.id === id);
      if (i < 0) throw new ErroProjeto(`comentário não achado: ${id}`, 'nao_achado');
      lista[i] = mudar(lista[i]);
      this.gravarComentarios(lista);
      return lista[i];
    });
  }

  responder(id: string, autor: string, texto: string) {
    return this.alterarComentario(id, (c) => ({...c, respostas: [...c.respostas, {autor, em: new Date().toISOString(), texto}]}));
  }

  resolver(id: string, por: string, nota?: string) {
    return this.alterarComentario(id, (c) => ({...c, estado: 'resolvido', resolucao: {por, em: new Date().toISOString(), nota}}));
  }

  reabrir(id: string) {
    return this.alterarComentario(id, (c) => ({...c, estado: 'aberto', resolucao: undefined}));
  }

  // ---------- pesquisa (src/nucleo/pesquisa.ts, docs/pesquisa.md) ----------
  // pesquisa/pesquisa.json não é documento do manifesto; as mudanças vão para o diário com o caminho do arquivo, para a
  // pessoa ver no Histórico quem leu cada fonte e registrou cada fato. O Ctrl+Z não as toca (são do agente).
  pesquisa(): Pesquisa {
    if (!this.existe(ARQUIVO_PESQUISA)) return pesquisaVazia();
    return lerPesquisa(this.lerJson<unknown>(ARQUIVO_PESQUISA).doc);
  }

  /** Muda a pesquisa (a função mexe na cópia que recebe) e registra no diário o patch e o inverso. */
  alterarPesquisa<R>(mudar: (p: Pesquisa) => R, quem: {autor: string; origem: string; rotulo: string}): R {
    return this.comTrava(() => this.alterarPesquisaSemTrava(mudar, quem));
  }

  private alterarPesquisaSemTrava<R>(mudar: (p: Pesquisa) => R, quem: {autor: string; origem: string; rotulo: string}): R {
    const existia = this.existe(ARQUIVO_PESQUISA) ? this.lerTexto(ARQUIVO_PESQUISA) : null;
    const textoAntes = existia ?? serializar(pesquisaVazia());
    const antes = this.pesquisa();
    const depois = structuredClone(antes);
    const r = mudar(depois);
    const texto = serializar(depois);
    this.gravarComDiario(ARQUIVO_PESQUISA, existia, texto, {
      seq: this.proximaSeq(),
      em: new Date().toISOString(),
      documento: ARQUIVO_PESQUISA,
      autor: quem.autor,
      origem: quem.origem,
      rotulo: quem.rotulo,
      versao_antes: versaoDe(textoAntes),
      versao_depois: versaoDe(texto),
      patch: jsonpatch.compare(antes, depois) as OperacaoPatch[],
      inverso: jsonpatch.compare(depois, antes) as OperacaoPatch[],
    });
    return r;
  }

  // ---------- plano do vídeo (src/nucleo/plano-video.ts, Onda B) ----------
  // plano.json não é documento do manifesto: como a pesquisa, vai para o diário com o caminho do arquivo (Histórico e
  // Reverter), e o aplicar_patch do MCP não o toca. Quem escreve é a IA (escrever_plano); quem decide é a pessoa.
  plano(): PlanoVideo | null {
    if (!this.existe(ARQUIVO_PLANO)) return null;
    return lerPlano(this.lerJson<unknown>(ARQUIVO_PLANO).doc);
  }

  /** Troca o plano pelo que `mudar` devolve (a partir do atual, ou null) e registra no diário o patch e o inverso. */
  alterarPlano(mudar: (p: PlanoVideo | null) => PlanoVideo, quem: {autor: string; origem: string; rotulo: string}): PlanoVideo {
    return this.comTrava(() => {
      const existia = this.existe(ARQUIVO_PLANO) ? this.lerTexto(ARQUIVO_PLANO) : null;
      const bruto = existia === null ? {} : (this.lerJson<unknown>(ARQUIVO_PLANO).doc ?? {});
      let depois: PlanoVideo;
      try {
        depois = mudar(lerPlano(bruto));
      } catch (e) {
        if (e instanceof ErroPlano) throw new ErroProjeto(e.message, e.tipo);
        throw new ErroProjeto((e as Error).message, 'patch');
      }
      const texto = serializar(depois);
      this.gravarComDiario(ARQUIVO_PLANO, existia, texto, {
        seq: this.proximaSeq(),
        em: new Date().toISOString(),
        documento: ARQUIVO_PLANO,
        autor: quem.autor,
        origem: quem.origem,
        rotulo: quem.rotulo,
        versao_antes: versaoDe(existia ?? serializar({})),
        versao_depois: versaoDe(texto),
        patch: jsonpatch.compare(bruto as object, depois) as OperacaoPatch[],
        inverso: jsonpatch.compare(depois, bruto as object) as OperacaoPatch[],
      });
      return depois;
    });
  }

  /** Texto limpo de uma fonte (pesquisa/fontes/<id>.txt, fora do git). O primeiro texto gravado põe a pasta no
   *  .gitignore de projetos criados antes da pesquisa existir. */
  gravarTextoFonte(id: string, texto: string) {
    this.gravarTexto(caminhoTextoFonte(idDeFonte(id)), texto);
    this.comTrava(() => {
      const ignorar = this.existe('.gitignore') ? this.lerTexto('.gitignore') : '';
      if (!ignorar.split(/\r?\n/).some((l) => /^\/?pesquisa\/fontes\/?$/.test(l.trim()))) {
        this.gravarTexto('.gitignore', `${ignorar}${ignorar && !ignorar.endsWith('\n') ? '\n' : ''}pesquisa/fontes/\n`);
      }
    });
  }

  /** Antes de a fonte relida com outro texto gravar por cima: o texto antigo (em que os fatos foram conferidos) passa
   *  para pesquisa/fontes/<id>.<8 primeiros do sha256 antigo>.txt. Nada da fonte se apaga. Devolve o caminho, ou
   *  undefined se não havia texto na pasta. */
  guardarVersaoTextoFonte(id: string, sha256Antigo: string): string | undefined {
    const atual = caminhoTextoFonte(idDeFonte(id));
    if (!this.existe(atual)) return undefined;
    const sha8 = /^[0-9a-f]{8}/i.exec(sha256Antigo)?.[0]?.toLowerCase() ?? 'anterior';
    const destino = atual.replace(/\.txt$/, `.${sha8}.txt`);
    renomearComRetry(this.caminhoParaGravar(atual), this.caminhoParaGravar(destino));
    return destino;
  }

  lerTextoFonte(id: string): string {
    const rel = caminhoTextoFonte(idDeFonte(id));
    if (!this.existe(rel)) throw new ErroProjeto(textoFonteFaltando(id, rel), 'nao_achado');
    return this.lerTexto(rel);
  }

  /** O mesmo, sem travar quem chama: o painel Pesquisa pede o texto inteiro pelo processo principal. */
  async lerTextoFonteSemTravar(id: string): Promise<string> {
    const rel = caminhoTextoFonte(idDeFonte(id));
    try {
      return await readFile(this.caminho(rel), 'utf-8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new ErroProjeto(textoFonteFaltando(id, rel), 'nao_achado');
      throw e;
    }
  }

  // ---------- estado do editor ----------
  estado(): EstadoEditor | null {
    const rel = path.join(PASTA_INTERNA, 'estado.json');
    return this.existe(rel) ? this.lerJson<EstadoEditor>(rel).doc : null;
  }

  gravarEstado(e: EstadoEditor) {
    this.gravarTexto(path.join(PASTA_INTERNA, 'estado.json'), serializar(e));
  }
}

const textoFonteFaltando = (id: string, rel: string) => `o texto da fonte ${id} não está nesta pasta (${rel} fica fora do git); leia a url de novo com ler_fonte`;

/** Id de fonte (f1, f2…) conferido antes de virar nome de arquivo. */
const idDeFonte = (id: string) => {
  if (!/^f\d+$/.test(id)) throw new ErroProjeto(`id de fonte inválido: ${id} (é f1, f2…)`, 'nao_achado');
  return id;
};

/** Valor de um JSON Pointer dentro do documento (undefined se não existir). */
export const valorEm = (doc: unknown, ponteiro: string): unknown => {
  try {
    return jsonpatch.getValueByPointer(doc, ponteiro);
  } catch {
    return undefined;
  }
};

const resumirPatch = (patch: OperacaoPatch[]) => {
  const ops = patch.filter((o) => o.op !== 'test');
  if (!ops.length) return 'sem mudança';
  if (ops.length === 1) return `${ops[0].op} ${ops[0].path}`;
  return `${ops.length} mudanças (${ops[0].path}…)`;
};

/** O que o índice do diário guarda de cada entrada: o lugar dela no arquivo (`ini`–`fim`, sem a quebra de linha) e
 *  onde começa o patch (para o resumo do Histórico), sem o patch e o inverso. */
type EntradaLeve = Omit<EntradaDiario, 'patch' | 'inverso' | 'versao_antes' | 'versao_depois'> & {ini: number; fim: number; patchIni: number; tem_inverso: boolean};

const TAMANHO_DO_RESUMO = 800;
const CHAVE_PATCH = Buffer.from(',"patch":');
const CHAVE_INVERSO_VAZIO = Buffer.from('"inverso":[]');

/** Uma linha do diário (bytes `a`–`b` de `buf`, que começa em `base` no arquivo) no índice. Lê só o começo (seq, autor,
 *  documento, rótulo…) e o fim (desfaz, transicao), que o JSON.stringify do registro escreve antes do patch e depois do
 *  inverso; o patch e o inverso, que são quase tudo, não passam pelo JSON.parse. Linha fora desse formato (à mão, de
 *  outra versão) é lida inteira; linha quebrada fica de fora. */
const entradaLeve = (buf: Buffer, a: number, b: number, base: number): EntradaLeve | null => {
  while (b > a && (buf[b - 1] === 0x0d || buf[b - 1] === 0x20)) b--;
  if (b <= a) return null;
  const leve = (e: Partial<EntradaDiario> | null, patchIni: number, temInverso: boolean): EntradaLeve | null => {
    if (!e || typeof e.seq !== 'number') return null;
    const {patch: _p, inverso: _i, versao_antes: _a, versao_depois: _d, ...resto} = e;
    return {...(resto as Omit<EntradaLeve, 'ini' | 'fim' | 'patchIni' | 'tem_inverso'>), ini: base + a, fim: base + b, patchIni, tem_inverso: temInverso};
  };
  const k = buf.indexOf(CHAVE_PATCH, a);
  const fecha = buf.lastIndexOf(0x5d, b - 1); // o "]" do inverso, a última lista da linha
  if (k >= 0 && k < b && fecha > k) {
    try {
      const comeco = JSON.parse(`${buf.toString('utf-8', a, k)}}`) as Partial<EntradaDiario>;
      const resto = buf.toString('utf-8', fecha + 1, b);
      const fim = resto === '}' ? {} : resto.startsWith(',') ? JSON.parse(`{${resto.slice(1)}`) as Partial<EntradaDiario> : null;
      if (fim && typeof comeco.seq === 'number') {
        const vazio = fecha + 1 - CHAVE_INVERSO_VAZIO.length;
        const temInverso = !(vazio > k && buf.compare(CHAVE_INVERSO_VAZIO, 0, CHAVE_INVERSO_VAZIO.length, vazio, fecha + 1) === 0);
        const e = Object.assign(comeco, fim) as EntradaLeve; // versao_antes e versao_depois ficam: são curtas
        e.ini = base + a;
        e.fim = base + b;
        e.patchIni = base + k + CHAVE_PATCH.length;
        e.tem_inverso = temInverso;
        return e;
      }
    } catch {
      /* fora do formato: lê inteira */
    }
  }
  try {
    const e = JSON.parse(buf.toString('utf-8', a, b)) as EntradaDiario;
    return leve(e, -1, Array.isArray(e?.inverso) && e.inverso.length > 0);
  } catch {
    return null;
  }
};

/** Lê `buf.length` bytes a partir de `posicao` (readSync pode devolver menos de uma vez); devolve quantos leu. */
const lerTudo = (fd: number, buf: Buffer, posicao: number) => {
  let lidos = 0;
  while (lidos < buf.length) {
    const n = readSync(fd, buf, lidos, buf.length - lidos, posicao + lidos);
    if (n <= 0) break;
    lidos += n;
  }
  return lidos;
};

/** O índice ainda vale para o arquivo: a última entrada indexada continua onde estava (o arquivo não foi reescrito no lugar). */
const continuaIgual = (fd: number, ix: {fim: number; entradas: EntradaLeve[]}) => {
  if (ix.fim === 0) return true;
  const nl = Buffer.alloc(1);
  readSync(fd, nl, 0, 1, ix.fim - 1);
  if (nl[0] !== 0x0a) return false;
  const ultima = ix.entradas.at(-1);
  if (!ultima) return true;
  const buf = Buffer.alloc(ultima.fim - ultima.ini);
  readSync(fd, buf, 0, buf.length, ultima.ini);
  return entradaLeve(buf, 0, buf.length, ultima.ini)?.seq === ultima.seq;
};

/** Seqs revertidos, de trás para a frente: entrada já revertida não conta (um desfazer revertido é um refazer). */
const revertidasDe = (todas: {seq: number; desfaz?: number}[]): Set<number> => {
  const s = new Set<number>();
  for (let i = todas.length - 1; i >= 0; i--) {
    const e = todas[i];
    if (!s.has(e.seq) && e.desfaz !== undefined) s.add(e.desfaz);
  }
  return s;
};

const tocam = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

/** Os "replace" cujo valor ainda deve estar no documento depois do patch: nenhuma operação seguinte do mesmo patch mexe
 *  no mesmo caminho, num de dentro dele ou num que o contém. */
const trocasFinais = (patch: OperacaoPatch[]) =>
  patch.flatMap((op, i) => (op.op === 'replace' && !patch.slice(i + 1).some((d) => tocam(d.path, op.path) || (d.from !== undefined && tocam(d.from, op.path))) ? [op] : []));

/** Entradas do diário num pedaço de texto; pulaPrimeira: o pedaço começa no meio de uma linha. Linha quebrada é pulada. */
const lerLinhas = (texto: string, pulaPrimeira = false): EntradaDiario[] => {
  const linhas = texto.split('\n');
  if (pulaPrimeira) linhas.shift();
  const r: EntradaDiario[] = [];
  for (const l of linhas) {
    if (!l.trim()) continue;
    try {
      const e = JSON.parse(l) as EntradaDiario;
      if (typeof e?.seq === 'number') r.push(e);
    } catch {
      /* linha quebrada: fica de fora */
    }
  }
  return r;
};
