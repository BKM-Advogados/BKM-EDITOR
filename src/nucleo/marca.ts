// Kit de marca: as cores, as fontes, o logo e a assinatura de um escritório, guardados fora dos projetos (pasta
// `marcas/<id>/` da pessoa, com `marca.json`, `logo.*` e `fontes/*.ttf|otf|woff|woff2`) e aplicados ao `tema` que o
// documento já tem. Só dados e regras (sem disco): a interface e as composições importam deste arquivo; quem lê e
// grava a pasta é pasta-marcas.ts.
import {hex} from './acabamento';
import {nomeDeFonteVariavel} from './fonte-variavel';
import {ehDocCenas, TEMA_NEUTRO, type TemaCenas} from './cenas';
import type {CamadaImagem, Degrade, DocImagem, MarcaDoDocumento, OperacaoPatch} from './documentos';

/** As quatro cores que todo tema usa e, por nome, as de apoio da paleta (terracota, grafite, areia…). */
export type CoresMarca = {fundo: string; texto: string; destaque: string; suave: string} & Record<string, string>;
/** Fonte de arquivo. `arquivo` é relativo à pasta do kit ("fontes/Archivo-Bold.ttf") ou, depois de copiada, à do projeto.
 *  Fonte variável leva a faixa do eixo de peso: `peso` (o menor) e `peso_max`, e serve a todos os pesos entre os dois. */
export type FonteArquivo = {familia: string; arquivo: string; peso?: number; peso_max?: number; estilo?: 'normal' | 'italic'};
export type FontesMarca = {titulo: string; texto: string; mono?: string; arquivos: FonteArquivo[]};
export type Marca = {
  formato: 1;
  id: string; // nome da pasta e valor de tema.marca: minúsculas, números e hífen
  nome: string;
  cores: CoresMarca;
  fontes: FontesMarca;
  logo?: string; // arquivo na pasta do kit ("logo.png")
  assinatura?: string; // o que vai no rodapé: o @ ("@escritorio"), o site, o nome por extenso
  notas?: string;
};

/** O `tema` de um vídeo de cenas depois do kit: cores e fonte de sempre mais o id do kit, o logo copiado para midia/,
 *  a assinatura e as fontes próprias copiadas para fontes/ (a composição carrega por elas). */
export type TemaDeMarca = TemaCenas & {marca: string; logo?: string; assinatura?: string; fontes_arquivos?: FonteArquivo[]};

export const ARQUIVO_MARCA = 'marca.json';
export const PASTA_FONTES = 'fontes';
export const EXTENSOES_FONTE = ['.ttf', '.otf', '.woff', '.woff2'];
export const EXTENSOES_LOGO = ['.png', '.svg', '.jpg', '.jpeg', '.webp'];

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
export const MARCAS_INICIAIS: Marca[] = [MARCA_BKM, MARCA_NEUTRO];

/** "Escritório Exemplo" → "escritorio-exemplo": o nome da pasta. */
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
  const pesoMax = typeof o.peso_max === 'number' && o.peso_max <= 900 && o.peso_max > (peso ?? 100) ? Math.round(o.peso_max) : undefined;
  return {familia, arquivo, ...(peso ? {peso} : {}), ...(pesoMax ? {peso_max: pesoMax} : {}), ...(o.estilo === 'italic' ? {estilo: 'italic' as const} : {})};
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
  const logo = texto(o.logo)?.replace(/^.*[\\/]/, ''); // o logo fica sempre na raiz do kit: sem pasta, sem "../"
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
  if (nomeDeFonteVariavel(base)) {
    // "Roboto-VariableFont_wght", "Inter[opsz,wght]-Italic": a família é o que vem antes, e o arquivo serve a todos os pesos
    const nome = base.replace(/\[[^\]]*\]/g, '').replace(/[-_]?variable.*$/i, '').replace(/[-_]?(italic|oblique)$/i, '');
    const familia = nomeDeFamilia(nome.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ')) || 'Fonte';
    return {familia, peso: 100, peso_max: 900, ...(/italic|oblique/i.test(base) ? {estilo: 'italic' as const} : {})};
  }
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

