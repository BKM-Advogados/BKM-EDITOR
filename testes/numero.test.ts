// Rodada 3, frente C: o número que conta mostra as casas decimais dos valores (video-D8): R$ 1.412,50 e 7,5% não saem
// arredondados, no vídeo de cenas e no carrossel da Cliente.
import {describe, expect, it} from 'vitest';
import {casasDe, casasDoNumero, formatarNumero} from '../src/composicoes/formatar-numero';

describe('número com decimais', () => {
  it('conta as casas dos valores', () => {
    expect([0, 280, 7.5, 2824.68, 0.125, 1e-7, NaN, -3.25].map(casasDe)).toEqual([0, 0, 1, 2, 3, 4, 0, 2]);
  });

  it('em dinheiro com centavos, sempre duas casas; em percentual, as que os valores têm', () => {
    expect(casasDoNumero({de: 0, ate: 1412.5, prefixo: 'R$'})).toBe(2);
    expect(formatarNumero(1412.5, casasDoNumero({de: 0, ate: 1412.5, prefixo: 'R$'}))).toBe('1.412,50');
    expect(formatarNumero(2824.68, casasDoNumero({de: 0, ate: 2824.68, sufixo: ' reais'}))).toBe('2.824,68');
    expect(formatarNumero(7.5, casasDoNumero({de: 0, ate: 7.5, sufixo: '%'}))).toBe('7,5');
    // inteiro continua inteiro, inclusive em dinheiro
    expect(formatarNumero(280, casasDoNumero({de: 0, ate: 280, prefixo: 'R$'}))).toBe('280');
    expect(formatarNumero(1000, casasDoNumero({de: 0, ate: 1000}))).toBe('1.000');
  });

  it('o campo casas manda, preso de 0 a 4; durante a contagem as casas não mudam', () => {
    expect(casasDoNumero({de: 0, ate: 7.5, casas: 0})).toBe(0);
    expect(casasDoNumero({de: 0, ate: 100, casas: 2})).toBe(2);
    expect(casasDoNumero({de: 0, ate: 100, casas: 9})).toBe(4);
    expect(casasDoNumero({de: 0, ate: 100, casas: -1})).toBe(0);
    const c = casasDoNumero({de: 0, ate: 1412.5, prefixo: 'R$'});
    expect([0, 0.33, 0.66, 1].map((p) => formatarNumero(1412.5 * p, c).split(',')[1].length)).toEqual([2, 2, 2, 2]);
  });
});
