// Pintura das camadas em canvas 2D. A mesma função desenha o PNG exportado (exportarPng.ts, num canvas do tamanho do
// documento) e, na prévia, as camadas com acabamento (Prancheta.tsx, num canvas do tamanho da camada na tela): sombra,
// contorno, degradê e máscara saem iguais nos dois porque são o mesmo código. Camada sem acabamento pinta direto no
// contexto, como sempre; com acabamento, o corpo (e o contorno) vão a um canvas à parte do tamanho da região, e a
// sombra nasce ao copiar esse canvas de volta. A sombra, o desfoque e os traços são em px do documento e acompanham a
// escala do contexto (que é px do canvas por px do documento). As regras de texto e encaixe são as da prévia em DOM
// (comum.ts). Ver docs/imagem.md.
import type {CamadaImagem} from '../../../nucleo/documentos';
import {
  alcanceDaSombra, caixaPintada, contornoDe, corComOpacidade, degradeDe, elipseDoDegrade, intersecao, linhaDoDegrade, sombraDe, temAcabamento,
  type ItemPintura, type Retangulo,
} from '../../../nucleo/acabamento';
import {ENTRELINHA, PADRAO, encaixe, familiaCss} from './comum';

/** Imagem pronta para desenhar e o tamanho natural do arquivo (o encaixe é sempre pelo original, mesmo num bitmap menor). */
export type FonteImagem = {fonte: CanvasImageSource; iw: number; ih: number};

export const novoCanvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};
export const soltar = (c: HTMLCanvasElement) => {
  c.width = 0;
  c.height = 0;
};
export const contexto = (c: HTMLCanvasElement) => {
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas 2D indisponível');
  return ctx;
};

/** Cor como o canvas entende ("#rrggbb" ou "rgba(…)"), para a opacidade das paradas valer também em nomes de cor. */
const normalizar = (ctx: CanvasRenderingContext2D, cor: string) => {
  const antes = ctx.fillStyle;
  ctx.fillStyle = '#000000';
  ctx.fillStyle = cor;
  const r = ctx.fillStyle;
  ctx.fillStyle = antes;
  return typeof r === 'string' ? r : cor;
};
const cor = (ctx: CanvasRenderingContext2D, c: string, opacidade = 1) => corComOpacidade(normalizar(ctx, c), opacidade);

const alfa = (c: CamadaImagem) => Math.min(1, Math.max(0, c.opacidade ?? 1));

// ---------- texto ----------

export const fonteCss = (c: CamadaImagem) => `${c.peso ?? PADRAO.peso} ${c.tamanho ?? PADRAO.tamanho}px ${familiaCss(c.fonte)}`;

/** Quebra por \n e pela largura da caixa; palavra maior que a caixa parte por letra (o overflow-wrap da prévia). */
const quebrarLinhas = (ctx: CanvasRenderingContext2D, texto: string, largura: number) => {
  const linhas: string[] = [];
  for (const paragrafo of texto.split('\n')) {
    let linha = '';
    for (const palavra of paragrafo.split(' ')) {
      const tentativa = linha ? `${linha} ${palavra}` : palavra;
      if (ctx.measureText(tentativa).width <= largura) {
        linha = tentativa;
        continue;
      }
      if (linha) linhas.push(linha);
      linha = '';
      for (const letra of palavra) {
        if (linha && ctx.measureText(linha + letra).width > largura) {
          linhas.push(linha);
          linha = letra;
        } else linha += letra;
      }
    }
    linhas.push(linha);
  }
  return linhas.map((l) => l.trimEnd());
};

type LayoutTexto = {linhas: string[]; x: number; linha0: number; altLinha: number; alinhar: CanvasTextAlign};

