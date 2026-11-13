// EQ de três bandas da faixa como processador por bloco (M-04; era o AdaptadorEq3): prateleira de graves em 200 Hz, sino
// em 1 kHz (Q 0,9) e prateleira de agudos em 5 kHz, em cascata, só as bandas ≠ 0. A conta é a de filtrarNoLugar
// (musica-som.ts), amostra a amostra: o estado (x1 x2 y1 y2) fica em double e cada estágio grava em float32, então o PCM
// sai igual ao do motor antigo. Ver docs/audio-grafo.md, "Converter um efeito".
import type {FaixaMixerP} from '../musica';
import {prateleiraAgudos, prateleiraGraves, sino, type Biquad} from '../musica-som';
import type {EstadoProcessador, Processador} from './tipos';

export class Eq3 implements Processador {
  readonly tipo = 'eq3';
  readonly entradas = [2];
  readonly saidas = [2];
  readonly latencia = 0;
  private filtros: Biquad[] = [];
  /** Por canal e por filtro: x1, x2, y1, y2. */
  private st = new Float64Array(0);
  constructor(readonly eq: FaixaMixerP['eq']) {}
  preparar(taxa: number, _bloco?: number) {
    const {graves_db, medios_db, agudos_db} = this.eq;
    this.filtros = [];
    if (graves_db) this.filtros.push(prateleiraGraves(200, graves_db, taxa));
    if (medios_db) this.filtros.push(sino(1000, 0.9, medios_db, taxa));
    if (agudos_db) this.filtros.push(prateleiraAgudos(5000, agudos_db, taxa));
    this.st = new Float64Array(2 * this.filtros.length * 4);
  }
  processar(entradas: readonly (readonly Float32Array[])[], saidas: readonly Float32Array[][], n: number) {
    const st = this.st;
    for (let c = 0; c < 2; c++) {
      const y = saidas[0][c];
      y.set(entradas[0][c].subarray(0, n));
      for (let k = 0; k < this.filtros.length; k++) {
        const f = this.filtros[k], o = (c * this.filtros.length + k) * 4;
        let x1 = st[o], x2 = st[o + 1], y1 = st[o + 2], y2 = st[o + 3];
        for (let i = 0; i < n; i++) {
          const x0 = y[i];
          const y0 = f.b0 * x0 + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
          x2 = x1; x1 = x0; y2 = y1; y1 = y0;
          y[i] = y0;
        }
        st[o] = x1; st[o + 1] = x2; st[o + 2] = y1; st[o + 3] = y2;
      }
    }
  }
  resetar() {
    this.st.fill(0);
  }
  estado(): EstadoProcessador {
    return {st: Array.from(this.st)};
  }
  restaurar(e: EstadoProcessador) {
    const st = e.st as number[] | undefined;
    if (st) this.st.set(st.slice(0, this.st.length));
  }
}
