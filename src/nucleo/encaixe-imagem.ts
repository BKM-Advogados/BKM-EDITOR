// Encaixe e guias da imagem (rodada 3, B2): no arrasto, a caixa do que anda encaixa (bordas e centro) nas bordas e no
// centro da prancheta, nas bordas e centros das outras camadas, na margem segura e, com a grade ligada, nas linhas dela,
// a 5 px de tela; as guias do encaixe e a distância até o vizinho de cada lado aparecem no monitor. Puro, sem DOM: o
// monitor e os testes usam as mesmas contas. Ver docs/imagem.md.
import type {CamadaImagem} from './documentos';
import {caixaDe, type Caixa} from './layout-imagem';
import {conjuntoDe, type IdZonaSegura} from './zonas-seguras';

export type TipoAlvo = 'prancheta' | 'camada' | 'margem' | 'grade';
export type Alvo = {valor: number; tipo: TipoAlvo};
export type Alvos = {x: Alvo[]; y: Alvo[]};
export type Guia = {eixo: 'x' | 'y'; valor: number; tipo: TipoAlvo};
/** Distância medida no arrasto: segmento de `de` a `ate` no eixo, na altura (ou coluna) `em`; `valor` em px. */
export type Distancia = {eixo: 'x' | 'y'; de: number; ate: number; em: number; valor: number};
/** Área da margem segura em px do documento: coberta pela interface da rede ou o contorno a respeitar. */
export type AreaSegura = Caixa & {tipo: 'coberta' | 'contorno'; miolo: boolean; rotulo: string};

export const TOLERANCIA_TELA = 5; // px de tela

/** Zonas da rede pelo tamanho exato (feed 4:5, story 9:16, miniatura do YouTube); outro tamanho (quadrado, LinkedIn,
 *  A4) ganha só a margem de 5% de cada lado, a área segura de título. */
const conjuntoDoTamanho = (largura: number, altura: number): IdZonaSegura | null =>
  largura === 1080 && altura === 1350 ? 'feed' : largura === 1080 && altura === 1920 ? 'vertical' : largura === 1280 && altura === 720 ? 'youtube' : null;

export const margemSegura = (largura: number, altura: number): AreaSegura[] => {
  const zonas = conjuntoDe(conjuntoDoTamanho(largura, altura))?.zonas;
  if (!zonas) return [{x: largura * 0.05, y: altura * 0.05, w: largura * 0.9, h: altura * 0.9, tipo: 'contorno', miolo: true, rotulo: 'Margem segura (5%)'}];
  return zonas.map((z) => ({x: z.x * largura, y: z.y * altura, w: z.largura * largura, h: z.altura * altura, tipo: z.tipo, miolo: Boolean(z.miolo), rotulo: z.rotulo}));
};

/** Onde encaixar: prancheta (bordas e centro), as camadas que não andam (bordas e centros das caixas giradas) e, com a
 *  margem ligada, as bordas das áreas seguras. */
export const alvosDeEncaixe = (camadas: CamadaImagem[], andando: Set<number>, prancheta: {largura: number; altura: number}, margem?: AreaSegura[]): Alvos => {
  const x: Alvo[] = [0, prancheta.largura / 2, prancheta.largura].map((valor) => ({valor, tipo: 'prancheta' as const}));
  const y: Alvo[] = [0, prancheta.altura / 2, prancheta.altura].map((valor) => ({valor, tipo: 'prancheta' as const}));
  camadas.forEach((c, i) => {
    if (!c || andando.has(i) || c.visivel === false) return;
    const k = caixaDe(c);
    x.push({valor: k.x, tipo: 'camada'}, {valor: k.x + k.w / 2, tipo: 'camada'}, {valor: k.x + k.w, tipo: 'camada'});
    y.push({valor: k.y, tipo: 'camada'}, {valor: k.y + k.h / 2, tipo: 'camada'}, {valor: k.y + k.h, tipo: 'camada'});
  });
  for (const a of margem ?? []) {
    x.push({valor: a.x, tipo: 'margem'}, {valor: a.x + a.w, tipo: 'margem'});
    y.push({valor: a.y, tipo: 'margem'}, {valor: a.y + a.h, tipo: 'margem'});
  }
  return {x, y};
};

/** O melhor encaixe de um eixo: menor distância (dentro da tolerância) entre uma borda ou o centro da caixa e um alvo
 *  ou, com grade, a linha mais perto das bordas. */
const encaixarEixo = (ini: number, tam: number, alvos: Alvo[], tol: number, grade?: number) => {
  const pontos = [ini, ini + tam / 2, ini + tam];
  let melhor: {d: number; tipo: TipoAlvo} | null = null;
  const tentar = (d: number, tipo: TipoAlvo) => {
    if (Math.abs(d) <= tol && (!melhor || Math.abs(d) < Math.abs(melhor.d))) melhor = {d, tipo};
  };
  for (const a of alvos) for (const p of pontos) tentar(a.valor - p, a.tipo);
  if (grade && grade > 0) for (const p of [ini, ini + tam]) tentar(Math.round(p / grade) * grade - p, 'grade');
  return melhor as {d: number; tipo: TipoAlvo} | null;
};