/** Fonte, alinhamento e linhas do texto no contexto (que fica com a fonte e o alinhamento dele). */
const layoutTexto = (ctx: CanvasRenderingContext2D, c: CamadaImagem): LayoutTexto => {
  const tamanho = c.tamanho ?? PADRAO.tamanho;
  ctx.font = fonteCss(c);
  ctx.textBaseline = 'alphabetic';
  const a = c.alinhar ?? PADRAO.alinhar;
  const alinhar: CanvasTextAlign = a === 'centro' ? 'center' : a === 'direita' ? 'right' : 'left';
  ctx.textAlign = alinhar;
  // a linha tem tamanho × ENTRELINHA e o texto fica no meio dela, como a caixa de linha do CSS (meia entrelinha)
  const altLinha = tamanho * ENTRELINHA;
  const m = ctx.measureText('Hg');
  const linha0 = (altLinha - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
  return {linhas: quebrarLinhas(ctx, c.texto ?? '', c.largura), x: a === 'centro' ? c.largura / 2 : a === 'direita' ? c.largura : 0, linha0, altLinha, alinhar};
};

let medidor: CanvasRenderingContext2D | null = null;

/** Quanto o texto passa da caixa: as linhas além da altura e uma margem para acento e letra que sai da linha. É o que
 *  o canvas da prévia precisa a mais em volta (a exportação desenha no documento inteiro e não precisa). */
export const folgaDoTexto = (c: CamadaImagem) => {
  medidor ??= novoCanvas(1, 1).getContext('2d');
  const tamanho = c.tamanho ?? PADRAO.tamanho;
  const margem = tamanho * 0.35;
  if (!medidor) return {esq: margem, dir: margem, cima: margem, baixo: margem + tamanho * 4};
  const l = layoutTexto(medidor, c);
  return {esq: margem, dir: margem, cima: margem, baixo: margem + Math.max(0, l.linhas.length * l.altLinha - c.altura)};
};

// ---------- corpo ----------

/** Translada e gira para o espaço da camada (0..largura × 0..altura), roda `f` e volta. */
const naCaixa = (ctx: CanvasRenderingContext2D, c: CamadaImagem, f: () => void) => {
  ctx.save();
  ctx.translate(c.x + c.largura / 2, c.y + c.altura / 2);
  if (c.rotacao) ctx.rotate((c.rotacao * Math.PI) / 180);
  ctx.translate(-c.largura / 2, -c.altura / 2);
  f();
  ctx.restore();
};

const caminhoForma = (ctx: CanvasRenderingContext2D, c: CamadaImagem) => {
  ctx.beginPath();
  if (c.forma === 'elipse') ctx.ellipse(c.largura / 2, c.altura / 2, c.largura / 2, c.altura / 2, 0, 0, Math.PI * 2);
  else ctx.roundRect(0, 0, c.largura, c.altura, Math.max(0, Math.min(c.raio ?? 0, c.largura / 2, c.altura / 2)));
};

const escreverLinhas = (ctx: CanvasRenderingContext2D, l: LayoutTexto, f: 'fillText' | 'strokeText') =>
  l.linhas.forEach((linha, k) => ctx[f](linha, l.x, l.linha0 + k * l.altLinha));

/** Silhueta opaca da forma ou do texto: recorta a foto da máscara e tira o miolo do contorno. */
const silhueta = (ctx: CanvasRenderingContext2D, c: CamadaImagem) =>
  naCaixa(ctx, c, () => {
    ctx.fillStyle = '#000000';
    if (c.tipo === 'texto') escreverLinhas(ctx, layoutTexto(ctx, c), 'fillText');
    else if (c.tipo === 'forma') {
      caminhoForma(ctx, c);
      ctx.fill();
    } else ctx.fillRect(0, 0, c.largura, c.altura);
  });

/** Preenche com o degradê o que já está pintado no contexto (source-in), no espaço da camada: o radial vira elipse
 *  pela escala do eixo y, e o retângulo enorme cobre letra e contorno que passam da caixa. */
const tingirComDegrade = (ctx: CanvasRenderingContext2D, d: NonNullable<ReturnType<typeof degradeDe>>, w: number, h: number) => {
  ctx.save();
  ctx.globalCompositeOperation = 'source-in';
  ctx.beginPath();
  ctx.rect(-1e5, -1e5, 2e5, 2e5);
  preencherComDegrade(ctx, d, w, h);
  ctx.restore();
};

/** Enche o caminho atual com o degradê na caixa 0..w × 0..h do espaço atual (o caminho já está traçado). */
const preencherComDegrade = (ctx: CanvasRenderingContext2D, d: NonNullable<ReturnType<typeof degradeDe>>, w: number, h: number) => {
  ctx.save();
  let g: CanvasGradient;
  if (d.tipo === 'linear') {
    const p = linhaDoDegrade(d.angulo, w, h);
    g = ctx.createLinearGradient(p.x0, p.y0, p.x1, p.y1);
  } else {
    const e = elipseDoDegrade(d.centro, w, h);
    ctx.translate(e.cx, e.cy);
    ctx.scale(1, e.ry / e.rx);
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, e.rx);
  }
  for (const p of d.paradas) g.addColorStop(p.posicao, cor(ctx, p.cor, p.opacidade));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
};

