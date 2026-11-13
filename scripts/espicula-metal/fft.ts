// FFT radix-2 iterativa (complexa) e FFT real de tamanho N pela complexa de N/2.
//
// Transcendentais: cos e sin só no construtor (tabelas de giro), pela `mat.ts`. Com Math.cos/Math.sin as tabelas
// mudavam no último bit entre o V8 e o JavaScriptCore e o hash do PCM do gabinete mudava junto (medido).

import * as M from './mat';

export class FFTComplexa {
  readonly n: number;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly rev: Uint32Array;

  constructor(n: number) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT: ${n} não é potência de 2`);
    this.n = n;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      this.cos[k] = M.cos((2 * Math.PI * k) / n);
      this.sin[k] = M.sin((2 * Math.PI * k) / n);
    }
    this.rev = new Uint32Array(n);
    let bits = 0;
    while (1 << bits < n) bits++;
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >>> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  /** No lugar. Direta: expoente -i; inversa: +i, SEM dividir por n. */
  transformar(re: Float64Array, im: Float64Array, inversa = false): void {
    const n = this.n;
    const rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    const sinal = inversa ? 1 : -1;
    for (let tam = 2; tam <= n; tam <<= 1) {
      const meio = tam >>> 1;
      const passo = n / tam;
      for (let i = 0; i < n; i += tam) {
        for (let j = 0, k = 0; j < meio; j++, k += passo) {
          const wr = this.cos[k];
          const wi = sinal * this.sin[k];
          const a = i + j;
          const b = a + meio;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }
}

/** FFT de sinal real de tamanho n, com n/2+1 bins de saída. */
export class FFTReal {
  readonly n: number;
  private readonly m: number;
  private readonly c: FFTComplexa;
  private readonly zr: Float64Array;
  private readonly zi: Float64Array;
  private readonly wr: Float64Array;
  private readonly wi: Float64Array;

  constructor(n: number) {
    this.n = n;
    this.m = n / 2;
    this.c = new FFTComplexa(this.m);
    this.zr = new Float64Array(this.m);
    this.zi = new Float64Array(this.m);
    this.wr = new Float64Array(this.m + 1);
    this.wi = new Float64Array(this.m + 1);
    for (let k = 0; k <= this.m; k++) {
      this.wr[k] = M.cos((2 * Math.PI * k) / n);
      this.wi[k] = -M.sin((2 * Math.PI * k) / n);
    }
  }

  /** x (n reais) -> re, im (n/2+1). */
  direta(x: ArrayLike<number>, re: Float64Array, im: Float64Array): void {
    const m = this.m;
    const zr = this.zr;
    const zi = this.zi;
    for (let i = 0; i < m; i++) {
      zr[i] = x[2 * i];
      zi[i] = x[2 * i + 1];
    }
    this.c.transformar(zr, zi);
    for (let k = 0; k <= m; k++) {
      const a = k % m;
      const b = (m - k) % m;
      // E = (Z[k] + conj Z[m-k]) / 2 ; O = (Z[k] - conj Z[m-k]) / (2i)
      const er = (zr[a] + zr[b]) / 2;
      const ei = (zi[a] - zi[b]) / 2;
      const or = (zi[a] + zi[b]) / 2;
      const oi = -(zr[a] - zr[b]) / 2;
      const wr = this.wr[k];
      const wi = this.wi[k];
      re[k] = er + wr * or - wi * oi;
      im[k] = ei + wr * oi + wi * or;
    }
  }

  /** re, im (n/2+1) -> x (n reais), já dividido por n. */
  inversa(re: Float64Array, im: Float64Array, x: Float64Array | Float32Array): void {
    const m = this.m;
    const zr = this.zr;
    const zi = this.zi;
    for (let k = 0; k < m; k++) {
      const b = m - k;
      // E = (X[k] + conj X[m-k]) / 2 ; O = (X[k] - conj X[m-k]) * conj(W^k) / 2 ; Z = E + i O
      const er = (re[k] + re[b]) / 2;
      const ei = (im[k] - im[b]) / 2;
      const dr = (re[k] - re[b]) / 2;
      const di = (im[k] + im[b]) / 2;
      const wr = this.wr[k];
      const wi = -this.wi[k];
      const or = dr * wr - di * wi;
      const oi = dr * wi + di * wr;
      zr[k] = er - oi;
      zi[k] = ei + or;
    }
    this.c.transformar(zr, zi, true);
    const esc = 1 / m;
    for (let i = 0; i < m; i++) {
      x[2 * i] = zr[i] * esc;
      x[2 * i + 1] = zi[i] * esc;
    }
  }
}
