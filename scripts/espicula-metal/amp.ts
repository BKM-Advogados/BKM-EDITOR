// Amp de alto ganho: pré-EQ (boost "tight"), pré-amp de 3 estágios com waveshaper assimétrico a 8x, tone stack,
// power amp suave a 2x com presence e depth. O sobreamostrador é polifásico com FIR de Kaiser (anti-imagem na subida,
// anti-aliasing na descida).
//
// Transcendentais:
// - Projeto dos FIR (sin e Math.sqrt) e dos biquads/polos (sin, cos, exp, pow): só no setup, pela `mat.ts`.
// - Waveshaper: por padrão é RACIONAL (aproximação de Padé de tanh, só + * /, idêntica em qualquer V8). Com
//   `tanhNativo: true` usa Math.tanh por amostra a 8x: é o único lugar da cadeia com transcendental no laço quente,
//   mantido só para medir custo e diferença (ver RESULTADO.md).

import {biquad, Cadeia, coefPolo, firKaiser, TAXA} from './comum';

export class Sobreamostrador {
  readonly fator: number;
  readonly latencia: number; // em amostras na taxa base (subida + descida)
  private readonly T: number;
  private readonly fases: Float64Array[];
  private readonly hDesce: Float64Array;
  private readonly histIn: Float64Array;
  private wIn = 0;
  private readonly histOv: Float64Array;
  private wOv = 0;
  private fase = 0;

  constructor(fator: number, tapsPorFase = 32, corte = 22000, beta = 8.6) {
    this.fator = fator;
    this.T = tapsPorFase;
    const N = fator * tapsPorFase;
    const h = firKaiser(N, corte, TAXA * fator, beta);
    this.fases = [];
    for (let j = 0; j < fator; j++) {
      const r = new Float64Array(tapsPorFase);
      for (let k = 0; k < tapsPorFase; k++) r[k] = fator * h[(tapsPorFase - 1 - k) * fator + j];
      this.fases.push(r);
    }
    this.hDesce = new Float64Array(N);
    for (let k = 0; k < N; k++) this.hDesce[k] = h[N - 1 - k];
    this.histIn = new Float64Array(2 * tapsPorFase);
    this.histOv = new Float64Array(2 * N);
    this.latencia = (N - 1) / fator;
  }

  /** `x[0..n)` -> `u[0..n*fator)`. */
  subir(x: Float32Array, n: number, u: Float64Array) {
    const T = this.T;
    const L = this.fator;
    const hist = this.histIn;
    let w = this.wIn;
    let o = 0;
    for (let i = 0; i < n; i++) {
      const v = x[i];
      hist[w] = v;
      hist[w + T] = v;
      const base = w + 1;
      for (let j = 0; j < L; j++) {
        const r = this.fases[j];
        let s = 0;
        for (let k = 0; k < T; k++) s += r[k] * hist[base + k];
        u[o++] = s;
      }
      if (++w >= T) w = 0;
    }
    this.wIn = w;
  }

  /** `u[0..n*fator)` -> `y[0..n)`, filtrando antes de decimar. */
  descer(u: Float64Array, n: number, y: Float32Array) {
    const N = this.T * this.fator;
    const L = this.fator;
    const hist = this.histOv;
    const h = this.hDesce;
    let w = this.wOv;
    let fase = this.fase;
    let o = 0;
    const total = n * L;
    for (let i = 0; i < total; i++) {
      const v = u[i];
      hist[w] = v;
      hist[w + N] = v;
      if (++w >= N) w = 0;
      if (++fase === L) {
        fase = 0;
        // janela: hist[w .. w+N), da mais antiga à mais nova
        let s = 0;
        for (let k = 0; k < N; k++) s += h[k] * hist[w + k];
        y[o++] = s;
      }
    }
    this.wOv = w;
    this.fase = fase;
  }
}