/** Fundo da prancheta em degradê, por cima da cor de fundo (o contexto está em px do documento). */
export const pintarFundoDegrade = (ctx: CanvasRenderingContext2D, degrade: unknown, w: number, h: number) => {
  const d = degradeDe(degrade);
  if (!d) return;
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  preencherComDegrade(ctx, d, w, h);
};

/** Corpo da camada: o texto, a forma (cor ou degradê) ou a imagem dentro da caixa, sem sombra nem contorno. O degradê
 *  tinge o que está no contexto: só vale num canvas à parte (o caminho do acabamento). */
const pintarCorpo = (ctx: CanvasRenderingContext2D, c: CamadaImagem, img: FonteImagem | undefined, opacidade: number) =>
  naCaixa(ctx, c, () => {
    ctx.globalAlpha = opacidade;
    if (c.tipo === 'imagem') {
      if (!img) return;
      ctx.beginPath();
      ctx.rect(0, 0, c.largura, c.altura);
      ctx.clip();
      const e = encaixe(img.iw || 1, img.ih || 1, c.largura, c.altura, c.ajuste);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img.fonte, e.x, e.y, e.w, e.h);
      return;
    }
    const d = degradeDe(c.degrade);
    if (c.tipo === 'texto') {
      const l = layoutTexto(ctx, c);
      ctx.fillStyle = d ? '#000000' : (c.cor ?? PADRAO.cor);
      escreverLinhas(ctx, l, 'fillText');
    } else {
      ctx.fillStyle = d ? '#000000' : (c.preenchimento ?? PADRAO.preenchimento);
      caminhoForma(ctx, c);
      ctx.fill();
    }
    if (d) tingirComDegrade(ctx, d, c.largura, c.altura);
  });

// ---------- contorno ----------

type Transformacao = {m: DOMMatrix; x0: number; y0: number};

const canvasIgual = (w: number, h: number, t: Transformacao) => {
  const c = novoCanvas(w, h);
  const ctx = contexto(c);
  ctx.setTransform(t.m.a, t.m.b, t.m.c, t.m.d, t.m.e - t.x0, t.m.f - t.y0);
  return {c, ctx};
};

/** Traço do texto ou da forma: centrado na borda com a espessura; por fora e por dentro, o dobro, sem o miolo ou só
 *  com ele. Cantos redondos, como o contorno "por fora" dos editores. */
