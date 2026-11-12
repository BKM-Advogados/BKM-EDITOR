// Os modelos da pessoa ("Salvar como modelo"): a pasta meus-modelos/ ao lado dos projetos
// (%USERPROFILE%\Estudio\meus-modelos, trocável nas preferências, ESTUDIO_MODELOS fora do app e nos testes), no mesmo jeito
// da pasta dos kits de marca (pasta-marcas.ts). Não é Estudio\modelos: essa guarda os modelos de IA (whisper e MODNet).
// Cada modelo é uma pasta <id>/ com:
//   modelo.json     o nome, a descrição, o tipo (módulo do primeiro documento), o tamanho e os documentos
//   miniatura.jpg   a miniatura do projeto na hora de salvar, se havia (a tela inicial mostra no cartão)
//   projeto/        estudio.json, os documentos e só a mídia que eles citam (midia/ e fontes/)
// Salvar copia o projeto inteiro ou um documento só; nunca leva o diário (.estudio/), o .git, as conversas, saidas/,
// a pesquisa nem os comentários. Criar a partir do modelo monta um Plano (criar-projeto.ts) com esses arquivos, um
// .gitignore e um CLAUDE.md novos: o projeto nasce limpo, como um de fábrica. Os modelos de fábrica (modelos.ts) não
// moram aqui, então não se renomeiam nem se removem. Serve à tela (ipc-modelos.ts) e ao MCP (mcp-modelos.ts).
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {claudeMd, GITIGNORE, type Plano} from './criar-projeto';
import type {EntradaDocumento, Manifesto, Modulo} from './documentos';
import {gravarAtomico} from './gravar-seguro';
import {dentroDe, ErroProjeto, semBom, serializar, type Projeto} from './projeto';

export const ARQUIVO_MODELO = 'modelo.json';
export const PASTA_DO_PROJETO = 'projeto';
export const MINIATURA_DO_MODELO = 'miniatura.jpg';
/** Pastas do projeto de onde sai a mídia que os documentos citam. */
const PASTAS_DE_MIDIA = ['midia', 'fontes'];

export type ModeloProprio = {
  formato: 1;
  id: string; // o nome da pasta
  nome: string;
  descricao?: string;
  modulo: Modulo; // o do primeiro documento: a tela inicial mostra o modelo nesse tipo
  largura?: number;
  altura?: number;
  documentos: {id: string; modulo: Modulo; titulo: string}[];
  criado_em: string;
  de_projeto?: string; // o nome do projeto de onde saiu
};

/** Um modelo lido do disco: os dados, a pasta e a miniatura (data URL), se houver. */
export type ModeloLido = ModeloProprio & {pasta: string; miniatura?: string};

/** Pasta padrão, ao lado dos projetos. ESTUDIO_MODELOS aponta outra (o MCP fora do app e os testes usam). */
export const pastaPadraoModelos = () => process.env.ESTUDIO_MODELOS || path.join(os.homedir(), 'Estudio', 'meus-modelos'); // modelos/ é a do whisper e do MODNet

let configurada: (() => string) | null = null;
/** O app diz onde fica a pasta (preferências); sem isso, a padrão. */
export const definirPastaModelos = (f: (() => string) | null) => {
  configurada = f;
};
export const pastaModelos = () => configurada?.() || pastaPadraoModelos();

/** Os caminhos de mídia (midia/… e fontes/…) que aparecem como valor em qualquer lugar do documento. */
export const midiaCitada = (doc: unknown): string[] => {
  const achados = new Set<string>();
  const andar = (x: unknown) => {
    if (typeof x === 'string') {
      const s = x.replace(/\\/g, '/');
      if (PASTAS_DE_MIDIA.some((p) => s.startsWith(`${p}/`)) && !s.split('/').includes('..')) achados.add(s);
    } else if (Array.isArray(x)) x.forEach(andar);
    else if (x && typeof x === 'object') Object.values(x).forEach(andar);
  };
  andar(doc);
  return [...achados].sort();
};

/** Tamanho do documento, se ele tiver: vídeo de cenas e animação em `formato`, imagem na raiz. */
const tamanhoDe = (doc: unknown): {largura?: number; altura?: number} => {
  const o = (doc ?? {}) as {formato?: {largura?: unknown; altura?: unknown}; largura?: unknown; altura?: unknown};
  const l = typeof o.formato?.largura === 'number' ? o.formato.largura : o.largura;
  const a = typeof o.formato?.altura === 'number' ? o.formato.altura : o.altura;
  return typeof l === 'number' && typeof a === 'number' ? {largura: l, altura: a} : {};
};

const MODULOS: Modulo[] = ['video', 'imagem', '3d', 'musica', 'animacao'];

