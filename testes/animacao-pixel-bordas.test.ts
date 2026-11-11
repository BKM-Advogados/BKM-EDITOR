// C4 (auditoria de conteúdo): as bordas da revelação. No "meio" o 2×2 só aparecia em p=1, o 1×1 dava NaN e os cantos
// saltavam no último quadro; na varredura a 1ª coluna aparecia em p=0⁺ e a frente parava antes do fim. Agora uma regra só
// (limiarDaCelula): a célula entra em (posição + 0,5) / (alcance + 1).
import {describe, expect, it} from 'vitest';
import {limiarDaCelula, ordemAleatoria, revelar, revelarRGBA, type EfeitoPixel, type GradePixel} from '../src/nucleo/animacao-pixel';
import {modeloAnimacaoLogoPixel} from '../src/nucleo/animacao';

type Ef = 'aleatorio' | 'varredura' | 'varredura-baixo' | 'meio';
const EFEITOS: Ef[] = ['aleatorio', 'varredura', 'varredura-baixo', 'meio'];
const TAMANHOS: [number, number][] = [];
for (let c = 1; c <= 9; c++) for (let l = 1; l <= 9; l++) TAMANHOS.push([c, l]);
TAMANHOS.push([1, 40], [40, 1], [64, 64], [128, 72]);

const cheia = (colunas: number, linhas: number): GradePixel => ({colunas, linhas, paleta: ['#FF0000'], celulas: '0'.repeat(colunas * linhas)});
const vis = (a: (string | null)[]) => a.filter(Boolean).length;
const limiares = (colunas: number, linhas: number, efeito: EfeitoPixel, semente = 1) => {
  const n = colunas * linhas;
  const ordem = ordemAleatoria(n, semente);
  return Array.from({length: n}, (_, i) => limiarDaCelula(efeito, i, i % colunas, Math.floor(i / colunas), colunas, linhas, ordem, n));
};

