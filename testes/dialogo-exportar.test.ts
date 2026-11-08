// Rodada 3, frente C: ajudantes do diálogo de exportar (video-D5 tamanho personalizado, video-D11 trecho nascendo inválido e
// video-D4 blocos que se sobrepõem num destino).
import {describe, expect, it} from 'vitest';
import {encostarTrecho, fecharMedidaPersonalizada, lerMedidaPersonalizada, LIMITE_PERSONALIZADO, sobreposicoes, trechoValido} from '../src/nucleo/exportacao';

describe('tamanho personalizado (video-D5)', () => {
  it('digitar 1920 passa por 1, 19 e 192 sem virar 16 nem 7680', () => {
    // o que a tela faz a cada tecla: guarda o texto e só passa o valor quando está na faixa
    const passos = ['1', '19', '192', '1920'].map((t) => lerMedidaPersonalizada(t));
    expect(passos.map((p) => p.texto)).toEqual(['1', '19', '192', '1920']);
    expect(passos.map((p) => p.valor)).toEqual([null, 19, 192, 1920]);
  });

  it('só dígitos, até quatro, sem zero à esquerda', () => {
    expect(lerMedidaPersonalizada('19a2,0 px')).toEqual({texto: '1920', valor: 1920});
    expect(lerMedidaPersonalizada('0016')).toEqual({texto: '16', valor: 16});
    expect(lerMedidaPersonalizada('123456').texto).toBe('1234');
    expect(lerMedidaPersonalizada('')).toEqual({texto: '', valor: null});
    expect(lerMedidaPersonalizada('15').valor).toBeNull(); // abaixo de 16
    expect(lerMedidaPersonalizada('7681').valor).toBeNull(); // acima de 7680
    expect(lerMedidaPersonalizada('7680').valor).toBe(LIMITE_PERSONALIZADO.max);
  });

  it('ao sair do campo prende à faixa; vazio volta ao valor de antes', () => {
    expect(fecharMedidaPersonalizada('9999', 1080)).toBe(7680);
    expect(fecharMedidaPersonalizada('3', 1080)).toBe(16);
    expect(fecharMedidaPersonalizada('1920', 1080)).toBe(1920);
    expect(fecharMedidaPersonalizada('', 1080)).toBe(1080);
    expect(fecharMedidaPersonalizada('abc', 1080)).toBe(1080);
  });
});

describe('trecho que nasce válido (video-D11)', () => {
  it('um vídeo de 47.383 ms mostra 47,4 s no "até" e o trecho todo continua válido', () => {
    const duracao = 47383;
    const bruto = {de_ms: 0, ate_ms: Math.round(47.4 * 1000)};
    expect(trechoValido(bruto, duracao)).toBe(false); // o defeito: passa 17 ms da duração
    expect(trechoValido(encostarTrecho(bruto, duracao), duracao)).toBe(true);
    expect(encostarTrecho(bruto, duracao)).toEqual({de_ms: 0, ate_ms: duracao});
  });

  it('só encosta nas pontas; um trecho de verdade no meio não muda', () => {
    expect(encostarTrecho({de_ms: 2000, ate_ms: 5000}, 47383)).toEqual({de_ms: 2000, ate_ms: 5000});
    expect(encostarTrecho({de_ms: 30, ate_ms: 47340}, 47383)).toEqual({de_ms: 0, ate_ms: 47383});
    expect(encostarTrecho({de_ms: 0, ate_ms: 47300}, 47383)).toEqual({de_ms: 0, ate_ms: 47300}); // 83 ms de diferença: é escolha
    expect(trechoValido(encostarTrecho({de_ms: 0, ate_ms: 50}, 47383), 47383)).toBe(false); // continua exigindo 0,1 s
  });
});

describe('blocos que se sobrepõem num destino (video-D4)', () => {
  const caixa = (id: string, x: number, y: number, largura: number, altura: number) => ({id, x, y, largura, altura});

  it('acha o par que se cobre e ignora o que só encosta', () => {
    const caixas = [caixa('título', 0.1, 0.1, 0.8, 0.2), caixa('lista', 0.1, 0.25, 0.8, 0.3), caixa('rodapé', 0.1, 0.55, 0.8, 0.1)];
    expect(sobreposicoes(caixas)).toEqual([['título', 'lista']]); // título acaba em 0,30 e a lista começa em 0,25
    expect(sobreposicoes([caixa('a', 0, 0, 0.5, 0.5), caixa('b', 0.5, 0, 0.5, 0.5)])).toEqual([]); // lado a lado
  });

  it('um pouco de folga não conta (menos de 8% da menor caixa) e o limite é ajustável', () => {
    const a = caixa('a', 0, 0, 1, 0.5);
    const b = caixa('b', 0, 0.48, 1, 0.5); // 0,02 de 0,5 = 4%
    expect(sobreposicoes([a, b])).toEqual([]);
    expect(sobreposicoes([a, b], 0.01)).toEqual([['a', 'b']]);
  });

  it('vários pares e caixa vazia', () => {
    const caixas = [caixa('a', 0, 0, 1, 0.4), caixa('b', 0, 0.2, 1, 0.4), caixa('c', 0, 0.3, 1, 0.4), caixa('v', 0.5, 0.5, 0, 0)];
    expect(sobreposicoes(caixas)).toEqual([['a', 'b'], ['a', 'c'], ['b', 'c']]);
  });
});
