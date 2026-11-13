// FFT e STFT puras (sem disco, sem dependências): a base espectral comum da Música (limpeza de voz hoje; EQ, analisador e
// afinação nas próximas ondas). FFT complexa de raiz 2 no lugar, FFT de sinal real, janela de Hann e STFT/iSTFT com
// soma das sobreposições (overlap-add). Tudo em Float64; a aritmética da FFT é a mesma que a limpeza de voz já usava,
// então quem passou a usar este módulo gera exatamente o mesmo PCM.

export type TransformadaFft = (re: Float64Array, im: Float64Array, inversa: boolean) => void;

export const ehPotenciaDe2 = (n: number) => Number.isInteger(n) && n >= 1 && (n & (n - 1)) === 0;

/** FFT complexa de raiz 2, no lugar, de tamanho `n` (potência de 2). A direta usa e^(-i·2πk/n) sem escala; a inversa usa
 *  e^(+i…) e divide por `n` (ida e volta devolve o original). Tabelas de bit-reverso e de senos são calculadas uma vez. */
export const criarFft = (n: number): TransformadaFft => {
  if (!ehPotenciaDe2(n)) throw new Error(`FFT: o tamanho ${n} não é potência de 2`);
  const bits = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / n);
    sin[k] = Math.sin((2 * Math.PI * k) / n);
  }
  return (re, im, inversa) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    const sinal = inversa ? 1 : -1;
    for (let tam = 2; tam <= n; tam <<= 1) {
      const meio = tam >> 1;
      const passo = n / tam;
      for (let i = 0; i < n; i += tam) {
        for (let j = 0, k = 0; j < meio; j++, k += passo) {
          const wr = cos[k], wi = sinal * sin[k];
          const a = i + j, b = a + meio;
          const tr = wr * re[b] - wi * im[b];
          const ti = wr * im[b] + wi * re[b];
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
    if (inversa) for (let i = 0; i < n; i++) (re[i] /= n), (im[i] /= n);
  };
};

/** Janela de Hann periódica (a que soma constante com sobreposição de 50 %, 75 %…). Com `raiz`, a raiz quadrada dela: usada
 *  na análise e na síntese juntas, o produto volta a ser a Hann. */
export const janelaHann = (n: number, raiz = false): Float64Array => {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    w[i] = raiz ? Math.sqrt(h) : h;
  }
  return w;
};

export type FftReal = {
  n: number;
  /** Espectro de `n/2 + 1` faixas (0 a Nyquist) de um sinal real de `n` amostras. */
  direta: (x: ArrayLike<number>) => {re: Float64Array; im: Float64Array};
  /** Sinal real de `n` amostras a partir das `n/2 + 1` faixas (a metade negativa é o conjugado). */
  inversa: (re: ArrayLike<number>, im: ArrayLike<number>) => Float64Array;
};

/** FFT de sinal real sobre a complexa (parte imaginária zero). Devolve só as faixas de 0 a Nyquist. */
export const criarFftReal = (n: number): FftReal => {
  const fft = criarFft(n);
  const bins = n / 2 + 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  return {
    n,
    direta: (x) => {
      for (let i = 0; i < n; i++) {
        re[i] = x[i] ?? 0;
        im[i] = 0;
      }
      fft(re, im, false);
      return {re: re.slice(0, bins), im: im.slice(0, bins)};
    },
    inversa: (xr, xi) => {
      for (let k = 0; k < bins; k++) {
        re[k] = xr[k];
        im[k] = xi[k];
      }
      for (let k = 1; k < n / 2; k++) {
        re[n - k] = xr[k];
        im[n - k] = -xi[k];
      }
      im[0] = 0;
      im[n / 2] = 0;
      fft(re, im, true);
      return re.slice();
    },
  };
};

export type Stft = {
  n: number;
  hop: number;
  bins: number;
  /** Comprimento do sinal original, para a iSTFT devolver o mesmo tamanho. */
  total: number;
  /** O quadro q começa na amostra `q * hop - (n - hop)` (os primeiros caem antes do zero, o resto é zero). */
  re: Float64Array[];
  im: Float64Array[];
};

export const inicioDoQuadro = (q: number, n: number, hop: number) => q * hop - (n - hop);

const validar = (n: number, hop: number) => {
  if (!ehPotenciaDe2(n)) throw new Error(`STFT: o tamanho ${n} não é potência de 2`);
  if (!Number.isInteger(hop) || hop < 1 || hop > n) throw new Error(`STFT: hop ${hop} fora de 1..${n}`);
};

/** STFT: janela em cada quadro de `n` amostras a cada `hop`, FFT real de cada um. Cobre o sinal inteiro, com `n/hop`
 *  quadros em cada amostra. `janela` padrão: Hann periódica. */
export const stft = (x: ArrayLike<number>, n: number, hop: number, janela: Float64Array = janelaHann(n)): Stft => {
  validar(n, hop);
  const total = x.length;
  const quadros = Math.ceil(total / hop) + Math.ceil(n / hop) - 1;
  const fr = criarFftReal(n);
  const buf = new Float64Array(n);
  const out: Stft = {n, hop, bins: n / 2 + 1, total, re: [], im: []};
  for (let q = 0; q < quadros; q++) {
    const s0 = inicioDoQuadro(q, n, hop);
    for (let i = 0; i < n; i++) {
      const s = s0 + i;
      buf[i] = (s >= 0 && s < total ? x[s] : 0) * janela[i];
    }
    const e = fr.direta(buf);
    out.re.push(e.re);
    out.im.push(e.im);
  }
  return out;
};

/** iSTFT por soma das sobreposições: cada quadro volta pela FFT inversa, recebe a janela de síntese e é somado; o
 *  resultado é dividido pela soma dos quadrados das janelas em cada amostra (reconstrução perfeita quando o espectro
 *  não foi alterado, e a normalização certa mesmo com janelas que não somam constante). */
export const istft = (s: Stft, janela: Float64Array = janelaHann(s.n)): Float32Array => {
  validar(s.n, s.hop);
  const {n, hop, total} = s;
  const fr = criarFftReal(n);
  const acc = new Float64Array(total);
  const peso = new Float64Array(total);
  for (let q = 0; q < s.re.length; q++) {
    const quadro = fr.inversa(s.re[q], s.im[q]);
    const s0 = inicioDoQuadro(q, n, hop);
    for (let i = 0; i < n; i++) {
      const t = s0 + i;
      if (t < 0 || t >= total) continue;
      acc[t] += quadro[i] * janela[i];
      peso[t] += janela[i] * janela[i];
    }
  }
  const out = new Float32Array(total);
  for (let i = 0; i < total; i++) out[i] = peso[i] > 1e-12 ? acc[i] / peso[i] : 0;
  return out;
};
