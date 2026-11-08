// Peças comuns do módulo de imagem: documento mostrado, valores padrão das camadas, endereço da mídia, encaixe da
// imagem (cobrir/conter), fontes e a prévia ao vivo de um campo antes do patch. Prévia, exportação e inspector usam as
// mesmas regras para darem o mesmo pixel.
import {useSyncExternalStore} from 'react';
import {loadFont as Archivo} from '@remotion/google-fonts/Archivo';
import {loadFont as IBMPlexMono} from '@remotion/google-fonts/IBMPlexMono';
import {loadFont as IBMPlexSans} from '@remotion/google-fonts/IBMPlexSans';
import type {CamadaImagem, DocImagem, MarcaDoDocumento, PaginaImagem} from '../../../nucleo/documentos';
import {baseCamadas, idLivre, indiceNaBase, paginaDoCaminho, paginasDe, slug} from '../../../nucleo/carrossel';
import {fonte, listarFontes} from '../../../composicoes/fontes';
import {loja, useLoja, type Estado} from '../../estado/loja';

export const ENTRELINHA = 1.15;
const GENERICAS = new Set(['system-ui', 'sans-serif', 'serif', 'monospace']);

export const PADRAO = {fonte: 'system-ui', tamanho: 48, peso: 400, cor: '#FFFFFF', alinhar: 'esquerda', preenchimento: '#808080', raio: 0, ajuste: 'cobrir'} as const;

/** Na área Efeitos, o alvo dela (quando é imagem); nas outras, o documento ativo da área Imagem. */
export const usarDocumentoImagem = () =>
  useLoja((e) => {
    const alvo = e.alvoEfeitos;
    if (e.area === 'efeitos' && alvo && e.info?.manifesto.documentos.some((d) => d.id === alvo && d.modulo === 'imagem')) return alvo;
    return e.ativo.imagem;
  });

/** O agente pode gravar um JSON quebrado à mão: sem lista de camadas nem de páginas, os painéis avisam em vez de cair. */
export const docValido = (doc: unknown): doc is DocImagem => {
  const d = doc as DocImagem | undefined;
  return Array.isArray(d?.camadas) || Array.isArray(d?.paginas);
};

export const visivel = (c: CamadaImagem) => c.visivel !== false;

/** Índice da camada num caminho "<base>/N" ("/camadas/3" ou "/paginas/1/camadas/3"); -1 se não for camada dessa lista. */
export const indiceDe = (caminho: string | null | undefined, base: string) => indiceNaBase(caminho, base);

// ---------- páginas (carrossel) ----------
// A página ativa fica na loja pelo id (sobrevive a reordenar); aqui vira índice, lista de camadas e base dos caminhos.
export type PaginaAtiva = {p: number; pagina: PaginaImagem; paginas: PaginaImagem[]; base: string; camadas: CamadaImagem[]};

export const paginaAtivaDe = (e: Estado, documento: string, doc: DocImagem): PaginaAtiva => {
  const paginas = paginasDe(doc);
  const id = e.paginaAtiva[documento];
  const p = Math.max(0, id ? paginas.findIndex((x) => x.id === id) : 0);
  const pagina = paginas[p] ?? paginas[0];
  return {p, pagina, paginas, base: baseCamadas(doc, p), camadas: Array.isArray(pagina?.camadas) ? pagina.camadas : []};
};

export const usarPaginaAtiva = (documento: string | undefined, doc: DocImagem | undefined) =>
  useLoja((e) => (documento && docValido(doc) ? paginaAtivaDe(e, documento, doc) : null));

/** Vai para a página `p`; a seleção de outra página é solta. */
export const irParaPagina = (documento: string, doc: DocImagem, p: number) => {
  const paginas = paginasDe(doc);
  const pagina = paginas[Math.max(0, Math.min(p, paginas.length - 1))];
  if (!pagina) return;
  loja.definir((e) => ({
    paginaAtiva: {...e.paginaAtiva, [documento]: pagina.id},
    selecao: e.selecao?.documento === documento && paginaDoCaminho(doc, e.selecao.caminho) !== paginas.indexOf(pagina) ? null : e.selecao,
  }));
};

export const rotuloCamada = (c: CamadaImagem) => c.nome || c.texto?.split('\n')[0] || c.id;

export const alinhamentoCss = (a?: CamadaImagem['alinhar']) => (a === 'centro' ? 'center' : a === 'direita' ? 'right' : 'left');

/** "midia\\logo.png" ou "./midia/logo.png" → "midia/logo.png"; null se sair do projeto. */
export const caminhoNoProjeto = (bruto: string): string | null => {
  const c = bruto.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (!c || /^[a-z]:/i.test(c) || c.split('/').includes('..')) return null;
  return c;
};

export const urlMidia = (caminho: string) =>
  `${loja.get().info?.base_midia ?? ''}/${caminho.split(/[\\/]/).filter(Boolean).map(encodeURIComponent).join('/')}`;

export type Caixa = {x: number; y: number; w: number; h: number};

/** Onde a imagem cai dentro da caixa da camada (object-fit, centralizada como o object-position padrão). */
export const encaixe = (iw: number, ih: number, w: number, h: number, ajuste: CamadaImagem['ajuste'] = PADRAO.ajuste): Caixa => {
  const s = ajuste === 'conter' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
  return {x: (w - iw * s) / 2, y: (h - ih * s) / 2, w: iw * s, h: ih * s};
};

