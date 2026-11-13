// Os contratos do grafo de áudio (M-01, ADR A2 de docs/musica-daw.md): o que é um processador por bloco, um adaptador de
// buffer inteiro e um parâmetro com automação amostra a amostra. Puro: nada de Node, de DOM nem de Web Audio, para rodar
// igual no worker da janela, no processo principal, no MCP por stdio e, na onda M5, dentro de um AudioWorklet.
// Ver docs/audio-grafo.md.

/** O que um processador guarda entre blocos, em JSON (números, textos, listas e objetos; nada de Float32Array). */
export type EstadoProcessador = Record<string, unknown>;

/** Um parâmetro que o processador lê a cada bloco. O nome é local ao processador ("ganho", "pan"); o endereço da M-02
 *  (`faixa:<id>/volume_db`) fica na ligação do nó, não aqui. */
export type ParametroProcessador = {nome: string; padrao: number};

/** O que o executor passa a cada bloco. */
export type ContextoBloco = {
  /** A amostra da música (tempo absoluto, já descontada a latência que chega a este nó) da primeira amostra do bloco. */
  inicio: number;
  taxa: number;
  /** O valor do parâmetro neste bloco: um número (constante no bloco) ou uma curva com um valor por amostra (só os
   *  primeiros `n` valem). A curva é emprestada: leia dentro do `processar`, não guarde. */
  param(nome: string): number | Float32Array;
};

/** Processador por bloco: o tijolo do grafo. Estado explícito, latência declarada, N portas de entrada e de saída
 *  (cada porta é uma lista de canais: estéreo = 2). Não aloca no `processar`. */
export interface Processador {
  /** Nome do tipo, para depurar e para o estado ("ganho", "volume_pan", "eq3"). */
  readonly tipo: string;
  readonly inteiro?: false;
  /** Canais de cada porta de entrada (a porta 1 de um compressor com sidechain, por exemplo). */
  readonly entradas: readonly number[];
  /** Canais de cada porta de saída (um instrumento com várias saídas para o mixer). */
  readonly saidas: readonly number[];
  readonly parametros?: readonly ParametroProcessador[];
  /** Quantas amostras a saída atrasa em relação à entrada (lookahead, FIR de fase linear). Lida depois do `preparar`:
   *  pode depender da taxa. O executor compensa (PDC) e descarta o atraso do fim da cadeia. */
  readonly latencia: number;
  /** Chamado antes do primeiro bloco: aloque aqui tudo que o `processar` vai usar. `bloco` é o maior `n` que virá. */
  preparar(taxa: number, bloco: number): void;
  /** Lê `entradas[porta][canal][0..n)` e escreve `saidas[porta][canal][0..n)`. As entradas são do executor (não mude);
   *  as saídas chegam com lixo do bloco anterior: escreva todas as `n` amostras de todos os canais. */
  processar(entradas: readonly (readonly Float32Array[])[], saidas: readonly Float32Array[][], n: number, ctx: ContextoBloco): void;
  /** Volta ao estado do começo (silêncio na memória: linhas de atraso zeradas, envelopes em repouso). */
  resetar(): void;
  estado(): EstadoProcessador;
  restaurar(e: EstadoProcessador): void;
}

/** Adaptador de buffer inteiro: envolve uma função de efeito que só sabe processar a música toda de uma vez (os efeitos
 *  de musica-som.ts). Só roda no render offline: o executor junta a entrada inteira, chama `processarTudo` e usa a saída
 *  como fonte para o resto do grafo. É o primeiro passo da migração; o alvo é virar `Processador` nativo (docs/audio-grafo.md). */
export interface ProcessadorInteiro {
  readonly tipo: string;
  readonly inteiro: true;
  readonly entradas: readonly number[];
  readonly saidas: readonly number[];
  /** Recebe as entradas inteiras (`n` amostras por canal, alinhadas no tempo da música; pode mudar no lugar) e devolve as
   *  saídas inteiras, com `n` amostras por canal (pode devolver as próprias entradas). */
  processarTudo(entradas: Float32Array[][], n: number, taxa: number): Float32Array[][];
  resetar(): void;
  estado(): EstadoProcessador;
  restaurar(e: EstadoProcessador): void;
}

export type QualquerProcessador = Processador | ProcessadorInteiro;

export const ehInteiro = (p: QualquerProcessador): p is ProcessadorInteiro => p.inteiro === true;

/** Curva de um parâmetro no tempo da música, já na unidade do processador: um valor por amostra (antes do começo vale o
 *  primeiro, depois do fim o último) ou uma função que preenche `out[0..n)` a partir da amostra `inicio`. */
export type CurvaParam = Float32Array | ((inicio: number, n: number, out: Float32Array) => void);

/** Como um parâmetro do nó é ligado: um valor fixo, um endereço da M-02 (a automação registrada no grafo para esse
 *  endereço manda), uma curva própria do nó (uma modulação interna, como o ganho do sidechain por notas) ou mais de um.
 *  Vale, nesta ordem: a automação do endereço, a curva, o valor, o padrão do processador. */
export type LigacaoParam = number | {endereco?: string; curva?: CurvaParam; valor?: number};
