// Noise gate com histerese, hold e rampas (estilo "decimator" no DI, antes do amp, onde o ruído ainda não ganhou
// 60 dB). Limiares guardados em linear: nenhum log por amostra.
// Transcendentais: pow e exp (da `mat.ts`, via comum.ts) só no construtor.

import {coefPolo, deDb, TAXA} from './comum';

export type OpcoesGate = {abreDb: number; fechaDb: number; holdMs: number; ataqueMs: number; soltaMs: number};

export const GATE_PADRAO: OpcoesGate = {abreDb: -52, fechaDb: -60, holdMs: 25, ataqueMs: 0.5, soltaMs: 45};

export class Gate {
  private abre: number;
  private fecha: number;
  private hold: number;
  private cAtaque: number;
  private cSolta: number;
  private cEnv: number;
  private env = 0;
  private ganho = 0;
  private aberto = false;
  private contaHold = 0;
  constructor(o: OpcoesGate = GATE_PADRAO) {
    this.abre = deDb(o.abreDb);
    this.fecha = deDb(o.fechaDb);
    this.hold = Math.round((o.holdMs / 1000) * TAXA);
    this.cAtaque = coefPolo(1000 / (2 * Math.PI * o.ataqueMs), TAXA);
    this.cSolta = coefPolo(1000 / (2 * Math.PI * o.soltaMs), TAXA);
    this.cEnv = coefPolo(1000 / (2 * Math.PI * 8), TAXA); // detector de pico com queda de ~8 ms
  }
  processar(buf: Float32Array, n: number) {
    let env = this.env;
    let ganho = this.ganho;
    let aberto = this.aberto;
    let conta = this.contaHold;
    const {abre, fecha, hold, cAtaque, cSolta, cEnv} = this;
    for (let i = 0; i < n; i++) {
      const x = buf[i];
      const m = x < 0 ? -x : x;
      env = m > env ? m : env * cEnv;
      if (env >= abre) {
        aberto = true;
        conta = hold;
      } else if (aberto && env < fecha) {
        if (conta > 0) conta--;
        else aberto = false;
      }
      const alvo = aberto ? 1 : 0;
      ganho = alvo > ganho ? alvo + (ganho - alvo) * cAtaque : alvo + (ganho - alvo) * cSolta;
      buf[i] = x * ganho;
    }
    this.env = env < 1e-25 ? 0 : env;
    this.ganho = ganho < 1e-25 ? 0 : ganho;
    this.aberto = aberto;
    this.contaHold = conta;
  }
}
