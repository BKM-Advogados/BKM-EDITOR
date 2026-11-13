// Guitarra elétrica por Karplus-Strong estendido (Jaffe e Smith, 1983), corda por corda.
//
// Laço de cada corda: linha de atraso inteira N -> filtro de perda de polo único (brilho e decaimento)
// -> passa-tudo de 1ª ordem (fração da afinação) -> de volta à linha. A afinação desconta o atraso de fase do filtro
// de perda na fundamental, então a nota fica certa mesmo com o filtro escuro do palm mute.
// Excitação: triângulo da corda puxada mais ruído com semente (passa-baixa da palheta e pente da posição dela).
// Saída: captador de ponte (pente da posição do captador lido na própria linha) e ressonância do humbucker com cabo.
//
// Transcendentais: só por NOTA (pow do ganho do laço e da afinação; cos, sin, atan2 e Math.sqrt da fase e do módulo do
// filtro na fundamental), pela `mat.ts`. O laço por amostra é só soma e multiplicação.

import {Biquad, biquad, Rng, TAXA} from './comum';
import * as M from './mat';

/** Drop B de 6 cordas (B1 F#2 B2 E3 G#3 C#4) e B padrão de 7 cordas (B1 E2 A2 D3 G3 B3 E4), em MIDI. */
export const AFINACOES = {
  dropB: [35, 42, 47, 52, 56, 61],
  seteB: [35, 40, 45, 50, 55, 59, 64],
} as const;

export const hzDeMidi = (m: number, la = 440) => la * M.pow(2, (m - 69) / 12);

export type Articulacao = 'pm' | 'aberto';

const TAM_LINHA = 4096; // corda mais grave possível: 48000/4096 = 11,7 Hz

class Voz {
  private linha = new Float64Array(TAM_LINHA);
  private pos = 0;
  private n = 100;
  private tapCaptador = 6;
  private ap = 0; // coeficiente do passa-tudo
  private apX1 = 0;
  private apY1 = 0;
  private a = 0.1; // polo do filtro de perda
  private g = 0.99; // ganho do laço (rho * (1 - a))
  private lp1 = 0;
  private w0 = 0;
  ativa = false;
  private amostrasDesdeSoltar = -1;

  /** Coeficientes do laço para uma corda de fundamental f0 com polo `a` e T60 em segundos na fundamental. */
  private afinar(f0: number, a: number, t60: number, refazerAtraso: boolean) {
    const w = (2 * Math.PI * f0) / TAXA;
    // Filtro de perda H = (1-a)/(1 - a z^-1): fase e módulo na fundamental.
    const atrasoFase = M.atan2(a * M.sin(w), 1 - a * M.cos(w)) / w;
    const modulo = (1 - a) / Math.sqrt(1 - 2 * a * M.cos(w) + a * a);
    const alvo = M.pow(0.001, 1 / (f0 * t60)); // ganho por período para cair 60 dB em t60
    this.a = a;
    this.g = (alvo / modulo) * (1 - a);
    if (refazerAtraso) {
      const D = TAXA / f0 - atrasoFase;
      let N = Math.floor(D);
      let frac = D - N;
      if (frac < 0.1) {
        N -= 1;
        frac += 1;
      }
      this.n = N;
      this.ap = (1 - frac) / (1 + frac);
      this.w0 = w;
    }
  }

  tocar(f0: number, art: Articulacao, vel: number, rng: Rng, posPalheta: number, posCaptador: number) {
    const pm = art === 'pm';
    // Palm mute: laço escuro e curto. Aberto: brilhante e longo (as graves soam mais).
    const a = pm ? 0.72 : 0.14 + 0.06 * (1 - vel);
    const t60 = pm ? 0.13 + 0.04 * rng.u() : Math.min(6, 2.2 * M.pow(82 / f0, 0.5));
    this.afinar(f0, a, t60, true);
    this.pos = 0;
    this.apX1 = this.apY1 = this.lp1 = 0;
    this.linha.fill(0);
    const n = this.n;
    // Excitação: forma de corda puxada (triângulo com o vértice na posição da palheta: harmônicos caem ~1/n²)
    // mais ruído (atrito da palheta) -> polo único (dureza da palheta) -> pente da posição da palheta -> sem DC.
    const exc = new Float64Array(n);
    const polo = pm ? 0.8 : 0.45 - 0.2 * vel;
    const d = Math.max(1, Math.round(posPalheta * n));
    const mistura = pm ? 0.25 : 0.35 + 0.2 * vel;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp = (1 - polo) * rng.b() + polo * lp;
      exc[i] = lp;
    }
    let media = 0;
    let maiorRuido = 1e-9;
    const pente = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      pente[i] = exc[i] - (i >= d ? exc[i - d] : 0);
      maiorRuido = Math.max(maiorRuido, Math.abs(pente[i]));
    }
    for (let i = 0; i < n; i++) {
      const tri = i < d ? i / d : (n - i) / (n - d);
      pente[i] = (1 - mistura) * tri + (mistura * pente[i]) / maiorRuido;
      media += pente[i];
    }
    media /= n;
    let maior = 1e-9;
    for (let i = 0; i < n; i++) {
      pente[i] -= media;
      maior = Math.max(maior, Math.abs(pente[i]));
    }
    const amp = (0.25 + 0.75 * vel) / maior;
    for (let i = 0; i < n; i++) this.linha[i] = pente[i] * amp;
    this.tapCaptador = Math.max(1, Math.round(posCaptador * n));
    this.ativa = true;
    this.amostrasDesdeSoltar = -1;
  }

  /** Abafar (mão ou palm): perda alta, sem mexer no atraso para não estalar. */
  soltar(rapido = false) {
    if (!this.ativa || this.amostrasDesdeSoltar >= 0) return;
    const f0 = (this.w0 * TAXA) / (2 * Math.PI);
    this.afinar(f0, 0.7, rapido ? 0.025 : 0.07, false);
    this.amostrasDesdeSoltar = 0;
  }

  /** Soma a saída do captador em `saida[0..n)`. */
  render(saida: Float64Array, nAmostras: number) {
    if (!this.ativa) return;
    const linha = this.linha;
    const N = this.n;
    const a = this.a;
    const g = this.g;
    const ap = this.ap;
    const tap = this.tapCaptador;
    let pos = this.pos;
    let lp1 = this.lp1;
    let apX1 = this.apX1;
    let apY1 = this.apY1;
    let pico = 0;
    // A linha é circular de tamanho N dentro do buffer de TAM_LINHA: escreve onde leu (atraso exato N).
    for (let i = 0; i < nAmostras; i++) {
      const s = linha[pos];
      let pT = pos + tap;
      if (pT >= N) pT -= N;
      saida[i] += s - linha[pT]; // captador: pente da posição
      lp1 = g * s + a * lp1; // perda
      const y = ap * lp1 + apX1 - ap * apY1; // fração
      apX1 = lp1;
      apY1 = y;
      linha[pos] = y;
      if (++pos >= N) pos = 0;
      const m = s < 0 ? -s : s;
      if (m > pico) pico = m;
    }
    this.pos = pos;
    this.lp1 = Math.abs(lp1) < 1e-25 ? 0 : lp1;
    this.apX1 = Math.abs(apX1) < 1e-25 ? 0 : apX1;
    this.apY1 = Math.abs(apY1) < 1e-25 ? 0 : apY1;
    if (this.amostrasDesdeSoltar >= 0) this.amostrasDesdeSoltar += nAmostras;
    if (pico < 1e-6 || this.amostrasDesdeSoltar > TAXA) this.ativa = false;
  }
}

