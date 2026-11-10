import {describe, expect, it} from 'vitest';
import {
  aliviar, CURVAS, hexParaRgb, interpolarCor, novaAnimacao, novaCamadaAnimacao, normalizarAnimacao, resolverAnimacao,
  resolverCor, rgbParaHex, valorBase, valorEm, type CamadaAnimacao,
} from '../src/nucleo/animacao';

const forma = (extra: Partial<CamadaAnimacao> = {}): CamadaAnimacao => ({
  id: 'c1', nome: 'Forma', tipo: 'forma', x: 0, y: 0, largura: 100, altura: 100, ...extra,
});

describe('curvas', () => {
  it('linear é a identidade', () => {
    expect(aliviar('linear', 0)).toBe(0);
    expect(aliviar('linear', 0.5)).toBeCloseTo(0.5);
    expect(aliviar('linear', 1)).toBe(1);
  });
  it('suave (ease-in-out) passa pelo meio', () => {
    expect(aliviar('suave', 0)).toBe(0);
    expect(aliviar('suave', 0.5)).toBeCloseTo(0.5);
    expect(aliviar('suave', 1)).toBe(1);
  });
  it('entrada (ease-in) começa devagar', () => {
    expect(aliviar('entrada', 0.5)).toBeCloseTo(0.125);
  });
  it('saída (ease-out) termina devagar', () => {
    expect(aliviar('saida', 0.5)).toBeCloseTo(0.875);
  });
  it('mola passa de 1 (overshoot) e assenta em 1', () => {
    expect(aliviar('mola', 0)).toBeCloseTo(0);
    expect(aliviar('mola', 1)).toBeCloseTo(1);
    expect(aliviar('mola', 0.5)).toBeGreaterThan(1);
  });
  it('degrau segura em 0 até o fim do segmento', () => {
    expect(aliviar('degrau', 0.99)).toBe(0);
  });
  it('todas as curvas listadas têm uma função', () => {
    for (const c of CURVAS) expect(typeof aliviar(c.id, 0.3)).toBe('number');
  });
});

describe('valorEm', () => {
  it('sem trilha vale a prop base', () => {
    const c = forma({x: 42});
    expect(valorEm(c, 'x', 1234)).toBe(42);
  });
  it('trilha vazia vale a prop base', () => {
    const c = forma({x: 42, trilhas: {x: []}});
    expect(valorEm(c, 'x', 1234)).toBe(42);
  });
  it('interpola linear entre dois quadros-chave', () => {
    const c = forma({trilhas: {x: [{t_ms: 0, valor: 0}, {t_ms: 1000, valor: 100}]}});
    expect(valorEm(c, 'x', 500)).toBeCloseTo(50);
    expect(valorEm(c, 'x', 250)).toBeCloseTo(25);
  });
  it('antes do primeiro quadro-chave vale o dele; depois do último, o dele', () => {
    const c = forma({trilhas: {x: [{t_ms: 100, valor: 10}, {t_ms: 500, valor: 90}]}});
    expect(valorEm(c, 'x', 0)).toBe(10);
    expect(valorEm(c, 'x', 100)).toBe(10);
    expect(valorEm(c, 'x', 500)).toBe(90);
    expect(valorEm(c, 'x', 9000)).toBe(90);
  });
  it('usa a curva do quadro-chave de saída', () => {
    const c = forma({trilhas: {x: [{t_ms: 0, valor: 0, curva: 'entrada'}, {t_ms: 1000, valor: 100}]}});
    expect(valorEm(c, 'x', 500)).toBeCloseTo(12.5);
  });
  it('degrau segura o valor até o quadro-chave seguinte', () => {
    const c = forma({trilhas: {x: [{t_ms: 0, valor: 0, curva: 'degrau'}, {t_ms: 1000, valor: 100}]}});
    expect(valorEm(c, 'x', 500)).toBe(0);
    expect(valorEm(c, 'x', 1000)).toBe(100);
  });
  it('opacidade, escala, rotacao e progresso têm base e trilha', () => {
    expect(valorBase(forma(), 'escala')).toBe(1);
    expect(valorBase(forma(), 'rotacao')).toBe(0);
    expect(valorBase(forma(), 'opacidade')).toBe(1);
    const c = forma({trilhas: {escala: [{t_ms: 0, valor: 0.5}, {t_ms: 200, valor: 1.5}]}});
    expect(valorEm(c, 'escala', 100)).toBeCloseTo(1);
  });
});

describe('cores em OKLab', () => {
  it('hex e rgb são inversos', () => {
    expect(hexParaRgb('#C88155')).toEqual([200, 129, 85]);
    expect(rgbParaHex(200, 129, 85)).toBe('#C88155');
  });
  it('interpolar preto→branco no meio dá um cinza (r≈g≈b)', () => {
    const meio = interpolarCor('#000000', '#FFFFFF', 0.5);
    const [r, g, b] = hexParaRgb(meio);
    expect(Math.abs(r - g)).toBeLessThanOrEqual(1);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(1);
    expect(r).toBeGreaterThan(90);
    expect(r).toBeLessThan(160);
  });
  it('interpolar nas pontas devolve as cores de origem', () => {
    expect(interpolarCor('#000000', '#FFFFFF', 0)).toBe('#000000');
    expect(interpolarCor('#000000', '#FFFFFF', 1)).toBe('#FFFFFF');
  });
  it('cor interpola pelo trilho como número', () => {
    const c = forma({cor: '#000000', trilhas: {cor: [{t_ms: 0, valor: '#000000'}, {t_ms: 1000, valor: '#FFFFFF'}]}});
    const meio = String(valorEm(c, 'cor', 500));
    const [r, g] = hexParaRgb(meio);
    expect(Math.abs(r - g)).toBeLessThanOrEqual(1);
  });
  it('resolverCor resolve as referências do kit de marca', () => {
    const tema = {fundo: '#111', texto: '#222', destaque: '#333', suave: '#444', fonte: 'Inter'};
    expect(resolverCor('@destaque', tema)).toBe('#333');
    expect(resolverCor('#ABC123', tema)).toBe('#ABC123');
  });
});

describe('normalização e resolução', () => {
  it('normaliza com calma um documento quebrado', () => {
    const d = normalizarAnimacao({camadas: [{tipo: 'nada', x: 'x'}], largura: 'grande'});
    expect(d.largura).toBe(1920);
    expect(d.camadas[0].tipo).toBe('forma');
    expect(d.camadas[0].x).toBe(0);
  });
  it('resolve o tema neutro quando o documento não tem tema', () => {
    const {props} = resolverAnimacao(novaAnimacao(1920, 1080));
    expect(props.composicao).toBe('Animacao');
    expect(props.tema.destaque).toBe('#70B8FF');
  });
  it('novaAnimacao e novaCamadaAnimacao dão documentos válidos', () => {
    const doc = novaAnimacao(1080, 1920);
    expect(doc.camadas).toHaveLength(1);
    for (const t of ['forma', 'texto', 'imagem', 'pixel'] as const) {
      expect(novaCamadaAnimacao(t, 'x').tipo).toBe(t);
    }
  });
});
