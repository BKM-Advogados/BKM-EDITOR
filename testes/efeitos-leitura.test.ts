// Rodada 3, frente C: a pilha de efeitos é lida com validação (tres-efeitos-D1 e D2). Um valor com o tipo errado ou fora da
// faixa, escrito à mão ou pela IA, não derruba a tela nem apaga os outros filtros.
import {describe, expect, it} from 'vitest';
import {camadas, efeitosValidos, filtroCss, lerEfeitos, novoEfeito, problemasDosEfeitos} from '../src/nucleo/efeitos';

describe('pilha de efeitos lida com validação', () => {
  it('um tipo que não existe fica avisado e não desenha, sem tirar o lugar dele na lista (D1)', () => {
    const l = lerEfeitos([{id: 'a', tipo: 'brilho', valor: 1.2}, {id: 'b', tipo: 'nitidez', valor: 1}, null, {id: 'c', tipo: 'sepia', valor: 0.5}]);
    expect(l.map((x) => x.efeito?.id ?? null)).toEqual(['a', null, null, 'c']); // posições do documento mantidas
    expect(l[1].problema).toMatch(/b: tipo "nitidez" não existe/);
    expect(l[2].problema).toMatch(/não é um objeto/);
    expect(efeitosValidos([{id: 'b', tipo: 'nitidez', valor: 1}, {id: 'a', tipo: 'brilho', valor: 1.2}]).map((e) => e.id)).toEqual(['a']);
    expect(lerEfeitos(undefined)).toEqual([]);
    expect(lerEfeitos('brilho')).toEqual([]);
  });

  it('valor em texto vira número; fora da faixa, a faixa; sem valor, o padrão do tipo (D1, D2)', () => {
    const [a, b, c, d] = lerEfeitos([
      {id: 'a', tipo: 'brilho', valor: '1.2'}, {id: 'b', tipo: 'brilho', valor: -0.5}, {id: 'c', tipo: 'desfoque'}, {id: 'd', tipo: 'matiz', valor: 'muito'},
    ]);
    expect(a.efeito?.valor).toBe(1.2);
    expect(a.problema).toMatch(/valor em texto/);
    expect(b.efeito?.valor).toBe(0); // brilho vai de 0 a 2
    expect(b.problema).toMatch(/fora de 0 a 2/);
    expect(c.efeito?.valor).toBe(4); // padrão do desfoque
    expect(d.efeito?.valor).toBe(15); // padrão do matiz
    expect(problemasDosEfeitos([{id: 'x', tipo: 'brilho', valor: 1}])).toEqual([]);
  });

  it('um valor inválido não apaga os outros filtros da pilha (D2)', () => {
    const pilha = [{id: 'a', tipo: 'contraste', valor: 1.2}, {id: 'b', tipo: 'brilho', valor: -0.5}, {id: 'c', tipo: 'saturacao'}, {id: 'd', tipo: 'sepia', valor: 0.3}];
    const f = filtroCss(pilha);
    expect(f).toBe('contrast(1.2) brightness(0) saturate(1.2) sepia(0.3)');
    expect(f).not.toMatch(/-|undefined|NaN/); // o navegador descartaria a cadeia inteira com qualquer um destes
    // desligado não entra; camada (vinheta, granulado e tom) não vira filtro e só vale ligada
    expect(filtroCss([{id: 'a', tipo: 'brilho', valor: 1.5, ativo: false}, {id: 'b', tipo: 'vinheta', valor: 0.5}])).toBe('');
    expect(camadas([{id: 'a', tipo: 'vinheta', valor: 7}, {id: 'b', tipo: 'tom', valor: 0.2, cor: 'não é cor'}, {id: 'c', tipo: 'tom', valor: 0.2, ativo: false}]))
      .toEqual([{id: 'a', tipo: 'vinheta', valor: 1}, {id: 'b', tipo: 'tom', valor: 0.2, cor: '#C88155'}]);
    expect(filtroCss()).toBe('');
    expect(filtroCss('brilho')).toBe('');
  });

  it('a pilha válida sai igual à de antes (nada muda para o que já funcionava)', () => {
    const pilha = [novoEfeito('desfoque'), novoEfeito('brilho'), novoEfeito('tom'), {...novoEfeito('saturacao'), ativo: false}];
    const lidos = efeitosValidos(pilha);
    expect(lidos.map((e) => e.valor)).toEqual(pilha.map((e) => e.valor));
    expect(lerEfeitos(pilha).every((l) => !l.problema)).toBe(true);
    expect(filtroCss(pilha)).toBe('blur(4px) brightness(1.1)');
  });
});
