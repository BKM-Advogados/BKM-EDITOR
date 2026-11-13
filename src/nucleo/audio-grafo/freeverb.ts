// Freeverb nativo por bloco (retorno 1). Mesma conta de `reverberar` em musica-som.ts, amostra a amostra e na mesma
// ordem, para o PCM sair igual ao do motor antigo (o oráculo dos testes): a entrada mono vai a float32, os pentes somam
// num acumulador float32 na ordem dos tamanhos, o filtro de cada pente é `number` e as linhas são Float32Array.
// Ver docs/audio-grafo.md.
import type {ContextoBloco, EstadoProcessador, Processador} from './tipos';

const PENTES = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const PASSA_TUDO = [556, 441, 341, 225];
const ESPALHAR = 23;

/** Freeverb do retorno 1: entra estéreo, sai só o molhado (estéreo). */
export class Freeverb implements Processador {
  readonly tipo = 'freeverb';
  readonly entradas = [2];
  readonly saidas = [2];
  readonly latencia = 0;
  private realimentar = 0;
  private amort = 0;
  // por lado (0 = esquerdo, 1 = direito): linhas, índices e filtros dos pentes; linhas e índices dos passa-tudo
  private pentes: Float32Array[][] = [];
  private kPentes: number[][] = [];
  private filtros: number[][] = [];
  private passas: Float32Array[][] = [];
  private kPassas: number[][] = [];

  constructor(readonly tamanho: number, readonly amortecimento: number) {
    this.realimentar = 0.7 + 0.28 * tamanho;
    this.amort = amortecimento * 0.4;
  }

  preparar(taxa: number, _bloco: number) {
    const escala = taxa / 44100;
    const linhas = (tams: number[], desvio: number) => tams.map((p) => new Float32Array(Math.max(1, Math.round((p + desvio) * escala))));
    this.pentes = [0, ESPALHAR].map((d) => linhas(PENTES, d));
    this.passas = [0, ESPALHAR].map((d) => linhas(PASSA_TUDO, d));
    this.resetar();
  }

  resetar() {
    for (const lado of [...this.pentes, ...this.passas]) for (const l of lado) l.fill(0);
    this.kPentes = this.pentes.map((l) => l.map(() => 0));
    this.kPassas = this.passas.map((l) => l.map(() => 0));
    this.filtros = this.pentes.map((l) => l.map(() => 0));
  }

  processar(entradas: readonly (readonly Float32Array[])[], saidas: readonly Float32Array[][], n: number, _ctx: ContextoBloco) {
    const [L, R] = entradas[0];
    const {realimentar, amort} = this;
    const um = 1 - amort;
    for (let lado = 0; lado < 2; lado++) {
      const out = saidas[0][lado];
      const pentes = this.pentes[lado], kp = this.kPentes[lado], fil = this.filtros[lado];
      const passas = this.passas[lado], ka = this.kPassas[lado];
      for (let i = 0; i < n; i++) {
        const mono = Math.fround((L[i] + R[i]) * 0.015); // o ganho fixo do Freeverb
        let soma = 0;
        for (let c = 0; c < pentes.length; c++) {
          const buf = pentes[c];
          const k = kp[c];
          const y = buf[k];
          const filtro = y * um + fil[c] * amort;
          fil[c] = filtro;
          buf[k] = mono + filtro * realimentar;
          soma = Math.fround(soma + y);
          kp[c] = k + 1 >= buf.length ? 0 : k + 1;
        }
        let v = soma;
        for (let c = 0; c < passas.length; c++) {
          const buf = passas[c];
          const k = ka[c];
          const b = buf[k];
          const y = Math.fround(-v + b);
          buf[k] = v + b * 0.5;
          v = y;
          ka[c] = k + 1 >= buf.length ? 0 : k + 1;
        }
        out[i] = v;
      }
    }
  }

  estado(): EstadoProcessador {
    return {
      pentes: this.pentes.map((l) => l.map((b) => Array.from(b))),
      passas: this.passas.map((l) => l.map((b) => Array.from(b))),
      kPentes: this.kPentes.map((l) => [...l]),
      kPassas: this.kPassas.map((l) => [...l]),
      filtros: this.filtros.map((l) => [...l]),
    };
  }

  restaurar(e: EstadoProcessador) {
    const g = (k: string) => e[k] as number[][][] | number[][];
    (g('pentes') as number[][][]).forEach((l, i) => l.forEach((b, c) => this.pentes[i][c].set(b)));
    (g('passas') as number[][][]).forEach((l, i) => l.forEach((b, c) => this.passas[i][c].set(b)));
    this.kPentes = (g('kPentes') as number[][]).map((l) => [...l]);
    this.kPassas = (g('kPassas') as number[][]).map((l) => [...l]);
    this.filtros = (g('filtros') as number[][]).map((l) => [...l]);
  }
}