const tracoDoCaminho = (forma: CamadaImagem, k: NonNullable<ReturnType<typeof contornoDe>>, w: number, h: number, t: Transformacao) => {
  const {c, ctx} = canvasIgual(w, h, t);
  naCaixa(ctx, forma, () => {
    ctx.lineWidth = k.posicao === 'centro' ? k.espessura : k.espessura * 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = cor(ctx, k.cor);
    if (forma.tipo === 'texto') escreverLinhas(ctx, layoutTexto(ctx, forma), 'strokeText');
    else if (forma.tipo === 'forma') {
      caminhoForma(ctx, forma);
      ctx.stroke();
    } else ctx.strokeRect(0, 0, forma.largura, forma.altura);
  });
  if (k.posicao !== 'centro') {
    ctx.globalCompositeOperation = k.posicao === 'fora' ? 'destination-out' : 'destination-in';
    silhueta(ctx, forma);
  }
  return c;
};

/** O alfa de `fonte` engordado de `raio` px do canvas: cópias deslocadas em anéis (sem buraco nos traços finos). */
const dilatar = (fonte: HTMLCanvasElement, raio: number) => {
  const d = novoCanvas(fonte.width, fonte.height);
  const ctx = contexto(d);
  const aneis = raio <= 2 ? [raio] : [raio, raio * 0.66, raio * 0.33];
  for (const r of aneis) {
    const n = Math.min(64, Math.max(8, Math.ceil((2 * Math.PI * r) / 1.5)));
    for (let a = 0; a < n; a++) ctx.drawImage(fonte, Math.cos((2 * Math.PI * a) / n) * r, Math.sin((2 * Math.PI * a) / n) * r);
  }
  ctx.drawImage(fonte, 0, 0);
  return d;
};

/** Faixa de `raio` px por fora (ou por dentro) do alfa do corpo, para o contorno de uma imagem (a foto sem fundo vira
 *  adesivo). */
const faixaDoAlfa = (corpo: HTMLCanvasElement, raio: number, lado: 'fora' | 'dentro') => {
  let base = corpo;
  if (lado === 'dentro') {
    // por dentro: o avesso do corpo engordado, só onde há corpo
    base = novoCanvas(corpo.width, corpo.height);
    const b = contexto(base);
    b.fillRect(0, 0, base.width, base.height);
    b.globalCompositeOperation = 'destination-out';
    b.drawImage(corpo, 0, 0);
  }
  const faixa = dilatar(base, raio);
  if (base !== corpo) soltar(base);
  const f = contexto(faixa);
  f.globalCompositeOperation = lado === 'fora' ? 'destination-out' : 'destination-in';
  f.drawImage(corpo, 0, 0);
  return faixa;
};

const tracoDoAlfa = (corpo: HTMLCanvasElement, k: NonNullable<ReturnType<typeof contornoDe>>, escala: number) => {
  const r = k.espessura * escala;
  const faixas = k.posicao === 'centro' ? [faixaDoAlfa(corpo, r / 2, 'fora'), faixaDoAlfa(corpo, r / 2, 'dentro')] : [faixaDoAlfa(corpo, r, k.posicao)];
  const [traco, ...resto] = faixas;
  const t = contexto(traco);
  for (const f of resto) {
    t.drawImage(f, 0, 0);
    soltar(f);
  }
  t.globalCompositeOperation = 'source-in';
  t.fillStyle = cor(t, k.cor);
  t.fillRect(0, 0, traco.width, traco.height);
  return traco;
};

// ---------- camada ----------

/** Folga em volta da caixa, no espaço da camada: o texto que passa dela e, numa imagem com contorno, a espessura por
 *  todos os lados (o contorno por dentro precisa de avesso em volta da foto para engordar). */
const folgaLocal = (forma: CamadaImagem) => {
  if (forma.tipo === 'texto') return folgaDoTexto(forma);
  const e = forma.tipo === 'imagem' ? (contornoDe(forma)?.espessura ?? 0) : 0;
  return {esq: e, dir: e, cima: e, baixo: e};
};

/** Região do canvas (px do canvas, inteiros) que o corpo e o contorno ocupam, presa ao canvas mais o alcance da sombra
 *  (uma camada logo fora pode jogar sombra para dentro). */
