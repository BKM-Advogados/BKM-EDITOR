// Tela inicial com uma porta de entrada (ux/pesquisa-ux-visual.md, item 12): o pedido ao Claude vem antes de tudo, os
// tipos têm o mesmo peso e incluem a Música, e "Ver um exemplo" aparece uma vez só, sem marca de cliente.
import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

const tsx = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'inicio', 'Inicio.tsx'), 'utf8');

describe('tela inicial', () => {
  it('o pedido ao Claude vem antes de "Começar do zero"', () => {
    expect(tsx.indexOf('className={`pedido-claude')).toBeGreaterThan(0);
    expect(tsx.indexOf('className={`pedido-claude')).toBeLessThan(tsx.indexOf('Começar do zero'));
  });
  it('os tipos incluem a Música e o exemplo aparece uma vez só', () => {
    const tipos = tsx.slice(tsx.indexOf('const TIPOS'), tsx.indexOf('];', tsx.indexOf('const TIPOS')));
    for (const t of ["'video'", "'imagem'", "'animacao'", "'musica'", "'3d'"]) expect(tipos).toContain(`id: ${t}`);
    expect(tsx.match(/>Ver um exemplo</g)).toHaveLength(1);
  });
  it('"Antes de começar" virou uma linha de estado discreta (faixa só quando falta algo)', () => {
    expect(tsx).not.toContain('Antes de começar');
    expect(tsx).toContain("estado-inicio${falta ? ' falta' : ''}");
  });
});
