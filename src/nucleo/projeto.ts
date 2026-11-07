// Acesso à pasta do projeto, comum ao processo principal do app e ao servidor MCP que o Claude usa no terminal.
// Toda escrita em documento passa por aplicarPatch: confere a versão (lock otimista), aplica o JSON Patch de forma
// atômica (os "test" falham antes de qualquer mudança), grava, e registra a mudança com o patch inverso no diário.
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import jsonpatch, {type Operation} from 'fast-json-patch';
import type {ArquivoComentarios, Comentario, EntradaDiario, EntradaDocumento, EstadoEditor, Manifesto, OperacaoPatch} from './documentos';
import {ARQUIVO_PESQUISA, caminhoTextoFonte, lerPesquisa, pesquisaVazia, type Pesquisa} from './pesquisa';

export const PASTA_INTERNA = '.estudio';

export class ErroProjeto extends Error {
  constructor(message: string, readonly codigo: 'conflito' | 'patch' | 'caminho' | 'nao_achado' = 'patch') {
    super(message);
  }
}

export const versaoDe = (texto: string) => createHash('sha256').update(texto).digest('hex').slice(0, 12);

export const serializar = (doc: unknown) => `${JSON.stringify(doc, null, 2)}\n`;

export class Projeto {
  constructor(readonly raiz: string) {}

  /** Caminho absoluto de um arquivo do projeto; recusa sair da pasta. */
  caminho(rel: string): string {
    const abs = path.resolve(this.raiz, rel);
    const dentro = path.relative(this.raiz, abs);
    if (dentro.startsWith('..') || path.isAbsolute(dentro)) throw new ErroProjeto(`caminho fora do projeto: ${rel}`, 'caminho');
    return abs;
  }

  existe(rel: string) {
    return existsSync(this.caminho(rel));
  }

  lerTexto(rel: string): string {
    const abs = this.caminho(rel);
    if (!existsSync(abs)) throw new ErroProjeto(`arquivo não achado: ${rel}`, 'nao_achado');
    return readFileSync(abs, 'utf-8');
  }

  lerJson<T>(rel: string): {doc: T; versao: string} {
    const texto = this.lerTexto(rel);
    try {
      return {doc: JSON.parse(texto) as T, versao: versaoDe(texto)};
    } catch (e) {
      throw new ErroProjeto(`${rel} não é um JSON válido (${(e as Error).message}); desfaça a última mudança no arquivo`, 'patch');
    }
  }

  /** Grava de forma atômica (arquivo temporário + rename), para o observador nunca ler meio arquivo. */
  gravarTexto(rel: string, texto: string) {
    const abs = this.caminho(rel);
    mkdirSync(path.dirname(abs), {recursive: true});
    const tmp = `${abs}.${process.pid}.tmp`;
    writeFileSync(tmp, texto, 'utf-8');
    renameSync(tmp, abs);
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
    const m = {...this.manifesto(), nome: limpo};
    this.gravarManifesto(m);
    return m;
  }

  /** Grava o arquivo de um documento novo e o põe no manifesto (o conteúdo vem de criar-projeto.ts). */
  adicionarDocumento(entrada: EntradaDocumento, conteudo: unknown): EntradaDocumento {
    const m = this.manifesto();
    if (m.documentos.some((d) => d.id === entrada.id || d.caminho === entrada.caminho)) throw new ErroProjeto(`já existe o documento ${entrada.id}`, 'conflito');
    if (this.existe(entrada.caminho)) throw new ErroProjeto(`o arquivo ${entrada.caminho} já existe`, 'conflito');
    this.gravarTexto(entrada.caminho, serializar(conteudo));
    this.gravarManifesto({...m, documentos: [...m.documentos, entrada]});
    return entrada;
  }

  renomearDocumento(id: string, titulo: string): EntradaDocumento {
    const m = this.manifesto();
    const i = m.documentos.findIndex((d) => d.id === id);
    if (i < 0) throw new ErroProjeto(`documento não achado: ${id}`, 'nao_achado');
    const documentos = [...m.documentos];
    documentos[i] = {...documentos[i], titulo: titulo.trim() || documentos[i].titulo};
    this.gravarManifesto({...m, documentos});
    return documentos[i];
  }

  /** Caminho do arquivo de um documento, pelo id do manifesto ou pelo próprio caminho. */
  arquivoDoDocumento(idOuCaminho: string): string {
    const m = this.manifesto();
    const e = m.documentos.find((d) => d.id === idOuCaminho || d.caminho === idOuCaminho);
    if (!e) throw new ErroProjeto(`documento não achado: ${idOuCaminho} (ids: ${m.documentos.map((d) => d.id).join(', ')})`, 'nao_achado');
    return e.caminho;
  }

