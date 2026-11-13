// Processadores nativos do grafo (por bloco, sem alocar no `processar`): a fonte que toca um buffer pronto, a passagem
// (o ponto de soma de uma faixa ou do master), o ganho com automação e o volume com pan de uma faixa. As contas são as
// mesmas de musica-som.ts, operação por operação, para o PCM sair igual ao do motor antigo (o oráculo dos testes).
// Ver docs/audio-grafo.md.
import {fonteDeMemoria, type FonteAmostras} from './amostras';
import type {ContextoBloco, EstadoProcessador, Processador} from './tipos';

/** dB → ganho linear (a conta do motor inteiro: 10^(dB/20)). */
export const ganhoDeDb = (db: number) => Math.pow(10, db / 20);

// balanço de potência igual: no centro os dois lados ficam inteiros; todo de um lado, o outro cala (0 exato)
const ladoDoPan = (p: number) => (p >= 1 ? 0 : Math.cos((p * Math.PI) / 2));
/** Ganhos [esquerdo, direito] do pan de potência igual (−1 a 1). */
export const panLei = (p: number): [number, number] => [p > 0 ? ladoDoPan(p) : 1, p < 0 ? ladoDoPan(-p) : 1];

abstract class SemEstado {
  preparar(_taxa: number, _bloco: number) {}
  resetar() {}
  estado(): EstadoProcessador {
    return {};
  }
  restaurar(_e: EstadoProcessador) {}
}

/** Toca um som pronto (o som seco de um canal, uma saída guardada no cache): a amostra `ctx.inicio + i`, e silêncio fora
 *  dele. Sem entrada. Aceita buffers inteiros ou uma `FonteAmostras` lida por trecho (carga preguiçosa, cache em disco). */
export class Fonte extends SemEstado implements Processador {
  readonly tipo = 'fonte';
  readonly entradas: number[] = [];
  readonly saidas: number[];
  readonly latencia = 0;
  readonly fonte: FonteAmostras;
  constructor(som: readonly Float32Array[] | FonteAmostras) {
    super();
    this.fonte = Array.isArray(som) ? fonteDeMemoria(som as readonly Float32Array[]) : (som as FonteAmostras);
    this.saidas = [this.fonte.canais];
  }
  processar(_e: readonly (readonly Float32Array[])[], saidas: readonly Float32Array[][], n: number, ctx: ContextoBloco) {
    this.fonte.ler(ctx.inicio, n, saidas[0], 0);
  }
}

/** Passagem de `canais` canais: a saída é a entrada (que o executor já somou das ligações). É o ponto de soma de uma faixa
 *  (os canais que tocam nela) e do master. */
export class Passa extends SemEstado implements Processador {
  readonly tipo = 'passa';
  readonly entradas: number[];
  readonly saidas: number[];
  readonly latencia = 0;
  constructor(canais = 2) {
    super();
    this.entradas = [canais];
    this.saidas = [canais];
  }
  processar(entradas: readonly (readonly Float32Array[])[], saidas: readonly Float32Array[][], n: number) {
    for (let k = 0; k < saidas[0].length; k++) saidas[0][k].set(entradas[0][k].subarray(0, n));
  }
}

/** Multiplica todos os canais pelo parâmetro `ganho` (linear), amostra a amostra quando ele é uma curva: o ganho do
 *  sidechain, a automação de volume de uma faixa ou do master, o volume fixo do master. */
export class Ganho extends SemEstado implements Processador {
  readonly tipo = 'ganho';
  readonly entradas: number[];
  readonly saidas: number[];
  readonly latencia = 0;
  readonly parametros = [{nome: 'ganho', padrao: 1}];
  constructor(canais = 2) {
    super();
    this.entradas = [canais];
    this.saidas = [canais];
  }
  processar(entradas: readonly (readonly Float32Array[])[], saidas: readonly Float32Array[][], n: number, ctx: ContextoBloco) {
    const g = ctx.param('ganho');
    for (let k = 0; k < saidas[0].length; k++) {
      const x = entradas[0][k], y = saidas[0][k];
      if (typeof g === 'number') for (let i = 0; i < n; i++) y[i] = x[i] * g;
      else for (let i = 0; i < n; i++) y[i] = x[i] * g[i];
    }
  }
}

