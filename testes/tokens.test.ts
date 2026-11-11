// Tokens num arquivo só (ux/pesquisa-ux-visual.md §4 e item 18): tema escuro padrão, tema claro com os mesmos nomes,
// alto contraste que só reatribui, e os contrastes medidos pela fórmula do WCAG.
import {describe, expect, it} from 'vitest';
import {razaoDeContraste, type RGB} from '../src/nucleo/contraste';
import {CLARO, COMPACTA, CONTRASTE_CLARO, CONTRASTE_ESCURO, cssDosTokens, ESCURO, temaDoTerminal, tokenDo} from '../src/renderer/estilo/tokens';
import {APARENCIA_PADRAO, efetiva, normalizarAparencia} from '../src/renderer/estado/aparencia';

const rgb = (hex: string): RGB => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`não é #rrggbb: ${hex}`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
};
const razao = (a: string, b: string) => razaoDeContraste(rgb(a), rgb(b));

describe('tokens', () => {
  it('o acento da interface é o azul #70B8FF no escuro', () => {
    expect(ESCURO['--acento'].toLowerCase()).toBe('#70b8ff');
  });

  it('o tema claro tem todos os nomes do escuro', () => {
    expect(Object.keys(CLARO).sort()).toEqual(Object.keys(ESCURO).sort());
  });

  for (const [nome, t] of [['escuro', ESCURO], ['claro', CLARO]] as const) {
    it(`texto e acento passam de 4,5:1 sobre o corpo e o hover (${nome})`, () => {
      for (const fundo of ['--fundo-2', '--fundo-3'] as const) {
        for (const texto of ['--texto', '--texto-2', '--texto-3', '--acento', '--agente', '--ok', '--aviso', '--erro'] as const) {
          expect(razao(t[texto], t[fundo]), `${texto} sobre ${fundo}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(razao(t['--sobre-acento'], t['--acento'])).toBeGreaterThanOrEqual(4.5);
      expect(razao(t['--texto'], t['--acento-fundo'])).toBeGreaterThanOrEqual(7);
      expect(razao(t['--sobre-pino'], t['--pino'])).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('alto contraste: contorno de campo com 3:1 (WCAG 1.4.11) e texto suave mais forte', () => {
    expect(razao(CONTRASTE_ESCURO['--borda-campo'], ESCURO['--fundo-2'])).toBeGreaterThanOrEqual(3);
    expect(razao(CONTRASTE_CLARO['--borda-campo'], CLARO['--fundo-2'])).toBeGreaterThanOrEqual(3);
    expect(razao(CONTRASTE_ESCURO['--texto-3'], ESCURO['--fundo-2'])).toBeGreaterThan(razao(ESCURO['--texto-3'], ESCURO['--fundo-2']));
    expect(CONTRASTE_ESCURO['--texto-2']).toBe('var(--texto)');
  });

  it('o CSS gerado tem :root, o tema claro, o alto contraste, a densidade compacta e o tema do dockview', () => {
    const css = cssDosTokens();
    expect(css).toMatch(/^:root \{/);
    expect(css).toContain(':root[data-tema="claro"] {');
    expect(css).toContain(':root[data-contraste="alto"] {');
    expect(css).toContain(':root[data-densidade="compacta"], :root[data-densidade="auto"][data-faixa="C"] {');
    expect(css).toContain('.dockview-theme-estudio {');
    expect(css).toContain('color-scheme: light');
    expect(COMPACTA['--controle']).toBe('24px');
  });

  it('o terminal sai dos mesmos tokens nos dois temas', () => {
    expect(temaDoTerminal('escuro').cursor).toBe(ESCURO['--acento']);
    expect(temaDoTerminal('claro').background).toBe(CLARO['--fundo-1']);
    expect(Object.values(temaDoTerminal('claro')).every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
    expect(tokenDo('claro', '--raio')).toBe('6px');
  });
});

describe('aparência', () => {
  it('o padrão é o tema escuro, contraste e movimento do sistema, densidade pela janela e 100%', () => {
    expect(APARENCIA_PADRAO).toEqual({tema: 'escuro', contraste: 'sistema', densidade: 'auto', escala: 1, movimento: 'sistema'});
  });
  it('lê com calma o que estiver gravado', () => {
    expect(normalizarAparencia(null)).toEqual(APARENCIA_PADRAO);
    expect(normalizarAparencia({tema: 'roxo', escala: 9, densidade: 'compacta'})).toEqual({...APARENCIA_PADRAO, escala: 1.5, densidade: 'compacta'});
    expect(normalizarAparencia({escala: 0.2}).escala).toBe(0.9);
  });
  it('"do sistema" segue o sistema', () => {
    const a = {...APARENCIA_PADRAO, tema: 'sistema' as const};
    expect(efetiva(a, {claro: true, alto: true, reduz: false})).toEqual({tema: 'claro', contraste: 'alto', movimento: 'normal'});
    expect(efetiva({...a, contraste: 'normal', movimento: 'reduzido'}, {claro: false, alto: true, reduz: false})).toEqual({tema: 'escuro', contraste: 'normal', movimento: 'reduzido'});
  });
});
