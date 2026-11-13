// Delay estéreo nativo por bloco (retorno 2), com realimentação, passa-baixas de um polo no laço e pingue-pongue. Mesma
// conta de `atrasar` em musica-som.ts: linhas em Float32Array, filtros em `number`. Sai só o molhado.
// Ver docs/audio-grafo.md.
import type {ContextoBloco, EstadoProcessador, Processador} from './tipos';

const DUAS_PI = Math.PI * 2;

export class DelayEstereo implements Processador {
  readonly tipo = 'delay';
  readonly entradas = [2];
  readonly saidas = [2];
  readonly latencia = 0;
  private a = 0;
  private linhaL = new Float32Array(1);
  private linhaR = new Float32Array(1);
  private fl = 0;
  private fr = 0;
  private k = 0;

  constructor(readonly atraso_s: number, readonly realimentacao: number, readonly brilho: number, readonly pingue: boolean) {}

  preparar(taxa: number, _bloco: number) {
    const d = Math.max(1, Math.round(this.atraso_s * taxa));
    this.a = Math.exp((-DUAS_PI * 1500 * Math.pow(8, this.brilho)) / taxa);
    this.linhaL = new Float32Array(d);
    this.linhaR = new Float32Array(d);
    this.resetar();
  }

  resetar() {
    this.linhaL.fill(0);
    this.linhaR.fill(0);
    this.fl = this.fr = this.k = 0;
  }

  processar(entradas: readonly (readonly Float32Array[])[], saidas: readonly Float32Array[][], n: number, _ctx: ContextoBloco) {
    const [L, R] = entradas[0];
    const [oL, oR] = saidas[0];
    const {a, realimentacao, pingue, linhaL, linhaR} = this;
    const d = linhaL.length;
    let {fl, fr, k} = this;
    for (let i = 0; i < n; i++) {
      const yl = linhaL[k], yr = linhaR[k];
      oL[i] = yl;
      oR[i] = yr;
      fl = (1 - a) * yl + a * fl;
      fr = (1 - a) * yr + a * fr;
      const xl = L[i], xr = R[i];
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

  estado(): EstadoProcessador {
    return {linhaL: Array.from(this.linhaL), linhaR: Array.from(this.linhaR), fl: this.fl, fr: this.fr, k: this.k};
  }

  restaurar(e: EstadoProcessador) {
    this.linhaL.set(e.linhaL as number[]);
    this.linhaR.set(e.linhaR as number[]);
    this.fl = Number(e.fl);
    this.fr = Number(e.fr);
    this.k = Number(e.k);
  }
}