/** Imagem decodificada a partir de um blob (a URL temporária é revogada assim que carrega). */
export const imagemDoBlob = (blob: Blob) =>
  new Promise<HTMLImageElement>((ok, falha) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => (URL.revokeObjectURL(url), ok(img));
    img.onerror = () => (URL.revokeObjectURL(url), falha(new Error('arquivo de imagem ilegível')));
    img.src = url;
  });

/** Tamanho natural de uma imagem do projeto (lança se não existir). */
export const medirImagem = async (caminho: string) => {
  const r = await fetch(urlMidia(caminho));
  if (!r.ok) throw new Error(`não achei ${caminho} no projeto`);
  const img = await imagemDoBlob(await r.blob());
  return {iw: img.naturalWidth || 1, ih: img.naturalHeight || 1};
};

/** Id de camada livre na lista (da página): "texto-1", "texto-2"… */
export const idNovo = (base: string, camadas: CamadaImagem[]) => idLivre(camadas, slug(base, 'camada'));

// ---------- fontes ----------
// O font-family vem do carregador das composições (fonte()), que funciona fora do Remotion: o delayRender só conta
// um handle quando não há render. Para exportar é preciso esperar os arquivos: o carregador baixa por fetch e o
// document.fonts.ready não enxerga esse download. Chamar o loadFont com as mesmas opções reaproveita o mesmo cache.
type Carregador = (estilo: 'normal', opcoes: {subsets: string[]; ignoreTooManyRequestsWarning: boolean}) => {waitUntilDone: () => Promise<void>};
const CARREGADORES: Record<string, Carregador> = {Archivo, IBMPlexMono, IBMPlexSans} as unknown as Record<string, Carregador>;

/** As fontes do seletor da imagem: primeiro as do kit da peça ("@titulo" e as outras, que seguem o kit), depois as de
 *  arquivo (do kit e do projeto), as do Google que o app tem e a do sistema. A fonte que a camada já usa entra mesmo que
 *  não seja de nenhuma lista, para o seletor nunca ficar em branco. */
export const opcoesDeFonte = (marca: MarcaDoDocumento | undefined, atual?: string): [string, string][] => {
  const lista: [string, string][] = [];
  if (marca) {
    lista.push(['@titulo', `Título do kit · ${marca.fontes.titulo}`], ['@texto', `Texto do kit · ${marca.fontes.texto}`], ['@mono', `Mono do kit · ${marca.fontes.mono ?? marca.fontes.texto}`]);
  }
  const doKit = new Set(marca ? [marca.fontes.titulo, marca.fontes.texto, marca.fontes.mono ?? marca.fontes.texto] : []);
  const todas = listarFontes();
  const ordenadas = [...todas.filter((f) => doKit.has(f.nome)), ...todas.filter((f) => !doKit.has(f.nome))];
  for (const f of ordenadas) lista.push([f.nome, `${f.nome}${f.origem === 'arquivo' ? ' · arquivo' : ''}${doKit.has(f.nome) ? ' · do kit' : ''}`]);
  lista.push(['system-ui', 'Fonte do sistema']);
  if (atual && !lista.some(([v]) => v === atual)) lista.push([atual, atual]);
  return lista;
};

export const familiaCss = (nome?: string) => {
  const n = nome || PADRAO.fonte;
  return GENERICAS.has(n) ? n : `"${fonte(n)}", system-ui, sans-serif`;
};

export const esperarFontes = async (nomes: string[]) => {
  await Promise.all([...new Set(nomes)].map((n) => {
    familiaCss(n);
    const carregar = CARREGADORES[n.replace(/\s+/g, '')];
    return carregar?.('normal', {subsets: ['latin', 'latin-ext'], ignoreTooManyRequestsWarning: true}).waitUntilDone().catch(() => undefined);
  }));
  await document.fonts.ready;
};

// ---------- prévia ao vivo ----------
// Controle deslizante ou seletor de cor sendo mexido: o monitor mostra o valor na hora, o patch só sai ao soltar.
export type Previa = {documento: string; caminho: string; valor: unknown} | null;

/** Cópia de `obj` com `valor` no caminho relativo ("sombra/desfoque", "degrade/paradas/1/cor"); o resto fica igual. */
export const comValor = <T,>(obj: T, caminho: string, valor: unknown): T => {
  const [chave, ...resto] = caminho.split('/').map((x) => x.replace(/~1/g, '/').replace(/~0/g, '~'));
  const base = (obj && typeof obj === 'object' ? obj : {}) as Record<string, unknown>;
  const novo: Record<string, unknown> | unknown[] = Array.isArray(base) ? [...base] : {...base};
  (novo as Record<string, unknown>)[chave] = resto.length ? comValor(base[chave], resto.join('/'), valor) : valor;
  return novo as T;
};
let previa: Previa = null;
const ouvintes = new Set<() => void>();
export const definirPrevia = (p: Previa) => {
  previa = p;
  ouvintes.forEach((f) => f());
};
const assinar = (f: () => void) => {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
};
export const usarPrevia = () => useSyncExternalStore(assinar, () => previa);
