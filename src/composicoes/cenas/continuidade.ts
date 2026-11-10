// Corte limpo da lâmina (video-D1): um bloco que atravessa o corte fica nas duas cenas, e a segunda metade continua a
// primeira em vez de recomeçar. O cenas-dividir.ts marca o bloco com `segue_ms` (na primeira cena: continua na seguinte por
// mais tanto) e `desde_ms` (na segunda: já estava na tela há tanto quando a cena começa). Aqui fica a conta do tempo de
// cada animação do bloco (entrada, contagem do número, Ken Burns, saída), pura, para a composição e o teste usarem igual.
import type {BlocoCenas} from '../../nucleo/cenas';

const ms = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

export type TempoDoBloco = {
  /** Instante (ms de saída) em que o bloco entrou de verdade: o `em` menos o que já estava na tela antes desta cena. */
  inicio: number;
  /** Duração do movimento (Ken Burns) do bloco inteiro, contando as duas metades. */
  total: number;
  /** O bloco continua na próxima cena: não some no fim desta. */
  segue: boolean;
};

/** `em` e `sai` são os do bloco já resolvido (ms de saída, absolutos). */
export const tempoDoBloco = (b: Pick<BlocoCenas, 'desde_ms' | 'segue_ms'> & {em: number; sai: number}): TempoDoBloco => {
  const desde = ms(b.desde_ms);
  const segue = ms(b.segue_ms);
  return {inicio: b.em - desde, total: Math.max(1, desde + (b.sai - b.em) + segue), segue: segue > 0};
};
