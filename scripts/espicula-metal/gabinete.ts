// IR de gabinete 4x12 sintetizado (nenhum IR de terceiros) e convolução particionada uniforme por FFT.
//
// O IR é a resposta ao impulso de:
//   1. uma cascata de biquads que desenha a curva típica de um 4x12 fechado com falantes de 12" de médio forte
//      (ressonância do gabinete ~105 Hz e queda abaixo de 70 Hz, vale em 400 Hz, presença em 2-4 kHz, queda íngreme
//      acima de 5 kHz, um entalhe de cone em ~6,8 kHz), com picos e vales de "quebra de cone" pequenos tirados da semente;
//   2. modos da caixa (senoides amortecidas em 105-260 Hz, recorrência de 2ª ordem, sem sin por amostra);
//   3. um eco curto da parede do fundo e uma cauda difusa fraca (180 Hz-3 kHz) (ruído filtrado com decaimento), até 200 ms.
// "Microfone" diferente por semente: cada lado da dobra usa uma variação (posição no cone), como em mixes reais.
//
// Transcendentais: cos, sin, exp e pow (da `mat.ts`) no setup dos biquads e dos modos; a convolução usa FFT com tabelas.

import {Biquad, biquad, BLOCO, coefPolo, Rng, TAXA} from './comum';
import {FFTReal} from './fft';
import * as M from './mat';

export const DURACAO_IR = 0.2;

export const sintetizarIR = (semente: number, duracao = DURACAO_IR): Float32Array => {
  const n = Math.round(duracao * TAXA);
  const rng = new Rng(semente);
  const fora = rng.u(); // 0 = no centro do cone (mais brilho), 1 = na borda (mais escuro)
  const coefs = [
    biquad.passaAlta(68, 0.9),
    biquad.passaAlta(55, 0.6),
    biquad.pico(105, 1.6, 5),
    biquad.pico(420, 0.9, -3.5),
    biquad.pico(1400, 1.2, 1.5),
    biquad.pico(2300 + 300 * rng.b(), 1.8, 5.5 - 2 * fora),
    biquad.pico(3700 + 400 * rng.b(), 2.4, 4 - 2 * fora),
    biquad.passaBaixa(5200 - 900 * fora, 0.75),
    biquad.passaBaixa(5600 - 900 * fora, 0.6),
    biquad.passaBaixa(7500, 0.55),
    biquad.rejeita(6800 + 300 * rng.b(), 3),
  ];
  // Quebra de cone: 5 picos/vales estreitos de ±2,5 dB entre 900 Hz e 4,5 kHz.
  for (let i = 0; i < 5; i++) {
    const f = 900 * M.pow(5, rng.u());
    coefs.push(biquad.pico(f, 4 + 4 * rng.u(), 2.5 * rng.b()));
  }
  const filtros = coefs.map((c) => new Biquad(c));
  const ir = new Float64Array(n);
  // 1) resposta ao impulso da cascata
  for (let i = 0; i < n; i++) {
    let x = i === 0 ? 1 : 0;
    for (const f of filtros) x = f.passo(x);
    ir[i] = x;
  }
  // 2) modos da caixa: y[n] = 2 r cos(w) y[n-1] - r^2 y[n-2] (oscilador amortecido). `g` é o ganho no pico em
  // relação à cascata (~1 na banda): a amplitude do impulso sai de g * 2 (1 - r) sin(w), senão o modo domina tudo.
  const modos = [
    {f: 105, t60: 0.09, g: 0.5},
    {f: 162, t60: 0.06, g: 0.3},
    {f: 214, t60: 0.05, g: 0.2},
    {f: 258, t60: 0.04, g: 0.15},
  ];
  for (const m of modos) {
    const r = M.pow(0.001, 1 / (m.t60 * TAXA));
    const w = (2 * Math.PI * m.f) / TAXA;
    const c = 2 * r * M.cos(w);
    const amp = m.g * 2 * (1 - r) * M.sin(w);
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < n; i++) {
      const y = (i === 0 ? amp : 0) + c * y1 - r * r * y2;
      y2 = y1;
      y1 = y;
      ir[i] += y;
    }
  }
  // 3) eco da parede do fundo (~0,9 ms) e cauda difusa
  const eco = Math.round(0.0009 * TAXA);
  for (let i = n - 1; i >= eco; i--) ir[i] -= 0.18 * ir[i - eco];
  const lp = new Biquad(biquad.passaBaixa(3000, 0.7));
  const hp = new Biquad(biquad.passaAlta(180, 0.7));
  const decai = coefPolo(1 / 0.035, TAXA); // envelope com constante de tempo de 35 ms
  let env = 1;
  for (let i = Math.round(0.002 * TAXA); i < n; i++) {
    env *= decai;
    ir[i] += hp.passo(lp.passo(rng.b())) * env * 0.002;
  }
  // janela de saída (meia Hann nos últimos 20 ms) e energia unitária
  const fade = Math.round(0.02 * TAXA);
  for (let i = 0; i < fade; i++) ir[n - 1 - i] *= 0.5 - 0.5 * M.cos((Math.PI * i) / fade);
  let e = 0;
  for (let i = 0; i < n; i++) e += ir[i] * ir[i];
  const k = 1 / Math.sqrt(e);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = ir[i] * k;
  return out;
};

