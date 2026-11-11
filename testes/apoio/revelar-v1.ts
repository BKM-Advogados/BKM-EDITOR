// Cópia congelada do animacao-pixel.ts de antes do R4 (revelar com as fórmulas nos laços): referência da equivalência
// em animacao-pixel-rgba.test.ts. Ao mudar as fórmulas de propósito (C4), este arquivo sai.
// Arte em pixel (docs/animacao.md): a grade de células coloridas das camadas "pixel", no estilo dos protetores de tela.
// Tudo TypeScript puro (sem DOM, sem Remotion, sem programa externo): a conversão de uma imagem em grade (redução por
// média + quantização de cores), a codificação compacta das células, os efeitos de revelação determinísticos por semente
// e a conta de cor. A composição desenha o que este arquivo devolve; a interface edita a grade à mão (lápis, borracha,
// conta-gotas, balde).
export type GradePixel = {
  colunas: number;
  linhas: number;
  paleta: string[]; // cores "#rrggbb"
  celulas: string; // um caractere por célula, linha por linha: "." = vazio, ou o índice da paleta (base 62)
};

export type EfeitoPixel = 'aleatorio' | 'decodificar' | 'varredura' | 'varredura-baixo' | 'meio' | 'chuva';

export const EFEITOS_PIXEL: {id: EfeitoPixel; nome: string}[] = [
  {id: 'aleatorio', nome: 'Aleatório'},
  {id: 'decodificar', nome: 'Decodificar'},
  {id: 'varredura', nome: 'Varredura'},
  {id: 'varredura-baixo', nome: 'Varredura para baixo'},
  {id: 'meio', nome: 'Do meio para fora'},
  {id: 'chuva', nome: 'Chuva (matrix)'},
];

// ---------- codificação das células ----------
export const CHARSET_CELULAS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const VAZIO = '.';
export const MAX_CORES = CHARSET_CELULAS.length; // 62

/** Índices de paleta (ou -1 para vazio) → string compacta (um caractere por célula). */
export const codificarCelulas = (indices: number[]): string =>
  indices.map((i) => (i < 0 || i >= CHARSET_CELULAS.length ? VAZIO : CHARSET_CELULAS[i])).join('');

/** String compacta → índices de paleta (ou -1 para vazio). */
export const decodificarCelulas = (celulas: string): number[] => {
  const out: number[] = new Array(celulas.length);
  for (let i = 0; i < celulas.length; i++) {
    const c = celulas[i];
    if (c === VAZIO) out[i] = -1;
    else {
      const idx = CHARSET_CELULAS.indexOf(c);
      out[i] = idx < 0 ? 0 : idx;
    }
  }
  return out;
};

/** Cor de uma célula (ou null se vazia), já com o índice fora da paleta protegido. */
export const corDaCelula = (grade: GradePixel, indice: number): string | null =>
  indice < 0 ? null : (grade.paleta[indice] ?? grade.paleta[0] ?? '#000000');

