// Kit de marca: as cores, as fontes, o logo e a assinatura de um escritório, guardados fora dos projetos (pasta
// `marcas/<id>/` da pessoa, com `marca.json`, `logo.*` e `fontes/*.ttf|otf|woff|woff2`) e aplicados ao `tema` que o
// documento já tem. A Cliente sai do código por aqui: o CarrosselNarrado lê a paleta e as fontes de MARCA_CLIENTE, com os mesmos
// valores de sempre. Só dados e regras (sem disco): a interface e as composições importam deste arquivo; quem lê e
// grava a pasta é pasta-marcas.ts.
import {ehDocCenas, TEMA_NEUTRO, type TemaCenas} from './cenas';
import type {DocImagem, OperacaoPatch} from './documentos';

/** As quatro cores que todo tema usa e, por nome, as de apoio da paleta (cobre, grafite, osso…). */
export type CoresMarca = {fundo: string; texto: string; destaque: string; suave: string} & Record<string, string>;
/** Fonte de arquivo. `arquivo` é relativo à pasta do kit ("fontes/Archivo-Bold.ttf") ou, depois de copiada, à do projeto. */
export type FonteArquivo = {familia: string; arquivo: string; peso?: number; estilo?: 'normal' | 'italic'};
export type FontesMarca = {titulo: string; texto: string; mono?: string; arquivos: FonteArquivo[]};
export type Marca = {
  formato: 1;
  id: string; // nome da pasta e valor de tema.marca: minúsculas, números e hífen
  nome: string;
  cores: CoresMarca;
  fontes: FontesMarca;
  logo?: string; // arquivo na pasta do kit ("logo.png")
  assinatura?: string; // o que vai no rodapé: "@escritorioexemplo", o site, o nome por extenso
  notas?: string;
};

/** O `tema` de um vídeo de cenas depois do kit: cores e fonte de sempre mais o id do kit, o logo copiado para midia/,
 *  a assinatura e as fontes próprias copiadas para fontes/ (a composição carrega por elas). */
export type TemaDeMarca = TemaCenas & {marca: string; logo?: string; assinatura?: string; fontes_arquivos?: FonteArquivo[]};

export const ARQUIVO_MARCA = 'marca.json';
export const PASTA_FONTES = 'fontes';
export const EXTENSOES_FONTE = ['.ttf', '.otf', '.woff', '.woff2'];
export const EXTENSOES_LOGO = ['.png', '.svg', '.jpg', '.jpeg', '.webp'];

// Paleta do manual da Cliente (04/11/2026), pelos valores RGB: Cobre Cliente 200·129·85, Grafite 46·51·49, Osso 244·240·234,
// Grafite Profundo 23·26·25; apoio Cobre Profundo, Cobre Claro, Grafite Névoa e Aço. Sem laranja. O "suave" é o osso
// a 62% sobre o grafite profundo, o texto de apoio das cenas escuras do carrossel.
export const MARCA_CLIENTE: Marca = {
  formato: 1,
  id: 'cliente',
  nome: 'Cliente Advogados',
  cores: {fundo: '#171A19', texto: '#F4F0EA', destaque: '#C88155', suave: '#A09F9B',
    cobre: '#C88155', cobreProfundo: '#795033', cobreClaro: '#E4B492', grafite: '#2E3331', grafiteProfundo: '#171A19', nevoa: '#3D4142', osso: '#F4F0EA', aco: '#37556A'},
  fontes: {titulo: 'Archivo', texto: 'IBM Plex Sans', mono: 'IBM Plex Mono', arquivos: []},
  logo: 'logo.png',
  assinatura: '@escritorioexemplo',
  notas: 'Manual de marca da Cliente (04/11/2026): Archivo 700 nos títulos, IBM Plex Sans no texto, IBM Plex Mono em rótulos e numerais. '
    + '55% osso, 30% grafite, 15% cobre; sem laranja. O logo nunca gira nem leva efeito.',
};

// A BKM ainda não tem manual no repositório: cores sóbrias de espera, para trocar no painel Marca.
export const MARCA_BKM: Marca = {
  formato: 1,
  id: 'bkm',
  nome: 'BKM Advogados',
  cores: {fundo: '#101826', texto: '#F2EEE6', destaque: '#C9A961', suave: '#A5ADBA'},
  fontes: {titulo: 'Inter', texto: 'Inter', arquivos: []},
  assinatura: 'bkmadvogados.com.br',
  notas: 'Paleta e fontes provisórias: troque pelas do manual da BKM e importe o logo (menu → Marca…).',
};

const {fonte: FONTE_NEUTRA, ...CORES_NEUTRAS} = TEMA_NEUTRO;
export const MARCA_NEUTRO: Marca = {
  formato: 1,
  id: 'neutro',
  nome: 'Neutro',
  cores: {...CORES_NEUTRAS},
  fontes: {titulo: FONTE_NEUTRA, texto: FONTE_NEUTRA, arquivos: []},
  notas: 'O tema padrão do Estúdio, igual ao de um vídeo novo sem kit.',
};

