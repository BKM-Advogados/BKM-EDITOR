// A pasta dos kits de marca no disco (%USERPROFILE%\Estudio\marcas, trocável nas preferências): lista, lê, grava,
// duplica, importa logo e fontes e aplica um kit a um documento do projeto, copiando o logo para midia/ e as fontes
// para fontes/ antes do patch no tema. Serve ao processo principal (IPC) e às ferramentas do MCP, dentro e fora do app.
import {copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {ARQUIVO_MARCA, arquivosDaMarca, EXTENSOES_FONTE, EXTENSOES_LOGO, idDeMarca, inferirFonte, MARCA_NEUTRO, MARCA_NEUTRO_ANTIGO, MARCAS_INICIAIS, normalizarMarca, PASTA_FONTES,
  patchDaMarca, temaDaMarca, type FonteArquivo, type Marca} from './marca';
import {lerEixoDePeso} from './fonte-variavel';
import {gravarAtomico} from './gravar-seguro';
import {dentroDe, ErroProjeto, semBom, serializar, type Projeto} from './projeto';

/** Um kit lido do disco: o kit e a pasta dele. */
export type MarcaLida = Marca & {pasta: string};

/** Pasta padrão, ao lado dos projetos. ESTUDIO_MARCAS aponta outra (o MCP fora do app e os testes usam). */
export const pastaPadraoMarcas = () => process.env.ESTUDIO_MARCAS || path.join(os.homedir(), 'Estudio', 'marcas');

let configurada: (() => string) | null = null;
/** O app diz onde fica a pasta (preferências); sem isso, a padrão. */
export const definirPastaMarcas = (f: (() => string) | null) => {
  configurada = f;
};
export const pastaMarcas = () => configurada?.() || pastaPadraoMarcas();

/** Família, peso e estilo de um arquivo de fonte: pelo nome do arquivo e, se ele é variável, pela faixa do eixo de peso que
 *  a própria fonte declara (fica o 100 a 900 do nome quando o WOFF2 não deixa ler). */
export const fonteDoArquivo = (arquivo: string): Omit<FonteArquivo, 'arquivo'> => {
  const nome = inferirFonte(arquivo);
  try {
    const eixo = lerEixoDePeso(readFileSync(arquivo), (b) => zlib.inflateSync(b));
    if (eixo.variavel && eixo.min !== undefined && eixo.max !== undefined && eixo.max > eixo.min) return {...nome, peso: eixo.min, peso_max: eixo.max};
    if (eixo.variavel && nome.peso_max === undefined) return {...nome, peso: 100, peso_max: 900};
    if (!eixo.variavel && nome.peso_max !== undefined && !/\.woff2$/i.test(arquivo)) return {familia: nome.familia, peso: 400, ...(nome.estilo ? {estilo: nome.estilo} : {})};
  } catch {
    /* arquivo ilegível: vale o nome */
  }
  return nome;
};

const ORDEM = new Map(MARCAS_INICIAIS.map((m, i) => [m.id, i]));

/** O JSON com as chaves em ordem e o hex em maiúscula, para comparar dois kits sem ligar para a forma de gravar. */
const canonico = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(canonico);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonico((v as Record<string, unknown>)[k])]));
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toUpperCase() : v;
};
const ANTIGO = JSON.stringify(canonico(MARCA_NEUTRO_ANTIGO));
/** Pastas em que o Neutro antigo já foi conferido nesta execução: a conferência lê um arquivo só, uma vez. */
const conferidas = new Set<string>();

export class PastaMarcas {
  constructor(private readonly opcoes: {pasta?: () => string} = {}) {}

  get pasta() {
    return this.opcoes.pasta?.() || pastaMarcas();
  }

  /** A pasta de um kit. Recusa id que sai da pasta dos kits ("..", "../fora", com barra); nome criado à mão ("Minha
   *  Marca") continua valendo. */
  pastaDe(id: string) {
    if (!id || id === '.' || id === '..' || /[\\/]/.test(id)) throw new ErroProjeto(`id de kit inválido: ${id}`, 'caminho');
    return path.join(this.pasta, id);
  }

  /** Os kits de fábrica que faltarem (hoje só o neutro). Kit que já está na pasta, de fábrica ou não, fica como está; a
   *  exceção é o Neutro gravado antes da reformulação e nunca mexido, que vira o de hoje (destaque branco). */
  garantir() {
    for (const m of MARCAS_INICIAIS) {
      if (existsSync(path.join(this.pastaDe(m.id), ARQUIVO_MARCA))) continue;
      this.gravar(m);
    }
    this.atualizarNeutroAntigo();
  }

