// Linha e seta na imagem (rodada 3, frente Marca): a forma "linha" é um segmento horizontal no meio da caixa da camada, de
// uma ponta à outra, e gira com `rotacao`: o ângulo da seta é o giro da camada, então arrastar a alça de giro ou
// escrever `rotacao` aponta a seta para onde se quer. Cada ponta pode ter seta aberta, triângulo, losango, círculo ou barra;
// o traço pode ser sólido, tracejado ou pontilhado, de pontas e junções redondas, retas, quadradas, pontudas ou chanfradas.
// Só regras e números, sem DOM: a pintura em canvas (src/renderer/modulos/imagem/linha.ts) serve à prévia e ao PNG e lê
// daqui a geometria. Campo ausente ou fora do lugar volta ao padrão. Ver docs/marca.md.
import {tracoDe} from './acabamento';
import type {CamadaImagem, DocImagem, Linha, OperacaoPatch, PontaDeSeta} from './documentos';

export const PONTAS_DE_SETA: [PontaDeSeta, string][] = [
  ['nenhuma', 'Nenhuma'], ['seta', 'Seta aberta'], ['triangulo', 'Triângulo'], ['losango', 'Losango'], ['circulo', 'Círculo'], ['barra', 'Barra'],
];
const VALIDAS = new Set<string>(PONTAS_DE_SETA.map(([v]) => v));
export const ESPESSURA_LINHA = 6;

const numero = (v: unknown, padrao: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : padrao);

/** A linha da camada com os padrões preenchidos: 6 px, sólida, pontas e junção redondas, sem setas, seta de 4 espessuras. */
export const linhaDe = (c: Pick<CamadaImagem, 'linha'>) => {
  const l: Linha = c.linha && typeof c.linha === 'object' ? c.linha : {};
  const espessura = numero(l.espessura, ESPESSURA_LINHA, 0.5, 400);
  const ponta = (v: unknown): PontaDeSeta => (typeof v === 'string' && VALIDAS.has(v) ? (v as PontaDeSeta) : 'nenhuma');
  return {espessura, ...tracoDe(l), inicio: ponta(l.inicio), fim: ponta(l.fim), tamanho: numero(l.tamanho_seta, Math.max(14, espessura * 4), 2, 2000)};
};

/** A ponta desenhada: o tipo, o bico (x e y no espaço da camada) e o sentido em que aponta (+1 para a direita, -1 para a esquerda). */
export type CabecaDeLinha = {tipo: Exclude<PontaDeSeta, 'nenhuma'>; x: number; y: number; sentido: 1 | -1; tamanho: number};

/** Quanto o traço para antes do bico: o triângulo e o losango cobrem o fim da linha; o círculo fica com o centro no fim do traço. */
const recuo = (tipo: PontaDeSeta, tamanho: number) => (tipo === 'triangulo' ? tamanho : tipo === 'losango' || tipo === 'circulo' ? tamanho / 2 : 0);

/** A geometria no espaço da camada (0..largura × 0..altura): o traço vai de x0 a x1 na altura y, e as pontas ficam nos extremos da
 *  caixa. Linha mais curta que as pontas: o traço some e ficam só elas. */
export const geometriaDaLinha = (c: Pick<CamadaImagem, 'largura' | 'altura' | 'linha'>) => {
  const l = linhaDe(c);
  let x0 = recuo(l.inicio, l.tamanho);
  let x1 = c.largura - recuo(l.fim, l.tamanho);
  if (x1 < x0) x0 = x1 = c.largura / 2;
  const y = c.altura / 2;
  const cabecas: CabecaDeLinha[] = [];
  if (l.inicio !== 'nenhuma') cabecas.push({tipo: l.inicio, x: 0, y, sentido: -1, tamanho: l.tamanho});
  if (l.fim !== 'nenhuma') cabecas.push({tipo: l.fim, x: c.largura, y, sentido: 1, tamanho: l.tamanho});
  return {...l, x0, x1, y, cabecas};
};

/** O que a linha e as pontas passam da caixa, por lado: meia espessura da ponta redonda e quadrada e a meia largura da seta. É
 *  o que o canvas da prévia precisa a mais em volta. */
export const folgaDaLinha = (c: Pick<CamadaImagem, 'linha'>) => {
  const l = linhaDe(c);
  const e = Math.ceil(Math.max(l.espessura, l.tamanho) + l.espessura);
  return {esq: e, dir: e, cima: e, baixo: e};
};

/** Os pontos do desenho de cada ponta, no espaço da camada, para a pintura: `poligono` (preenchido), `abertos` (traçados) e `circulo`. */
export const formaDaCabeca = (h: CabecaDeLinha) => {
  const {x, y, sentido: s, tamanho: T} = h;
  switch (h.tipo) {
    case 'triangulo': return {poligono: [[x, y], [x - s * T, y - T / 2], [x - s * T, y + T / 2]] as [number, number][]};
    case 'losango': return {poligono: [[x, y], [x - s * T / 2, y - T / 3], [x - s * T, y], [x - s * T / 2, y + T / 3]] as [number, number][]};
    case 'circulo': return {circulo: {x: x - s * T / 2, y, r: T / 2}};
    case 'barra': return {abertos: [[[x, y - T / 2], [x, y + T / 2]]] as [number, number][][]};
    default: return {abertos: [[[x - s * T * 0.9, y - T * 0.45], [x, y], [x - s * T * 0.9, y + T * 0.45]]] as [number, number][][]};
  }
};

