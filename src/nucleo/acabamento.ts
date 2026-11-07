// Acabamento das camadas de imagem: sombra, contorno, degradê e máscara de recorte. Só regras e números, sem DOM: a
// pintura em canvas (src/renderer/modulos/imagem/pintura.ts), que serve à prévia e ao PNG, lê daqui os valores
// padrão, os pontos do degradê, a folga que a sombra e o contorno pedem em volta da caixa e quem recorta quem; o
// inspector lê as predefinições do kit de marca. Campo ausente ou fora do lugar volta ao padrão, nunca derruba a tela
// (o Claude pode gravar o JSON à mão). Ver docs/imagem.md.
import type {CamadaImagem, Contorno, Degrade, DocImagem, OperacaoPatch, ParadaDegrade, Sombra} from './documentos';
import type {Marca} from './marca';

export const SOMBRA_PADRAO: Required<Sombra> = {cor: '#000000', opacidade: 0.35, desfoque: 24, x: 0, y: 8};
export const CONTORNO_PADRAO: Required<Contorno> = {cor: '#FFFFFF', espessura: 4, posicao: 'fora'};
export const POSICOES_CONTORNO: [Required<Contorno>['posicao'], string][] = [['fora', 'Por fora'], ['centro', 'Na borda'], ['dentro', 'Por dentro']];

const numero = (v: unknown, padrao: number, min = -Infinity, max = Infinity) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : padrao;
const corOu = (v: unknown, padrao: string) => (typeof v === 'string' && v.trim() ? v.trim() : padrao);

/** A sombra da camada com os padrões preenchidos; null se não tem (ou é invisível). */
export const sombraDe = (c: Pick<CamadaImagem, 'sombra'>): Required<Sombra> | null => {
  const s = c.sombra;
  if (!s || typeof s !== 'object') return null;
  const r = {
    cor: corOu(s.cor, SOMBRA_PADRAO.cor), opacidade: numero(s.opacidade, SOMBRA_PADRAO.opacidade, 0, 1),
    desfoque: numero(s.desfoque, SOMBRA_PADRAO.desfoque, 0, 1000), x: numero(s.x, SOMBRA_PADRAO.x), y: numero(s.y, SOMBRA_PADRAO.y),
  };
  return r.opacidade > 0 ? r : null;
};

/** O contorno da camada com os padrões preenchidos; null se não tem (ou a espessura é zero). */
export const contornoDe = (c: Pick<CamadaImagem, 'contorno'>): Required<Contorno> | null => {
  const k = c.contorno;
  if (!k || typeof k !== 'object') return null;
  const espessura = numero(k.espessura, 0, 0, 1000);
  if (!(espessura > 0)) return null;
  const posicao = k.posicao === 'centro' || k.posicao === 'dentro' ? k.posicao : 'fora';
  return {cor: corOu(k.cor, CONTORNO_PADRAO.cor), espessura, posicao};
};

/** Paradas em ordem de posição, presas de 0 a 1; uma parada só vira cor chapada (duas iguais). */
export const paradasDe = (d: Pick<Degrade, 'paradas'>): Required<ParadaDegrade>[] => {
  const lista = (Array.isArray(d.paradas) ? d.paradas : [])
    .filter((p) => p && typeof p.cor === 'string' && p.cor.trim())
    .map((p) => ({cor: p.cor.trim(), posicao: numero(p.posicao, 0, 0, 1), opacidade: numero(p.opacidade, 1, 0, 1)}))
    .sort((a, b) => a.posicao - b.posicao);
  if (lista.length === 1) return [{...lista[0], posicao: 0}, {...lista[0], posicao: 1}];
  return lista;
};

/** O degradê com os padrões preenchidos; null se não tem paradas. */
export const degradeDe = (d: unknown): (Required<Pick<Degrade, 'tipo' | 'angulo' | 'centro'>> & {paradas: Required<ParadaDegrade>[]}) | null => {
  if (!d || typeof d !== 'object') return null;
  const g = d as Degrade;
  const paradas = paradasDe(g);
  if (!paradas.length) return null;
  const centro = g.centro && typeof g.centro === 'object' ? {x: numero(g.centro.x, 0.5, 0, 1), y: numero(g.centro.y, 0.5, 0, 1)} : {x: 0.5, y: 0.5};
  return {tipo: g.tipo === 'radial' ? 'radial' : 'linear', angulo: numero(g.angulo, 180), centro, paradas};
};