  /** Troca o marca.json do Neutro pelo de hoje só se ele é idêntico ao de fábrica antigo (fora a ordem das chaves e a
   *  caixa do hex). Qualquer mudança da pessoa (cor, fonte, nome, nota, logo) deixa o kit como está. Uma vez por pasta. */
  private atualizarNeutroAntigo() {
    const pasta = this.pasta;
    if (conferidas.has(pasta)) return;
    conferidas.add(pasta);
    const arq = path.join(pasta, MARCA_NEUTRO.id, ARQUIVO_MARCA);
    try {
      if (!existsSync(arq)) return;
      if (JSON.stringify(canonico(JSON.parse(semBom(readFileSync(arq, 'utf-8'))))) !== ANTIGO) return;
      this.gravar(MARCA_NEUTRO);
    } catch {
      /* ilegível ou disco indisponível: fica como está */
    }
  }

  /** Os kits, com os de fábrica primeiro e os outros por nome. */
  listar(): MarcaLida[] {
    if (!existsSync(this.pasta)) return [];
    this.atualizarNeutroAntigo();
    return readdirSync(this.pasta, {withFileTypes: true})
      .filter((d) => d.isDirectory() && existsSync(path.join(this.pasta, d.name, ARQUIVO_MARCA)))
      .map((d) => this.ler(d.name))
      .sort((a, b) => (ORDEM.get(a.id) ?? 99) - (ORDEM.get(b.id) ?? 99) || a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  ler(id: string): MarcaLida {
    const pasta = this.pastaDe(id);
    const arq = path.join(pasta, ARQUIVO_MARCA);
    if (!existsSync(arq) && ORDEM.has(id)) this.garantir();
    if (!existsSync(arq)) throw new ErroProjeto(`kit de marca não achado: ${id} (em ${this.pasta})`, 'nao_achado');
    let bruto: unknown;
    try {
      bruto = JSON.parse(semBom(readFileSync(arq, 'utf-8')));
    } catch (e) {
      throw new ErroProjeto(`${arq} não é um JSON válido (${(e as Error).message})`, 'patch');
    }
    // o id é sempre o nome da pasta, mesmo que o arquivo diga outro
    return {...normalizarMarca(bruto, id), id, pasta};
  }

  /** Grava (cria ou atualiza) o marca.json e devolve como ficou. Logo e fontes entram por importarLogo e importarFonte. */
  gravar(m: Marca): MarcaLida {
    const limpa = normalizarMarca(m, m.id);
    const pasta = this.pastaDe(limpa.id);
    mkdirSync(pasta, {recursive: true});
    gravarAtomico(path.join(pasta, ARQUIVO_MARCA), serializar(limpa));
    return {...limpa, pasta};
  }

  /** Id que ainda não tem pasta: "escritorio-2", "escritorio-3"… */
  idLivre(base: string) {
    const b = idDeMarca(base);
    let id = b;
    for (let n = 2; existsSync(this.pastaDe(id)); n++) id = `${b}-${n}`;
    return id;
  }

  /** Kit novo, em branco (as cores do neutro), com o nome dado. */
  criar(nome: string): MarcaLida {
    const n = nome.trim() || 'Nova marca';
    return this.gravar({...MARCA_NEUTRO, id: this.idLivre(n), nome: n, notas: undefined});
  }

  /** Cópia inteira (logo e fontes junto) com id e nome novos. */
  duplicar(id: string, nome: string): MarcaLida {
    const origem = this.ler(id);
    const n = nome.trim() || `${origem.nome} (cópia)`;
    const novo = this.idLivre(n);
    cpSync(origem.pasta, this.pastaDe(novo), {recursive: true});
    return this.gravar({...origem, id: novo, nome: n});
  }

  /** Copia a imagem para a pasta do kit como logo.<ext> e aponta o kit para ela. */
  importarLogo(id: string, origem: string): MarcaLida {
    const m = this.ler(id);
    const ext = path.extname(origem).toLowerCase();
    if (!EXTENSOES_LOGO.includes(ext)) throw new ErroProjeto(`logo em "${ext || 'sem extensão'}": use ${EXTENSOES_LOGO.join(', ')}`, 'patch');
    const nome = `logo${ext}`;
    copyFileSync(origem, path.join(m.pasta, nome));
    if (m.logo && m.logo !== nome) rmSync(path.join(m.pasta, m.logo), {force: true});
    return this.gravar({...m, logo: nome});
  }

  /** Copia o arquivo de fonte para fontes/ do kit; família, peso e estilo vêm do nome do arquivo quando não são ditos. */
  importarFonte(id: string, origem: string, dados: Partial<Omit<FonteArquivo, 'arquivo'>> = {}): MarcaLida {
    const m = this.ler(id);
    const ext = path.extname(origem).toLowerCase();
    if (!EXTENSOES_FONTE.includes(ext)) throw new ErroProjeto(`fonte em "${ext || 'sem extensão'}": use ${EXTENSOES_FONTE.join(', ')}`, 'patch');
    mkdirSync(path.join(m.pasta, PASTA_FONTES), {recursive: true});
    const rel = `${PASTA_FONTES}/${path.basename(origem)}`;
    copyFileSync(origem, path.join(m.pasta, rel));
    const inferido = fonteDoArquivo(origem);
    const peso = dados.peso ?? inferido.peso;
    const pesoMax = dados.peso !== undefined ? dados.peso_max : inferido.peso_max; // peso dito à mão vale um peso só
    const nova: FonteArquivo = {familia: dados.familia?.trim() || inferido.familia, arquivo: rel, peso, ...(pesoMax ? {peso_max: pesoMax} : {}),
      ...((dados.estilo ?? inferido.estilo) === 'italic' ? {estilo: 'italic' as const} : {})};
    return this.gravar({...m, fontes: {...m.fontes, arquivos: [...m.fontes.arquivos.filter((f) => f.arquivo !== rel), nova]}});
  }

  /** Aplica o kit a um documento do projeto: copia o logo (midia/) e as fontes (fontes/) que faltam, troca os que mudaram
   *  no kit (`atualizados`) e troca o tema por patch, que vai para o diário com o autor. */
  aplicar(projeto: Projeto, id: string, documento: string, o: {autor: string; origem: string}) {
    return projeto.comTrava(() => this.aplicarSemTrava(projeto, id, documento, o));
  }

  private aplicarSemTrava(projeto: Projeto, id: string, documento: string, o: {autor: string; origem: string}) {
    const m = this.ler(id);
    const rel = projeto.arquivoDoDocumento(documento);
    const {doc} = projeto.lerJson<unknown>(rel);
    const {copiar, logo, fontes_arquivos} = arquivosDaMarca(m);
    const copiados: string[] = [];
    const atualizados: string[] = [];
    // fora da pasta do kit (um marca.json com "../"), ou que não está mais lá: não copia, e o tema não o cita
    const validos = copiar.filter((c) => {
      const de = path.join(m.pasta, c.de);
      return dentroDe(m.pasta, de) && existsSync(de);
    });
    const presentes = new Set(validos.map((c) => c.para));
    const tema = temaDaMarca(m, {logo: logo && presentes.has(logo) ? logo : undefined, fontes_arquivos: fontes_arquivos.filter((f) => presentes.has(f.arquivo))});
    const patch = patchDaMarca(doc, m, tema);
    // recusa antes de copiar: documento que não recebe kit não ganha logo nem fonte no projeto
    if (!patch.length) throw new ErroProjeto(`o documento ${documento} não recebe kit de marca (só vídeo de cenas, imagem e animação)`, 'patch');
    for (const c of validos) {
      const de = path.join(m.pasta, c.de);
      const para = projeto.caminhoParaGravar(c.para); // midia/ ou fontes/ ligadas para fora por link: não copia para lá
      const jaTem = existsSync(para);
      if (jaTem && readFileSync(de).equals(readFileSync(para))) continue;
      mkdirSync(path.dirname(para), {recursive: true});
      copyFileSync(de, para); // o kit manda: logo e fonte novos com o mesmo nome trocam os que o projeto já tinha
      (jaTem ? atualizados : copiados).push(c.para);
    }
    const r = projeto.aplicarPatch({documento, patch, autor: o.autor, origem: o.origem, rotulo: `kit de marca: ${m.nome}`});
    return {versao: r.versao, seq: r.entrada.seq, marca: m.id, nome: m.nome, copiados, atualizados, tema};
  }

}

/** As fontes próprias que um projeto tem em fontes/, pelo nome do arquivo (para a interface registrar antes de desenhar). */
export const fontesDoProjeto = (raiz: string): FonteArquivo[] => {
  const pasta = path.join(raiz, PASTA_FONTES);
  if (!existsSync(pasta)) return [];
  return readdirSync(pasta)
    .filter((f) => EXTENSOES_FONTE.includes(path.extname(f).toLowerCase()))
    .sort()
    .map((f) => ({...fonteDoArquivo(path.join(pasta, f)), arquivo: `${PASTA_FONTES}/${f}`}));
};
