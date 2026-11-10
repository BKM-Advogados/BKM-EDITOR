// Encaixe e guias da imagem (rodada 3, B2): a caixa que anda encosta nas bordas e no centro da prancheta e das outras
// camadas, na margem segura e na grade, só dentro de 5 px de tela; as guias acesas e a distância até o vizinho de cada
// lado; a margem segura pela rede (feed) ou 5% (quadrado); o passo das réguas.
import {describe, expect, it} from 'vitest';
import type {CamadaImagem} from '../src/nucleo/documentos';
import {alvosDeEncaixe, distancias, encaixar, margemSegura, passoDaGrade, passoDaRegua, TOLERANCIA_TELA} from '../src/nucleo/encaixe-imagem';

const c = (id: string, x: number, y: number, largura: number, altura: number): CamadaImagem => ({id, nome: id, tipo: 'forma', x, y, largura, altura});
const prancheta = {largura: 1080, altura: 1350};

describe('encaixe', () => {
  const camadas = [c('fixa', 600, 300, 200, 100), c('anda', 0, 0, 100, 100)];
  const alvos = alvosDeEncaixe(camadas, new Set([1]), prancheta);

  it('encosta a 5 px de tela: com zoom 0,5 a tolerância é 10 px do documento', () => {
    const tol = TOLERANCIA_TELA / 0.5;
    // borda esquerda a 8 px da borda da prancheta: encaixa em 0
    expect(encaixar({x: 8, y: 500, w: 100, h: 100}, alvos, tol)).toMatchObject({dx: -8, dy: 0});
    // a 12 px já não encaixa
    expect(encaixar({x: 12, y: 500, w: 100, h: 100}, alvos, tol).dx).toBe(0);
    // centro no centro da prancheta (540): caixa de 100 em x 487 → anda 3
    const r = encaixar({x: 487, y: 500, w: 100, h: 100}, alvos, tol);
    expect(r.dx).toBe(3);
    expect(r.guias).toContainEqual({eixo: 'x', valor: 540, tipo: 'prancheta'});
  });

  it('bordas e centro das outras camadas também; as guias acesas são as linhas em que a caixa cai', () => {
    // a borda de cima encosta na de baixo da camada fixa (y 400)
    const r = encaixar({x: 300, y: 404, w: 100, h: 100}, alvos, 10);
    expect(r.dy).toBe(-4);
    expect(r.guias).toEqual([{eixo: 'y', valor: 400, tipo: 'camada'}]);
    // a borda esquerda encosta na direita da fixa (x 800) e o centro vertical no dela (350)
    const s = encaixar({x: 806, y: 296, w: 100, h: 100}, alvos, 10);
    expect([s.dx, s.dy]).toEqual([-6, 4]);
    expect(s.guias).toEqual(expect.arrayContaining([{eixo: 'x', valor: 800, tipo: 'camada'}, {eixo: 'y', valor: 350, tipo: 'camada'}]));
  });

  it('com grade, a borda encosta na linha mais perto; com margem segura, nas bordas dela', () => {
    expect(passoDaGrade(1080)).toBe(90);
    const r = encaixar({x: 184, y: 600, w: 100, h: 100}, {x: [], y: []}, 10, 90);
    expect(r.dx).toBe(-4);
    expect(r.guias).toContainEqual({eixo: 'x', valor: 180, tipo: 'grade'});
    const quadrado = margemSegura(1080, 1080);
    expect(quadrado).toEqual([expect.objectContaining({x: 54, y: 54, w: 972, h: 972, miolo: true})]);
    const comMargem = alvosDeEncaixe([], new Set(), {largura: 1080, altura: 1080}, quadrado);
    expect(encaixar({x: 58, y: 500, w: 100, h: 100}, comMargem, 10)).toMatchObject({dx: -4});
  });

  it('a margem do feed 4:5 vem das zonas da rede, em px do documento', () => {
    const feed = margemSegura(1080, 1350);
    expect(feed.length).toBeGreaterThan(0);
    for (const a of feed) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w).toBeLessThanOrEqual(1080 + 1e-6);
      expect(a.y + a.h).toBeLessThanOrEqual(1350 + 1e-6);
    }
  });
});

describe('distâncias no arrasto', () => {
  it('até o vizinho de cada lado (o mais perto que cruza a faixa) ou até a borda da prancheta', () => {
    const caixa = {x: 400, y: 400, w: 100, h: 100};
    const outras = [{x: 100, y: 420, w: 50, h: 50}, {x: 700, y: 300, w: 50, h: 150}, {x: 420, y: 100, w: 30, h: 30}, {x: 900, y: 900, w: 10, h: 10}];
    const d = distancias(caixa, outras, prancheta);
    expect(d).toEqual(expect.arrayContaining([
      {eixo: 'x', de: 150, ate: 400, em: 445, valor: 250},
      {eixo: 'x', de: 500, ate: 700, em: 425, valor: 200},
      {eixo: 'y', de: 130, ate: 400, em: 435, valor: 270},
      {eixo: 'y', de: 500, ate: 1350, em: 450, valor: 850},
    ]));
    expect(d).toHaveLength(4);
  });
});

describe('réguas', () => {
  it('as marcas ficam a pelo menos 60 px de tela umas das outras', () => {
    expect(passoDaRegua(1)).toBe(100);
    expect(passoDaRegua(0.32)).toBe(200);
    expect(passoDaRegua(4)).toBe(20);
  });
});
