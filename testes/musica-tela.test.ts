// Música com cor por canal (ux/pesquisa-ux-visual.md, item 15): cada canal ganha uma cor de faixa automática pela ordem,
// a mesma no arranjo, na lista e no mixer, e nenhuma delas é cor de sinal (âmbar do comentário, violeta do agente).
import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

(globalThis as unknown as {window: unknown}).window ??= {estudio: {}};
const {CORES_CANAL, corDaFaixa, corDoCanal} = await import('../src/renderer/modulos/musica/estado');

describe('cor por canal', () => {
  it('pela ordem, da paleta de faixa, voltando ao começo', () => {
    expect(CORES_CANAL.every((c) => /^var\(--faixa-/.test(c))).toBe(true);
    expect(corDoCanal(0)).toBe('var(--faixa-azul)');
    expect(corDoCanal(CORES_CANAL.length)).toBe(corDoCanal(0));
    expect(corDoCanal(-1)).toBe(CORES_CANAL[CORES_CANAL.length - 1]);
  });
  it('a faixa do mixer tem a cor do canal que toca nela', () => {
    const canais = [{id: 'bateria', faixa_mixer: 'bateria'}, {id: 'baixo', faixa_mixer: 'f-baixo'}];
    expect(corDaFaixa(canais, 'f-baixo')).toBe(corDoCanal(1));
    expect(corDaFaixa(canais, 'sobrando')).toBe(corDoCanal(2));
  });
  it('seções e acordes saem do âmbar e do rosa; nenhuma cor fixa no CSS da Música', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'modulos', 'musica', 'musica.css'), 'utf8');
    expect(css).not.toMatch(/\.acorde\.secao \{[^}]*--comentario/);
    expect(css).not.toMatch(/\.faixa-acordes \.acorde \{[^}]*--trilha-efeito/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba\(/i);
  });
});