/** Volume (dB) e pan (−1 a 1) de uma faixa estéreo: `L·(g·gl)` e `R·(g·gr)`, como o fim de processarFaixa. */
export class VolumePan extends SemEstado implements Processador {
  readonly tipo = 'volume_pan';
  readonly entradas = [2];
  readonly saidas = [2];
  readonly latencia = 0;
  readonly parametros = [{nome: 'volume_db', padrao: 0}, {nome: 'pan', padrao: 0}];
  processar(entradas: readonly (readonly Float32Array[])[], saidas: readonly Float32Array[][], n: number, ctx: ContextoBloco) {
    const v = ctx.param('volume_db'), p = ctx.param('pan');
    const [L, R] = entradas[0], [oL, oR] = saidas[0];
    if (typeof v === 'number' && typeof p === 'number') {
      const g = ganhoDeDb(v);
      const [gl, gr] = panLei(p);
      for (let i = 0; i < n; i++) {
        oL[i] = L[i] * (g * gl);
        oR[i] = R[i] * (g * gr);
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      const g = ganhoDeDb(typeof v === 'number' ? v : v[i]);
      const [gl, gr] = panLei(typeof p === 'number' ? p : p[i]);
      oL[i] = L[i] * (g * gl);
      oR[i] = R[i] * (g * gr);
    }
  }
}

/** Linha de atraso de `d` amostras por canal (a compensação de latência numa ligação, PDC). Estado: as linhas. */
export class Atraso implements Processador {
  readonly tipo = 'atraso';
  readonly entradas: number[];
  readonly saidas: number[];
  readonly latencia: number;
  private linhas: Float32Array[];
  private k = 0;
  constructor(readonly amostras: number, canais = 2) {
    this.entradas = [canais];
    this.saidas = [canais];
    this.latencia = amostras;
    this.linhas = Array.from({length: canais}, () => new Float32Array(Math.max(1, amostras)));
  }
  preparar() {}
  processar(entradas: readonly (readonly Float32Array[])[], saidas: readonly Float32Array[][], n: number) {
    const d = this.amostras;
    if (d === 0) {
      for (let c = 0; c < saidas[0].length; c++) saidas[0][c].set(entradas[0][c].subarray(0, n));
      return;
    }
    let k = this.k;
    for (let c = 0; c < saidas[0].length; c++) {
      const x = entradas[0][c], y = saidas[0][c], linha = this.linhas[c];
      k = this.k;
      for (let i = 0; i < n; i++) {
        y[i] = linha[k];
        linha[k] = x[i];
        if (++k >= d) k = 0;
      }
    }
    this.k = k;
  }
  resetar() {
    for (const l of this.linhas) l.fill(0);
    this.k = 0;
  }
  estado(): EstadoProcessador {
    return {k: this.k, linhas: this.linhas.map((l) => Array.from(l))};
  }
  restaurar(e: EstadoProcessador) {
    this.k = Number(e.k) || 0;
    const linhas = e.linhas as number[][] | undefined;
    if (linhas) linhas.forEach((l, c) => this.linhas[c]?.set(l.slice(0, this.linhas[c].length)));
  }
}

/** O atraso manual de uma faixa ("track delay", M-07), em amostras. Positivo atrasa de verdade: uma linha de atraso sem
 *  latência declarada, que o PDC não desfaz. Negativo adianta: o sinal passa direto e o nó declara `−amostras` de
 *  latência, então o PDC atrasa todos os outros caminhos até o somador e, no fim, o executor descarta esse atraso da
 *  saída; o efeito é esta faixa soar `−amostras` antes (o que cairia antes do zero se perde). Com 0, é uma passagem. */
export class AtrasoFaixa implements Processador {
  readonly tipo = 'atraso_faixa';
  readonly entradas: number[];
  readonly saidas: number[];
  readonly latencia: number;
  private readonly linha: Atraso;
  constructor(readonly amostras: number, canais = 2) {
    if (!Number.isInteger(amostras)) throw new Error(`atraso_faixa: ${amostras} amostras não é inteiro`);
    this.entradas = [canais];
    this.saidas = [canais];
    this.latencia = Math.max(0, -amostras);
    this.linha = new Atraso(Math.max(0, amostras), canais);
  }
  preparar() {}
  processar(entradas: readonly (readonly Float32Array[])[], saidas: readonly Float32Array[][], n: number) {
    this.linha.processar(entradas, saidas, n);
  }
  resetar() {
    this.linha.resetar();
  }
  estado(): EstadoProcessador {
    return this.linha.estado();
  }
  restaurar(e: EstadoProcessador) {
    this.linha.restaurar(e);
  }
}
