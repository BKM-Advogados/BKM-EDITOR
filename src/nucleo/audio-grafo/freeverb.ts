// Freeverb do retorno 1 (Jezar at Dreampoint, domínio público) como processador por bloco (M-04; era o
// AdaptadorFreeverb): oito pentes com amortecimento e quatro passa-tudo por lado, o direito 23 amostras mais largo, os
// tamanhos do original a 44,1 kHz escalados para a taxa. Sai só o molhado.
//
// A conta é a de reverberar (musica-som.ts), que roda cada pente sobre a música inteira e soma num Float32Array. Aqui,
// amostra a amostra, os oito pentes somam na mesma ordem num acumulador float32 (Math.fround a cada soma, a partir de +0)
// e os passa-tudo vêm em seguida, na ordem: dá o mesmo PCM. As linhas são float32 e o filtro de cada pente é double.
// Ver docs/audio-grafo.md.
import type {ContextoBloco, EstadoProcessador, Processador} from './tipos';

const PENTES = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const PASSA_TUDO = [556, 441, 341, 225];
const ESPALHAR = 23;

type Lado = {pentes: Float32Array[]; kp: Int32Array; filtro: Float64Array; passa: Float32Array[]; ka: Int32Array};

export class Freeverb implements Processador {
  readonly tipo = 'freeverb';
  readonly entradas = [2];
  readonly saidas = [2];
  readonly latencia = 0;
  private lados: Lado[] = [];
  private realimentar: number;
  private amort: number;
  constructor(readonly tamanho: number, readonly amortecimento: number) {
    this.realimentar = 0.7 + 0.28 * tamanho;
    this.amort = amortecimento * 0.4;
  }
  preparar(taxa: number, _bloco?: number) {
    const escala = taxa / 44100;
    const tam = (p: number, desvio: number) => Math.max(1, Math.round((p + desvio) * escala));
    this.lados = [0, ESPALHAR].map((desvio) => ({
      pentes: PENTES.map((p) => new Float32Array(tam(p, desvio))),
      kp: new Int32Array(PENTES.length),
      filtro: new Float64Array(PENTES.length),
      passa: PASSA_TUDO.map((p) => new Float32Array(tam(p, desvio))),
      ka: new Int32Array(PASSA_TUDO.length),
    }));
  }
  processar(entradas: readonly (readonly Float32Array[])[], saidas: readonly Float32Array[][], n: number, _ctx?: ContextoBloco) {
    const [L, R] = entradas[0];
    const realimentar = this.realimentar, amort = this.amort, fround = Math.fround;
    for (let s = 0; s < 2; s++) {
      const {pentes, kp, filtro, passa, ka} = this.lados[s];
      const out = saidas[0][s];
      for (let i = 0; i < n; i++) {
        const mono = fround((L[i] + R[i]) * 0.015); // o ganho fixo do Freeverb (o motor antigo guarda em float32)
        let acc = 0;
        for (let p = 0; p < 8; p++) {
          const buf = pentes[p];
          let k = kp[p];
          const y = buf[k];
          const f = y * (1 - amort) + filtro[p] * amort;
          filtro[p] = f;
          buf[k] = mono + f * realimentar;
          acc = fround(acc + y);
          if (++k >= buf.length) k = 0;
          kp[p] = k;
        }
        for (let p = 0; p < 4; p++) {
          const buf = passa[p];
          let k = ka[p];
          const b = buf[k];
          const y = -acc + b;
          buf[k] = acc + b * 0.5;
          acc = fround(y);
          if (++k >= buf.length) k = 0;
          ka[p] = k;
        }
        out[i] = acc;
      }
    }
  }
  resetar() {
    for (const l of this.lados) {
      for (const b of l.pentes) b.fill(0);
      for (const b of l.passa) b.fill(0);
      l.kp.fill(0);
      l.ka.fill(0);
      l.filtro.fill(0);
    }
  }
  estado(): EstadoProcessador {
    return {lados: this.lados.map((l) => ({pentes: l.pentes.map((b) => Array.from(b)), kp: Array.from(l.kp), filtro: Array.from(l.filtro),
      passa: l.passa.map((b) => Array.from(b)), ka: Array.from(l.ka)}))};
  }
  restaurar(e: EstadoProcessador) {
    const lados = e.lados as {pentes: number[][]; kp: number[]; filtro: number[]; passa: number[][]; ka: number[]}[] | undefined;
    if (!lados) return;
    lados.forEach((x, s) => {
      const l = this.lados[s];
      if (!l) return;
      x.pentes.forEach((b, p) => l.pentes[p]?.set(b.slice(0, l.pentes[p].length)));
      x.passa.forEach((b, p) => l.passa[p]?.set(b.slice(0, l.passa[p].length)));
      l.kp.set(x.kp.slice(0, 8));
      l.ka.set(x.ka.slice(0, 4));
      l.filtro.set(x.filtro.slice(0, 8));
    });
  }
}
