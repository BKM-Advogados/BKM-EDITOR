import {describe, expect, it} from 'vitest';
import {
  codificarCelulas, decodificarCelulas, gradeDeImagem, gradeVazia, misturarCor, ordemAleatoria, quantizar, revelar,
  type DadosImagem, type GradePixel,
} from '../src/nucleo/animacao-pixel';

const grade = (cores: string[], indices: number[], colunas = 2, linhas = 2): GradePixel => ({
  colunas, linhas, paleta: cores, celulas: codificarCelulas(indices),
});

describe('codificação das células', () => {
  it('faz ida e volta, com vazio', () => {
    const indices = [0, -1, 5, 61];
    expect(decodificarCelulas(codificarCelulas(indices))).toEqual(indices);
  });
  it('vazio vira "."', () => {
    expect(codificarCelulas([-1, 0])).toBe('.0');
  });
});

describe('conversão de imagem', () => {
  it('quantiza uma imagem de duas cores', () => {
    const dados = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 0, 255, 255, // vermelho, azul
      255, 0, 0, 255, 0, 0, 255, 255,
    ]);
    const img: DadosImagem = {largura: 2, altura: 2, dados};
    const g = gradeDeImagem(img, {colunas: 2, linhas: 2, cores: 2});
    expect(g.paleta).toHaveLength(2);
    expect(g.colunas).toBe(2);
    expect(g.linhas).toBe(2);
    expect(g.celulas).toHaveLength(4);
    const idx = decodificarCelulas(g.celulas);
    expect(idx[0]).toBe(idx[2]); // mesma coluna, mesma cor
    expect(idx[1]).toBe(idx[3]);
  });
  it('transparência vira vazio', () => {
    const dados = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 0, 0, 0,
      255, 0, 0, 255, 0, 0, 0, 0,
    ]);
    const g = gradeDeImagem({largura: 2, altura: 2, dados}, {colunas: 2, linhas: 2, cores: 2});
    const idx = decodificarCelulas(g.celulas);
    expect(idx[1]).toBe(-1);
  });
  it('quantiza para a paleta do kit de marca', () => {
    const dados = new Uint8ClampedArray([
      200, 129, 85, 255, 46, 51, 49, 255,
      200, 129, 85, 255, 46, 51, 49, 255,
    ]);
    const paleta = ['#C88155', '#2E3331'];
    const g = gradeDeImagem({largura: 2, altura: 2, dados}, {colunas: 2, linhas: 2, paleta});
    expect(g.paleta).toEqual(paleta);
  });
});

describe('determinismo', () => {
  it('mesma semente, mesmo quadro, mesma saída', () => {
    const g = grade(['#000000', '#C88155', '#2E3331', '#F4F0EA'], [0, 1, 2, 3, 0, 2, 1, 3, 0], 3, 3);
    const a = revelar(g, 'aleatorio', 42, 0.5);
    const b = revelar(g, 'aleatorio', 42, 0.5);
    expect(a).toEqual(b);
  });
  it('semente diferente embaralha diferente', () => {
    const a = ordemAleatoria(100, 1);
    const b = ordemAleatoria(100, 2);
    expect(a).not.toEqual(b);
  });
});

describe('efeitos de revelação', () => {
  const cores = ['#111111', '#C88155', '#F4F0EA'];
  const indices = [0, 1, 2, 0, 1, 2, 0, 1, 2]; // 3×3
  const g = () => grade(cores, indices, 3, 3);
  const efeitos = ['aleatorio', 'decodificar', 'varredura', 'varredura-baixo', 'meio', 'chuva'] as const;

  for (const efeito of efeitos) {
    it(`${efeito}: nada no começo, tudo no fim`, () => {
      const gr = g();
      const inicio = revelar(gr, efeito, 7, 0);
      expect(inicio.every((c) => c === null)).toBe(true);
      const fim = revelar(gr, efeito, 7, 1);
      expect(fim.every((c) => c !== null)).toBe(true);
    });
    it(`${efeito}: o meio revela pelo menos uma célula e não todas`, () => {
      const meio = revelar(g(), efeito, 7, 0.5);
      const reveladas = meio.filter((c) => c !== null).length;
      expect(reveladas).toBeGreaterThan(0);
      expect(reveladas).toBeLessThan(9);
    });
  }

  it('varredura vai da esquerda para a direita', () => {
    const gr = g();
    const meio = revelar(gr, 'varredura', 1, 0.2); // < 1/3 da largura, só a 1ª coluna
    // coluna 0 revelada (linhas 0,1,2), colunas 1 e 2 não
    expect(meio[0]).not.toBeNull();
    expect(meio[3]).not.toBeNull();
    expect(meio[6]).not.toBeNull();
    expect(meio[1]).toBeNull();
    expect(meio[4]).toBeNull();
  });

  it('decodificar assenta na cor final no fim', () => {
    const gr = g();
    const fim = revelar(gr, 'decodificar', 3, 1);
    expect(fim[0]).toBe(gr.paleta[0]);
    expect(fim[1]).toBe(gr.paleta[1]);
  });

  it('chuva preenche por coluna de cima para baixo', () => {
    const gr = g();
    const meio = revelar(gr, 'chuva', 5, 0.1);
    // com progresso pequeno, apenas o topo de algumas colunas
    const reveladas = meio.filter((c) => c !== null).length;
    expect(reveladas).toBeGreaterThan(0);
    expect(reveladas).toBeLessThan(9);
  });

  it('grade vazia é toda transparente', () => {
    const v = gradeVazia(4, 4);
    expect(decodificarCelulas(v.celulas).every((i) => i === -1)).toBe(true);
  });

  it('misturarCor nas pontas e no meio', () => {
    expect(misturarCor('#000000', '#FFFFFF', 0)).toBe('#000000');
    expect(misturarCor('#000000', '#FFFFFF', 1)).toBe('#FFFFFF');
    expect(misturarCor('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });
});

describe('C10: median-cut sem cores repetidas', () => {
  it('imagem de 2 cores pedida com 8 sai com paleta de 2', () => {
    const px = Array.from({length: 64}, (_, i) => (i % 2 ? {r: 255, g: 255, b: 255, a: 1} : {r: 0, g: 0, b: 0, a: 1}));
    expect(quantizar(px, 8).paleta).toHaveLength(2);
  });
  it('com proporção desigual (a mediana cai entre pixels iguais) também não repete', () => {
    const px = Array.from({length: 64}, (_, i) => (i === 0 ? {r: 0, g: 0, b: 0, a: 1} : {r: 255, g: 255, b: 255, a: 1}));
    const {paleta, indices} = quantizar(px, 8);
    expect(paleta).toEqual(['#000000', '#FFFFFF']);
    expect(indices.slice(0, 3)).toEqual([0, 1, 1]);
  });
  it('uma cor só dá paleta de 1', () => {
    expect(quantizar(Array.from({length: 9}, () => ({r: 10, g: 20, b: 30, a: 1})), 4).paleta).toEqual(['#0A141E']);
  });
});