// ---------- criar ----------
export type OpcoesLinha = {x1: number; y1: number; x2: number; y2: number; cor?: string; espessura?: number; estilo?: Linha['estilo']; pontas?: Linha['pontas'];
  juncao?: Linha['juncao']; inicio?: PontaDeSeta; fim?: PontaDeSeta; tamanho_seta?: number};

/** Linha ou seta do ponto (x1, y1) ao (x2, y2), em px do documento: a caixa tem o comprimento do segmento e é girada pelo ângulo
 *  dele (0° aponta para a direita, 90° para baixo, como no CSS). Sem pontas, é uma linha; com `fim: "triangulo"`, uma seta. */
export const linhaNova = (o: OpcoesLinha): Omit<CamadaImagem, 'id'> => {
  const dx = o.x2 - o.x1;
  const dy = o.y2 - o.y1;
  const comprimento = Math.max(2, Math.hypot(dx, dy));
  const linha: Linha = {...(o.espessura !== undefined ? {espessura: o.espessura} : {}), ...(o.estilo && o.estilo !== 'solido' ? {estilo: o.estilo} : {}),
    ...(o.pontas && o.pontas !== 'redonda' ? {pontas: o.pontas} : {}), ...(o.juncao && o.juncao !== 'redonda' ? {juncao: o.juncao} : {}),
    ...(o.inicio && o.inicio !== 'nenhuma' ? {inicio: o.inicio} : {}), ...(o.fim && o.fim !== 'nenhuma' ? {fim: o.fim} : {}),
    ...(o.tamanho_seta !== undefined ? {tamanho_seta: o.tamanho_seta} : {})};
  const l = linhaDe({linha});
  const altura = Math.max(12, Math.round(Math.max(l.espessura, l.tamanho) * 1.5));
  const cx = (o.x1 + o.x2) / 2;
  const cy = (o.y1 + o.y2) / 2;
  const graus = dx === 0 && dy === 0 ? 0 : Math.round(((Math.atan2(dy, dx) * 180) / Math.PI) * 100) / 100;
  const seta = l.inicio !== 'nenhuma' || l.fim !== 'nenhuma';
  return {
    nome: seta ? 'Seta' : 'Linha', tipo: 'forma', forma: 'linha', preenchimento: o.cor ?? '@destaque', raio: 0, linha,
    x: Math.round(cx - comprimento / 2), y: Math.round(cy - altura / 2), largura: Math.round(comprimento), altura,
    ...(graus ? {rotacao: graus} : {}),
  };
};

/** As predefinições do botão "Inserir linha ou seta": segmento horizontal de 40% da largura, no centro da peça. */
export const PREDEFINICOES_LINHA: {id: string; nome: string; opcoes: Partial<OpcoesLinha>}[] = [
  {id: 'linha', nome: 'Linha', opcoes: {}},
  {id: 'tracejada', nome: 'Linha tracejada', opcoes: {estilo: 'tracejado'}},
  {id: 'seta', nome: 'Seta', opcoes: {fim: 'triangulo'}},
  {id: 'seta-aberta', nome: 'Seta aberta', opcoes: {fim: 'seta'}},
  {id: 'seta-dupla', nome: 'Seta dupla', opcoes: {inicio: 'triangulo', fim: 'triangulo'}},
  {id: 'seta-tracejada', nome: 'Seta tracejada', opcoes: {estilo: 'tracejado', fim: 'seta'}},
  {id: 'ponto-seta', nome: 'Ponto e seta', opcoes: {inicio: 'circulo', fim: 'triangulo'}},
  {id: 'medida', nome: 'Medida (barras)', opcoes: {inicio: 'barra', fim: 'barra', espessura: 3}},
];

export const linhaDaPredefinicao = (doc: Pick<DocImagem, 'largura' | 'altura'>, id: string): Omit<CamadaImagem, 'id'> | null => {
  const p = PREDEFINICOES_LINHA.find((x) => x.id === id);
  if (!p) return null;
  const comprimento = Math.round(doc.largura * 0.4);
  const y = Math.round(doc.altura / 2);
  const x1 = Math.round((doc.largura - comprimento) / 2);
  return linhaNova({x1, y1: y, x2: x1 + comprimento, y2: y, ...p.opcoes});
};

/** O patch de uma linha nova numa página (a primeira, sem `pagina`) está em mcp-marca.ts (patchInserirLinha). */
export type PatchDeLinha = {patch: OperacaoPatch[]; id: string; caminho: string};
