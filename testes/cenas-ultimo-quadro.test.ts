// O último quadro do vídeo de cenas tem cena (auditoria de render, R6): o vídeo tem ceil(duração) quadros, e quando a
// duração termina antes do meio de um quadro a última cena acabava um quadro antes, que saía só com o fundo do tema.
import {describe, expect, it} from 'vitest';
import {quadrosDaCena} from '../src/composicoes/cenas/VideoCenas';

describe('R6 · o último quadro tem cena', () => {
  it('1010 ms a 30 qps (31 quadros): a última cena cobre o quadro 30; as outras não mudam', () => {
    const total = Math.ceil(1.01 * 30);
    const {de, dur} = quadrosDaCena({t_in: 0, t_out: 1010}, true, 30, total);
    expect(de + dur - 1).toBe(total - 1);
    expect(quadrosDaCena({t_in: 0, t_out: 1010}, false, 30, total)).toEqual({de: 0, dur: 30});
  });
  it('duração que já cai no quadro: nada muda', () => {
    expect(quadrosDaCena({t_in: 1000, t_out: 3000}, true, 30, 90)).toEqual({de: 30, dur: 60});
  });
  it('o corte entre duas cenas fica no mesmo quadro', () => {
    expect(quadrosDaCena({t_in: 0, t_out: 500}, false, 30, 31)).toEqual({de: 0, dur: 15});
    expect(quadrosDaCena({t_in: 500, t_out: 1010}, true, 30, 31)).toEqual({de: 15, dur: 16});
  });
});