/** Os kits de fábrica, criados na primeira abertura se não existirem. */
export const MARCAS_INICIAIS: Marca[] = [MARCA_CLIENTE, MARCA_BKM, MARCA_NEUTRO];

/** "Cliente Advogados" → "ks-advogados": o nome da pasta. */
export const idDeMarca = (nome: string) =>
  nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'marca';

const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const cor = (v: unknown, padrao: string) => {
  const t = texto(v);
  if (!t) return padrao;
  return /^#[0-9a-f]{6}$/i.test(t) ? t.toUpperCase() : t;
};
/** Nome de família que vale sem aspas num font-family (letras, números, espaço, hífen e sublinhado): as composições e o
 *  FontFace usam o nome cru, e "Minha (fonte)" quebraria a declaração inteira. */
export const nomeDeFamilia = (nome: string) => nome.replace(/[^\p{L}\p{N} _-]+/gu, ' ').replace(/\s+/g, ' ').trim();
const fonteArquivo = (x: unknown): FonteArquivo | null => {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const familia = texto(o.familia) && nomeDeFamilia(texto(o.familia)!);
  const arquivo = texto(o.arquivo)?.replace(/\\/g, '/');
  if (!familia || !arquivo) return null;
  const peso = typeof o.peso === 'number' && o.peso >= 100 && o.peso <= 900 ? Math.round(o.peso) : undefined;
  return {familia, arquivo, ...(peso ? {peso} : {}), ...(o.estilo === 'italic' ? {estilo: 'italic' as const} : {})};
};

/** Lê um marca.json com calma: campo ausente ou fora do lugar volta ao neutro, nunca derruba o app. */
export const normalizarMarca = (x: unknown, idPadrao = 'marca'): Marca => {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const cores = (o.cores && typeof o.cores === 'object' ? o.cores : {}) as Record<string, unknown>;
  const fontes = (o.fontes && typeof o.fontes === 'object' ? o.fontes : {}) as Record<string, unknown>;
  const N = MARCA_NEUTRO.cores;
  const apoio = Object.fromEntries(Object.entries(cores).filter(([k, v]) => !(k in N) && texto(v)).map(([k, v]) => [k, cor(v, '')]));
  const titulo = (texto(fontes.titulo) && nomeDeFamilia(texto(fontes.titulo)!)) || MARCA_NEUTRO.fontes.titulo;
  const textoFonte = texto(fontes.texto) && nomeDeFamilia(texto(fontes.texto)!);
  const mono = texto(fontes.mono) && nomeDeFamilia(texto(fontes.mono)!);
  const logo = texto(o.logo);
  const assinatura = texto(o.assinatura);
  const notas = texto(o.notas);
  return {
    formato: 1,
    id: idDeMarca(texto(o.id) ?? idPadrao),
    nome: texto(o.nome) ?? idPadrao,
    cores: {fundo: cor(cores.fundo, N.fundo), texto: cor(cores.texto, N.texto), destaque: cor(cores.destaque, N.destaque), suave: cor(cores.suave, N.suave), ...apoio},
    fontes: {titulo, texto: textoFonte || titulo, ...(mono ? {mono} : {}),
      arquivos: (Array.isArray(fontes.arquivos) ? fontes.arquivos : []).map(fonteArquivo).filter((f): f is FonteArquivo => f !== null)},
    ...(logo ? {logo} : {}),
    ...(assinatura ? {assinatura} : {}),
    ...(notas ? {notas} : {}),
  };
};

// ---------- fontes de arquivo ----------
const PESOS: [RegExp, number][] = [
  [/thin|hairline/i, 100], [/extralight|ultralight/i, 200], [/light/i, 300], [/regular|normal|book|roman/i, 400], [/medium/i, 500],
  [/semibold|demibold/i, 600], [/extrabold|ultrabold/i, 800], [/black|heavy/i, 900], [/bold/i, 700],
];