  // ---------- patches e diário ----------
  aplicarPatch(entrada: {
    documento: string;
    patch: OperacaoPatch[];
    versao_base?: string;
    autor: string;
    origem: string;
    rotulo?: string;
  }): {versao: string; entrada: EntradaDiario} {
    const rel = this.arquivoDoDocumento(entrada.documento);
    const {doc, versao} = this.lerJson<unknown>(rel);
    if (entrada.versao_base && entrada.versao_base !== versao) {
      throw new ErroProjeto(`o documento mudou (versão ${versao}, esperada ${entrada.versao_base}); leia de novo e refaça o patch`, 'conflito');
    }
    const erro = jsonpatch.validate(entrada.patch as Operation[], doc);
    if (erro) throw new ErroProjeto(`patch inválido: ${erro.name} em ${erro.operation?.path ?? '?'}: ${erro.message.split('\n')[0]}`);
    let depois: unknown;
    try {
      depois = jsonpatch.applyPatch(doc, entrada.patch as Operation[], true, false).newDocument;
    } catch (e) {
      throw new ErroProjeto(`patch recusado: ${(e as Error).message.split('\n')[0]}`);
    }
    const texto = serializar(depois);
    const versaoDepois = versaoDe(texto);
    this.gravarTexto(rel, texto);
    const registro: EntradaDiario = {
      seq: this.proximaSeq(),
      em: new Date().toISOString(),
      documento: rel,
      autor: entrada.autor,
      origem: entrada.origem,
      rotulo: entrada.rotulo ?? resumirPatch(entrada.patch),
      versao_antes: versao,
      versao_depois: versaoDepois,
      patch: entrada.patch.filter((o) => o.op !== 'test'),
      inverso: jsonpatch.compare(depois as object, doc as object) as OperacaoPatch[],
    };
    this.registrar(registro);
    return {versao: versaoDepois, entrada: registro};
  }

  private arquivoDiario() {
    return path.join(PASTA_INTERNA, 'diario.jsonl');
  }

  diario(desde = 0): EntradaDiario[] {
    if (!this.existe(this.arquivoDiario())) return [];
    return this.lerTexto(this.arquivoDiario())
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as EntradaDiario)
      .filter((e) => e.seq > desde);
  }

  private proximaSeq() {
    const todas = this.diario();
    return todas.length ? todas[todas.length - 1].seq + 1 : 1;
  }

  registrar(e: EntradaDiario) {
    const abs = this.caminho(this.arquivoDiario());
    mkdirSync(path.dirname(abs), {recursive: true});
    appendFileSync(abs, `${JSON.stringify(e)}\n`, 'utf-8');
  }

  // ---------- comentários ----------
  comentarios(): Comentario[] {
    if (!this.existe('comentarios.json')) return [];
    return this.lerJson<ArquivoComentarios>('comentarios.json').doc.comentarios;
  }

  private gravarComentarios(lista: Comentario[]) {
    this.gravarTexto('comentarios.json', serializar({formato: 1, comentarios: lista} satisfies ArquivoComentarios));
  }

  novoComentario(c: Omit<Comentario, 'id' | 'criado_em' | 'estado' | 'respostas'>): Comentario {
    const lista = this.comentarios();
    const maior = lista.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0);
    const novo: Comentario = {...c, id: `cmt_${String(maior + 1).padStart(4, '0')}`, criado_em: new Date().toISOString(), estado: 'aberto', respostas: []};
    this.gravarComentarios([...lista, novo]);
    return novo;
  }

  alterarComentario(id: string, mudar: (c: Comentario) => Comentario): Comentario {
    const lista = this.comentarios();
    const i = lista.findIndex((c) => c.id === id);
    if (i < 0) throw new ErroProjeto(`comentário não achado: ${id}`, 'nao_achado');
    lista[i] = mudar(lista[i]);
    this.gravarComentarios(lista);
    return lista[i];
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

  gravarPesquisa(p: Pesquisa) {
    this.gravarTexto(ARQUIVO_PESQUISA, serializar(p));
  }

  /** Muda a pesquisa (a função mexe na cópia que recebe) e registra no diário o patch e o inverso. */
  alterarPesquisa<R>(mudar: (p: Pesquisa) => R, quem: {autor: string; origem: string; rotulo: string}): R {
    const textoAntes = this.existe(ARQUIVO_PESQUISA) ? this.lerTexto(ARQUIVO_PESQUISA) : serializar(pesquisaVazia());
    const antes = this.pesquisa();
    const depois = structuredClone(antes);
    const r = mudar(depois);
    const texto = serializar(depois);
    this.gravarTexto(ARQUIVO_PESQUISA, texto);
    this.registrar({
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

  /** Texto limpo de uma fonte (pesquisa/fontes/<id>.txt, fora do git). O primeiro texto gravado põe a pasta no
   *  .gitignore de projetos criados antes da pesquisa existir. */
  gravarTextoFonte(id: string, texto: string) {
    this.gravarTexto(caminhoTextoFonte(idDeFonte(id)), texto);
    const ignorar = this.existe('.gitignore') ? this.lerTexto('.gitignore') : '';
    if (!ignorar.split(/\r?\n/).some((l) => /^\/?pesquisa\/fontes\/?$/.test(l.trim()))) {
      this.gravarTexto('.gitignore', `${ignorar}${ignorar && !ignorar.endsWith('\n') ? '\n' : ''}pesquisa/fontes/\n`);
    }
  }

  /** Antes de a fonte relida com outro texto gravar por cima: o texto antigo (em que os fatos foram conferidos) passa
   *  para pesquisa/fontes/<id>.<8 primeiros do sha256 antigo>.txt. Nada da fonte se apaga. Devolve o caminho, ou
   *  undefined se não havia texto na pasta. */
  guardarVersaoTextoFonte(id: string, sha256Antigo: string): string | undefined {
    const atual = caminhoTextoFonte(idDeFonte(id));
    if (!this.existe(atual)) return undefined;
    const sha8 = /^[0-9a-f]{8}/i.exec(sha256Antigo)?.[0]?.toLowerCase() ?? 'anterior';
    const destino = atual.replace(/\.txt$/, `.${sha8}.txt`);
    renameSync(this.caminho(atual), this.caminho(destino));
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