/** A camada pede o caminho do acabamento (canvas na prévia)? Sem nada disso, a prévia continua em DOM. */
export const temAcabamento = (c: CamadaImagem) =>
  Boolean(sombraDe(c) || contornoDe(c) || (c.tipo !== 'imagem' && degradeDe(c.degrade)));

// ---------- geometria do degradê (a mesma do CSS) ----------

/** Linear: o segmento do degradê na caixa w×h, como o linear-gradient do CSS: passa pelo centro, na direção do ângulo
 *  (0 = para cima, 90 = para a direita, 180 = para baixo), com o comprimento que leva os cantos às paradas 0 e 1. */
export const linhaDoDegrade = (angulo: number, w: number, h: number) => {
  const t = (angulo * Math.PI) / 180;
  const dx = Math.sin(t);
  const dy = -Math.cos(t);
  const meio = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  return {x0: w / 2 - dx * meio, y0: h / 2 - dy * meio, x1: w / 2 + dx * meio, y1: h / 2 + dy * meio};
};

/** Radial: centro e raios da elipse que passa pelo canto mais longe do centro (farthest-corner do CSS): a elipse do
 *  lado mais longe em cada eixo, vezes √2. */
export const elipseDoDegrade = (centro: {x: number; y: number}, w: number, h: number) => {
  const cx = centro.x * w;
  const cy = centro.y * h;
  const a = Math.max(cx, w - cx, 1e-6);
  const b = Math.max(cy, h - cy, 1e-6);
  return {cx, cy, rx: a * Math.SQRT2, ry: b * Math.SQRT2};
};

/** "#C88155", "#C815", "rgb(200, 129, 85)" ou "rgba(200, 129, 85, 0.5)" em canais; null para o resto (nomes de cor). */
const hex = (cor: string) => {
  const t = cor.trim();
  const f = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(t);
  if (f) return {r: Math.round(Number(f[1])), g: Math.round(Number(f[2])), b: Math.round(Number(f[3])), a: f[4] === undefined ? 1 : Math.min(1, Number(f[4]))};
  const m = /^#([0-9a-f]{3,8})$/i.exec(t);
  if (!m || ![3, 4, 6, 8].includes(m[1].length)) return null;
  const h = m[1].length <= 4 ? [...m[1]].map((x) => x + x).join('') : m[1];
  return {r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1};
};

/** "#C88155" com opacidade 0,5 → "rgba(200,129,85,0.5)". Cor que não se lê (nome de cor) passa como veio, sem a opacidade. */
export const corComOpacidade = (cor: string, opacidade = 1) => {
  const c = hex(cor);
  if (!c) return cor;
  const a = Math.round(c.a * Math.min(1, Math.max(0, opacidade)) * 1000) / 1000;
  return a >= 1 ? `rgb(${c.r},${c.g},${c.b})` : `rgba(${c.r},${c.g},${c.b},${a})`;
};

/** Mistura duas cores hexadecimais (t = 0 dá a primeira, 1 a segunda); devolve #RRGGBB. */
export const misturar = (a: string, b: string, t: number) => {
  const x = hex(a);
  const y = hex(b);
  if (!x || !y) return a;
  const m = (p: number, q: number) => Math.round(p + (q - p) * t).toString(16).padStart(2, '0');
  return `#${m(x.r, y.r)}${m(x.g, y.g)}${m(x.b, y.b)}`.toUpperCase();
};

// ---------- folga e caixa pintada ----------

export type Retangulo = {x: number; y: number; w: number; h: number};

/** Quanto o contorno passa da caixa, por lado, em px do documento (por fora: a espessura; na borda: metade). */
export const folgaDoContorno = (c: Pick<CamadaImagem, 'contorno'>) => {
  const k = contornoDe(c);
  return !k ? 0 : k.posicao === 'fora' ? k.espessura : k.posicao === 'centro' ? k.espessura / 2 : 0;
};

/** Alcance do desfoque da sombra: o shadowBlur do canvas é o dobro do desvio-padrão, e três desvios cobrem o borrão. */
export const alcanceDaSombra = (desfoque: number) => desfoque * 1.5;

/** Retângulo do documento que contém a pintura da camada: a caixa com a folga local (contorno, texto que passa da
 *  caixa), girada pelo centro da camada, mais a sombra, que anda na direção da página. `local` soma por lado. */
