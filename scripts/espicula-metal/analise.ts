// Análise espectral para julgar o som sem ouvido: espectro médio (Welch), bandas, centroide, aliasing de um seno,
// espectrograma em PNG, afinação por autocorrelação e correlação L/R.
// Aqui os transcendentais (log10, cos da janela) não importam: é medida, não render.

import {png} from './arquivos';
import {db} from './comum';
import {FFTReal} from './fft';

const hann = (n: number) => {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
};
const blackmanHarris = (n: number) => {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = (2 * Math.PI * i) / n;
    w[i] = 0.35875 - 0.48829 * Math.cos(x) + 0.14128 * Math.cos(2 * x) - 0.01168 * Math.cos(3 * x);
  }
  return w;
};

/** Potência média por bin (Welch, Hann, 50%). */
export const espectroMedio = (x: Float32Array, inicio = 0, fim = x.length, nfft = 8192) => {
  const fft = new FFTReal(nfft);
  const w = hann(nfft);
  const seg = new Float64Array(nfft);
  const re = new Float64Array(nfft / 2 + 1);
  const im = new Float64Array(nfft / 2 + 1);
  const p = new Float64Array(nfft / 2 + 1);
  let cont = 0;
  for (let o = inicio; o + nfft <= fim; o += nfft / 2) {
    for (let i = 0; i < nfft; i++) seg[i] = x[o + i] * w[i];
    fft.direta(seg, re, im);
    for (let k = 0; k < p.length; k++) p[k] += re[k] * re[k] + im[k] * im[k];
    cont++;
  }
  for (let k = 0; k < p.length; k++) p[k] /= Math.max(1, cont);
  return p;
};

export const BANDAS: [string, number, number][] = [
  ['sub (<60 Hz)', 20, 60],
  ['grave (60-250)', 60, 250],
  ['médio-grave (250-800)', 250, 800],
  ['médio (800-2,5k)', 800, 2500],
  ['presença (2,5k-5k)', 2500, 5000],
  ['agudo (5k-10k)', 5000, 10000],
  ['ar (>10k)', 10000, 24000],
];

export const bandas = (p: Float64Array, taxa: number) => {
  const nfft = (p.length - 1) * 2;
  const df = taxa / nfft;
  let total = 0;
  for (let k = 1; k < p.length; k++) total += p[k];
  return BANDAS.map(([nome, a, b]) => {
    let s = 0;
    for (let k = Math.ceil(a / df); k <= Math.min(p.length - 1, Math.floor(b / df)); k++) s += p[k];
    return {nome, db: 10 * Math.log10(Math.max(s / total, 1e-30))};
  });
};

export const centroide = (p: Float64Array, taxa: number) => {
  const df = taxa / ((p.length - 1) * 2);
  let s = 0;
  let sw = 0;
  for (let k = 1; k < p.length; k++) {
    s += p[k];
    sw += p[k] * k * df;
  }
  return sw / s;
};

/**
 * Relação sinal/aliasing de um seno de f0 passado por um processador: energia nos bins longe de qualquer harmônico
 * k*f0 < Nyquist, dividida pela energia total, entre 20 Hz e 20 kHz. Em dB (mais negativo = melhor).
 */
export const aliasingDb = (y: Float32Array, f0: number, taxa: number) => {
  const nfft = 65536;
  const ini = y.length - nfft;
  const fft = new FFTReal(nfft);
  const w = blackmanHarris(nfft);
  const seg = new Float64Array(nfft);
  for (let i = 0; i < nfft; i++) seg[i] = y[ini + i] * w[i];
  const re = new Float64Array(nfft / 2 + 1);
  const im = new Float64Array(nfft / 2 + 1);
  fft.direta(seg, re, im);
  const df = taxa / nfft;
  const harm = new Uint8Array(nfft / 2 + 1);
  for (let h = f0; h < taxa / 2; h += f0) {
    const k = Math.round(h / df);
    for (let d = -6; d <= 6; d++) if (k + d >= 0 && k + d < harm.length) harm[k + d] = 1;
  }
  let total = 0;
  let alias = 0;
  for (let k = Math.ceil(20 / df); k <= Math.floor(20000 / df); k++) {
    const pw = re[k] * re[k] + im[k] * im[k];
    total += pw;
    if (!harm[k]) alias += pw;
  }
  return 10 * Math.log10(Math.max(alias / total, 1e-30));
};

