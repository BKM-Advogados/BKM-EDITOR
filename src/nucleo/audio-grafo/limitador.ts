// Limitador do master como processador nativo por bloco, causal, com latência declarada de 1,5 ms (`la` amostras).
// O motor antigo (limitarNoLugar em musica-som.ts) olhava `la` amostras adiante lendo a música inteira; aqui a saída da
// amostra i sai quando a entrada i + la chega: o pedido de cada amostra entra numa fila monotônica (mínimo da janela
// [i, i + la]) e a entrada espera numa linha de `la` amostras. O executor compensa a latência (PDC) e roda `la` amostras
// de silêncio depois do fim, que pedem 1 e completam a janela da cauda como o motor antigo fazia. Mesmas contas, mesmo
// arredondamento (pedido, mínimo e janela em float32; soma, rampa e ganho em double). Ver docs/audio-grafo.md.
import {ganhoDeDb} from './processadores';
import type {ContextoBloco, EstadoProcessador, Processador} from './tipos';

export const LOOKAHEAD_LIMITADOR_S = 0.0015;
export const latenciaDoLimitador = (taxa: number) => Math.max(1, Math.round(LOOKAHEAD_LIMITADOR_S * taxa));

export class Limitador implements Processador {
  readonly tipo = 'limitador';
  readonly entradas = [2];
  readonly saidas = [2];
  latencia: number;
  readonly parametros = [{nome: 'teto_db', padrao: -1}, {nome: 'soltura_ms', padrao: 80}];
  private taxa: number;
  private la: number;
  private linha: Float32Array[] = []; // a entrada que espera, por canal (la amostras)
  private filaIdx = new Int32Array(0); // fila monotônica (anel): índice absoluto e valor do pedido
  private filaVal = new Float32Array(0);
  private ini = 0;
  private tam = 0;
  private janela = new Float32Array(0);
  private k = 0; // amostras que já entraram
  private r = 1;
  private soma = 0;
  private menor = 1;
  private tetoDb = NaN;
  private teto = 1;
  private solturaMs = NaN;
  private so = 0;

  constructor(taxa = 48000) {
    this.taxa = taxa;
    this.la = this.latencia = latenciaDoLimitador(taxa);
    this.alocar();
  }

  /** A maior redução do último render, em dB (0 quando nada passou): o `limitador_db` do resultado. */
  get reducao_db() {
    return this.menor < 1 ? Math.round(-20 * Math.log10(this.menor) * 10) / 10 : 0;
  }

  private alocar() {
    const la = this.la;
    this.linha = [new Float32Array(la), new Float32Array(la)];
    this.filaIdx = new Int32Array(la + 3);
    this.filaVal = new Float32Array(la + 3);
    this.janela = new Float32Array(la + 1);
    this.zerar();
  }
  private zerar() {
    for (const l of this.linha) l.fill(0);
    this.ini = this.tam = 0;
    this.janela.fill(1); // a janela da média começa cheia de 1 (antes do começo, nada a reduzir)
    this.k = 0;
    this.r = 1;
    this.soma = this.la + 1;
    this.menor = 1;
  }

  preparar(taxa: number, _bloco: number) {
    this.taxa = taxa;
    this.la = this.latencia = latenciaDoLimitador(taxa);
    this.tetoDb = this.solturaMs = NaN;
    this.alocar();
  }

  processar(entradas: readonly (readonly Float32Array[])[], saidas: readonly Float32Array[][], n: number, ctx: ContextoBloco) {
    const pt = ctx.param('teto_db'), ps = ctx.param('soltura_ms');
    const tetoDb = typeof pt === 'number' ? pt : pt[0], solturaMs = typeof ps === 'number' ? ps : ps[0];
    if (tetoDb !== this.tetoDb) {
      this.teto = ganhoDeDb(tetoDb);
      this.tetoDb = tetoDb;
    }
    if (solturaMs !== this.solturaMs) {
      this.so = Math.exp(-1 / ((solturaMs / 1000) * this.taxa));
      this.solturaMs = solturaMs;
    }
    const {teto, so, la} = this;
    const cap = la + 3, jan = la + 1;
    const [eL, eR] = entradas[0], [oL, oR] = saidas[0];
    const [lL, lR] = this.linha;
    const {filaIdx, filaVal, janela} = this;
    let {ini, tam, k, r, soma, menor} = this;
    let w = k >= la ? (k - la) % jan : 0; // posição na janela da média; só anda depois da latência
    let p = k % la; // posição na linha de espera
    for (let i = 0; i < n; i++, k++) {
      const xl = eL[i], xr = eR[i];
      // o pedido desta amostra
      const al = Math.abs(xl), ar = Math.abs(xr);
      let pk = 0;
      if (al > pk) pk = al;
      if (ar > pk) pk = ar;
      const pedido = Math.fround(pk > teto ? teto / pk : 1);
      // fila: mínimo do pedido em [k − la, k]
      while (tam > 0 && filaVal[(ini + tam - 1) % cap] >= pedido) tam--;
      const pos = (ini + tam) % cap;
      filaIdx[pos] = k;
      filaVal[pos] = pedido;
      tam++;
      while (filaIdx[ini] < k - la) {
        ini = (ini + 1) % cap;
        tam--;
      }
      // a amostra que sai é a de k − la (a da linha); antes disso ainda é a latência
      const yl = lL[p], yr = lR[p];
      lL[p] = xl;
      lR[p] = xr;
      if (++p >= la) p = 0;
      if (k < la) {
        oL[i] = 0;
        oR[i] = 0;
        continue;
      }
      r = Math.min(filaVal[ini], 1 - (1 - r) * so);
      soma += r - janela[w];
      janela[w] = r;
      if (++w > la) w = 0;
      const g = Math.min(1, soma / jan);
      if (g < menor) menor = g;
      const a = yl * g, b = yr * g;
      oL[i] = a > teto ? teto : a < -teto ? -teto : a; // só o primeiro 1,5 ms e o arredondamento chegam aqui
      oR[i] = b > teto ? teto : b < -teto ? -teto : b;
    }
    this.ini = ini; this.tam = tam; this.k = k; this.r = r; this.soma = soma; this.menor = menor;
  }

  resetar() {
    this.zerar();
  }
  estado(): EstadoProcessador {
    return {
      k: this.k, r: this.r, soma: this.soma, menor: this.menor, ini: this.ini, tam: this.tam,
      linha: this.linha.map((l) => Array.from(l)), filaIdx: Array.from(this.filaIdx), filaVal: Array.from(this.filaVal),
      janela: Array.from(this.janela),
    };
  }
  restaurar(e: EstadoProcessador) {
    this.k = Number(e.k) || 0;
    this.r = Number(e.r) || 1;
    this.soma = Number(e.soma) || this.la + 1;
    this.menor = Number(e.menor) || 1;
    this.ini = Number(e.ini) || 0;
    this.tam = Number(e.tam) || 0;
    const l = e.linha as number[][] | undefined;
    if (l) l.forEach((x, c) => this.linha[c]?.set(x.slice(0, this.la)));
    const fi = e.filaIdx as number[] | undefined, fv = e.filaVal as number[] | undefined, j = e.janela as number[] | undefined;
    if (fi) this.filaIdx.set(fi.slice(0, this.filaIdx.length));
    if (fv) this.filaVal.set(fv.slice(0, this.filaVal.length));
    if (j) this.janela.set(j.slice(0, this.janela.length));
  }
}
