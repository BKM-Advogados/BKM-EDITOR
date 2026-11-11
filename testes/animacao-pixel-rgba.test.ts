// R4 (auditoria de render): a camada de pixel desenha com ImageData (revelarRGBA) e guarda o preparo de cada grade num
// cache com teto. As fórmulas da revelação ficam num lugar só (limiarDaCelula), usado pelas duas versões.
import {describe, expect, it} from 'vitest';
import {CHARSET_CELULAS, preparosGuardados, revelar, revelarRGBA, type EfeitoPixel, type GradePixel} from '../src/nucleo/animacao-pixel';

const EFEITOS: (EfeitoPixel | undefined)[] = ['aleatorio', 'decodificar', 'varredura', 'varredura-baixo', 'meio', 'chuva', undefined];

const gradeAleatoria = (colunas: number, linhas: number, cores: number, semente: number): GradePixel => {
  let x = semente;
  const r = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const paleta = Array.from({length: cores}, () => `#${Math.floor(r() * 0xffffff).toString(16).padStart(6, '0')}`); // minúsculas de propósito
  let celulas = '';
  for (let i = 0; i < colunas * linhas; i++) celulas += r() < 0.15 ? '.' : CHARSET_CELULAS[Math.floor(r() * cores)];
  return {colunas, linhas, paleta, celulas};
};

/** Diferenças, célula a célula, entre a saída em texto (`a`) e a em RGBA (`b`). */
const diferencas = (a: (string | null)[], b: Uint8ClampedArray) => {
  let dif = 0;
  for (let i = 0; i < a.length; i++) {
    const cor = a[i];
    if (!cor) {
      if (b[i * 4 + 3] !== 0) dif++;
      continue;
    }
    const v = parseInt(cor.slice(1), 16);
    if (b[i * 4 + 3] !== 255 || b[i * 4] !== ((v >> 16) & 255) || b[i * 4 + 1] !== ((v >> 8) & 255) || b[i * 4 + 2] !== (v & 255)) dif++;
  }
  return dif;
};

const CASOS: [number, number, number][] = [[1, 1, 1], [2, 2, 2], [3, 3, 3], [5, 1, 4], [1, 7, 4], [16, 16, 8], [64, 40, 62], [33, 17, 16]];
const PROGRESSOS = [-0.2, 0, 0.001, 0.13, 0.5, 0.77, 0.999, 1, 1.3];

describe('R4: revelarRGBA = revelar, célula a célula', () => {
  it('grades de 1×1 a 64×40, 1 a 62 cores, várias sementes e progressos: 0 diferenças entre texto e RGBA', () => {
    let dif = 0;
    let casos = 0;
    for (const [c, l, k] of CASOS) {
      for (const sem of [1, 7, 42, 123456]) {
        const g = gradeAleatoria(c, l, k, sem + c * 31 + l);
        for (const ef of EFEITOS) for (const p of PROGRESSOS) {
          const b = revelarRGBA(g, ef, sem, p);
          expect(b.length).toBe(g.colunas * g.linhas * 4);
          dif += diferencas(revelar(g, ef, sem, p), b);
          casos++;
        }
      }
    }
    expect(casos).toBeGreaterThan(2000);
    expect(dif).toBe(0);
  });

  it('grade com células a menos ou a mais: o tamanho é colunas × linhas e não lança (ImageData exige)', () => {
    const curta: GradePixel = {colunas: 4, linhas: 3, paleta: ['#ff0000'], celulas: '00000'};
    const longa: GradePixel = {colunas: 2, linhas: 2, paleta: ['#ff0000'], celulas: '0000000'};
    const torta: GradePixel = {colunas: 3.7, linhas: 2, paleta: ['#ff0000'], celulas: '000000'};
    const semCelulas = {colunas: 2, linhas: 2} as unknown as GradePixel;
    expect(revelarRGBA(curta, 'aleatorio', 1, 1).length).toBe(48);
    expect(revelarRGBA(curta, 'chuva', 1, 0.5).length).toBe(48);
    expect(revelarRGBA(longa, 'meio', 1, 1).length).toBe(16);
    expect(revelarRGBA(torta, 'varredura', 1, 1).length).toBe(24);
    expect(revelarRGBA(semCelulas, 'decodificar', 1, 0.5).length).toBe(16);
  });

  it('várias camadas e sementes: o cache fica no teto e não vaza', () => {
    for (let k = 0; k < 100; k++) revelarRGBA(gradeAleatoria(128, 128, 8, k), 'decodificar', k, 0.5);
    const g = preparosGuardados();
    expect(g.quantos).toBeLessThanOrEqual(64);
    expect(g.celulas).toBeLessThanOrEqual(4_000_000);
    // grades enormes: saem pelo teto de células, mas a que está em uso fica
    const enorme: GradePixel = {colunas: 1500, linhas: 1000, paleta: ['#ff0000'], celulas: '0'.repeat(1_500_000)};
    for (let k = 0; k < 3; k++) revelarRGBA(enorme, 'aleatorio', k, 0.5);
    expect(preparosGuardados().celulas).toBeLessThanOrEqual(4_000_000);
    expect(preparosGuardados().quantos).toBeGreaterThanOrEqual(1);
  });

  it('a mesma grade editada (outras células, mesma chave) não usa o preparo velho', () => {
    const a: GradePixel = {colunas: 2, linhas: 1, paleta: ['#ff0000', '#00ff00'], celulas: '00'};
    const b: GradePixel = {...a, celulas: '11'};
    expect(revelarRGBA(a, 'aleatorio', 3, 1)[1]).toBe(0);
    expect(revelarRGBA(b, 'aleatorio', 3, 1)[1]).toBe(255);
  });

  it('desempenho: 190 mil células, aleatório, poucos ms por quadro depois do 1º', () => {
    const g = gradeAleatoria(520, 366, 16, 3);
    revelarRGBA(g, 'aleatorio', 3, 0.5);
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) revelarRGBA(g, 'aleatorio', 3, i / 10);
    expect((performance.now() - t0) / 10).toBeLessThan(15);
  });
});
