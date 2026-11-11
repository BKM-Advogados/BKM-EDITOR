// C2 (auditoria de conteúdo): a trilha de cor com referência do tema ("@destaque") ou hex curto ("#fff") interpolava a
// partir do preto. Agora a referência é resolvida pelo tema antes de interpolar, o degrau segura o valor cru e o número em
// texto numa trilha numérica vira número.
import {describe, expect, it} from 'vitest';
import {
  hexParaRgb, novaCamadaAnimacao, normalizarAnimacao, resolverAnimacao, TEMA_ANIMACAO_NEUTRO, valorEm, type CamadaAnimacao,
  type DocAnimacao,
} from '../src/nucleo/animacao';

const camada = (trilha: {t_ms: number; valor: string | number; curva?: string}[]): CamadaAnimacao =>
  normalizarAnimacao({camadas: [{id: 'f', tipo: 'forma', cor: '@destaque', trilhas: {cor: trilha}}]}).camadas[0];
const rgb = (v: number | string) => hexParaRgb(String(v));

describe('C2: cor com @ref e #rgb', () => {
  it('entre dois "@destaque" a cor é a do destaque, e no quadro-chave volta a referência crua', () => {
    const c = camada([{t_ms: 0, valor: '@destaque'}, {t_ms: 1000, valor: '@destaque'}]);
    expect(valorEm(c, 'cor', 0)).toBe('@destaque');
    expect(valorEm(c, 'cor', 500)).toBe(TEMA_ANIMACAO_NEUTRO.destaque.toUpperCase());
  });

  it('de "@destaque" para vermelho o meio parte do azul do destaque, não do preto', () => {
    const c = camada([{t_ms: 0, valor: '@destaque'}, {t_ms: 1000, valor: '#FF0000'}]);
    const [r, , b] = rgb(valorEm(c, 'cor', 500));
    expect(b).toBeGreaterThan(60);
    expect(r).toBeGreaterThan(150);
  });

  it('o tema do documento entra na interpolação', () => {
    const c = camada([{t_ms: 0, valor: '@destaque'}, {t_ms: 1000, valor: '@destaque'}]);
    expect(valorEm(c, 'cor', 500, {...TEMA_ANIMACAO_NEUTRO, destaque: '#00FF00'})).toBe('#00FF00');
  });

  it('degrau segura o valor cru (a referência), não o preto', () => {
    const c = camada([{t_ms: 0, valor: '@destaque', curva: 'degrau'}, {t_ms: 1000, valor: '#FFFFFF'}]);
    expect(valorEm(c, 'cor', 500)).toBe('@destaque');
  });

  it('hex curto "#fff" é branco', () => {
    expect(hexParaRgb('#fff')).toEqual([255, 255, 255]);
    const c = camada([{t_ms: 0, valor: '#fff'}, {t_ms: 1000, valor: '#fff'}]);
    expect(valorEm(c, 'cor', 500)).toBe('#FFFFFF');
  });

  it('fluxo da tela: forma nova + losango em 0 + cor nova em 1 s parte do destaque', () => {
    const base = novaCamadaAnimacao('forma', 'f');
    const k0 = valorEm(base, 'cor', 0);
    expect(k0).toBe('@destaque');
    const c: CamadaAnimacao = {...base, trilhas: {cor: [{t_ms: 0, valor: k0, curva: 'suave'}, {t_ms: 1000, valor: '#FF0000', curva: 'suave'}]}};
    expect(rgb(valorEm(c, 'cor', 200))[2]).toBeGreaterThan(150);
  });

  it('compatibilidade: trilha só com hex de 6 dígitos dá o mesmo valor de antes (OKLab)', () => {
    const c: CamadaAnimacao = {...novaCamadaAnimacao('forma', 'f'), trilhas: {cor: [{t_ms: 0, valor: '#000000'}, {t_ms: 1000, valor: '#FFFFFF'}]}};
    const [r, g, b] = rgb(valorEm(c, 'cor', 500));
    expect(Math.abs(r - g)).toBeLessThanOrEqual(1);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(1);
    expect(valorEm(c, 'cor', 0)).toBe('#000000');
    expect(valorEm(c, 'cor', 1000)).toBe('#FFFFFF');
  });
});

describe('C2: tipo do valor por propriedade', () => {
  it('número em texto numa trilha de posição vira número', () => {
    const c = normalizarAnimacao({camadas: [{id: 'f', tipo: 'forma', trilhas: {x: [{t_ms: 0, valor: '100'}, {t_ms: 1000, valor: 200}]}}]}).camadas[0];
    expect(valorEm(c, 'x', 500)).toBe(150);
  });

  it('texto que não é número numa trilha numérica é descartado com aviso', () => {
    const doc = {camadas: [{id: 'f', tipo: 'forma', trilhas: {x: [{t_ms: 0, valor: 'abc'}, {t_ms: 1000, valor: 500}]}}]} as unknown as DocAnimacao;
    const {props, avisos} = resolverAnimacao(doc);
    expect(props.camadas[0].trilhas?.x).toEqual([{t_ms: 1000, valor: 500}]);
    expect(valorEm(props.camadas[0], 'x', 500)).toBe(500);
    expect(avisos.join(' ')).toMatch(/"x"/);
  });

  it('número numa trilha de cor é descartado com aviso', () => {
    const doc = {camadas: [{id: 'f', tipo: 'forma', trilhas: {cor: [{t_ms: 0, valor: 7}, {t_ms: 1000, valor: '#FF0000'}]}}]} as unknown as DocAnimacao;
    const {props, avisos} = resolverAnimacao(doc);
    expect(props.camadas[0].trilhas?.cor).toHaveLength(1);
    expect(avisos.join(' ')).toMatch(/"cor"/);
  });

  it('sem normalizar (o inspetor lê o documento cru), valorEm também não devolve texto em propriedade numérica', () => {
    const c = {...novaCamadaAnimacao('forma', 'f'), trilhas: {x: [{t_ms: 0, valor: 'abc'}, {t_ms: 1000, valor: 500}]}} as CamadaAnimacao;
    expect(typeof valorEm(c, 'x', 500)).toBe('number');
    expect(Number.isFinite(valorEm(c, 'x', 500) as number)).toBe(true);
  });
});
