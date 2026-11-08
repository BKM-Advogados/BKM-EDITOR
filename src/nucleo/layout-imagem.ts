// Layout das camadas da imagem: a caixa de cada camada (girada) e a de várias, alinhar (6) e distribuir (2), o patch
// que move um conjunto de camadas de uma vez e o redimensionar de camada girada sem o canto escorregar. Puro, sem DOM
// nem disco: o monitor, as ferramentas do MCP (mcp-imagem.ts) e os testes usam as mesmas funções. Ver docs/imagem.md.
import type {CamadaImagem, OperacaoPatch} from './documentos';
import {mascarasEmUso} from './acabamento';

export type Caixa = {x: number; y: number; w: number; h: number};
export type Alinhamento = 'esquerda' | 'centro' | 'direita' | 'topo' | 'meio' | 'base';
export type Distribuicao = 'horizontal' | 'vertical';
export type Deslocamento = {dx: number; dy: number};

export const ALINHAMENTOS: Alinhamento[] = ['esquerda', 'centro', 'direita', 'topo', 'meio', 'base'];
export const DISTRIBUICOES: Distribuicao[] = ['horizontal', 'vertical'];

/** Os quatro cantos da camada no documento, já girada pelo centro. */
export const cantosDe = (c: Pick<CamadaImagem, 'x' | 'y' | 'largura' | 'altura' | 'rotacao'>): [number, number][] => {
  const cx = c.x + c.largura / 2;
  const cy = c.y + c.altura / 2;
  const t = ((c.rotacao ?? 0) * Math.PI) / 180;
  const cos = Math.cos(t);
  const sen = Math.sin(t);
  return [[0, 0], [c.largura, 0], [c.largura, c.altura], [0, c.altura]].map(([px, py]) => {
    const lx = px - c.largura / 2;
    const ly = py - c.altura / 2;
    return [cx + lx * cos - ly * sen, cy + lx * sen + ly * cos];
  });
};