/** O modelo.json lido como veio, com o que falta preenchido (um arquivo mexido à mão não derruba a lista). */
const normalizar = (bruto: unknown, id: string): ModeloProprio => {
  const o = (bruto ?? {}) as Partial<ModeloProprio>;
  const docs = Array.isArray(o.documentos) ? o.documentos.filter((d) => d && typeof d.id === 'string' && MODULOS.includes(d.modulo)) : [];
  const modulo = MODULOS.includes(o.modulo as Modulo) ? (o.modulo as Modulo) : docs[0]?.modulo ?? 'video';
  return {
    formato: 1,
    id,
    nome: typeof o.nome === 'string' && o.nome.trim() ? o.nome.trim() : id,
    ...(typeof o.descricao === 'string' && o.descricao.trim() ? {descricao: o.descricao.trim()} : {}),
    modulo,
    ...(typeof o.largura === 'number' && typeof o.altura === 'number' ? {largura: o.largura, altura: o.altura} : {}),
    documentos: docs.map((d) => ({id: d.id, modulo: d.modulo, titulo: typeof d.titulo === 'string' ? d.titulo : d.id})),
    criado_em: typeof o.criado_em === 'string' ? o.criado_em : new Date(0).toISOString(),
    ...(typeof o.de_projeto === 'string' && o.de_projeto ? {de_projeto: o.de_projeto} : {}),
  };
};

/** Os arquivos de uma pasta, em caminhos relativos com "/", sem seguir para fora dela. */
const arquivosDe = (raiz: string, rel: string): string[] => {
  const abs = path.join(raiz, rel);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, {withFileTypes: true}).flatMap((d) => {
    const r = `${rel}/${d.name}`;
    if (d.isDirectory()) return arquivosDe(raiz, r);
    return d.isFile() ? [r] : [];
  });
};

export class PastaModelos {
  constructor(private readonly opcoes: {pasta?: () => string} = {}) {}

  get pasta() {
    return this.opcoes.pasta?.() || pastaModelos();
  }

  /** A pasta de um modelo. Recusa id que sai da pasta dos modelos ("..", com barra). */
  pastaDe(id: string) {
    if (!id || id === '.' || id === '..' || /[\\/]/.test(id) || id.startsWith('.')) throw new ErroProjeto(`id de modelo inválido: ${id}`, 'caminho');
    return path.join(this.pasta, id);
  }

