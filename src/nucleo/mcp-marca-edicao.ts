// Ferramentas MCP do kit de marca da pessoa (frente 2): o que o painel Marca da tela faz (src/renderer/casca/PainelMarca.tsx),
// pela mesma pasta dos kits (pasta-marcas.ts: a das preferências no app, ESTUDIO_MARCAS ou ~/Estudio/marcas fora dele).
// - listar_marcas (livre: só lê).
// - criar_marca, editar_marca, importar_logo_marca e importar_fonte_marca (cartão): gravam na pasta dos kits, FORA do
//   projeto e sem diário (não há Reverter), e as duas de importar trazem um arquivo do computador. Um kit mudado não mexe
//   nos documentos que já o receberam: aplicar_marca de novo leva a mudança.
// Esquema plano (cores e fontes em campos soltos, sem objeto aninhado nem união): serve a qualquer provedor de IA.
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import type {Marca} from './marca';
import {PastaMarcas, type MarcaLida} from './pasta-marcas';
import {ErroProjeto} from './projeto';

const texto = (x: unknown) => ({content: [{type: 'text' as const, text: typeof x === 'string' ? x : JSON.stringify(x, null, 2)}]});
const erro = (e: unknown) => ({
  isError: true,
  content: [{type: 'text' as const, text: e instanceof ErroProjeto ? `${e.codigo}: ${e.message}` : String((e as Error)?.message ?? e)}],
});
const seguro = <A,>(f: (a: A) => unknown) => async (a: A) => {
  try {
    return texto(await f(a));
  } catch (e) {
    return erro(e);
  }
};

/** O kit como a IA o lê: sem a pasta no disco, com as fontes de arquivo resumidas. */
export const resumoDaMarca = (m: MarcaLida | Marca) => ({
  id: m.id,
  nome: m.nome,
  cores: m.cores,
  fontes: {titulo: m.fontes.titulo, texto: m.fontes.texto, ...(m.fontes.mono ? {mono: m.fontes.mono} : {}),
    ...(m.fontes.arquivos.length ? {arquivos: m.fontes.arquivos.map((f) => ({familia: f.familia, arquivo: f.arquivo, ...(f.peso ? {peso: f.peso} : {}),
      ...(f.peso_max ? {peso_max: f.peso_max} : {}), ...(f.estilo === 'italic' ? {estilo: 'italic'} : {})}))} : {})},
  ...(m.logo ? {logo: m.logo} : {}),
  ...(m.assinatura ? {assinatura: m.assinatura} : {}),
  ...(m.notas ? {notas: m.notas} : {}),
});

const HEX = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'cor em #RRGGBB');

type Edicao = {marca: string; nome?: string; fundo?: string; texto?: string; destaque?: string; suave?: string; fonte_titulo?: string; fonte_texto?: string;
  fonte_mono?: string; assinatura?: string; notas?: string};

/** O kit com a edição pedida. Texto vazio em assinatura, notas ou fonte_mono apaga o campo. */
export const marcaEditada = (m: Marca, e: Omit<Edicao, 'marca'>): Marca => {
  const opcional = (v: string | undefined, atual: string | undefined) => (v === undefined ? atual : v.trim() || undefined);
  const cores = {...m.cores, ...(e.fundo ? {fundo: e.fundo} : {}), ...(e.texto ? {texto: e.texto} : {}), ...(e.destaque ? {destaque: e.destaque} : {}),
    ...(e.suave ? {suave: e.suave} : {})};
  const mono = opcional(e.fonte_mono, m.fontes.mono);
  const {mono: _semMono, ...fontes} = m.fontes;
  const assinatura = opcional(e.assinatura, m.assinatura);
  const notas = opcional(e.notas, m.notas);
  const {assinatura: _a, notas: _n, ...resto} = m;
  return {
    ...resto,
    ...(e.nome?.trim() ? {nome: e.nome.trim()} : {}),
    cores,
    fontes: {...fontes, ...(e.fonte_titulo?.trim() ? {titulo: e.fonte_titulo.trim()} : {}), ...(e.fonte_texto?.trim() ? {texto: e.fonte_texto.trim()} : {}), ...(mono ? {mono} : {})},
    ...(assinatura ? {assinatura} : {}),
    ...(notas ? {notas} : {}),
  };
};