/** O kit como a imagem o guarda: id, nome, cores por nome e fontes, para a cor "@destaque" das camadas se ler daí. */
export const marcaDoKit = (m: Pick<Marca, 'id' | 'nome' | 'cores' | 'fontes'>): MarcaDoDocumento => ({
  id: m.id,
  nome: m.nome,
  cores: {...m.cores},
  fontes: {titulo: m.fontes.titulo, texto: m.fontes.texto, ...(m.fontes.mono ? {mono: m.fontes.mono} : {})},
});

// ---------- trocar de kit na imagem ----------
// Cor e fonte que a camada tem hoje são o papel que cada uma fazia no kit anterior (destaque, texto, suave, título…):
// o kit novo põe a dele no mesmo papel. O kit anterior é o que a imagem guarda em `marca`; sem ele (imagem de antes
// do campo), vale o primeiro kit de fábrica que tenha aquele valor. Cor ou fonte que não é de nenhum kit é escolha da
// pessoa e fica como está; cor por referência ("@destaque") nem entra: ela já lê o kit novo.
const PAPEIS_PRINCIPAIS = ['destaque', 'texto', 'suave', 'fundo'];
// o modelo de carrossel de antes do campo `marca`: o neutro com um cobre de destaque e um cinza-azulado de apoio
const CARROSSEL_ANTIGO = {fundo: '#111418', texto: '#F2F2F2', destaque: '#C88155', suave: '#B8BEC7'};
// a paleta escura e as fontes de um kit de fábrica que saiu do app: as imagens de antes do campo `marca` que nasceram
// nele continuam trocando de kit pelo papel de cada cor e fonte
const PALETA_ANTIGA = {fundo: '#171A19', texto: '#F4F0EA', destaque: '#C88155', suave: '#A09F9B'};
const FONTES_ANTIGAS: FontesMarca = {titulo: 'Archivo', texto: 'IBM Plex Sans', mono: 'IBM Plex Mono', arquivos: []};
const PALETAS_DE_FABRICA: Record<string, string>[] = [MARCA_BKM.cores, MARCA_NEUTRO.cores, PALETA_ANTIGA, CARROSSEL_ANTIGO];
const FONTES_DE_FABRICA = [MARCA_BKM.fontes, MARCA_NEUTRO.fontes, FONTES_ANTIGAS];
const GENERICAS = new Set(['system-ui', 'sans-serif', 'serif', 'monospace']);

const canais = (cor: string) => {
  const c = hex(cor);
  return c ? `${c.r},${c.g},${c.b},${c.a}` : cor.trim().toLowerCase();
};
const ehReferencia = (v: string) => v.trim().startsWith('@');

const papelDaCor = (cor: string, paletas: Record<string, string>[]): string | undefined => {
  const n = canais(cor);
  for (const p of paletas) {
    for (const k of [...PAPEIS_PRINCIPAIS, ...Object.keys(p).filter((x) => !PAPEIS_PRINCIPAIS.includes(x))]) if (p[k] && canais(p[k]) === n) return k;
  }
  return undefined;
};

type PapelFonte = 'titulo' | 'texto' | 'mono';
const papelDaFonte = (fonte: string | undefined, peso: number | undefined, conjuntos: FontesMarca[]): PapelFonte | undefined => {
  const f = fonte?.trim();
  const pelaEspessura: PapelFonte = (peso ?? 400) >= 600 ? 'titulo' : 'texto';
  if (!f || GENERICAS.has(f)) return pelaEspessura;
  for (const set of conjuntos) {
    const papeis = (['titulo', 'texto', 'mono'] as const).filter((r) => set[r]?.toLowerCase() === f.toLowerCase());
    if (!papeis.length) continue;
    if (papeis.length === 1) return papeis[0];
    return papeis.includes(pelaEspessura) ? pelaEspessura : papeis[0];
  }
  return undefined;
};

