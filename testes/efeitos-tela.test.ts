// Efeitos com amostra (ux/pesquisa-ux-visual.md, item 23): cada pré-ajuste e cada efeito mostram o resultado numa amostra
// com o filtro de verdade; o antes e depois tem tecla visível (Shift+D).
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';

(globalThis as unknown as {window: unknown}).window ??= {estudio: {}, addEventListener: () => undefined, removeEventListener: () => undefined};
const {AmostraEfeito} = await import('../src/renderer/modulos/efeitos/paineis');

describe('efeitos com amostra', () => {
  it('a amostra leva o filtro CSS e as camadas de vinheta e tom', () => {
    const html = renderToStaticMarkup(React.createElement(AmostraEfeito, {efeitos: [{tipo: 'contraste', valor: 1.2}, {tipo: 'vinheta', valor: 0.5}, {tipo: 'tom', valor: 0.3}]}));
    expect(html).toContain('filter:contrast(1.2)');
    expect(html).toContain('camada vinheta');
    expect(html).toContain('mix-blend-mode:soft-light');
  });
  it('pré-ajustes e efeitos viram cartões com amostra; Shift+D mostra o antes', () => {
    const tsx = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'modulos', 'efeitos', 'paineis.tsx'), 'utf8');
    expect(tsx.match(/className="cartao-efeito"/g)?.length).toBe(2);
    expect(tsx).toContain("e.code === 'KeyD'");
    expect(tsx).toContain('<kbd>Shift</kbd><kbd>D</kbd>');
  });
});