/** Caixa (sem giro) que contém a camada girada; sem sombra nem contorno: é a que se alinha e se encaixa. */
export const caixaDe = (c: Pick<CamadaImagem, 'x' | 'y' | 'largura' | 'altura' | 'rotacao'>): Caixa => {
  if (!c.rotacao) return {x: c.x, y: c.y, w: c.largura, h: c.altura};
  const p = cantosDe(c);
  const xs = p.map((q) => q[0]);
  const ys = p.map((q) => q[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y};
};

/** Caixa que contém todas; null sem nenhuma. */
export const caixaDeVarias = (cs: Pick<CamadaImagem, 'x' | 'y' | 'largura' | 'altura' | 'rotacao'>[]): Caixa | null => {
  if (!cs.length) return null;
  const caixas = cs.map(caixaDe);
  const x = Math.min(...caixas.map((k) => k.x));
  const y = Math.min(...caixas.map((k) => k.y));
  return {x, y, w: Math.max(...caixas.map((k) => k.x + k.w)) - x, h: Math.max(...caixas.map((k) => k.y + k.h)) - y};
};

/** O alvo do alinhamento: com várias camadas, a caixa delas; com uma só, a prancheta inteira. */
export const alvoDoAlinhamento = (cs: CamadaImagem[], prancheta: {largura: number; altura: number}): Caixa =>
  (cs.length > 1 && caixaDeVarias(cs)) || {x: 0, y: 0, w: prancheta.largura, h: prancheta.altura};

/** Quanto cada camada anda para ficar alinhada ao alvo (pela caixa girada dela). */
export const alinhar = (cs: CamadaImagem[], como: Alinhamento, alvo: Caixa): Deslocamento[] =>
  cs.map((c) => {
    const k = caixaDe(c);
    switch (como) {
      case 'esquerda': return {dx: alvo.x - k.x, dy: 0};
      case 'centro': return {dx: alvo.x + alvo.w / 2 - (k.x + k.w / 2), dy: 0};
      case 'direita': return {dx: alvo.x + alvo.w - (k.x + k.w), dy: 0};
      case 'topo': return {dx: 0, dy: alvo.y - k.y};
      case 'meio': return {dx: 0, dy: alvo.y + alvo.h / 2 - (k.y + k.h / 2)};
      default: return {dx: 0, dy: alvo.y + alvo.h - (k.y + k.h)};
    }
  });

/** Distribuir: a primeira e a última (pela posição) ficam; as do meio ganham o mesmo espaço entre caixas. Com menos
 *  de três, nada anda. */
export const distribuir = (cs: CamadaImagem[], eixo: Distribuicao): Deslocamento[] => {
  const nada = cs.map(() => ({dx: 0, dy: 0}));
  if (cs.length < 3) return nada;
  const h = eixo === 'horizontal';
  const itens = cs.map((c, i) => ({i, k: caixaDe(c)})).sort((a, b) => (h ? a.k.x - b.k.x : a.k.y - b.k.y));
  const ini = h ? itens[0].k.x : itens[0].k.y;
  const ult = itens[itens.length - 1].k;
  const fim = h ? ult.x + ult.w : ult.y + ult.h;
  const soma = itens.reduce((s, it) => s + (h ? it.k.w : it.k.h), 0);
  const vao = (fim - ini - soma) / (itens.length - 1);
  let pos = ini;
  for (const it of itens) {
    const atual = h ? it.k.x : it.k.y;
    nada[it.i] = h ? {dx: pos - atual, dy: 0} : {dx: 0, dy: pos - atual};
    pos += (h ? it.k.w : it.k.h) + vao;
  }
  return nada;
};

/** A foto recortada anda com a máscara: aos índices pedidos somam-se as fotos das máscaras que estão neles. */
export const comAcompanhantes = (camadas: CamadaImagem[], indices: number[]) => {
  const fotos = mascarasEmUso(camadas);
  const todos = new Set(indices);
  for (const i of indices) {
    const f = fotos.get(i);
    if (f !== undefined) todos.add(f);
  }
  return [...todos].sort((a, b) => a - b);
};

/** Patch que move as camadas `indices` (com test do id de cada uma); posições inteiras, como o resto do editor. A foto
 *  de uma máscara movida vai junto com o mesmo deslocamento. */
export const patchMover = (camadas: CamadaImagem[], base: string, indices: number[], desl: Deslocamento[]): OperacaoPatch[] => {
  const porIndice = new Map(indices.map((i, k) => [i, desl[k]] as const));
  for (const [mascara, foto] of mascarasEmUso(camadas)) {
    const d = porIndice.get(mascara);
    if (d && !porIndice.has(foto)) porIndice.set(foto, d);
  }
  const patch: OperacaoPatch[] = [];
  for (const [i, d] of [...porIndice].sort((a, b) => a[0] - b[0])) {
    const c = camadas[i];
    const x = Math.round(c.x + d.dx);
    const y = Math.round(c.y + d.dy);
    if (x === c.x && y === c.y) continue;
    patch.push({op: 'test', path: `${base}/${i}/id`, value: c.id});
    if (x !== c.x) patch.push({op: 'replace', path: `${base}/${i}/x`, value: x});
    if (y !== c.y) patch.push({op: 'replace', path: `${base}/${i}/y`, value: y});
  }
  return patch;
};

/** Nova caixa de uma camada girada que muda de tamanho pela alça (canto de baixo à direita): o canto oposto, o de
 *  cima à esquerda da camada, fica parado na página. Sem giro, é só trocar largura e altura. */
export const redimensionarGirada = (c: Pick<CamadaImagem, 'x' | 'y' | 'largura' | 'altura' | 'rotacao'>, largura: number, altura: number) => {
  if (!c.rotacao) return {x: c.x, y: c.y, largura, altura};
  const [fixo] = cantosDe(c);
  const t = (c.rotacao * Math.PI) / 180;
  const cos = Math.cos(t);
  const sen = Math.sin(t);
  // o canto de cima à esquerda da caixa nova é centro + R(−w/2, −h/2); o centro sai de igualar esse canto ao fixo
  const cx = fixo[0] - (-largura / 2 * cos + altura / 2 * sen);
  const cy = fixo[1] - (-largura / 2 * sen - altura / 2 * cos);
  return {x: Math.round(cx - largura / 2), y: Math.round(cy - altura / 2), largura, altura};
};

/** Camadas tocadas por um retângulo (a caixa de seleção), na ordem da pilha; sem as ocultas e sem as fotos recortadas
 *  (quem aparece é a máscara). */
export const tocadasPor = (camadas: CamadaImagem[], r: Caixa) => {
  const fotos = new Set(mascarasEmUso(camadas).values());
  return camadas.flatMap((c, i) => {
    if (!c || c.visivel === false || fotos.has(i)) return [];
    const k = caixaDe(c);
    return k.x < r.x + r.w && k.x + k.w > r.x && k.y < r.y + r.h && k.y + k.h > r.y ? [i] : [];
  });
};