/** Os patches que passam o conteúdo da imagem do kit anterior (`doc.marca`, ou os de fábrica) para o `m`. */
const patchDaImagem = (doc: DocImagem, m: Marca): OperacaoPatch[] => {
  const paletas = [...(doc.marca ? [doc.marca.cores] : []), ...PALETAS_DE_FABRICA];
  const fontes = [...(doc.marca ? [doc.marca.fontes as FontesMarca] : []), ...FONTES_DE_FABRICA];
  const ops: OperacaoPatch[] = [];
  const cor = (atual: string | undefined, path: string) => {
    if (typeof atual !== 'string' || !atual.trim() || ehReferencia(atual)) return;
    const papel = papelDaCor(atual, paletas);
    const nova = papel ? m.cores[papel] : undefined;
    if (nova && canais(nova) !== canais(atual)) ops.push({op: 'replace', path, value: nova});
  };
  const degrade = (d: Degrade | undefined, path: string) => d?.paradas?.forEach((p, k) => cor(p?.cor, `${path}/paradas/${k}/cor`));
  const camada = (c: CamadaImagem, base: string) => {
    if (!c) return;
    if (c.tipo === 'texto') {
      const papel = typeof c.fonte === 'string' && ehReferencia(c.fonte) ? undefined : papelDaFonte(c.fonte, c.peso, fontes);
      const nova = papel === 'titulo' ? m.fontes.titulo : papel === 'mono' ? (m.fontes.mono ?? m.fontes.texto) : papel === 'texto' ? m.fontes.texto : undefined;
      if (nova && nova !== c.fonte) ops.push(por(c.fonte, `${base}/fonte`, nova));
      // sem cor, ou no branco padrão que nenhum kit tem, o texto é o do kit; as outras cores seguem o papel que tinham
      if (c.cor === undefined) ops.push({op: 'add', path: `${base}/cor`, value: '@texto'});
      else if (typeof c.cor === 'string' && canais(c.cor) === canais('#FFFFFF') && !papelDaCor(c.cor, paletas)) ops.push({op: 'replace', path: `${base}/cor`, value: m.cores.texto});
      else cor(c.cor, `${base}/cor`);
    }
    if (c.tipo === 'forma') cor(c.preenchimento, `${base}/preenchimento`);
    if (c.tipo !== 'imagem') degrade(c.degrade, `${base}/degrade`);
    cor(c.sombra?.cor, `${base}/sombra/cor`);
    cor(c.contorno?.cor, `${base}/contorno/cor`);
  };
  cor(doc.fundo, '/fundo');
  degrade(doc.fundo_degrade, '/fundo_degrade');
  doc.camadas.forEach((c, i) => camada(c, `/camadas/${i}`));
  doc.paginas?.forEach((p, i) => p.camadas?.forEach((c, j) => camada(c, `/paginas/${i}/camadas/${j}`)));
  ops.push(por(doc.marca, '/marca', marcaDoKit(m)));
  return ops;
};

/** Patch que aplica o kit a um documento: o vídeo de cenas troca o `tema` inteiro; a imagem passa cada cor e fonte para
 *  o mesmo papel no kit novo (ver acima) e guarda o kit em `marca`; a animação troca o `tema` (que resolve as cores de
 *  referência @destaque etc.). Outro tipo de documento: lista vazia (não recebe kit). */
export const patchDaMarca = (doc: unknown, m: Marca, tema: TemaDeMarca = temaDaMarca(m)): OperacaoPatch[] => {
  if (ehDocCenas(doc)) {
    return doc.tema === undefined ? [{op: 'add', path: '/tema', value: tema}] : [{op: 'test', path: '/tema', value: doc.tema}, {op: 'replace', path: '/tema', value: tema}];
  }
  if (ehDocImagem(doc)) return patchDaImagem(doc, m);
  if (ehDocAnimacao(doc)) {
    return doc.tema === undefined ? [{op: 'add', path: '/tema', value: tema}] : [{op: 'test', path: '/tema', value: doc.tema}, {op: 'replace', path: '/tema', value: tema}];
  }
  return [];
};

/** Id do kit que um documento carrega (tema.marca no vídeo, marca.id na imagem), se tiver. */
export const marcaDoDocumento = (doc: unknown): string | undefined => {
  const d = doc as {tema?: {marca?: unknown}; marca?: {id?: unknown}} | null;
  if (typeof d?.tema?.marca === 'string') return d.tema.marca;
  return typeof d?.marca?.id === 'string' ? d.marca.id : undefined;
};