  /** Os modelos da pessoa, por nome. */
  listar(): ModeloLido[] {
    if (!existsSync(this.pasta)) return [];
    return readdirSync(this.pasta, {withFileTypes: true})
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && existsSync(path.join(this.pasta, d.name, ARQUIVO_MODELO)))
      .flatMap((d) => {
        try {
          return [this.ler(d.name)];
        } catch {
          return []; // modelo.json ilegível: fica fora da lista, sem derrubar as outras
        }
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  ler(id: string): ModeloLido {
    const pasta = this.pastaDe(id);
    const arq = path.join(pasta, ARQUIVO_MODELO);
    if (!existsSync(arq)) throw new ErroProjeto(`modelo não achado: ${id} (em ${this.pasta})`, 'nao_achado');
    let bruto: unknown;
    try {
      bruto = JSON.parse(semBom(readFileSync(arq, 'utf-8')));
    } catch (e) {
      throw new ErroProjeto(`${arq} não é um JSON válido (${(e as Error).message})`, 'patch');
    }
    const mini = path.join(pasta, MINIATURA_DO_MODELO);
    let miniatura: string | undefined;
    try {
      if (existsSync(mini)) miniatura = `data:image/jpeg;base64,${readFileSync(mini).toString('base64')}`;
    } catch {
      /* sem miniatura: o cartão desenha a moldura */
    }
    return {...normalizar(bruto, id), pasta, ...(miniatura ? {miniatura} : {})};
  }

  /** Id que ainda não tem pasta: "carrossel-semanal", "carrossel-semanal-2"… */
  idLivre(nome: string) {
    const b = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'modelo';
    let id = b;
    for (let n = 2; existsSync(this.pastaDe(id)); n++) id = `${b}-${n}`;
    return id;
  }

  /** Salva o projeto (ou só `documento`, id ou caminho) como modelo novo. Copia os documentos e a mídia que eles citam;
   *  o resto do projeto fica onde está. Grava numa pasta temporária e só então dá o nome: modelo pela metade não aparece. */
  salvar(projeto: Projeto, o: {nome: string; descricao?: string; documento?: string}): ModeloLido & {copiados: string[]; faltando: string[]} {
    const nome = o.nome.trim();
    if (!nome) throw new ErroProjeto('dê um nome ao modelo', 'patch');
    const manifesto = projeto.manifesto();
    let entradas: EntradaDocumento[] = manifesto.documentos;
    if (o.documento) {
      const rel = projeto.arquivoDoDocumento(o.documento);
      entradas = manifesto.documentos.filter((d) => d.caminho === rel);
    }
    if (!entradas.length) throw new ErroProjeto('o projeto não tem documento para virar modelo', 'nao_achado');
    const textos = entradas.map((e) => ({e, texto: projeto.lerTexto(e.caminho)}));
    const docs = textos.map(({e, texto}) => {
      try {
        return {e, doc: JSON.parse(texto) as unknown};
      } catch (err) {
        throw new ErroProjeto(`${e.caminho} não é um JSON válido (${(err as Error).message})`, 'patch');
      }
    });
    const citados = [...new Set(docs.flatMap(({doc}) => midiaCitada(doc)))];
    const copiados: string[] = [];
    const faltando: string[] = [];
    const id = this.idLivre(nome);
    mkdirSync(this.pasta, {recursive: true});
    const tmp = path.join(this.pasta, `.${id}.${process.pid}.${Date.now()}.tmp`);
    try {
      const base = path.join(tmp, PASTA_DO_PROJETO);
      mkdirSync(base, {recursive: true});
      const novoManifesto: Manifesto = {formato: 1, nome, documentos: entradas.map((e) => ({...e}))};
      writeFileSync(path.join(base, 'estudio.json'), serializar(novoManifesto), 'utf-8');
      for (const {e, texto} of textos) {
        mkdirSync(path.dirname(path.join(base, e.caminho)), {recursive: true});
        writeFileSync(path.join(base, e.caminho), texto, 'utf-8');
      }
      for (const rel of citados) {
        let de: string;
        try {
          de = projeto.caminho(rel);
        } catch {
          faltando.push(rel);
          continue;
        }
        if (!existsSync(de) || !statSync(de).isFile()) {
          faltando.push(rel);
          continue;
        }
        mkdirSync(path.dirname(path.join(base, rel)), {recursive: true});
        copyFileSync(de, path.join(base, rel));
        copiados.push(rel);
      }
      const mini = path.join(projeto.raiz, '.estudio', 'miniatura.jpg');
      if (!o.documento && existsSync(mini)) copyFileSync(mini, path.join(tmp, MINIATURA_DO_MODELO));
      const primeiro = docs[0];
      const dados: ModeloProprio = {
        formato: 1, id, nome, ...(o.descricao?.trim() ? {descricao: o.descricao.trim()} : {}),
        modulo: primeiro.e.modulo, ...tamanhoDe(primeiro.doc),
        documentos: entradas.map((e) => ({id: e.id, modulo: e.modulo, titulo: e.titulo})),
        criado_em: new Date().toISOString(), de_projeto: manifesto.nome,
      };
      writeFileSync(path.join(tmp, ARQUIVO_MODELO), serializar(dados), 'utf-8');
      renameSync(tmp, this.pastaDe(id));
    } catch (e) {
      rmSync(tmp, {recursive: true, force: true});
      throw e;
    }
    return {...this.ler(id), copiados, faltando};
  }

  /** Troca o nome (e a descrição, se vier). O id, que é a pasta, fica. */
  renomear(id: string, nome: string, descricao?: string): ModeloLido {
    const n = nome.trim();
    if (!n) throw new ErroProjeto('dê um nome ao modelo', 'patch');
    const {pasta: _p, miniatura: _m, ...m} = this.ler(id);
    const d = descricao === undefined ? m.descricao : descricao.trim() || undefined;
    const {descricao: _d, ...resto} = m;
    gravarAtomico(path.join(this.pastaDe(id), ARQUIVO_MODELO), serializar({...resto, nome: n, ...(d ? {descricao: d} : {})}));
    return this.ler(id);
  }

  /** Apaga a pasta do modelo. Os projetos criados a partir dele não mudam. */
  remover(id: string) {
    const pasta = this.pastaDe(id);
    if (!existsSync(path.join(pasta, ARQUIVO_MODELO))) throw new ErroProjeto(`modelo não achado: ${id}`, 'nao_achado');
    rmSync(pasta, {recursive: true, force: true});
  }

  /** Os arquivos de um projeto novo a partir do modelo (sem gravar nada): os documentos e a mídia dele, um .gitignore e
   *  um CLAUDE.md novos. `gravarPlano` grava; `aplicarMarcaAoPlano` troca o tema por um kit, como nos de fábrica. */
  plano(id: string, nome: string): Plano {
    const m = this.ler(id);
    const base = path.join(m.pasta, PASTA_DO_PROJETO);
    let manifesto: Manifesto;
    try {
      manifesto = JSON.parse(semBom(readFileSync(path.join(base, 'estudio.json'), 'utf-8'))) as Manifesto;
    } catch (e) {
      throw new ErroProjeto(`o modelo ${m.nome} está sem o estudio.json (${(e as Error).message})`, 'nao_achado');
    }
    const novo: Manifesto = {...manifesto, nome: nome.trim() || m.nome};
    const arquivos: Record<string, string> = {'estudio.json': serializar(novo), '.gitignore': GITIGNORE};
    for (const d of novo.documentos ?? []) {
      const abs = path.resolve(base, d.caminho);
      if (!dentroDe(base, abs) || !existsSync(abs)) throw new ErroProjeto(`o modelo ${m.nome} está sem o documento ${d.caminho}`, 'nao_achado');
      arquivos[d.caminho] = semBom(readFileSync(abs, 'utf-8'));
    }
    arquivos['CLAUDE.md'] = claudeMd([...new Set((novo.documentos ?? []).map((d) => d.modulo))]);
    const copiar = PASTAS_DE_MIDIA.flatMap((p) => arquivosDe(base, p)).map((rel) => ({de: path.join(base, rel), para: rel}));
    return {manifesto: novo, arquivos, pastas: ['midia', 'saidas', '.estudio'], ...(copiar.length ? {copiar} : {})};
  }
}
