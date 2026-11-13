// Peças comuns da espícula de metal: taxa, gerador pseudoaleatório com semente, biquads (RBJ), polo único e janela
// de Kaiser. Tudo fora do app (scripts/espicula-metal), sem dependência do motor de música.
//
// Transcendentais (registro pedido na tarefa): aqui só aparecem no CÁLCULO DE COEFICIENTES, uma vez por filtro ou
// por nota (sin, cos, exp, pow da `mat.ts`, a matemática própria, e Math.sqrt, que o IEEE-754 já fixa). Nenhum laço
// por amostra deste arquivo chama transcendental: Biquad.processar é só soma e multiplicação.

import * as M from './mat';

export const TAXA = 48000;
export const BLOCO = 128;

/** Gerador mulberry32: inteiro de 32 bits, sem transcendental. A mesma semente dá a mesma sequência em qualquer motor JS. */
export class Rng {
  private s: number;
  constructor(semente: number) {
    this.s = semente >>> 0 || 0x9e3779b9;
  }
  /** Uniforme em [0, 1). */
  u(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Uniforme em [-1, 1). */
  b(): number {
    return this.u() * 2 - 1;
  }
  /** Quase normal (soma de 4 uniformes, variância 1), sem log nem sqrt por amostra. */
  g(): number {
    return (this.u() + this.u() + this.u() + this.u() - 2) * 1.7320508075688772;
  }
}

export type CoefBiquad = {b0: number; b1: number; b2: number; a1: number; a2: number};

const rbj = (f: number, q: number, taxa: number) => {
  const w = (2 * Math.PI * f) / taxa; // setup: transcendental
  return {cw: M.cos(w), sw: M.sin(w), alfa: M.sin(w) / (2 * q)};
};
const norm = (b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): CoefBiquad => ({
  b0: b0 / a0,
  b1: b1 / a0,
  b2: b2 / a0,
  a1: a1 / a0,
  a2: a2 / a0,
});

/** Fórmulas do "Audio EQ Cookbook" (R. Bristow-Johnson). Ganhos em dB. */
export const biquad = {
  passaBaixa(f: number, q: number, taxa = TAXA): CoefBiquad {
    const {cw, alfa} = rbj(f, q, taxa);
    return norm((1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + alfa, -2 * cw, 1 - alfa);
  },
  passaAlta(f: number, q: number, taxa = TAXA): CoefBiquad {
    const {cw, alfa} = rbj(f, q, taxa);
    return norm((1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + alfa, -2 * cw, 1 - alfa);
  },
  pico(f: number, q: number, db: number, taxa = TAXA): CoefBiquad {
    const {cw, alfa} = rbj(f, q, taxa);
    const A = M.pow(10, db / 40);
    return norm(1 + alfa * A, -2 * cw, 1 - alfa * A, 1 + alfa / A, -2 * cw, 1 - alfa / A);
  },
  prateleiraBaixa(f: number, db: number, taxa = TAXA, s = 1): CoefBiquad {
    const {cw, sw} = rbj(f, 1, taxa);
    const A = M.pow(10, db / 40);
    const alfa = (sw / 2) * Math.sqrt((A + 1 / A) * (1 / s - 1) + 2);
    const r = 2 * Math.sqrt(A) * alfa;
    return norm(
      A * (A + 1 - (A - 1) * cw + r),
      2 * A * (A - 1 - (A + 1) * cw),
      A * (A + 1 - (A - 1) * cw - r),
      A + 1 + (A - 1) * cw + r,
      -2 * (A - 1 + (A + 1) * cw),
      A + 1 + (A - 1) * cw - r,
    );
  },
  prateleiraAlta(f: number, db: number, taxa = TAXA, s = 1): CoefBiquad {
    const {cw, sw} = rbj(f, 1, taxa);
    const A = M.pow(10, db / 40);
    const alfa = (sw / 2) * Math.sqrt((A + 1 / A) * (1 / s - 1) + 2);
    const r = 2 * Math.sqrt(A) * alfa;
    return norm(
      A * (A + 1 + (A - 1) * cw + r),
      -2 * A * (A - 1 + (A + 1) * cw),
      A * (A + 1 + (A - 1) * cw - r),
      A + 1 - (A - 1) * cw + r,
      2 * (A - 1 - (A + 1) * cw),
      A + 1 - (A - 1) * cw - r,
    );
  },
  rejeita(f: number, q: number, taxa = TAXA): CoefBiquad {
    const {cw, alfa} = rbj(f, q, taxa);
    return norm(1, -2 * cw, 1, 1 + alfa, -2 * cw, 1 - alfa);
  },
};

/** Biquad em forma direta II transposta, estado em Float64. */
export class Biquad {
  private z1 = 0;
  private z2 = 0;
  constructor(public c: CoefBiquad) {}
  passo(x: number): number {
    const c = this.c;
    const y = c.b0 * x + this.z1;
    this.z1 = c.b1 * x - c.a1 * y + this.z2;
    this.z2 = c.b2 * x - c.a2 * y;
    return y;
  }
  processar(buf: Float32Array | Float64Array, n: number): void {
    const {b0, b1, b2, a1, a2} = this.c;
    let z1 = this.z1;
    let z2 = this.z2;
    for (let i = 0; i < n; i++) {
      const x = buf[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      buf[i] = y;
    }
    // Denormais tratados no código (A4): estado muito pequeno vira zero.
    this.z1 = Math.abs(z1) < 1e-25 ? 0 : z1;
    this.z2 = Math.abs(z2) < 1e-25 ? 0 : z2;
  }
}

/** Cascata de biquads. */
export class Cadeia {
  readonly filtros: Biquad[];
  constructor(coefs: CoefBiquad[]) {
    this.filtros = coefs.map((c) => new Biquad(c));
  }
  processar(buf: Float32Array | Float64Array, n: number): void {
    for (const f of this.filtros) f.processar(buf, n);
  }
}

/** Coeficiente de polo único para corte f (exp só no setup). */
export const coefPolo = (f: number, taxa: number) => M.exp((-2 * Math.PI * f) / taxa);

/** Bessel modificada I0 por série (setup da janela de Kaiser). */
const besselI0 = (x: number) => {
  let soma = 1;
  let termo = 1;
  for (let k = 1; k < 60; k++) {
    termo *= (x / (2 * k)) * (x / (2 * k));
    soma += termo;
    if (termo < 1e-17 * soma) break;
  }
  return soma;
};

/**
 * Passa-baixa FIR de fase linear por sinc com janela de Kaiser. `corte` em Hz na taxa `taxa`. Ganho DC = 1.
 * Transcendentais (sin, sqrt) só aqui, no projeto do filtro.
 */
export const firKaiser = (n: number, corte: number, taxa: number, beta: number): Float64Array => {
  const h = new Float64Array(n);
  const fc = corte / taxa;
  const meio = (n - 1) / 2;
  const i0b = besselI0(beta);
  let soma = 0;
  for (let i = 0; i < n; i++) {
    const t = i - meio;
    const sinc = t === 0 ? 2 * fc : M.sin(2 * Math.PI * fc * t) / (Math.PI * t);
    const r = (2 * i) / (n - 1) - 1;
    const w = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0b;
    h[i] = sinc * w;
    soma += h[i];
  }
  for (let i = 0; i < n; i++) h[i] /= soma;
  return h;
};

/** Só para medida e relatório (fora do render). */
export const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-30));
export const deDb = (d: number) => M.pow(10, d / 20);
