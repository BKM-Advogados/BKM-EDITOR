// Compressor de alimentação direta da faixa como processador por bloco (M-04; era o AdaptadorCompressor): detector de
// pico ligado nos dois lados, envelope com ataque e soltura, redução acima do limiar e ganho de compensação. A conta é a
// de comprimir (musica-som.ts), amostra a amostra, com o envelope em double. Ver docs/audio-grafo.md.
import type {FaixaMixerP} from '../musica';
import {ganhoDeDb} from './processadores';
import type {EstadoProcessador, Processador} from './tipos';

export class Compressor implements Processador {
  readonly tipo = 'compressor';
  readonly entradas = [2];
  readonly saidas = [2];
  readonly latencia = 0;
  private at = 0;
  private so = 0;
  private makeup = 1;
  private env = 0;
  constructor(readonly c: FaixaMixerP['compressor']) {}
  preparar(taxa: number, _bloco?: number) {
    this.at = Math.exp(-1 / ((this.c.ataque_ms / 1000) * taxa));
    this.so = Math.exp(-1 / ((this.c.soltura_ms / 1000) * taxa));
    this.makeup = ganhoDeDb(this.c.ganho_db);
  }
  processar(entradas: readonly (readonly Float32Array[])[], saidas: readonly Float32Array[][], n: number) {
    const [L, R] = entradas[0], [oL, oR] = saidas[0];
    const {at, so, makeup} = this;
    const {limiar_db, razao} = this.c;
    let env = this.env;
    for (let i = 0; i < n; i++) {
      const x = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      env = x > env ? at * env + (1 - at) * x : so * env + (1 - so) * x;
      const nivel = env > 1e-6 ? 20 * Math.log10(env) : -120;
      const acima = nivel - limiar_db;
      const g = (acima > 0 ? ganhoDeDb(-acima * (1 - 1 / razao)) : 1) * makeup;
      oL[i] = L[i] * g;
      oR[i] = R[i] * g;
    }
    this.env = env;
  }
  resetar() {
    this.env = 0;
  }
  estado(): EstadoProcessador {
    return {env: this.env};
  }
  restaurar(e: EstadoProcessador) {
    this.env = Number(e.env) || 0;
  }
}