/** tanh racional (Padé [3/2] com limite em ±3): só + * /. Erro máximo ~2% perto de |x|=1,5, contínua em ±3. */
export const satRacional = (x: number) => {
  if (x >= 3) return 1;
  if (x <= -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
};

export type OpcoesAmp = {
  sobreamostragem: number; // 1 desliga (para medir aliasing)
  ganho: number; // 0..1
  tanhNativo?: boolean;
  graves?: number; // dB do tone stack
  medios?: number;
  agudos?: number;
  presence?: number;
  depth?: number;
  master?: number;
};

export class PreEQ {
  private c: Cadeia;
  constructor() {
    // Boost "tight" estilo TS: corta grave antes do ganho, empurra médio, apara agudo.
    this.c = new Cadeia([
      biquad.passaAlta(85, 0.7),
      biquad.pico(800, 0.8, 6),
      biquad.passaBaixa(6500, 0.7),
    ]);
  }
  processar(buf: Float32Array, n: number) {
    this.c.processar(buf, n);
  }
}

/** Pré-amp: 3 estágios de triodo estilizados, todos na taxa sobreamostrada. */
export class PreAmp {
  readonly latencia: number;
  private sobre: Sobreamostrador | null;
  private L: number;
  private u: Float64Array;
  private g1: number;
  private g2: number;
  private g3: number;
  private readonly b1 = 0.35;
  private readonly b2 = -0.25;
  private readonly b3 = 0.2;
  private o1: number;
  private o2: number;
  private o3: number;
  // filtros de polo único entre estágios (acoplamento e capacitor de Miller)
  private hpC: number[];
  private lpC: number[];
  private hpS = [0, 0, 0];
  private lpS = [0, 0, 0];
  private sat: (x: number) => number;

  constructor(o: OpcoesAmp, blocoMax: number) {
    this.L = o.sobreamostragem;
    this.sobre = this.L > 1 ? new Sobreamostrador(this.L) : null;
    this.latencia = this.sobre?.latencia ?? 0;
    this.u = new Float64Array(blocoMax * this.L);
    const ganho = o.ganho;
    this.g1 = 4 + 16 * ganho;
    this.g2 = 6 + 14 * ganho;
    this.g3 = 3;
    this.sat = o.tanhNativo ? Math.tanh : satRacional;
    // saída de cada estágio com entrada 0 (tira o DC do bias)
    this.o1 = this.forma(this.b1);
    this.o2 = this.forma(this.b2);
    this.o3 = this.forma(this.b3);
    const taxa = TAXA * this.L;
    this.hpC = [95, 50, 25].map((f) => 1 - coefPolo(f, taxa));
    this.lpC = [11000, 8000, 7000].map((f) => 1 - coefPolo(f, taxa));
  }

  /** Triodo estilizado: lado positivo satura antes (grade conduz), negativo é mais macio (corte). */
  private forma(x: number) {
    const s = this.sat;
    return x >= 0 ? s(x) : 1.6 * s(x / 1.6);
  }

  processar(buf: Float32Array, n: number) {
    const L = this.L;
    const u = this.u;
    if (this.sobre) this.sobre.subir(buf, n, u);
    else for (let i = 0; i < n; i++) u[i] = buf[i];
    const m = n * L;
    const {g1, g2, g3, b1, b2, b3, o1, o2, o3, hpC, lpC} = this;
    let [h0, h1, h2] = this.hpS;
    let [l0, l1, l2] = this.lpS;
    const forma = this.sat === satRacional ? formaRacional : (x: number) => this.forma(x);
    for (let i = 0; i < m; i++) {
      let x = u[i] * g1;
      x = forma(x + b1) - o1;
      h0 += hpC[0] * (x - h0);
      x -= h0;
      l0 += lpC[0] * (x - l0);
      x = l0 * g2;
      x = forma(x + b2) - o2;
      h1 += hpC[1] * (x - h1);
      x -= h1;
      l1 += lpC[1] * (x - l1);
      x = l1 * g3;
      x = forma(x + b3) - o3;
      h2 += hpC[2] * (x - h2);
      x -= h2;
      l2 += lpC[2] * (x - l2);
      u[i] = l2 * 0.5;
    }
    const z = (v: number) => (Math.abs(v) < 1e-25 ? 0 : v);
    this.hpS = [z(h0), z(h1), z(h2)];
    this.lpS = [z(l0), z(l1), z(l2)];
    if (this.sobre) this.sobre.descer(u, n, buf);
    else for (let i = 0; i < n; i++) buf[i] = u[i];
  }
}

const formaRacional = (x: number) => (x >= 0 ? satRacional(x) : 1.6 * satRacional(x / 1.6));

/** Tone stack aproximado por 3 biquads (não é o modelo de circuito de Yeh; ver RESULTADO.md). */
export class ToneStack {
  private c: Cadeia;
  constructor(o: OpcoesAmp) {
    this.c = new Cadeia([
      biquad.prateleiraBaixa(120, o.graves ?? 1),
      biquad.pico(550, 0.7, o.medios ?? -5),
      biquad.prateleiraAlta(2800, o.agudos ?? 1.5),
    ]);
  }
  processar(buf: Float32Array, n: number) {
    this.c.processar(buf, n);
  }
}

/** Power amp suave: depth e presence (como na realimentação negativa) e saturação leve a 2x. */
export class PowerAmp {
  readonly latencia: number;
  private sobre = new Sobreamostrador(2);
  private u: Float64Array;
  private eq: Cadeia;
  private drive = 1.4;
  private master: number;
  constructor(o: OpcoesAmp, blocoMax: number) {
    this.u = new Float64Array(blocoMax * 2);
    this.latencia = this.sobre.latencia;
    this.master = o.master ?? 0.6;
    this.eq = new Cadeia([
      biquad.pico(95, 1.1, o.depth ?? 4),
      biquad.prateleiraAlta(3500, o.presence ?? 2.5),
    ]);
  }
  processar(buf: Float32Array, n: number) {
    this.eq.processar(buf, n);
    const u = this.u;
    this.sobre.subir(buf, n, u);
    const d = this.drive;
    const k = this.master / satRacional(d);
    for (let i = 0; i < 2 * n; i++) {
      // push-pull: simétrico, só harmônicos ímpares, bem macio
      u[i] = satRacional(u[i] * d) * k;
    }
    this.sobre.descer(u, n, buf);
  }
}