/** f0 por autocorrelação normalizada com interpolação parabólica. */
export const f0Autocorr = (x: Float32Array, inicio: number, n: number, taxa: number, fMin = 40, fMax = 1000) => {
  const lagMin = Math.floor(taxa / fMax);
  const lagMax = Math.ceil(taxa / fMin);
  const r = new Float64Array(lagMax + 2);
  for (let lag = lagMin - 1; lag <= lagMax + 1; lag++) {
    let s = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i < n; i++) {
      const a = x[inicio + i];
      const b = x[inicio + i + lag];
      s += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    r[lag] = s / Math.sqrt(e1 * e2 + 1e-30);
  }
  let melhor = lagMin;
  for (let lag = lagMin; lag <= lagMax; lag++) if (r[lag] > r[melhor]) melhor = lag;
  // o primeiro pico com pelo menos 90% do maior (evita oitava abaixo)
  for (let lag = lagMin; lag <= lagMax; lag++) {
    if (r[lag] > 0.9 * r[melhor] && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) {
      melhor = lag;
      break;
    }
  }
  const a = r[melhor - 1];
  const b = r[melhor];
  const c = r[melhor + 1];
  const d = (0.5 * (a - c)) / (a - 2 * b + c);
  return taxa / (melhor + (Number.isFinite(d) ? d : 0));
};

export const correlacao = (a: Float32Array, b: Float32Array) => {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return ab / Math.sqrt(aa * bb);
};

export const rmsPico = (x: Float32Array, ini = 0, fim = x.length) => {
  let s = 0;
  let p = 0;
  for (let i = ini; i < fim; i++) {
    s += x[i] * x[i];
    p = Math.max(p, Math.abs(x[i]));
  }
  return {rms: Math.sqrt(s / Math.max(1, fim - ini)), pico: p};
};

/** Espectrograma em escala log de frequência (40 Hz a 20 kHz), -70 a 0 dB do máximo, colormap tipo "inferno" simplificado. */
export const espectrogramaPng = (x: Float32Array, taxa: number, largura = 1200, altura = 360): Buffer => {
  const nfft = 2048;
  const fft = new FFTReal(nfft);
  const w = hann(nfft);
  const seg = new Float64Array(nfft);
  const re = new Float64Array(nfft / 2 + 1);
  const im = new Float64Array(nfft / 2 + 1);
  const rgb = new Uint8Array(largura * altura * 3);
  const passo = (x.length - nfft) / largura;
  const fMin = 40;
  const fMax = 20000;
  const cor = (v: number): [number, number, number] => {
    const t = Math.max(0, Math.min(1, v));
    const r = Math.min(1, 1.6 * t);
    const g = Math.max(0, Math.min(1, 2 * t - 0.6));
    const b = t < 0.4 ? 0.2 + t : Math.max(0, 1.4 - 2.5 * t + 0.6 * t * t);
    return [Math.round(r * 255), Math.round(g * 255), Math.round(Math.max(0, Math.min(1, b)) * 255)];
  };
  let maxDb = -1e9;
  const cols: Float64Array[] = [];
  for (let c = 0; c < largura; c++) {
    const o = Math.floor(c * passo);
    for (let i = 0; i < nfft; i++) seg[i] = x[o + i] * w[i];
    fft.direta(seg, re, im);
    const col = new Float64Array(altura);
    for (let y = 0; y < altura; y++) {
      const f = fMin * Math.pow(fMax / fMin, 1 - y / (altura - 1));
      const k = Math.min(nfft / 2, Math.round((f * nfft) / taxa));
      const v = db(Math.sqrt(re[k] * re[k] + im[k] * im[k]) + 1e-12);
      col[y] = v;
      maxDb = Math.max(maxDb, v);
    }
    cols.push(col);
  }
  for (let c = 0; c < largura; c++) {
    for (let y = 0; y < altura; y++) {
      const [r, g, b] = cor((cols[c][y] - maxDb + 70) / 70);
      const i = (y * largura + c) * 3;
      rgb[i] = r;
      rgb[i + 1] = g;
      rgb[i + 2] = b;
    }
  }
  return png(largura, altura, rgb);
};
