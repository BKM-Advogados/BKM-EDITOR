// Delay do retorno 2, preso ao BPM, como processador por bloco (M-04; era o AdaptadorDelay): linha estéreo com
// realimentação e um passa-baixas de um polo no laço; no pingue-pongue, a entrada em mono começa à esquerda e cada volta
// troca de lado. Sai só o molhado. A conta é a de atrasar (musica-som.ts), amostra a amostra: as linhas em float32 e os
// filtros em double. Ver docs/audio-grafo.md.
import type {ContextoBloco, EstadoProcessador, Processador} from './tipos';

export class Delay implements Processador {
  readonly tipo = 'delay';
  readonly entradas = [2];
  readonly saidas = [2];
  readonly latencia = 0;
  private d = 1;
  private a = 0;
  private linhaL = new Float32Array(1);
  private linhaR = new Float32Array(1);
  private fl = 0;
  private fr = 0;
  private k = 0;
  constructor(readonly atraso_s: number, readonly realimentacao: number, readonly brilho: number, readonly pingue: boolean) {}
  preparar(taxa: number, _bloco?: number) {
    const d = Math.max(1, Math.round(this.atraso_s * taxa));
    this.a = Math.exp((-2 * Math.PI * 1500 * Math.pow(8, this.brilho)) / taxa);
    if (d !== this.d || this.linhaL.length !== d) {
      this.d = d;
      this.linhaL = new Float32Array(d);
      this.linhaR = new Float32Array(d);
    }
  }
  processar(entradas: readonly (readonly Float32Array[])[], saidas: readonly Float32Array[][], n: number, _ctx?: ContextoBloco) {
    const [xL, xR] = entradas[0], [oL, oR] = saidas[0];
    const {a, d, linhaL, linhaR, realimentacao, pingue} = this;
    let {fl, fr, k} = this;
    for (let i = 0; i < n; i++) {
      const yl = linhaL[k], yr = linhaR[k];
      oL[i] = yl;
      oR[i] = yr;
      fl = (1 - a) * yl + a * fl;
      fr = (1 - a) * yr + a * fr;
      const xl = xL[i], xr = xR[i];
      if (pingue) {
        linhaL[k] = (xl + xr) * 0.5 + fr * realimentacao;
        linhaR[k] = fl * realimentacao;
      } else {
        linhaL[k] = xl + fl * realimentacao;
        linhaR[k] = xr + fr * realimentacao;
      }
      if (++k >= d) k = 0;
    }
    this.fl = fl;
    this.fr = fr;
    this.k = k;
  }
  resetar() {
    this.linhaL.fill(0);
    this.linhaR.fill(0);
    this.fl = this.fr = 0;
    this.k = 0;
  }
  estado(): EstadoProcessador {
    return {fl: this.fl, fr: this.fr, k: this.k, l: Array.from(this.linhaL), r: Array.from(this.linhaR)};
  }
  restaurar(e: EstadoProcessador) {
    this.fl = Number(e.fl) || 0;
    this.fr = Number(e.fr) || 0;
    this.k = Number(e.k) || 0;
    if (Array.isArray(e.l)) this.linhaL.set((e.l as number[]).slice(0, this.linhaL.length));
    if (Array.isArray(e.r)) this.linhaR.set((e.r as number[]).slice(0, this.linhaR.length));
  }
}
