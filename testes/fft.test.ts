// FFT e STFT puras: impulso, seno, Parseval, ida e volta (complexa, real e STFT) e os erros de tamanho.
import {describe, expect, it} from 'vitest';
import {criarFft, criarFftReal, istft, janelaHann, stft} from '../src/nucleo/fft';

const perto = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('FFT complexa', () => {
  it('impulso na origem: espectro plano de módulo 1', () => {
    const n = 64;
    const re = new Float64Array(n), im = new Float64Array(n);
    re[0] = 1;
    criarFft(n)(re, im, false);
    for (let k = 0; k < n; k++) (perto(re[k], 1), perto(im[k], 0));
  });
  it('impulso atrasado: fase linear, módulo 1', () => {
    const n = 32, d = 3;
    const re = new Float64Array(n), im = new Float64Array(n);
    re[d] = 1;
    criarFft(n)(re, im, false);
    for (let k = 0; k < n; k++) {
      perto(Math.hypot(re[k], im[k]), 1);
      perto(re[k], Math.cos((-2 * Math.PI * k * d) / n));
      perto(im[k], Math.sin((-2 * Math.PI * k * d) / n));
    }
  });
  it('seno na faixa 5: só as faixas 5 e n-5 têm energia (n/2 cada)', () => {
    const n = 128, f = 5;
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * f * i) / n);
    criarFft(n)(re, im, false);
    for (let k = 0; k < n; k++) {
      const m = Math.hypot(re[k], im[k]);
      perto(m, k === f || k === n - f ? n / 2 : 0, 1e-8);
    }
    perto(im[f], -n / 2, 1e-8); // sen = (e^{i} - e^{-i}) / 2i
  });
  it('Parseval: soma |x|² = soma |X|² / n', () => {
    const n = 256;
    const re = new Float64Array(n), im = new Float64Array(n);
    let s = 7;
    for (let i = 0; i < n; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      re[i] = s / 2 ** 32 - 0.5;
      im[i] = Math.sin(i) * 0.3;
    }
    const e0 = re.reduce((a, v, i) => a + v * v + im[i] * im[i], 0);
    criarFft(n)(re, im, false);
    const e1 = re.reduce((a, v, i) => a + v * v + im[i] * im[i], 0) / n;
    perto(e0, e1, 1e-9);
  });
  it('ida e volta devolve o original', () => {
    const n = 512;
    const x = Float64Array.from({length: n}, (_, i) => Math.sin(i * 0.37) + (i % 7) * 0.1);
    const re = x.slice(), im = new Float64Array(n);
    const f = criarFft(n);
    f(re, im, false);
    f(re, im, true);
    for (let i = 0; i < n; i++) (perto(re[i], x[i]), perto(im[i], 0));
  });
  it('recusa tamanho que não é potência de 2', () => {
    expect(() => criarFft(100)).toThrow(/potência de 2/);
    expect(() => criarFft(0)).toThrow();
  });
});

describe('FFT real', () => {
  it('bate com a complexa e volta ao original', () => {
    const n = 64;
    const x = Float64Array.from({length: n}, (_, i) => Math.cos(i * 0.9) + 0.2 * i / n);
    const e = criarFftReal(n).direta(x);
    const re = x.slice(), im = new Float64Array(n);
    criarFft(n)(re, im, false);
    expect(e.re.length).toBe(n / 2 + 1);
    for (let k = 0; k <= n / 2; k++) (perto(e.re[k], re[k]), perto(e.im[k], im[k]));
    const y = criarFftReal(n).inversa(e.re, e.im);
    for (let i = 0; i < n; i++) perto(y[i], x[i]);
  });
});

describe('janela de Hann', () => {
  it('periódica: zero no início, 1 no meio; a raiz ao quadrado dá a Hann', () => {
    const n = 16;
    const h = janelaHann(n), r = janelaHann(n, true);
    perto(h[0], 0);
    perto(h[n / 2], 1);
    for (let i = 0; i < n; i++) perto(r[i] * r[i], h[i]);
  });
  it('com 75 % de sobreposição soma constante 2', () => {
    const n = 64, hop = 16, h = janelaHann(n);
    for (let i = 0; i < hop; i++) perto(h[i] + h[i + hop] + h[i + 2 * hop] + h[i + 3 * hop], 2);
  });
});

describe('STFT', () => {
  const sinal = (len: number) => Float32Array.from({length: len}, (_, i) => Math.sin(i * 0.05) * 0.6 + Math.sin(i * 0.9) * 0.2);
  it('ida e volta reconstrói o sinal (hop n/4 e n/2, tamanho não múltiplo)', () => {
    for (const [n, hop, len] of [[256, 64, 1000], [256, 128, 777], [512, 128, 5000]] as const) {
      const x = sinal(len);
      const y = istft(stft(x, n, hop));
      expect(y.length).toBe(len);
      let maior = 0;
      for (let i = 0; i < len; i++) maior = Math.max(maior, Math.abs(y[i] - x[i]));
      expect(maior).toBeLessThan(1e-5);
    }
  });
  it('janela raiz de Hann na análise e na síntese também reconstrói', () => {
    const x = sinal(900), j = janelaHann(256, true);
    const y = istft(stft(x, 256, 64, j), j);
    for (let i = 0; i < x.length; i++) perto(y[i], x[i], 1e-5);
  });
  it('seno puro concentra a energia na faixa certa', () => {
    const n = 512, f = 40;
    const x = Float32Array.from({length: 4096}, (_, i) => Math.sin((2 * Math.PI * f * i) / n));
    const s = stft(x, n, 128);
    const q = Math.floor(s.re.length / 2);
    const mag = s.re[q].map((v, k) => Math.hypot(v, s.im[q][k]));
    expect(mag.indexOf(Math.max(...mag))).toBe(f);
    expect(mag[f]).toBeGreaterThan(20 * mag[f + 6]);
  });
  it('sinal vazio e tamanhos inválidos', () => {
    expect(istft(stft(new Float32Array(0), 256, 64)).length).toBe(0);
    expect(() => stft(new Float32Array(10), 100, 25)).toThrow();
    expect(() => stft(new Float32Array(10), 256, 0)).toThrow();
  });
});