/**
 * Convolução particionada uniforme (overlap-save, linha de atraso no domínio da frequência).
 * Partição P amostras, FFT de 2P. Se P == bloco da cadeia, latência zero; se P for múltiplo maior, a latência é P.
 */
export class ConvolucaoParticionada {
  readonly latencia: number;
  private readonly P: number;
  private readonly fft: FFTReal;
  private readonly bins: number;
  private readonly Hr: Float64Array[];
  private readonly Hi: Float64Array[];
  private readonly Xr: Float64Array[];
  private readonly Xi: Float64Array[];
  private cabeca = 0;
  private readonly entrada: Float64Array; // [anterior P | atual P]
  private readonly tmp: Float64Array;
  private readonly Yr: Float64Array;
  private readonly Yi: Float64Array;
  private readonly fifoIn: Float64Array;
  private readonly fifoOut: Float64Array;
  private nIn = 0;
  private nOut = 0;

  constructor(ir: Float32Array, particao = BLOCO, blocoCadeia = BLOCO) {
    const P = particao;
    this.P = P;
    if (P % blocoCadeia !== 0 && blocoCadeia % P !== 0) throw new Error('partição e bloco incompatíveis');
    this.latencia = P > blocoCadeia ? P : 0;
    this.fft = new FFTReal(2 * P);
    this.bins = P + 1;
    const nPart = Math.ceil(ir.length / P);
    this.Hr = [];
    this.Hi = [];
    this.Xr = [];
    this.Xi = [];
    const seg = new Float64Array(2 * P);
    for (let p = 0; p < nPart; p++) {
      seg.fill(0);
      for (let i = 0; i < P && p * P + i < ir.length; i++) seg[i] = ir[p * P + i];
      const hr = new Float64Array(this.bins);
      const hi = new Float64Array(this.bins);
      this.fft.direta(seg, hr, hi);
      this.Hr.push(hr);
      this.Hi.push(hi);
      this.Xr.push(new Float64Array(this.bins));
      this.Xi.push(new Float64Array(this.bins));
    }
    this.entrada = new Float64Array(2 * P);
    this.tmp = new Float64Array(2 * P);
    this.Yr = new Float64Array(this.bins);
    this.Yi = new Float64Array(this.bins);
    this.fifoIn = new Float64Array(P);
    this.fifoOut = new Float64Array(P);
    // com latência, a saída começa com P zeros
    this.nOut = this.latencia > 0 ? P : 0;
  }

  get particoes() {
    return this.Hr.length;
  }

  /** Processa uma partição completa de `x` (P amostras) e escreve P amostras em `y`. */
  private particao(x: ArrayLike<number>, xo: number, y: Float64Array) {
    const P = this.P;
    const ent = this.entrada;
    ent.copyWithin(0, P, 2 * P);
    for (let i = 0; i < P; i++) ent[P + i] = x[xo + i];
    const np = this.Hr.length;
    this.cabeca = (this.cabeca + np - 1) % np;
    const c = this.cabeca;
    this.fft.direta(ent, this.Xr[c], this.Xi[c]);
    const Yr = this.Yr;
    const Yi = this.Yi;
    Yr.fill(0);
    Yi.fill(0);
    const B = this.bins;
    // Soma em ordem fixa (partição 0, 1, 2...), como pede o contrato canônico.
    for (let p = 0; p < np; p++) {
      const xr = this.Xr[(c + p) % np];
      const xi = this.Xi[(c + p) % np];
      const hr = this.Hr[p];
      const hi = this.Hi[p];
      for (let k = 0; k < B; k++) {
        Yr[k] += xr[k] * hr[k] - xi[k] * hi[k];
        Yi[k] += xr[k] * hi[k] + xi[k] * hr[k];
      }
    }
    this.fft.inversa(Yr, Yi, this.tmp);
    for (let i = 0; i < P; i++) y[i] = this.tmp[P + i];
  }

  processar(buf: Float32Array, n: number) {
    const P = this.P;
    if (this.latencia === 0) {
      for (let o = 0; o < n; o += P) {
        this.particao(buf, o, this.fifoOut);
        for (let i = 0; i < P; i++) buf[o + i] = this.fifoOut[i];
      }
      return;
    }
    // partição maior que o bloco: acumula P amostras, devolve com P de atraso
    for (let i = 0; i < n; i++) {
      this.fifoIn[this.nIn++] = buf[i];
      buf[i] = this.fifoOut[P - this.nOut];
      this.nOut--;
      if (this.nIn === P) {
        this.particao(this.fifoIn, 0, this.fifoOut);
        this.nIn = 0;
        this.nOut = P;
      }
    }
  }
}
