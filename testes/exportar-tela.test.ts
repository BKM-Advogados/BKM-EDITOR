// Exportar como cartões de destino (ux/pesquisa-ux-visual.md, item 14): destinos como cartões com o tamanho estimado, a
// prévia grande por destino, avisos com ação e o botão com o verbo exato ("Exportar 2 arquivos").
import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

const tsx = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'componentes', 'DialogoExportar.tsx'), 'utf8');

describe('diálogo Exportar', () => {
  it('destinos são cartões marcáveis, com a medida desenhada e o tamanho estimado', () => {
    expect(tsx).toMatch(/role="checkbox" aria-checked=\{m\}[^>]*\n?[^>]*className=\{`cartao-destino/);
    expect(tsx).toContain('<span className="cd-tam">{m ? tamanhoDe(f.id) : \'\'}</span>');
  });
  it('o botão diz quantos arquivos saem', () => {
    expect(tsx).toContain('`Exportar ${destinos.length} arquivos`');
  });
  it('os avisos de sobreposição têm ação e a prévia é grande', () => {
    expect(tsx).toContain('Ver na prévia');
    expect(tsx).toMatch(/lado=\{210\}/);
  });
});