/** "Montserrat-SemiBoldItalic.ttf" → família Montserrat, peso 600, itálico: o que dá para saber só pelo nome do arquivo. */
export const inferirFonte = (nomeArquivo: string): Omit<FonteArquivo, 'arquivo'> => {
  const base = nomeArquivo.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const corte = Math.max(base.lastIndexOf('-'), base.lastIndexOf('_'));
  const variante = corte > 0 ? base.slice(corte + 1) : '';
  const peso = PESOS.find(([re]) => re.test(variante))?.[1] ?? (/^\d{3}$/.test(variante) ? Number(variante) : undefined);
  const italico = /italic|oblique/i.test(variante);
  const nome = corte > 0 && (peso !== undefined || italico) ? base.slice(0, corte) : base;
  const familia = nomeDeFamilia(nome.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ')) || nomeDeFamilia(base) || 'Fonte';
  return {familia, peso: peso ?? 400, ...(italico ? {estilo: 'italic' as const} : {})};
};

/** O que vai do kit para o projeto: o logo em midia/ e as fontes em fontes/. `de` é relativo à pasta do kit, `para` à
 *  do projeto; `logo` e `fontes_arquivos` já são os caminhos no projeto, prontos para o tema. */
export const arquivosDaMarca = (m: Marca) => {
  const copiar: {de: string; para: string}[] = [];
  let logo: string | undefined;
  if (m.logo) {
    logo = `midia/logo-${m.id}${/\.[^.]+$/.exec(m.logo)?.[0]?.toLowerCase() ?? ''}`;
    copiar.push({de: m.logo, para: logo});
  }
  const fontes_arquivos = m.fontes.arquivos.map((f): FonteArquivo => {
    const para = `${PASTA_FONTES}/${f.arquivo.replace(/^.*\//, '')}`;
    copiar.push({de: f.arquivo, para});
    return {...f, arquivo: para};
  });
  return {copiar, logo, fontes_arquivos};
};

/** O tema que o kit põe num vídeo de cenas. `arquivos` é o que de fato foi copiado (quem aplica tira o que faltou). */
export const temaDaMarca = (m: Marca, arquivos: {logo?: string; fontes_arquivos: FonteArquivo[]} = arquivosDaMarca(m)): TemaDeMarca => ({
  fundo: m.cores.fundo,
  texto: m.cores.texto,
  destaque: m.cores.destaque,
  suave: m.cores.suave,
  fonte: m.fontes.titulo,
  marca: m.id,
  ...(arquivos.logo ? {logo: arquivos.logo} : {}),
  ...(m.assinatura ? {assinatura: m.assinatura} : {}),
  ...(arquivos.fontes_arquivos.length ? {fontes_arquivos: arquivos.fontes_arquivos} : {}),
});

const ehDocImagem = (doc: unknown): doc is DocImagem => {
  const d = doc as DocImagem | null;
  return Boolean(d) && typeof d === 'object' && Array.isArray(d!.camadas) && typeof d!.largura === 'number';
};
const ehDocAnimacao = (doc: unknown): doc is {camadas: unknown[]; tema?: unknown} => {
  const d = doc as Record<string, unknown> | null;
  return Boolean(d && typeof d === 'object' && Array.isArray(d.camadas) && typeof d.fps === 'number' && typeof d.duracao_ms === 'number');
};
const por = (atual: unknown, path: string, value: unknown): OperacaoPatch => ({op: atual === undefined ? 'add' : 'replace', path, value});

/** Patch que aplica o kit a um documento: o vídeo de cenas troca o `tema` inteiro; a imagem troca o fundo e, nos textos
 *  (da raiz e de cada página do carrossel), a fonte (negrito leva a de título) e a cor; a animação troca o `tema` (que
 *  resolve as cores de referência @destaque etc.). Outro tipo de documento: lista vazia (não recebe kit). */
export const patchDaMarca = (doc: unknown, m: Marca, tema: TemaDeMarca = temaDaMarca(m)): OperacaoPatch[] => {
  if (ehDocCenas(doc)) {
    return doc.tema === undefined ? [{op: 'add', path: '/tema', value: tema}] : [{op: 'test', path: '/tema', value: doc.tema}, {op: 'replace', path: '/tema', value: tema}];
  }
  if (ehDocImagem(doc)) {
    const ops = [por(doc.fundo, '/fundo', m.cores.fundo)];
    const textos = (camadas: DocImagem['camadas'], base: string) =>
      camadas.forEach((c, i) => {
        if (!c || c.tipo !== 'texto') return;
        ops.push(por(c.fonte, `${base}/${i}/fonte`, (c.peso ?? 400) >= 600 ? m.fontes.titulo : m.fontes.texto));
        ops.push(por(c.cor, `${base}/${i}/cor`, m.cores.texto));
      });
    textos(doc.camadas, '/camadas');
    doc.paginas?.forEach((p, i) => textos(p.camadas, `/paginas/${i}/camadas`));
    return ops;
  }
  if (ehDocAnimacao(doc)) {
    return doc.tema === undefined ? [{op: 'add', path: '/tema', value: tema}] : [{op: 'test', path: '/tema', value: doc.tema}, {op: 'replace', path: '/tema', value: tema}];
  }
  return [];
};

/** Id do kit que um documento carrega (tema.marca), se tiver. */
export const marcaDoDocumento = (doc: unknown): string | undefined => {
  const t = (doc as {tema?: {marca?: unknown}} | null)?.tema;
  return typeof t?.marca === 'string' ? t.marca : undefined;
};
