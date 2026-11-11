// Validação do documento de animação no núcleo (C1, C11 e o lado do núcleo do M5): a grade do pixel, o tamanho da
// composição e as faixas das propriedades. É a defesa que pega também o aplicar_patch e a edição do JSON à mão.
import {describe, expect, it} from 'vitest';
import {lerGrade, MAX_LADO_GRADE, revelar, type GradePixel} from '../src/nucleo/animacao-pixel';
import {modeloAnimacaoLogoPixel, normalizarAnimacao, resolverAnimacao, valorEm, type DocAnimacao} from '../src/nucleo/animacao';

const comGrade = (grade: unknown) => ({camadas: [{id: 'p', tipo: 'pixel', grade, progresso: 0.5}]}) as unknown as DocAnimacao;

describe('C1: a grade do pixel é validada no normalizador', () => {
  it('grade sem celulas é descartada com aviso, e nada quebra', () => {
    const {props, avisos} = resolverAnimacao(comGrade({colunas: 4, linhas: 4}));
    expect(props.camadas[0].grade).toBeUndefined();
    expect(avisos.join(' ')).toMatch(/grade da camada p inválida/);
  });

  it('celulas null é descartada; paleta ausente vira [] e revelar não quebra', () => {
    expect(normalizarAnimacao(comGrade({colunas: 2, linhas: 1, paleta: ['#fff'], celulas: null})).camadas[0].grade).toBeUndefined();
    const {props, avisos} = resolverAnimacao(comGrade({colunas: 2, linhas: 1, celulas: '00'}));
    const g = props.camadas[0].grade!;
    expect(g.paleta).toEqual([]);
    expect(revelar(g, 'varredura', 1, 1)).toEqual(['#000000', '#000000']);
    expect(avisos.join(' ')).toMatch(/grade/);
  });

  it('revelar é defensivo mesmo com uma grade que não passou pelo normalizador', () => {
    const torta = {colunas: 4, linhas: 4} as unknown as GradePixel;
    expect(() => revelar(torta, 'aleatorio', 1, 0.5)).not.toThrow();
    expect(() => revelar(torta, 'aleatorio', 1, 1)).not.toThrow();
    expect(revelar(torta, 'aleatorio', 1, 1)).toHaveLength(16);
  });

  it('celulas a menos: a saída tem colunas × linhas, sem undefined', () => {
    const g: GradePixel = {colunas: 4, linhas: 4, paleta: ['#FF0000'], celulas: '0000'};
    const out = revelar(g, 'varredura', 1, 0.9);
    expect(out).toHaveLength(16);
    expect(out.some((x) => x === undefined)).toBe(false);
    const lida = lerGrade(g);
    expect(lida.grade!.celulas).toBe('0000............');
    expect(lida.problema).toMatch(/4 caracteres em vez de 16/);
  });

  it('a paleta é consertada por posição, sem deslocar os índices', () => {
    const {grade} = lerGrade({colunas: 3, linhas: 1, paleta: ['#000000', 'banana', '#FF0000'], celulas: '012'});
    expect(grade!.paleta).toEqual(['#000000', '#000000', '#FF0000']);
    expect(revelar(grade!, 'aleatorio', 1, 1)[2]).toBe('#FF0000');
    expect(lerGrade({colunas: 1, linhas: 1, paleta: ['#abc'], celulas: '0'}).grade!.paleta).toEqual(['#AABBCC']);
  });

  it(`lado acima de ${MAX_LADO_GRADE} (ou não inteiro) descarta a grade em vez de reformatar`, () => {
    const d = resolverAnimacao(comGrade({colunas: 100000, linhas: 100000, paleta: [], celulas: ''}));
    expect(d.props.camadas[0].grade).toBeUndefined();
    expect(d.avisos.join(' ')).toMatch(new RegExp(`1 a ${MAX_LADO_GRADE}`));
    expect(lerGrade({colunas: 2.5, linhas: 2, paleta: [], celulas: '.....'}).grade).toBeUndefined();
    expect(lerGrade({colunas: MAX_LADO_GRADE, linhas: 1, paleta: [], celulas: '.'.repeat(MAX_LADO_GRADE)}).grade).toBeDefined();
  });

  it('documento válido não muda: a grade do modelo passa igual e sem aviso', () => {
    const doc = modeloAnimacaoLogoPixel();
    const {props, avisos} = resolverAnimacao(doc);
    expect(props.camadas[0].grade).toEqual(doc.camadas[0].grade);
    expect(avisos).toEqual([]);
  });
});

describe('C11: largura e altura da animação com teto', () => {
  it('largura 100000 cai para 7680; sem número volta ao padrão', () => {
    const d = normalizarAnimacao({largura: 100000, altura: 50000});
    expect(d.largura).toBe(7680);
    expect(d.altura).toBe(7680);
    expect(normalizarAnimacao({largura: -50, altura: 'x'})).toMatchObject({largura: 1920, altura: 1080});
    expect(normalizarAnimacao({largura: 10, altura: 1080.4})).toMatchObject({largura: 16, altura: 1080});
  });
});

describe('M5 (núcleo): faixas seguras no resolvedor', () => {
  const doc = {camadas: [{id: 'f', tipo: 'forma', x: -200, largura: -50, altura: 0, opacidade: 7, escala: -2,
    trilhas: {opacidade: [{t_ms: 0, valor: -3}, {t_ms: 1000, valor: 40}], x: [{t_ms: 0, valor: -500}, {t_ms: 1000, valor: 0}]}},
  {id: 'p', tipo: 'pixel', tamanho_pixel: 0, progresso: 3}]} as unknown as DocAnimacao;

  it('opacidade, escala, tamanho_pixel e progresso ficam na faixa; x negativo é legítimo', () => {
    const {props, avisos} = resolverAnimacao(doc);
    const [f, p] = props.camadas;
    expect(f).toMatchObject({x: -200, largura: 100, altura: 100, opacidade: 1, escala: 0});
    expect(f.trilhas?.opacidade?.map((k) => k.valor)).toEqual([0, 1]);
    expect(valorEm(f, 'opacidade', 500)).toBeCloseTo(0.5);
    expect(valorEm(f, 'x', 0)).toBe(-500);
    expect(p).toMatchObject({tamanho_pixel: 1, progresso: 1});
    expect(avisos.join(' ')).toMatch(/"opacidade" fora da faixa de 0 a 1/);
  });
});
