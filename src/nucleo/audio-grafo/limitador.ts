// Limitador do master como processador por bloco, causal, com latência declarada (M-04; era o AdaptadorLimitador). O
// motor antigo (limitarNoLugar, musica-som.ts) olha 1,5 ms à frente: o ganho de cada amostra i depende do mínimo do
// "pedido" (teto/pico) em [i, i + la]. Aqui a amostra que entra no instante t só calcula o pedido; a que sai é a de
// t − la, que já tem a janela inteira. A latência é `la` amostras e o executor a compensa e descarta (PDC).
//
// O PCM sai igual ao do antigo:
// - O pedido é guardado em float32 (o antigo usa um Float32Array) e o mínimo da janela vem de uma fila monotônica.
// - Depois do fim da música (`fim`), o antigo completava a janela com o pedido que restava, o que é o mesmo que pedir 1;
//   aqui, toda amostra que entra em t ≥ fim pede 1, seja o que for que chegue (a cauda do reverb, por exemplo).
// - A soltura (r), a média móvel (soma em double, janela em float32) e o corte no teto são os mesmos, na mesma ordem. Sem
//   nenhum pico acima do teto, o ganho é 1 exato e a saída é a entrada, como o `if (!algum) return 0` do antigo.
// `reducao_db` é a maior redução de [0, fim), arredondada a 0,1 dB (o `limitador_db` do resultado).
// Ver docs/audio-grafo.md.
import {ganhoDeDb} from './processadores';
import type {ContextoBloco, EstadoProcessador, Processador} from './tipos';

export class Limitador implements Processador {
  readonly tipo = 'limitador';
  readonly entradas = [2];
  readonly saidas = [2];
  latencia = 0;
  private la = 1;
  private teto = 1;
  private so = 0;
  // a entrada atrasada (la + 1 por canal) e o pedido por amostra que entrou, com a fila monotônica do mínimo
  private linhaL = new Float32Array(2);
  private linhaR = new Float32Array(2);
  private pedido = new Float32Array(2);
  private fila = new Float64Array(2); // instantes (t) na fila, em anel
  private filaIni = 0;
  private filaTam = 0;
  // a soltura e a média móvel do ganho
  private r = 1;
  private soma = 2;
  private janela = new Float32Array(2);
  private w = 0;
  private menor = 1;
  /** `fim`: amostras da música (o que vem depois só esvazia a linha). */
  constructor(readonly teto_db: number, readonly soltura_ms: number, readonly fim: number) {}

  get reducao_db() {
    return this.menor < 1 ? Math.round(-20 * Math.log10(this.menor) * 10) / 10 : 0;
  }

  preparar(taxa: number, _bloco?: number) {
    this.la = Math.max(1, Math.round(0.0015 * taxa));
    this.latencia = this.la;
    this.teto = ganhoDeDb(this.teto_db);
    this.so = Math.exp(-1 / ((this.soltura_ms / 1000) * taxa));
    const tam = this.la + 1;
    this.linhaL = new Float32Array(tam);
    this.linhaR = new Float32Array(tam);
    this.pedido = new Float32Array(tam);
    this.fila = new Float64Array(tam + 1);
    this.janela = new Float32Array(tam);
    this.resetar();
  }

  resetar() {
    this.linhaL.fill(0);
    this.linhaR.fill(0);
    this.pedido.fill(1);
    this.filaIni = this.filaTam = 0;
    this.r = 1;
    this.soma = this.la + 1; // a janela da média começa cheia de 1 (antes do começo, nada a reduzir)
    this.janela.fill(1);
    this.w = 0;
    this.menor = 1;
  }

  processar(entradas: readonly (readonly Float32Array[])[], saidas: readonly Float32Array[][], n: number, ctx: ContextoBloco) {
    const [L, R] = entradas[0], [oL, oR] = saidas[0];
    const {la, teto, so, fim, linhaL, linhaR, pedido, fila, janela} = this;
    const tam = la + 1, cap = fila.length;
    let {filaIni, filaTam, r, soma, w, menor} = this;
    for (let k = 0; k < n; k++) {
      const t = ctx.inicio + k; // a amostra que entra
      const s = ((t % tam) + tam) % tam;
      const xl = L[k], xr = R[k];
      linhaL[s] = xl;
      linhaR[s] = xr;
      let pk = 0;
      if (t >= 0 && t < fim) {
        const al = Math.abs(xl), ar = Math.abs(xr);
        if (al > pk) pk = al;
        if (ar > pk) pk = ar;
      }
      pedido[s] = pk > teto ? teto / pk : 1;
      const p = pedido[s];
      // fila monotônica: tira do fim quem pede mais (ou igual) e do começo quem saiu da janela [t − la, t]
      while (filaTam > 0 && pedido[((fila[(filaIni + filaTam - 1) % cap] % tam) + tam) % tam] >= p) filaTam--;
      fila[(filaIni + filaTam) % cap] = t;
      filaTam++;
      while (fila[filaIni] < t - la) {
        filaIni = (filaIni + 1) % cap;
        filaTam--;
      }
      const i = t - la; // a amostra que sai
      if (i < 0) {
        oL[k] = 0;
        oR[k] = 0;
        continue;
      }
      const frente = pedido[((fila[filaIni] % tam) + tam) % tam];
      r = Math.min(frente, 1 - (1 - r) * so);
      soma += r - janela[w];
      janela[w] = r;
      if (++w > la) w = 0;
      const g = Math.min(1, soma / (la + 1));
      if (g < menor && i < fim) menor = g;
      const si = ((i % tam) + tam) % tam;
      const yl = linhaL[si] * g, yr = linhaR[si] * g;
      oL[k] = yl > teto ? teto : yl < -teto ? -teto : yl; // só o primeiro 1,5 ms e o arredondamento chegam aqui
      oR[k] = yr > teto ? teto : yr < -teto ? -teto : yr;
    }
    Object.assign(this, {filaIni, filaTam, r, soma, w, menor});
  }

  estado(): EstadoProcessador {
    return {linhaL: Array.from(this.linhaL), linhaR: Array.from(this.linhaR), pedido: Array.from(this.pedido), fila: Array.from(this.fila),
      filaIni: this.filaIni, filaTam: this.filaTam, r: this.r, soma: this.soma, janela: Array.from(this.janela), w: this.w, menor: this.menor};
  }

  restaurar(e: EstadoProcessador) {
    const lista = (k: string, dest: Float32Array | Float64Array) => {
      const v = e[k];
      if (Array.isArray(v)) dest.set((v as number[]).slice(0, dest.length));
    };
    lista('linhaL', this.linhaL);
    lista('linhaR', this.linhaR);
    lista('pedido', this.pedido);
    lista('fila', this.fila);
    lista('janela', this.janela);
    for (const k of ['filaIni', 'filaTam', 'r', 'soma', 'w', 'menor'] as const) if (typeof e[k] === 'number') (this as unknown as Record<string, unknown>)[k] = e[k];
  }
}
