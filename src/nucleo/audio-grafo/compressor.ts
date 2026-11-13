// Compressor de alimentação direta da faixa como processador nativo por bloco (detector de pico ligado nos dois lados).
// A conta é a de `comprimir` de musica-som.ts: o envelope é um `number` (double) que atravessa os blocos, e a saída é
// `L[i] * g` arredondada para float32 uma vez. Sem lookahead: latência 0 e o PCM sai igual ao do motor antigo.
// Ver docs/audio-grafo.md.
import {ganhoDeDb} from './processadores';
import type {ContextoBloco, EstadoProcessador, Processador} from './tipos';

const escalar = (p: number | Float32Array) => (typeof p === 'number' ? p : p[0]);

export class Compressor implements Processador {
  readonly tipo = 'compressor';
  readonly entradas = [2];
  readonly saidas = [2];
  readonly latencia = 0;
  readonly parametros = [
    {nome: 'limiar_db', padrao: -18}, {nome: 'razao', padrao: 3}, {nome: 'ataque_ms', padrao: 10},
    {nome: 'soltura_ms', padrao: 120}, {nome: 'ganho_db', padrao: 0},
  ];
  private taxa = 48000;
  private env = 0;
  // constantes de tempo e do make-up, refeitas só quando o parâmetro muda (a automação da X-08 muda por bloco)
  private ataqueMs = NaN;
  private solturaMs = NaN;
  private ganhoDb = NaN;
  private at = 0;
  private so = 0;
  private makeup = 1;

  preparar(taxa: number, _bloco: number) {
    this.taxa = taxa;
    this.ataqueMs = this.solturaMs = this.ganhoDb = NaN;
  }

  processar(entradas: readonly (readonly Float32Array[])[], saidas: readonly Float32Array[][], n: number, ctx: ContextoBloco) {
    const limiar = escalar(ctx.param('limiar_db')), razao = escalar(ctx.param('razao'));
    const ataque = escalar(ctx.param('ataque_ms')), soltura = escalar(ctx.param('soltura_ms')), ganho = escalar(ctx.param('ganho_db'));
    if (ataque !== this.ataqueMs) {
      this.at = Math.exp(-1 / ((ataque / 1000) * this.taxa));
      this.ataqueMs = ataque;
    }
    if (soltura !== this.solturaMs) {
      this.so = Math.exp(-1 / ((soltura / 1000) * this.taxa));
      this.solturaMs = soltura;
    }
    if (ganho !== this.ganhoDb) {
      this.makeup = ganhoDeDb(ganho);
      this.ganhoDb = ganho;
    }
    const {at, so, makeup} = this;
    const [L, R] = entradas[0], [oL, oR] = saidas[0];
    let env = this.env;
    for (let i = 0; i < n; i++) {
      const x = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      env = x > env ? at * env + (1 - at) * x : so * env + (1 - so) * x;
      const nivel = env > 1e-6 ? 20 * Math.log10(env) : -120;
      const acima = nivel - limiar;
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
