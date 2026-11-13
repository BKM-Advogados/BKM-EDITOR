// EQ de três bandas da faixa como processador nativo por bloco (prateleira de graves em 200 Hz, sino em 1 kHz, prateleira
// de agudos em 5 kHz). A conta é a de filtrarNoLugar de musica-som.ts, operação por operação: cada biquad guarda
// x1 x2 y1 y2 como `number` (double) e a saída de cada banda vai para um Float32Array, que é a entrada da banda seguinte.
// O PCM sai igual ao do motor antigo. Ver docs/audio-grafo.md.
import {prateleiraAgudos, prateleiraGraves, sino, type Biquad} from '../musica-som';
import type {ContextoBloco, EstadoProcessador, Processador} from './tipos';

const BANDAS = ['graves_db', 'medios_db', 'agudos_db'] as const;
type Banda = (typeof BANDAS)[number];
const FILTROS: Record<Banda, (db: number, taxa: number) => Biquad> = {
  graves_db: (db, taxa) => prateleiraGraves(200, db, taxa),
  medios_db: (db, taxa) => sino(1000, 0.9, db, taxa),
  agudos_db: (db, taxa) => prateleiraAgudos(5000, db, taxa),
};

export class Eq3 implements Processador {
  readonly tipo = 'eq3';
  readonly entradas = [2];
  readonly saidas = [2];
  readonly latencia = 0;
  readonly parametros = BANDAS.map((nome) => ({nome, padrao: 0}));
  private taxa = 48000;
  private coef: (Biquad | undefined)[] = [undefined, undefined, undefined];
  private ganhoDe: number[] = [NaN, NaN, NaN]; // o valor com que o coeficiente foi calculado
  /** estado[banda][canal] = [x1, x2, y1, y2] */
  private est: number[][][] = BANDAS.map(() => [[0, 0, 0, 0], [0, 0, 0, 0]]);

  preparar(taxa: number, _bloco: number) {
    this.taxa = taxa;
    this.ganhoDe = [NaN, NaN, NaN];
  }

  processar(entradas: readonly (readonly Float32Array[])[], saidas: readonly Float32Array[][], n: number, ctx: ContextoBloco) {
    for (let c = 0; c < 2; c++) saidas[0][c].set(entradas[0][c].subarray(0, n));
    for (let b = 0; b < 3; b++) {
      const p = ctx.param(BANDAS[b]);
      // curva (automação da X-08): o coeficiente muda por bloco, com o valor do começo dele
      const db = typeof p === 'number' ? p : p[0];
      if (!db) continue; // banda em 0 dB: fora do caminho, como no motor antigo
      if (this.ganhoDe[b] !== db) {
        this.coef[b] = FILTROS[BANDAS[b]](db, this.taxa);
        this.ganhoDe[b] = db;
      }
      const f = this.coef[b]!;
      for (let c = 0; c < 2; c++) {
        const s = this.est[b][c], x = saidas[0][c];
        let x1 = s[0], x2 = s[1], y1 = s[2], y2 = s[3];
        for (let i = 0; i < n; i++) {
          const x0 = x[i];
          const y0 = f.b0 * x0 + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
          x2 = x1; x1 = x0; y2 = y1; y1 = y0;
          x[i] = y0;
        }
        s[0] = x1; s[1] = x2; s[2] = y1; s[3] = y2;
      }
    }
  }

  resetar() {
    for (const b of this.est) for (const c of b) c.fill(0);
  }
  estado(): EstadoProcessador {
    return {est: this.est.map((b) => b.map((c) => [...c]))};
  }
  restaurar(e: EstadoProcessador) {
    const est = e.est as number[][][] | undefined;
    if (est) est.forEach((b, i) => b.forEach((c, k) => this.est[i]?.[k]?.splice(0, 4, ...c)));
  }
}