export const caixaPintada = (c: CamadaImagem, local: {esq?: number; dir?: number; cima?: number; baixo?: number} = {}): Retangulo => {
  const e = folgaDoContorno(c);
  const x0 = -e - (local.esq ?? 0);
  const y0 = -e - (local.cima ?? 0);
  const x1 = c.largura + e + (local.dir ?? 0);
  const y1 = c.altura + e + (local.baixo ?? 0);
  const cx = c.largura / 2;
  const cy = c.altura / 2;
  const t = ((c.rotacao ?? 0) * Math.PI) / 180;
  const cos = Math.cos(t);
  const sen = Math.sin(t);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [px, py] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) {
    xs.push(c.x + cx + (px - cx) * cos - (py - cy) * sen);
    ys.push(c.y + cy + (px - cx) * sen + (py - cy) * cos);
  }
  let r = {x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys)};
  const s = sombraDe(c);
  if (s) {
    const b = alcanceDaSombra(s.desfoque);
    const esq = Math.max(0, b - s.x);
    const cima = Math.max(0, b - s.y);
    r = {x: r.x - esq, y: r.y - cima, w: r.w + esq + Math.max(0, b + s.x), h: r.h + cima + Math.max(0, b + s.y)};
  }
  return r;
};

/** Interseção de dois retângulos; null se não se tocam. */
export const intersecao = (a: Retangulo, b: Retangulo): Retangulo | null => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? {x, y, w, h} : null;
};

// ---------- máscara de recorte ----------
// A imagem `i` leva `mascara` com o id da camada logo acima (i + 1), uma forma ou um texto: a foto aparece só dentro
// dela. A máscara não se desenha sozinha; a sombra e o contorno dela vão em volta da foto recortada. Separadas (outra
// camada no meio, a de cima apagada ou virou imagem), a foto volta a aparecer inteira e a outra camada também.

/** Índice da máscara da camada `i`; -1 se ela não tem, ou se a de cima não é a dela. */
export const mascaraDe = (camadas: CamadaImagem[], i: number) => {
  const c = camadas[i];
  if (!c || c.tipo !== 'imagem' || typeof c.mascara !== 'string' || !c.mascara) return -1;
  const m = camadas[i + 1];
  return m && m.id === c.mascara && (m.tipo === 'forma' || m.tipo === 'texto') ? i + 1 : -1;
};

/** Para cada máscara em uso, o índice da imagem que ela recorta (máscara → imagem). */
export const mascarasEmUso = (camadas: CamadaImagem[]) => {
  const m = new Map<number, number>();
  camadas.forEach((_, i) => {
    const j = mascaraDe(camadas, i);
    if (j >= 0) m.set(j, i);
  });
  return m;
};

/** O que se pinta, de baixo para cima: cada camada visível e, numa imagem recortada, a máscara junto (que então não
 *  aparece sozinha). Máscara oculta mostra a foto inteira; foto oculta deixa a máscara aparecer como ela é. */
export type ItemPintura = {i: number; c: CamadaImagem; mascara?: {j: number; c: CamadaImagem}};

export const itensDePintura = (camadas: CamadaImagem[]): ItemPintura[] => {
  const itens: ItemPintura[] = [];
  const usadas = new Set<number>();
  camadas.forEach((c, i) => {
    if (usadas.has(i) || !c || c.visivel === false) return;
    const j = mascaraDe(camadas, i);
    if (j < 0) return void itens.push({i, c});
    usadas.add(j);
    itens.push(camadas[j].visivel === false ? {i, c} : {i, c, mascara: {j, c: camadas[j]}});
  });
  return itens;
};

/** A camada `i` pode ser recortada pela de cima? Devolve o motivo se não. */
export const podeRecortar = (camadas: CamadaImagem[], i: number): string | null => {
  const c = camadas[i];
  const m = camadas[i + 1];
  if (!c || c.tipo !== 'imagem') return 'só uma imagem fica recortada';
  if (!m) return 'não há camada acima desta';
  if (m.tipo !== 'forma' && m.tipo !== 'texto') return 'a camada de cima precisa ser uma forma ou um texto';
  if (mascarasEmUso(camadas).has(i)) return 'esta imagem já é máscara de outra';
  return null;
};

/** "Recortar pela camada de cima": a imagem `i` leva o id da camada i + 1. */
export const patchRecortar = (camadas: CamadaImagem[], base: string, i: number): OperacaoPatch[] => {
  if (podeRecortar(camadas, i)) return [];
  const c = camadas[i];
  return [{op: 'test', path: `${base}/${i}/id`, value: c.id}, {op: c.mascara === undefined ? 'add' : 'replace', path: `${base}/${i}/mascara`, value: camadas[i + 1].id}];
};

