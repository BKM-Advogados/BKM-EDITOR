// A cadeia de uma faixa de guitarra, por blocos de 128 amostras (o modelo da A2: processar(bloco) com estado e
// latência declarada), com o tempo de cada estágio somado à parte para o RTF por estágio.

import {OpcoesAmp, PowerAmp, PreAmp, PreEQ, ToneStack} from './amp';
import {BLOCO, Rng, TAXA} from './comum';
import * as M from './mat';
import {ConvolucaoParticionada, sintetizarIR} from './gabinete';
import {Gate, GATE_PADRAO} from './gate';
import {Evento, Guitarra, OpcoesGuitarra} from './guitarra';

export type Estagio = {nome: string; latencia: number; processar(buf: Float32Array, n: number): void};

/** Ruído do DI: chiado branco e zumbido de 60 Hz com harmônicos (oscilador por rotação, sem sin por amostra). */
export class RuidoDI {
  private rng: Rng;
  private c: number;
  private s: number;
  private x = 1;
  private y = 0;
  constructor(
    semente: number,
    private chiado = 0.00012, // ~ -78 dBFS
    private zumbido = 0.00005,
  ) {
    this.rng = new Rng(semente);
    const w = (2 * Math.PI * 60) / TAXA;
    this.c = M.cos(w);
    this.s = M.sin(w);
  }
  processar(buf: Float32Array, n: number) {
    let {x, y} = this;
    for (let i = 0; i < n; i++) {
      const nx = x * this.c - y * this.s;
      y = x * this.s + y * this.c;
      x = nx;
      // 3º harmônico por Chebyshev: cos(3t) = 4cos^3 - 3cos
      const h3 = 4 * x * x * x - 3 * x;
      buf[i] += this.chiado * this.rng.b() + this.zumbido * (x + 0.5 * h3);
    }
    // renormaliza a rotação (sqrt por bloco, não por amostra)
    const r = 1 / Math.sqrt(x * x + y * y);
    this.x = x * r;
    this.y = y * r;
  }
}

export type OpcoesFaixa = {
  eventos: Evento[];
  guitarra: OpcoesGuitarra;
  amp: OpcoesAmp;
  sementeIR: number;
  particaoIR?: number;
  gate?: boolean;
  ruido?: boolean;
  /** só DI (sem amp e sem gabinete), para medir afinação */
  soDI?: boolean;
  /** pular o gabinete (para medir aliasing do amp) */
  semGabinete?: boolean;
};

export const montarFaixa = (o: OpcoesFaixa): Estagio[] => {
  const g = new Guitarra(o.eventos, o.guitarra);
  const est: Estagio[] = [{nome: 'guitarra (KS)', latencia: 0, processar: (b, n) => g.render(b, n)}];
  if (o.ruido !== false) {
    const r = new RuidoDI(o.guitarra.semente * 7 + 1);
    est.push({nome: 'ruído DI', latencia: 0, processar: (b, n) => r.processar(b, n)});
  }
  if (o.soDI) return est;
  if (o.gate !== false) {
    const gt = new Gate(GATE_PADRAO);
    est.push({nome: 'gate', latencia: 0, processar: (b, n) => gt.processar(b, n)});
  }
  const pre = new PreEQ();
  est.push({nome: 'pré-EQ', latencia: 0, processar: (b, n) => pre.processar(b, n)});
  const pa = new PreAmp(o.amp, BLOCO);
  est.push({nome: `pré-amp ${o.amp.sobreamostragem}x`, latencia: pa.latencia, processar: (b, n) => pa.processar(b, n)});
  const ts = new ToneStack(o.amp);
  est.push({nome: 'tone stack', latencia: 0, processar: (b, n) => ts.processar(b, n)});
  const pw = new PowerAmp(o.amp, BLOCO);
  est.push({nome: 'power amp 2x', latencia: pw.latencia, processar: (b, n) => pw.processar(b, n)});
  if (!o.semGabinete) {
    const ir = sintetizarIR(o.sementeIR);
    const cv = new ConvolucaoParticionada(ir, o.particaoIR ?? BLOCO, BLOCO);
    est.push({nome: `gabinete (IR ${Math.round((ir.length / TAXA) * 1000)} ms, P=${o.particaoIR ?? BLOCO})`, latencia: cv.latencia, processar: (b, n) => cv.processar(b, n)});
  }
  return est;
};

export type Tempos = Map<string, number>;

/** Roda a cadeia por blocos até `amostras`, somando ms por estágio em `tempos`. */
export const renderFaixa = (est: Estagio[], amostras: number, tempos: Tempos): Float32Array => {
  const out = new Float32Array(amostras);
  const buf = new Float32Array(BLOCO);
  for (let o = 0; o < amostras; o += BLOCO) {
    buf.fill(0);
    for (const e of est) {
      const t0 = performance.now();
      e.processar(buf, BLOCO);
      tempos.set(e.nome, (tempos.get(e.nome) ?? 0) + performance.now() - t0);
    }
    out.set(o + BLOCO <= amostras ? buf : buf.subarray(0, amostras - o), o);
  }
  return out;
};

export const latenciaTotal = (est: Estagio[]) => Math.round(est.reduce((s, e) => s + e.latencia, 0));