// ---------- determinismo (mesma semente, mesma saída) ----------
/** Gerador pseudo-aleatório determinístico (mulberry32). */
export const mulberry32 = (semente: number) => {
  let a = (semente >>> 0) || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Permutação de 0..n-1 determinística pela semente (Fisher–Yates). */
export const ordemAleatoria = (n: number, semente: number): number[] => {
  const rnd = mulberry32(semente);
  const a = Array.from({length: n}, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ---------- revelação ----------
/**
 * A cor a desenhar de cada célula no instante `progresso` (0 a 1), determinística pela `semente`. `null` = célula ainda
 * não revelada (transparente). Em 0 nada aparece; em 1 a grade inteira, com as cores finais. Os efeitos:
 * - aleatorio: as células aparecem numa ordem embaralhada;
 * - decodificar: cada célula entra com uma cor trocada e "assenta" na cor final;
 * - varredura / varredura-baixo: uma frente anda da esquerda para a direita / de cima para baixo;
 * - meio: a revelação cresce do centro para fora;
 * - chuva: colunas caem como a chuva do Matrix, com a ponta clara.
 */
export const revelar = (grade: GradePixel, efeito: EfeitoPixel | undefined, semente: number, progresso: number): (string | null)[] => {
  const colunas = Math.max(1, grade.colunas);
  const linhas = Math.max(1, grade.linhas);
  const indices = decodificarCelulas(grade.celulas);
  const n = indices.length;
  const finais = indices.map((i) => corDaCelula(grade, i));
  const p = clamp01(progresso);
  if (p <= 0) return finais.map(() => null);
  if (p >= 1) return finais;
  const rnd = mulberry32(semente * 2654435761 + 7);
  const ordem = ordemAleatoria(Math.max(0, n), semente);

  const out: (string | null)[] = new Array(n).fill(null);
  const celula = (c: number, l: number) => l * colunas + c;

  switch (efeito) {
    case 'aleatorio':
      for (let i = 0; i < n; i++) if (ordem[i] / n <= p) out[i] = finais[i];
      return out;

    case 'decodificar': {
      for (let i = 0; i < n; i++) {
        if (finais[i] === null) continue;
        const limiar = ordem[i] / n;
        if (p <= limiar) continue;
        const corTrocada = grade.paleta[Math.floor(rnd() * grade.paleta.length)] ?? finais[i];
        // assim que entra, a célula ainda está com a cor trocada; assenta rápido na final
        const local = clamp01((p - limiar) / Math.max(0.05, 0.25));
        out[i] = local >= 1 ? finais[i] : misturarCor(corTrocada, finais[i]!, local);
      }
      return out;
    }

    case 'varredura':
      for (let l = 0; l < linhas; l++) for (let c = 0; c < colunas; c++) {
        if (c / colunas <= p) out[celula(c, l)] = finais[celula(c, l)];
      }
      return out;

    case 'varredura-baixo':
      for (let l = 0; l < linhas; l++) for (let c = 0; c < colunas; c++) {
        if (l / linhas <= p) out[celula(c, l)] = finais[celula(c, l)];
      }
      return out;

    case 'meio': {
      const cx = (colunas - 1) / 2;
      const cy = (linhas - 1) / 2;
      const maxD = Math.hypot(cx, cy);
      for (let l = 0; l < linhas; l++) for (let c = 0; c < colunas; c++) {
        if (Math.hypot(c - cx, l - cy) / maxD <= p) out[celula(c, l)] = finais[celula(c, l)];
      }
      return out;
    }

    case 'chuva': {
      // cada coluna tem a sua defasagem; a ponta desce e a coluna atrás dela fica preenchida
      for (let c = 0; c < colunas; c++) {
        const atraso = Math.floor(rnd() * linhas);
        const ponta = p * (linhas + atraso) - atraso;
        for (let l = 0; l < linhas; l++) {
          const i = celula(c, l);
          if (l <= ponta) out[i] = finais[i];
          // a ponta brilha (mais clara) na frente da chuva
          if (l === Math.floor(ponta) && l >= 0 && l < linhas && finais[i]) out[i] = misturarCor(finais[i]!, '#FFFFFF', 0.6);
        }
      }
      return out;
    }

    default:
      return finais;
  }
};

/** Mistura duas cores (hex) na proporção `u` (0 = a, 1 = b), em RGB. */
export const misturarCor = (a: string, b: string, u: number): string => {
  const h = (c: string) => parseInt(c.replace(/^#/, ''), 16);
  const va = h(a);
  const vb = h(b);
  const p = clamp01(u);
  const canal = (shift: number) => Math.round(((va >> shift) & 255) * (1 - p) + ((vb >> shift) & 255) * p);
  const r = canal(16);
  const g = canal(8);
  const bl = canal(0);
  return `#${[r, g, bl].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
};

// ---------- conversão de imagem → grade ----------
export type DadosImagem = {largura: number; altura: number; dados: Uint8ClampedArray}; // RGBA

/** Pixel médio de uma área (com o peso do alfa): ignora o que é transparente. */
const mediaArea = (img: DadosImagem, x0: number, y0: number, x1: number, y1: number): {r: number; g: number; b: number; a: number} => {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * img.largura + x) * 4;
    const alfa = img.dados[i + 3] / 255;
    if (alfa <= 0) continue;
    r += img.dados[i] * alfa;
    g += img.dados[i + 1] * alfa;
    b += img.dados[i + 2] * alfa;
    a += alfa;
    n++;
  }
  if (n === 0) return {r: 0, g: 0, b: 0, a: 0};
  return {r: r / a, g: g / a, b: b / a, a: a / n};
};

const hexDe = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/** Distância euclidiana entre duas cores RGB (o suficiente para achar a mais próxima). */
const distanciaRgb = (a: [number, number, number], b: [number, number, number]) => {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
};

/** Quantização por median-cut determinística: a imagem em nCores (≤ 62). Devolve paleta e índice por pixel. */
export const quantizar = (pixels: {r: number; g: number; b: number; a: number}[], nCores: number, paletaAlvo?: string[]): {paleta: string[]; indices: number[]} => {
  const alvo = paletaAlvo?.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, MAX_CORES).map((c) => c.toUpperCase());
  if (alvo && alvo.length) {
    const rgb = alvo.map((c) => {
      const v = parseInt(c.slice(1), 16);
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255] as [number, number, number];
    });
    const indices = pixels.map((p) => {
      if (p.a < 0.5) return -1;
      let melhor = 0;
      let d = Infinity;
      rgb.forEach((c, i) => {
        const dd = distanciaRgb([p.r, p.g, p.b], c);
        if (dd < d) {
          d = dd;
          melhor = i;
        }
      });
      return melhor;
    });
    return {paleta: alvo, indices};
  }

  const opacos = pixels.map((p, i) => ({...p, i})).filter((p) => p.a >= 0.5);
  const k = Math.max(1, Math.min(MAX_CORES, Math.floor(nCores)));
  const caixas: {px: typeof opacos; min: number[]; max: number[]}[] = opacos.length ? [{
    px: opacos,
    min: [0, 0, 0],
    max: [255, 255, 255],
  }] : [];
  // median-cut: divide a caixa com mais alcance pelo canal de maior variação, na mediana
  while (caixas.length < k) {
    let alvoI = -1;
    let alcance = -1;
    caixas.forEach((c, i) => {
      const spread = (c.max[0] - c.min[0]) + (c.max[1] - c.min[1]) + (c.max[2] - c.min[2]);
      if (spread > alcance && c.px.length > 1) {
        alcance = spread;
        alvoI = i;
      }
    });
    if (alvoI < 0) break;
    const cx = caixas[alvoI];
    const canais = [0, 1, 2].map((ch) => ({
      ch,
      span: cx.max[ch] - cx.min[ch],
      variancia: (() => {
        const m = cx.px.reduce((s, p) => s + (ch === 0 ? p.r : ch === 1 ? p.g : p.b), 0) / cx.px.length;
        return cx.px.reduce((s, p) => s + ((ch === 0 ? p.r : ch === 1 ? p.g : p.b) - m) ** 2, 0);
      })(),
    }));
    const ch = canais.sort((a, b) => b.variancia - a.variancia)[0].ch;
    const ordenado = [...cx.px].sort((a, b) => (ch === 0 ? a.r - b.r : ch === 1 ? a.g - b.g : a.b - b.b));
    const meio = Math.floor(ordenado.length / 2);
    const a = ordenado.slice(0, meio);
    const b = ordenado.slice(meio);
    const minMax = (px: typeof opacos) => [0, 1, 2].map((cc) => [
      Math.min(...px.map((p) => (cc === 0 ? p.r : cc === 1 ? p.g : p.b))),
      Math.max(...px.map((p) => (cc === 0 ? p.r : cc === 1 ? p.g : p.b))),
    ]);
    caixas[alvoI] = {px: a, min: minMax(a).map((m) => m[0]), max: minMax(a).map((m) => m[1])};
    caixas.push({px: b, min: minMax(b).map((m) => m[0]), max: minMax(b).map((m) => m[1])});
  }
  const paleta = caixas.map((c) => {
    const n = c.px.length || 1;
    return hexDe(c.px.reduce((s, p) => s + p.r, 0) / n, c.px.reduce((s, p) => s + p.g, 0) / n, c.px.reduce((s, p) => s + p.b, 0) / n);
  });
  const rgb = paleta.map((c) => {
    const v = parseInt(c.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255] as [number, number, number];
  });
  const indices = pixels.map((p) => {
    if (p.a < 0.5) return -1;
    let melhor = 0;
    let d = Infinity;
    rgb.forEach((c, i) => {
      const dd = distanciaRgb([p.r, p.g, p.b], c);
      if (dd < d) {
        d = dd;
        melhor = i;
      }
    });
    return melhor;
  });
  return {paleta, indices};
};

/**
 * Imagem (RGBA) → grade de células. Reduz para `colunas × linhas` por média de área e quantiza para `cores` (ou para a
 * `paleta` dada, ex. o kit de marca). Célula quase toda transparente vira vazio (".").
 */
export const gradeDeImagem = (img: DadosImagem, o: {colunas: number; linhas: number; cores?: number; paleta?: string[]}): GradePixel => {
  const colunas = Math.max(1, Math.round(o.colunas));
  const linhas = Math.max(1, Math.round(o.linhas));
  const pixels: {r: number; g: number; b: number; a: number}[] = new Array(colunas * linhas);
  for (let l = 0; l < linhas; l++) {
    const y0 = Math.floor((l * img.altura) / linhas);
    const y1 = Math.max(y0 + 1, Math.floor(((l + 1) * img.altura) / linhas));
    for (let c = 0; c < colunas; c++) {
      const x0 = Math.floor((c * img.largura) / colunas);
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * img.largura) / colunas));
      pixels[l * colunas + c] = mediaArea(img, x0, y0, x1, y1);
    }
  }
  const {paleta, indices} = quantizar(pixels, o.cores ?? 8, o.paleta);
  return {colunas, linhas, paleta, celulas: codificarCelulas(indices)};
};

/** Grade vazia (tudo transparente), para começar a desenhar à mão. */
export const gradeVazia = (colunas: number, linhas: number, paleta: string[] = ['#000000', '#FFFFFF']): GradePixel => ({
  colunas,
  linhas,
  paleta,
  celulas: codificarCelulas(new Array(colunas * linhas).fill(-1)),
});