/** "Soltar": a imagem volta a aparecer inteira (vale também para a máscara: solta a imagem de baixo). */
export const patchSoltar = (camadas: CamadaImagem[], base: string, i: number): OperacaoPatch[] => {
  const alvo = camadas[i]?.mascara !== undefined ? i : mascarasEmUso(camadas).get(i);
  if (alvo === undefined || camadas[alvo]?.mascara === undefined) return [];
  return [{op: 'test', path: `${base}/${alvo}/id`, value: camadas[alvo].id}, {op: 'remove', path: `${base}/${alvo}/mascara`}];
};

/** Bloco de camadas que anda junto na lista: a imagem e a máscara dela (ou a camada sozinha). */
export const blocoDe = (camadas: CamadaImagem[], i: number): [number, number] => {
  if (mascaraDe(camadas, i) === i + 1) return [i, i + 1];
  if (i > 0 && mascaraDe(camadas, i - 1) === i) return [i - 1, i];
  return [i, i];
};

/** Subir (+1) ou descer (-1) a camada `i` na pilha, com a máscara junto: o bloco vizinho passa para o outro lado.
 *  Devolve o patch (com test dos ids) e o índice novo da camada `i`; null se já está no topo ou no fundo. */
export const patchMoverCamada = (camadas: CamadaImagem[], base: string, i: number, direcao: 1 | -1) => {
  const [lo, hi] = blocoDe(camadas, i);
  const vizinho = direcao > 0 ? hi + 1 : lo - 1;
  if (vizinho < 0 || vizinho >= camadas.length) return null;
  const [vlo, vhi] = blocoDe(camadas, vizinho);
  const testes: OperacaoPatch[] = [];
  for (let k = Math.min(lo, vlo); k <= Math.max(hi, vhi); k++) testes.push({op: 'test', path: `${base}/${k}/id`, value: camadas[k].id});
  const moves: OperacaoPatch[] = [];
  // o bloco vizinho, uma camada por vez, vai para o outro lado do bloco que se move (a ordem dentro dele não muda)
  if (direcao > 0) for (let k = 0; k <= vhi - vlo; k++) moves.push({op: 'move', from: `${base}/${vlo + k}`, path: `${base}/${lo + k}`});
  else for (let k = 0; k <= vhi - vlo; k++) moves.push({op: 'move', from: `${base}/${vlo}`, path: `${base}/${hi}`});
  return {patch: [...testes, ...moves], indice: i + direcao * (vhi - vlo + 1)};
};

// ---------- predefinições ----------

/** Sombra suave: preta a 35%, 24 px de desfoque, 8 px para baixo. */
export const SOMBRA_SUAVE: Sombra = {...SOMBRA_PADRAO};

/** Contorno na cor de destaque do kit, por fora; num texto, a espessura acompanha o tamanho da letra. */
export const contornoDaMarca = (m: Pick<Marca, 'cores'>, c?: Pick<CamadaImagem, 'tipo' | 'tamanho'>): Contorno => ({
  cor: m.cores.destaque,
  espessura: c?.tipo === 'texto' ? Math.max(2, Math.round((c.tamanho ?? 48) * 0.06)) : 6,
  posicao: 'fora',
});

/** Degradê do kit: no texto e na forma, o destaque clareando em diagonal; no fundo, a cor de fundo esquentando
 *  para baixo com um quarto do destaque. */
export const degradeDaMarca = (m: Pick<Marca, 'cores'>, alvo: 'camada' | 'fundo' = 'camada'): Degrade =>
  alvo === 'fundo'
    ? {tipo: 'linear', angulo: 180, paradas: [{cor: m.cores.fundo, posicao: 0}, {cor: misturar(m.cores.fundo, m.cores.destaque, 0.25), posicao: 1}]}
    : {tipo: 'linear', angulo: 135, paradas: [{cor: m.cores.destaque, posicao: 0}, {cor: misturar(m.cores.destaque, '#FFFFFF', 0.35), posicao: 1}]};

/** Kit da imagem: o que tem a cor de fundo do documento (o kit aplicado troca o fundo) ou, sem nenhum, o primeiro. */
export const kitDaImagem = <M extends Pick<Marca, 'cores' | 'id'>>(doc: Pick<DocImagem, 'fundo'>, kits: M[]): M | undefined =>
  kits.find((k) => typeof doc.fundo === 'string' && k.cores.fundo.toUpperCase() === doc.fundo.toUpperCase()) ?? kits[0];