export const registrarMarcaEdicao = (servidor: McpServer, marcas = new PastaMarcas()) => {
  const garantidos = () => {
    marcas.garantir(); // os kits de fábrica que faltarem (o neutro)
    return marcas;
  };

  servidor.registerTool('listar_marcas', {
    description: 'Os kits de marca da pessoa (fora do projeto): id, nome, cores (fundo, texto, destaque, suave), fontes, logo, assinatura e notas. O id serve a aplicar_marca, editar_marca e criar_projeto.',
    inputSchema: {},
  }, seguro(() => ({marcas: garantidos().listar().map(resumoDaMarca)})));

  servidor.registerTool('criar_marca', {
    description: 'Cria um kit de marca novo na pasta de kits da pessoa: em branco (as cores do neutro) ou cópia de outro kit com logo e fontes ("a_partir_de"). Depois, editar_marca, importar_logo_marca e importar_fonte_marca o completam. Pede a permissão da pessoa.',
    inputSchema: {
      nome: z.string().min(1).max(80),
      a_partir_de: z.string().optional().describe('id do kit a copiar'),
    },
  }, seguro(({nome, a_partir_de}: {nome: string; a_partir_de?: string}) => {
    const m = a_partir_de ? garantidos().duplicar(a_partir_de, nome) : garantidos().criar(nome);
    return {ok: true, marca: resumoDaMarca(m)};
  }));

  servidor.registerTool('editar_marca', {
    description: 'Muda um kit de marca: nome, cores (#RRGGBB), fontes (Inter, Archivo, IBM Plex Sans, IBM Plex Mono ou a família de uma fonte importada no kit), assinatura (o @, o site) e notas. Só muda o que vier; texto vazio em assinatura, notas ou fonte_mono apaga. Grava fora do projeto, sem Reverter; documentos que já usam o kit mudam com aplicar_marca de novo. Pede a permissão da pessoa.',
    inputSchema: {
      marca: z.string().min(1).describe('id do kit (listar_marcas)'),
      nome: z.string().max(80).optional(),
      fundo: HEX.optional(),
      texto: HEX.optional(),
      destaque: HEX.optional(),
      suave: HEX.optional(),
      fonte_titulo: z.string().max(80).optional(),
      fonte_texto: z.string().max(80).optional(),
      fonte_mono: z.string().max(80).optional(),
      assinatura: z.string().max(120).optional(),
      notas: z.string().max(2000).optional(),
    },
  }, seguro(({marca, ...e}: Edicao) => {
    if (!Object.values(e).some((v) => v !== undefined)) throw new ErroProjeto('diga o que muda (nome, uma cor, uma fonte, assinatura ou notas)', 'patch');
    const atual = garantidos().ler(marca);
    const {pasta: _p, ...kit} = atual;
    const familias = new Set(kit.fontes.arquivos.map((f) => f.familia));
    const avisos = [e.fonte_titulo, e.fonte_texto, e.fonte_mono].filter((f): f is string => Boolean(f?.trim()))
      .filter((f) => !['Inter', 'Archivo', 'IBM Plex Sans', 'IBM Plex Mono'].includes(f.trim()) && !familias.has(f.trim()))
      .map((f) => `a fonte "${f}" não é das de fábrica nem de um arquivo do kit: importe o arquivo com importar_fonte_marca, ou a prévia usa outra`);
    return {ok: true, marca: resumoDaMarca(marcas.gravar(marcaEditada(kit, e))), ...(avisos.length ? {avisos} : {})};
  }));

  servidor.registerTool('importar_logo_marca', {
    description: 'Copia uma imagem do computador para o kit como o logo dele (png, svg, jpg, jpeg ou webp); o logo antigo sai. Pede a permissão da pessoa.',
    inputSchema: {
      marca: z.string().min(1).describe('id do kit'),
      caminho: z.string().min(1).describe('caminho absoluto da imagem no computador'),
    },
  }, seguro(({marca, caminho}: {marca: string; caminho: string}) => ({ok: true, marca: resumoDaMarca(garantidos().importarLogo(marca, caminho))})));

  servidor.registerTool('importar_fonte_marca', {
    description: 'Copia um arquivo de fonte do computador (ttf, otf, woff ou woff2) para o kit. Família, peso e estilo vêm do arquivo quando não são ditos. Para o kit usar a fonte, ponha a família em editar_marca (fonte_titulo ou fonte_texto). Pede a permissão da pessoa.',
    inputSchema: {
      marca: z.string().min(1).describe('id do kit'),
      caminho: z.string().min(1).describe('caminho absoluto do arquivo de fonte'),
      familia: z.string().max(80).optional(),
      peso: z.number().int().min(100).max(900).optional(),
      estilo: z.enum(['normal', 'italic']).optional(),
    },
  }, seguro(({marca, caminho, familia, peso, estilo}: {marca: string; caminho: string; familia?: string; peso?: number; estilo?: 'normal' | 'italic'}) => {
    const m = garantidos().importarFonte(marca, caminho, {...(familia ? {familia} : {}), ...(peso ? {peso} : {}), ...(estilo ? {estilo} : {})});
    return {ok: true, marca: resumoDaMarca(m)};
  }));
};