/** Evento de mão direita: em `t` segundos, `cordas[i]` toca a casa `casas[i]` (null = não toca). */
export type Evento =
  | {t: number; tipo: 'tocar'; corda: number; casa: number; art: Articulacao; vel: number}
  | {t: number; tipo: 'abafar'; corda: number};

export type OpcoesGuitarra = {
  afinacao: readonly number[];
  semente: number;
  /** Desafinação geral da guitarra em cents (dobra L/R). */
  cents: number;
  posPalheta: number;
  posCaptador: number;
  /** Desvio da micro-variação de afinação por nota, em cents (padrão 1,2; 0 para medir afinação). */
  variacaoCents?: number;
};

/**
 * Uma guitarra (uma "tomada" da dobra). Cada corda tem 2 vozes que se revezam: a nota nova começa numa voz limpa
 * enquanto a anterior é abafada rápido, como a corda real que a palheta interrompe.
 */
export class Guitarra {
  private vozes: Voz[][];
  private atual: number[];
  private eventos: Evento[];
  private prox = 0;
  private t = 0; // em amostras
  private rng: Rng;
  private acum = new Float64Array(4096);
  private captador: Biquad;
  private captador2: Biquad;

  constructor(
    eventos: Evento[],
    private o: OpcoesGuitarra,
  ) {
    this.eventos = [...eventos].sort((x, y) => x.t - y.t);
    this.vozes = o.afinacao.map(() => [new Voz(), new Voz()]);
    this.atual = o.afinacao.map(() => 0);
    this.rng = new Rng(o.semente);
    // Humbucker com cabo: ressonância em ~3,4 kHz e queda acima.
    this.captador = new Biquad(biquad.passaBaixa(3400 + 300 * this.rng.b(), 2.0));
    this.captador2 = new Biquad(biquad.passaAlta(55, 0.7));
  }

  private aplicar(ev: Evento) {
    const vs = this.vozes[ev.corda];
    if (ev.tipo === 'abafar') {
      vs[this.atual[ev.corda]].soltar();
      return;
    }
    vs[this.atual[ev.corda]].soltar(true);
    this.atual[ev.corda] = 1 - this.atual[ev.corda];
    const midi = this.o.afinacao[ev.corda] + ev.casa;
    const cents = this.o.cents + (this.o.variacaoCents ?? 1.2) * this.rng.g(); // micro-variação por nota
    const f0 = hzDeMidi(midi) * M.pow(2, cents / 1200);
    const posP = this.o.posPalheta * (1 + 0.08 * this.rng.b());
    vs[this.atual[ev.corda]].tocar(f0, ev.art, ev.vel, this.rng, posP, this.o.posCaptador);
  }

  /** Escreve o DI (mono) do bloco em `saida`. Eventos caem na amostra exata (sub-blocos). */
  render(saida: Float32Array, n: number) {
    let feito = 0;
    while (feito < n) {
      let fim = n;
      const ev = this.eventos[this.prox];
      if (ev) {
        const amostraEv = Math.round(ev.t * TAXA);
        if (amostraEv <= this.t + feito) {
          this.aplicar(ev);
          this.prox++;
          continue;
        }
        fim = Math.min(n, amostraEv - this.t);
      }
      const m = fim - feito;
      const acum = this.acum;
      acum.fill(0, 0, m);
      for (const vs of this.vozes) for (const v of vs) v.render(acum, m);
      for (let i = 0; i < m; i++) saida[feito + i] = acum[i] * 0.35;
      feito = fim;
    }
    this.t += n;
    this.captador.processar(saida, n);
    this.captador2.processar(saida, n);
  }
}
