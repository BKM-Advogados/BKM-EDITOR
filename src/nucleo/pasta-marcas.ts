// A pasta dos kits de marca no disco (%USERPROFILE%\Estudio\marcas, trocável nas preferências): lista, lê, grava,
// duplica, importa logo e fontes e aplica um kit a um documento do projeto, copiando o logo para midia/ e as fontes
// para fontes/ antes do patch no tema. Serve ao processo principal (IPC) e às ferramentas do MCP, dentro e fora do app.
import {copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ARQUIVO_MARCA, arquivosDaMarca, EXTENSOES_FONTE, EXTENSOES_LOGO, idDeMarca, inferirFonte, MARCA_NEUTRO, MARCAS_INICIAIS, normalizarMarca, PASTA_FONTES,
  patchDaMarca, temaDaMarca, type FonteArquivo, type Marca} from './marca';
import {ErroProjeto, serializar, type Projeto} from './projeto';

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

const ORDEM = new Map(MARCAS_INICIAIS.map((m, i) => [m.id, i]));

export class PastaMarcas {
  constructor(private readonly opcoes: {pasta?: () => string; exemplo?: string} = {}) {}

  get pasta() {
    return this.opcoes.pasta?.() || pastaMarcas();
  }

  pastaDe(id: string) {
    return path.join(this.pasta, id);
  }

  /** Os kits de fábrica que faltarem: ks (com o logo do exemplo, quando ele está ao alcance), bkm e neutro. */
  garantir() {
    for (const m of MARCAS_INICIAIS) {
      if (existsSync(path.join(this.pastaDe(m.id), ARQUIVO_MARCA))) continue;
      const logoExemplo = m.id === 'cliente' && this.opcoes.exemplo ? path.join(this.opcoes.exemplo, 'midia', 'logo-exemplo.png') : null;
      const comLogo = Boolean(logoExemplo && existsSync(logoExemplo));
      this.gravar(comLogo ? m : {...m, logo: undefined});
      if (comLogo) copyFileSync(logoExemplo!, path.join(this.pastaDe(m.id), m.logo!));
    }
  }

  /** Os kits, com os de fábrica primeiro e os outros por nome. */
  listar(): MarcaLida[] {
    if (!existsSync(this.pasta)) return [];
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
      bruto = JSON.parse(readFileSync(arq, 'utf-8'));
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
    const arq = path.join(pasta, ARQUIVO_MARCA);
    const tmp = `${arq}.${process.pid}.tmp`;
    writeFileSync(tmp, serializar(limpa), 'utf-8');
    renameSync(tmp, arq);
    return {...limpa, pasta};
  }

  /** Id que ainda não tem pasta: "bkm-2", "bkm-3"… */
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
    const inferido = inferirFonte(origem);
    const nova: FonteArquivo = {familia: dados.familia?.trim() || inferido.familia, arquivo: rel, peso: dados.peso ?? inferido.peso,
      ...((dados.estilo ?? inferido.estilo) === 'italic' ? {estilo: 'italic' as const} : {})};
    return this.gravar({...m, fontes: {...m.fontes, arquivos: [...m.fontes.arquivos.filter((f) => f.arquivo !== rel), nova]}});
  }

  /** Aplica o kit a um documento do projeto: copia o logo (midia/) e as fontes (fontes/) que ainda não estão lá e troca
   *  o tema por patch, que vai para o diário com o autor. */
  aplicar(projeto: Projeto, id: string, documento: string, o: {autor: string; origem: string}) {
    const m = this.ler(id);
    const rel = projeto.arquivoDoDocumento(documento);
    const {doc} = projeto.lerJson<unknown>(rel);
    const {copiar, logo, fontes_arquivos} = arquivosDaMarca(m);
    const copiados: string[] = [];
    const presentes = new Set<string>();
    for (const c of copiar) {
      const de = path.join(m.pasta, c.de);
      if (!existsSync(de)) continue; // o kit aponta para um arquivo que não está mais lá: o tema não o cita
      presentes.add(c.para);
      const para = projeto.caminho(c.para);
      if (existsSync(para)) continue;
      mkdirSync(path.dirname(para), {recursive: true});
      copyFileSync(de, para);
      copiados.push(c.para);
    }
    const tema = temaDaMarca(m, {logo: logo && presentes.has(logo) ? logo : undefined, fontes_arquivos: fontes_arquivos.filter((f) => presentes.has(f.arquivo))});
    const patch = patchDaMarca(doc, m, tema);
    if (!patch.length) throw new ErroProjeto(`o documento ${documento} não recebe kit de marca (só vídeo de cenas e imagem)`, 'patch');
    const r = projeto.aplicarPatch({documento, patch, autor: o.autor, origem: o.origem, rotulo: `kit de marca: ${m.nome}`});
    return {versao: r.versao, seq: r.entrada.seq, marca: m.id, nome: m.nome, copiados, tema};
  }
}

/** As fontes próprias que um projeto tem em fontes/, pelo nome do arquivo (para a interface registrar antes de desenhar). */
export const fontesDoProjeto = (raiz: string): FonteArquivo[] => {
  const pasta = path.join(raiz, PASTA_FONTES);
  if (!existsSync(pasta)) return [];
  return readdirSync(pasta)
    .filter((f) => EXTENSOES_FONTE.includes(path.extname(f).toLowerCase()))
    .sort()
    .map((f) => ({...inferirFonte(f), arquivo: `${PASTA_FONTES}/${f}`}));
};
