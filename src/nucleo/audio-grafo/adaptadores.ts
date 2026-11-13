// Adaptadores de buffer inteiro (primeiro passo da M-01): cada um envolve, sem mudar uma conta, a função de efeito que o
// motor antigo já usava em musica-som.ts (EQ de três bandas, compressor, Freeverb, delay e limitador). Assim o grafo dá
// o mesmo PCM do motor antigo desde o primeiro dia; a conversão de cada um em Processador nativo por bloco é o passo
// seguinte (docs/audio-grafo.md, "Converter um efeito"), conferida pelo oráculo (testes/audio-grafo-oraculo.test.ts).
import type {FaixaMixerP} from '../musica';
import {atrasar, comprimir, filtrarNoLugar, limitarNoLugar, prateleiraAgudos, prateleiraGraves, reverberar, sino} from '../musica-som';
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

/** EQ de três bandas da faixa (prateleira de graves em 200 Hz, sino em 1 kHz, prateleira de agudos em 5 kHz). */
export class AdaptadorEq3 extends AdaptadorEstereo implements ProcessadorInteiro {
  readonly tipo = 'eq3';
  constructor(readonly eq: FaixaMixerP['eq']) {
    super();
  }
  processarTudo(entradas: Float32Array[][], _n: number, taxa: number) {
    const {graves_db, medios_db, agudos_db} = this.eq;
    for (const x of entradas[0]) {
      if (graves_db) filtrarNoLugar(x, prateleiraGraves(200, graves_db, taxa));
      if (medios_db) filtrarNoLugar(x, sino(1000, 0.9, medios_db, taxa));
      if (agudos_db) filtrarNoLugar(x, prateleiraAgudos(5000, agudos_db, taxa));
    }
    return entradas;
  }
}

/** Compressor de alimentação direta da faixa (detector de pico ligado nos dois lados). */
export class AdaptadorCompressor extends AdaptadorEstereo implements ProcessadorInteiro {
  readonly tipo = 'compressor';
  constructor(readonly c: FaixaMixerP['compressor']) {
    super();
  }
  processarTudo(entradas: Float32Array[][], _n: number, taxa: number) {
    comprimir(entradas[0], this.c, taxa);
    return entradas;
  }
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

/** Limitador do master. O estado guarda a maior redução do último render (`reducao_db`, o `limitador_db` do resultado). */
export class AdaptadorLimitador extends AdaptadorEstereo implements ProcessadorInteiro {
  readonly tipo = 'limitador';
  reducao_db = 0;
  constructor(readonly teto_db: number, readonly soltura_ms: number) {
    super();
  }
  processarTudo(entradas: Float32Array[][], _n: number, taxa: number) {
    this.reducao_db = limitarNoLugar(entradas[0], this.teto_db, this.soltura_ms, taxa);
    return entradas;
  }
  resetar() {
    this.reducao_db = 0;
  }
  estado(): EstadoProcessador {
    return {reducao_db: this.reducao_db};
  }
  restaurar(e: EstadoProcessador) {
    this.reducao_db = Number(e.reducao_db) || 0;
  }
}
