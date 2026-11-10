// Rodada 3, frente C: contraste da marca d'água com o fundo (mínimo 3:1, medido num quadro).
import {describe, expect, it} from 'vitest';
import {
  avaliarContraste, CONTRASTE_MINIMO, luminancia, medirNaCaixa, placaParaMarca, quadrosParaMedir, razaoDeContraste, type RGB,
} from '../src/nucleo/contraste';

const cor = (c: RGB, n: number) => new Uint8Array(Array.from({length: n}, () => c).flat());

describe("contraste da marca d'água", () => {
  it('luminância e razão de contraste do WCAG', () => {
    expect(luminancia([0, 0, 0])).toBe(0);
    expect(luminancia([255, 255, 255])).toBeCloseTo(1, 5);
    expect(razaoDeContraste([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 3);
    expect(razaoDeContraste([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
    expect(razaoDeContraste([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 1); // #777 sobre branco: 4,48:1 (valor de referência)
    expect(razaoDeContraste([0, 0, 0], [255, 255, 255])).toBe(razaoDeContraste([255, 255, 255], [0, 0, 0]));
  });

  it('o pior quadro manda; sem medida da marca, não está ok', () => {
    const m = (quadro_ms: number, contraste: number | null) => ({quadro_ms, fundo: [10, 10, 10] as RGB, marca: contraste === null ? null : ([250, 250, 250] as RGB), contraste});
    const a = avaliarContraste([m(1000, 8), m(2000, 2.4), m(3000, 5)]);
    expect(a).toMatchObject({contraste: 2.4, ok: false, quadro_ms: 2000});
    expect(avaliarContraste([m(1000, 8), m(2000, 3), m(3000, 5)])).toMatchObject({contraste: 3, ok: true}); // 3:1 exato passa
    expect(avaliarContraste([m(1000, null)])).toMatchObject({contraste: null, ok: false, quadro_ms: null});
    expect(avaliarContraste([])).toMatchObject({ok: false});
    expect(CONTRASTE_MINIMO).toBe(3);
  });

  it('a placa que mais contrasta com a marca: escura para marca clara, clara para marca escura', () => {
    expect(placaParaMarca([250, 250, 250])).toBe('escura');
    expect(placaParaMarca([200, 129, 85])).toBe('escura'); // um cobre
    expect(placaParaMarca([20, 20, 20])).toBe('clara');
  });

  it('quadros: três pontos do trecho, ou um no meio de um trecho curtíssimo', () => {
    expect(quadrosParaMedir(10000)).toEqual([2500, 5000, 7500]);
    expect(quadrosParaMedir(10000, {de_ms: 2000, ate_ms: 6000})).toEqual([3000, 4000, 5000]);
    expect(quadrosParaMedir(10000, {de_ms: 2000, ate_ms: 2300})).toEqual([2150]);
  });

  it('mede o fundo da caixa inteira e a cor só nos pixels que a marca mudou', () => {
    const n = 100;
    const sem = cor([200, 200, 200], n); // fundo claro
    const com = cor([200, 200, 200], n);
    for (let i = 0; i < 20; i++) com.set([40, 40, 40], i * 3); // a marca é escura sobre o fundo claro
    const r = medirNaCaixa(sem, com);
    expect(r.fundo).toEqual([200, 200, 200]);
    expect(r.marca).toEqual([40, 40, 40]);
    expect(razaoDeContraste(r.fundo, r.marca!)).toBeGreaterThan(CONTRASTE_MINIMO);
    // logo claro sobre fundo claro: contraste baixo
    const clara = cor([200, 200, 200], n);
    for (let i = 0; i < 20; i++) clara.set([255, 255, 255], i * 3);
    const c = medirNaCaixa(sem, clara);
    expect(razaoDeContraste(c.fundo, c.marca!)).toBeLessThan(CONTRASTE_MINIMO);
    // marca que não apareceu: sem cor
    expect(medirNaCaixa(sem, sem).marca).toBeNull();
  });

  it('um logo quase da cor do fundo ainda é achado (diferença de poucos pontos): contraste perto de 1', () => {
    const n = 100;
    const sem = cor([244, 240, 234], n);
    const com = cor([244, 240, 234], n);
    for (let i = 0; i < 20; i++) com.set([236, 231, 222], i * 3); // o osso do logo, a 85% sobre um fundo osso
    const r = medirNaCaixa(sem, com);
    expect(r.marca).not.toBeNull();
    expect(razaoDeContraste(r.fundo, r.marca!)).toBeLessThan(1.2);
    expect(medirNaCaixa(sem, sem).marca).toBeNull(); // sem diferença nenhuma: a marca não apareceu
  });

  it('a sombra do texto não puxa a média: vale o lado em que a maioria dos pixels mudou', () => {
    const n = 100;
    const sem = cor([60, 60, 60], n);
    const com = cor([60, 60, 60], n);
    for (let i = 0; i < 30; i++) com.set([255, 255, 255], i * 3); // texto branco
    for (let i = 30; i < 36; i++) com.set([0, 0, 0], i * 3); // sombra, do outro lado do fundo
    const r = medirNaCaixa(sem, com);
    expect(r.marca).toEqual([255, 255, 255]);
  });
});