const regiaoDe = (ctx: CanvasRenderingContext2D, forma: CamadaImagem, m: DOMMatrix, escala: number) => {
  const s = sombraDe(forma);
  const r = caixaPintada({...forma, sombra: undefined}, folgaLocal(forma));
  const alcance = s ? (alcanceDaSombra(s.desfoque) + Math.max(Math.abs(s.x), Math.abs(s.y))) * escala : 0;
  const tela: Retangulo = {x: -alcance, y: -alcance, w: ctx.canvas.width + 2 * alcance, h: ctx.canvas.height + 2 * alcance};
  const dev = intersecao({x: r.x * escala + m.e, y: r.y * escala + m.f, w: r.w * escala, h: r.h * escala}, tela);
  if (!dev) return null;
  const x0 = Math.floor(dev.x);
  const y0 = Math.floor(dev.y);
  return {x0, y0, w: Math.max(1, Math.ceil(dev.x + dev.w) - x0), h: Math.max(1, Math.ceil(dev.y + dev.h) - y0)};
};

const pintarComAcabamento = (ctx: CanvasRenderingContext2D, item: ItemPintura, img: FonteImagem | undefined) => {
  const {c, mascara} = item;
  // numa imagem recortada, a máscara dá a silhueta, o contorno, a sombra e a opacidade do conjunto
  const forma = mascara?.c ?? c;
  if (forma.largura <= 0 || forma.altura <= 0) return;
  const m = ctx.getTransform();
  const escala = Math.hypot(m.a, m.b) || 1;
  const r = regiaoDe(ctx, forma, m, escala);
  if (!r) return;
  const t: Transformacao = {m, x0: r.x0, y0: r.y0};
  const {c: corpo, ctx: cc} = canvasIgual(r.w, r.h, t);
  if (mascara) {
    pintarCorpo(cc, c, img, alfa(c));
    cc.globalCompositeOperation = 'destination-in';
    cc.globalAlpha = 1;
    silhueta(cc, forma);
    cc.globalCompositeOperation = 'source-over';
  } else pintarCorpo(cc, c, img, 1);

  const k = contornoDe(forma);
  if (k) {
    const traco = forma.tipo === 'imagem' ? tracoDoAlfa(corpo, k, escala) : tracoDoCaminho(forma, k, r.w, r.h, t);
    cc.save();
    cc.setTransform(1, 0, 0, 1, 0, 0);
    cc.drawImage(traco, 0, 0);
    cc.restore();
    soltar(traco);
  }

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alfa(forma);
  const s = sombraDe(forma);
  if (s) {
    // a sombra do canvas não segue a transformação: vai em px do canvas
    ctx.shadowColor = cor(ctx, s.cor, s.opacidade);
    ctx.shadowBlur = s.desfoque * escala;
    ctx.shadowOffsetX = s.x * escala;
    ctx.shadowOffsetY = s.y * escala;
  }
  ctx.drawImage(corpo, r.x0, r.y0);
  ctx.restore();
  soltar(corpo);
};

/** Pinta um item (camada, ou imagem com a máscara) no lugar dele. O contexto está em px do documento vezes a escala. */
export const pintarItem = (ctx: CanvasRenderingContext2D, item: ItemPintura, img?: FonteImagem) => {
  const {c} = item;
  if (c.largura <= 0 || c.altura <= 0) return;
  if (item.mascara || temAcabamento(c)) return pintarComAcabamento(ctx, item, img);
  ctx.save();
  pintarCorpo(ctx, c, img, alfa(c));
  ctx.restore();
};

/** A caixa (no documento) que o canvas da prévia de um item precisa cobrir: a pintura inteira, com a sombra. */
export const caixaDoItem = (item: ItemPintura) => {
  const forma = item.mascara?.c ?? item.c;
  return caixaPintada(forma, folgaLocal(forma));
};
