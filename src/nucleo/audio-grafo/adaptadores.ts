// Adaptadores de buffer inteiro (primeiro passo da M-01): cada um envolve, sem mudar uma conta, a função de efeito que o
// motor antigo já usava em musica-som.ts (Freeverb e delay; o EQ, o compressor e o limitador já são nativos: eq3.ts, compressor.ts, limitador.ts). Assim o grafo dá
// o mesmo PCM do motor antigo desde o primeiro dia; a conversão de cada um em Processador nativo por bloco é o passo
// seguinte (docs/audio-grafo.md, "Converter um efeito"), conferida pelo oráculo (testes/audio-grafo-oraculo.test.ts).
import {atrasar, reverberar} from '../musica-som';
import type {EstadoProcessador, ProcessadorInteiro} from './tipos';

abstract class AdaptadorEstereo {
  readonly inteiro = true as const;
  readonly entradas = [2];
  readonly saidas = [2];
  resetar() {}
  estado(): EstadoProcessador {
    return {};
  }
  restaurar(_e: EstadoProcessador) {}
}

/** Freeverb do retorno 1 (sai só o molhado). */
export class AdaptadorFreeverb extends AdaptadorEstereo implements ProcessadorInteiro {
  readonly tipo = 'freeverb';
  constructor(readonly tamanho: number, readonly amortecimento: number) {
    super();
  }
  processarTudo(entradas: Float32Array[][], _n: number, taxa: number) {
    return [reverberar(entradas[0], this.tamanho, this.amortecimento, taxa)];
  }
}

/** Delay do retorno 2, preso ao BPM (sai só o molhado). */
export class AdaptadorDelay extends AdaptadorEstereo implements ProcessadorInteiro {
  readonly tipo = 'delay';
  constructor(readonly atraso_s: number, readonly realimentacao: number, readonly brilho: number, readonly pingue: boolean) {
    super();
  }
  processarTudo(entradas: Float32Array[][], _n: number, taxa: number) {
    return [atrasar(entradas[0], this.atraso_s, this.realimentacao, this.brilho, this.pingue, taxa)];
  }
}
