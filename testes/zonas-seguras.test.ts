// Zonas seguras das redes: tudo em frações dentro do quadro e com miolo livre (grupo 5 da Ordem sugerida, 06/11/2026).
import {describe, expect, it} from 'vitest';
import {conjuntoDe, ZONAS_SEGURAS, zonaSugerida} from '../src/nucleo/zonas-seguras';

const EPS = 1e-9;

describe('zonas seguras', () => {
  it('toda zona cabe no quadro e tem rótulo e fonte', () => {
    expect(ZONAS_SEGURAS.map((c) => c.id)).toEqual(['vertical', 'feed', 'youtube']);
    for (const c of ZONAS_SEGURAS) {
      expect(c.zonas.length).toBeGreaterThan(0);
      for (const z of c.zonas) {
        expect(z.x).toBeGreaterThanOrEqual(0);
        expect(z.y).toBeGreaterThanOrEqual(0);
        expect(z.largura).toBeGreaterThan(0);
        expect(z.altura).toBeGreaterThan(0);
        expect(z.x + z.largura).toBeLessThanOrEqual(1 + EPS);
        expect(z.y + z.altura).toBeLessThanOrEqual(1 + EPS);
        expect(z.rotulo.length).toBeGreaterThan(0);
        expect(z.fonte.length).toBeGreaterThan(0);
      }
    }
  });

  it('no vertical, as faixas de cima e de baixo somam menos que o quadro e a coluna de ícones fica entre elas', () => {
    const v = conjuntoDe('vertical')!;
    const cobertas = v.zonas.filter((z) => z.tipo === 'coberta');
    const cima = cobertas.find((z) => z.y === 0 && z.largura === 1)!;
    const baixo = cobertas.find((z) => z.y + z.altura > 1 - EPS && z.largura === 1)!;
    const coluna = cobertas.find((z) => z.x + z.largura > 1 - EPS && z.largura < 1)!;
    expect(cima.altura + baixo.altura).toBeLessThan(0.5);
    expect(coluna.y).toBeGreaterThanOrEqual(cima.altura);
    expect(coluna.y + coluna.altura).toBeLessThanOrEqual(baixo.y + EPS);
    expect(coluna.largura).toBeLessThan(0.2);
    // o que a interface cobre não passa da metade do quadro
    const area = cobertas.reduce((s, z) => s + z.largura * z.altura, 0);
    expect(area).toBeLessThan(0.5);
  });

  it('os cortes da grade são centrados: 3:4 do 9:16 e do 4:5, 1:1 do 4:5', () => {
    const v = conjuntoDe('vertical')!.zonas.find((z) => z.tipo === 'contorno')!;
    expect(v.y).toBeCloseTo((1 - v.altura) / 2, 9);
    expect((v.altura * 1920) / (v.largura * 1080)).toBeCloseTo(4 / 3, 6);
    const feed = conjuntoDe('feed')!.zonas;
    const quadrado = feed.find((z) => z.rotulo.includes('1:1'))!;
    expect(quadrado.y).toBeCloseTo((1 - quadrado.altura) / 2, 9);
    expect((quadrado.altura * 1350) / (quadrado.largura * 1080)).toBeCloseTo(1, 6);
    const tresQuatro = feed.find((z) => z.rotulo.includes('3:4'))!;
    expect(tresQuatro.x).toBeCloseTo((1 - tresQuatro.largura) / 2, 9);
    expect((tresQuatro.altura * 1350) / (tresQuatro.largura * 1080)).toBeCloseTo(4 / 3, 6);
  });

  it('sugere o conjunto pelo quadro', () => {
    expect(zonaSugerida(1080, 1920)).toBe('vertical');
    expect(zonaSugerida(1080, 1350)).toBe('feed');
    expect(zonaSugerida(1080, 1080)).toBe('feed');
    expect(zonaSugerida(1920, 1080)).toBe('youtube');
    expect(conjuntoDe(null)).toBeUndefined();
    expect(conjuntoDe('youtube')?.proporcao).toBe('16:9');
  });
});

describe('legenda do carrossel narrado (video-D17)', () => {
  it('acaba acima da faixa que a rede cobre embaixo no 9:16, com respiro', async () => {
    const {baseDaLegendaCarrossel} = await import('../src/nucleo/zonas-seguras');
    const faixa = conjuntoDe('vertical')!.zonas.find((z) => z.tipo === 'coberta' && z.largura >= 0.99 && z.y > 0.5)!;
    const base = baseDaLegendaCarrossel();
    expect(base).toBeLessThanOrEqual(Math.round(faixa.y * 1920) - 16);
    expect(base).toBe(1420); // 1920 − 484 = 1436, menos 16 px de respiro
    // duas linhas de 64 px com entrelinha de 1,12 cabem entre o fim da área dos blocos (~1270) e a base
    expect(base - 2 * 64 * 1.12).toBeGreaterThanOrEqual(1270);
    expect(baseDaLegendaCarrossel(40)).toBe(1396);
  });
});

describe('zona segura por tipo de quadro (video-D13)', () => {
  it('o 1:1 tem a própria classe, só com a margem de título, e não as medidas do 4:5', async () => {
    const {classeDoQuadro, conjuntoDaClasse, CONJUNTO_QUADRADO} = await import('../src/nucleo/zonas-seguras');
    expect(classeDoQuadro(1080, 1080)).toBe('quadrado');
    expect(classeDoQuadro(1080, 1050)).toBe('quadrado'); // quase quadrado (até 5%)
    expect(classeDoQuadro(1080, 1350)).toBe('feed');
    expect(classeDoQuadro(1080, 1920)).toBe('vertical');
    expect(classeDoQuadro(1920, 1080)).toBe('youtube');
    expect(conjuntoDaClasse('quadrado')).toBe(CONJUNTO_QUADRADO);
    expect(conjuntoDaClasse('feed')).toBe(conjuntoDe('feed'));
    expect(conjuntoDaClasse(null)).toBeUndefined();
    // só uma margem de 5% de cada lado, e nada coberto
    expect(CONJUNTO_QUADRADO.zonas).toHaveLength(1);
    expect(CONJUNTO_QUADRADO.zonas[0]).toMatchObject({tipo: 'contorno', x: 0.05, y: 0.05, largura: 0.9, altura: 0.9});
    // a lista das redes não ganhou o quadrado (ele é um conjunto à parte)
    expect(ZONAS_SEGURAS.map((c) => c.id)).toEqual(['vertical', 'feed', 'youtube']);
  });
});