describe('C4: propriedades em todas as grades de 1×1 a 9×9 (e 1×40, 40×1, 64², 128×72)', () => {
  it('sem NaN, limiar estritamente dentro de (0, 1)', () => {
    let ruins = 0;
    for (const [c, l] of TAMANHOS) for (const e of [...EFEITOS, 'decodificar' as const]) {
      for (const x of limiares(c, l, e)) if (!(Number.isFinite(x) && x > 0 && x < 1)) ruins++;
    }
    expect(ruins).toBe(0);
  });

  it('nada em p=0, tudo em p=1 e a grade já cheia no último limiar (sem salto no último quadro)', () => {
    for (const [c, l] of TAMANHOS) for (const e of EFEITOS) {
      const g = cheia(c, l);
      expect(vis(revelar(g, e, 3, 0))).toBe(0);
      expect(vis(revelar(g, e, 3, 1))).toBe(c * l);
      const ultimo = Math.max(...limiares(c, l, e, 3));
      expect(vis(revelar(g, e, 3, ultimo))).toBe(c * l);
    }
  });

  it('monotônico: o que entrou em p não sai em p′ > p (passo de 1/240)', () => {
    let saidas = 0;
    for (const [c, l] of TAMANHOS.slice(0, 81)) for (const e of EFEITOS) {
      const g = cheia(c, l);
      let antes = revelar(g, e, 5, 0);
      for (let k = 1; k <= 240; k++) {
        const agora = revelar(g, e, 5, k / 240);
        for (let i = 0; i < antes.length; i++) if (antes[i] && !agora[i]) saidas++;
        antes = agora;
      }
    }
    expect(saidas).toBe(0);
  });

  it('varredura e aleatório: a fração revelada fica a até meia célula de p', () => {
    for (const [c, l] of TAMANHOS) for (const e of ['aleatorio', 'varredura', 'varredura-baixo'] as Ef[]) {
      const passos = e === 'aleatorio' ? c * l : e === 'varredura' ? c : l;
      for (let k = 1; k < 100; k++) {
        const p = k / 100;
        const frac = vis(revelar(cheia(c, l), e, 9, p)) / (c * l);
        expect(Math.abs(frac - p)).toBeLessThanOrEqual(0.5 / passos + 1e-9);
      }
    }
  });

  it('meio: a frente anda em velocidade constante (limiar linear na distância ao centro)', () => {
    for (const [c, l] of TAMANHOS) {
      const lim = limiares(c, l, 'meio');
      const cx = (c - 1) / 2;
      const cy = (l - 1) / 2;
      const pares = lim.map((t, i) => [Math.hypot((i % c) - cx, Math.floor(i / c) - cy), t] as const).sort((a, b) => a[0] - b[0]);
      const [d0, t0] = pares[0];
      const passo = 1 / (Math.hypot(cx, cy) - Math.hypot(c % 2 ? 0 : 0.5, l % 2 ? 0 : 0.5) + 1);
      let fora = 0;
      for (const [d, t] of pares) if (d - d0 > 1e-9 && Math.abs((t - t0) / (d - d0) - passo) > 1e-9) fora++;
      expect(fora).toBe(0);
    }
  });

  it('casos da auditoria: 1×1 e 2×2 entram em p=0,5; 4×4 começa em ~0,21; 4 colunas: 1ª em 0,125, última em 0,875', () => {
    expect(vis(revelar(cheia(1, 1), 'meio', 1, 0.49))).toBe(0);
    expect(vis(revelar(cheia(1, 1), 'meio', 1, 0.5))).toBe(1);
    expect(vis(revelar(cheia(2, 2), 'meio', 1, 0.5))).toBe(4);
    expect(vis(revelar(cheia(4, 4), 'meio', 1, 0.2))).toBe(0);
    expect(vis(revelar(cheia(4, 4), 'meio', 1, 0.21))).toBe(4);
    expect(vis(revelar(cheia(4, 4), 'meio', 1, 0.8))).toBe(16);
    expect(vis(revelar(cheia(6, 6), 'meio', 1, 0.999))).toBe(36); // os cantos entram antes do fim
    expect(vis(revelar(cheia(4, 1), 'varredura', 1, 0.12))).toBe(0);
    expect(vis(revelar(cheia(4, 1), 'varredura', 1, 0.125))).toBe(1);
    expect(vis(revelar(cheia(4, 1), 'varredura', 1, 0.75))).toBe(3);
    expect(vis(revelar(cheia(4, 1), 'varredura', 1, 0.875))).toBe(4);
    expect(vis(revelar(cheia(1, 4), 'varredura-baixo', 1, 0.01))).toBe(0);
  });

  it('decodificar: toda célula já assentou na cor final antes do último quadro', () => {
    const g: GradePixel = {colunas: 8, linhas: 8, paleta: ['#000000', '#FFFFFF'], celulas: '01'.repeat(32)};
    expect(revelar(g, 'decodificar', 3, 0.999)).toEqual(revelar(g, 'decodificar', 3, 1));
    expect(vis(revelar(g, 'decodificar', 3, 0.001))).toBe(0);
  });
});

describe('C4: compatibilidade', () => {
  it('p=0, p=1 e p>1 (curva mola) não mudam: o modelo do app sai com as cores finais', () => {
    const g = modeloAnimacaoLogoPixel().camadas[0].grade!;
    const finais = revelar(g, undefined, 42, 1);
    for (const e of [...EFEITOS, 'decodificar' as const, 'chuva' as const]) {
      expect(revelar(g, e, 42, 1)).toEqual(finais);
      expect(revelar(g, e, 42, 1.3)).toEqual(finais);
      expect(vis(revelar(g, e, 42, 0))).toBe(0);
    }
  });

  it('revelar e revelarRGBA seguem iguais com as fórmulas novas', () => {
    const g = modeloAnimacaoLogoPixel().camadas[0].grade!;
    for (const e of [...EFEITOS, 'decodificar' as const, 'chuva' as const]) for (let k = 0; k <= 20; k++) {
      const p = k / 20;
      const a = revelar(g, e, 42, p);
      const b = revelarRGBA(g, e, 42, p);
      const dif = a.filter((cor, i) => b[i * 4 + 3] !== (cor ? 255 : 0)
        || (cor && b[i * 4] * 65536 + b[i * 4 + 1] * 256 + b[i * 4 + 2] !== parseInt(cor.slice(1), 16))).length;
      expect(dif).toBe(0);
    }
  });
});