/** Encaixa a caixa que anda: quanto ela anda a mais em x e y e as guias que ficam acesas (todas as linhas em que uma
 *  borda ou o centro dela cai depois do encaixe). `tol` em px do documento (5 px de tela ÷ zoom). */
export const encaixar = (caixa: Caixa, alvos: Alvos, tol: number, grade?: number) => {
  const ex = encaixarEixo(caixa.x, caixa.w, alvos.x, tol, grade);
  const ey = encaixarEixo(caixa.y, caixa.h, alvos.y, tol, grade);
  const dx = ex?.d ?? 0;
  const dy = ey?.d ?? 0;
  const k = {x: caixa.x + dx, y: caixa.y + dy, w: caixa.w, h: caixa.h};
  const guias: Guia[] = [];
  // acesas: os alvos em que uma borda ou o centro cai, e as linhas da grade em que uma borda cai (uma guia por linha)
  const acesas = (eixo: 'x' | 'y', ini: number, tam: number, lista: Alvo[]) => {
    const pontos = [ini, ini + tam / 2, ini + tam];
    const vistos = new Set<number>();
    const acender = (valor: number, tipo: TipoAlvo) => {
      if (vistos.has(Math.round(valor * 2))) return;
      vistos.add(Math.round(valor * 2));
      guias.push({eixo, valor, tipo});
    };
    for (const a of lista) if (pontos.some((p) => Math.abs(p - a.valor) < 0.5)) acender(a.valor, a.tipo);
    if (grade && grade > 0) for (const p of [ini, ini + tam]) if (Math.abs(p - Math.round(p / grade) * grade) < 0.5) acender(Math.round(p / grade) * grade, 'grade');
  };
  if (ex) acesas('x', k.x, k.w, alvos.x);
  if (ey) acesas('y', k.y, k.h, alvos.y);
  return {dx, dy, guias};
};

/** Distância da caixa até o vizinho de cada lado (a caixa mais perto cuja faixa cruza a dela) ou, sem vizinho, até a
 *  borda da prancheta. */
export const distancias = (caixa: Caixa, outras: Caixa[], prancheta: {largura: number; altura: number}): Distancia[] => {
  const r: Distancia[] = [];
  const cruzaY = (o: Caixa) => o.y < caixa.y + caixa.h && o.y + o.h > caixa.y;
  const cruzaX = (o: Caixa) => o.x < caixa.x + caixa.w && o.x + o.w > caixa.x;
  const meioY = (o?: Caixa) => (o ? (Math.max(o.y, caixa.y) + Math.min(o.y + o.h, caixa.y + caixa.h)) / 2 : caixa.y + caixa.h / 2);
  const meioX = (o?: Caixa) => (o ? (Math.max(o.x, caixa.x) + Math.min(o.x + o.w, caixa.x + caixa.w)) / 2 : caixa.x + caixa.w / 2);
  const esq = outras.filter((o) => cruzaY(o) && o.x + o.w <= caixa.x).sort((a, b) => b.x + b.w - (a.x + a.w))[0];
  const dir = outras.filter((o) => cruzaY(o) && o.x >= caixa.x + caixa.w).sort((a, b) => a.x - b.x)[0];
  const cima = outras.filter((o) => cruzaX(o) && o.y + o.h <= caixa.y).sort((a, b) => b.y + b.h - (a.y + a.h))[0];
  const baixo = outras.filter((o) => cruzaX(o) && o.y >= caixa.y + caixa.h).sort((a, b) => a.y - b.y)[0];
  const de = (eixo: 'x' | 'y', a: number, b: number, em: number) => {
    if (b - a > 0.5) r.push({eixo, de: a, ate: b, em, valor: Math.round(b - a)});
  };
  de('x', esq ? esq.x + esq.w : 0, caixa.x, meioY(esq));
  de('x', caixa.x + caixa.w, dir ? dir.x : prancheta.largura, meioY(dir));
  de('y', cima ? cima.y + cima.h : 0, caixa.y, meioX(cima));
  de('y', caixa.y + caixa.h, baixo ? baixo.y : prancheta.altura, meioX(baixo));
  return r;
};

/** Passo da grade: doze colunas na largura (90 px num post de 1080). */
export const passoDaGrade = (largura: number) => Math.max(4, Math.round(largura / 12));

/** Passo das marcas da régua (px do documento) para ficarem a pelo menos `minimoTela` px de tela umas das outras. */
export const passoDaRegua = (escala: number, minimoTela = 60) =>
  [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000].find((p) => p * escala >= minimoTela) ?? 5000;
