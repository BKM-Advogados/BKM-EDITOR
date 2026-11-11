// Regras de CSS da interface (visual neutro, docs/tela.md §7). O CSS do renderer é global: uma classe com o desenho
// base definido em dois arquivos vale pela ordem em que as áreas carregam. Foi o que quebrava a tela inicial depois de
// abrir a Música (`.cartao-modelo` em inicio.css e musica.css).
import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

const RAIZ = path.join(__dirname, '..', 'src', 'renderer');
const arquivosCss = (dir = RAIZ): string[] =>
  fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? arquivosCss(p) : e.name.endsWith('.css') ? [p] : [];
  });
const semComentarios = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Classes cujo desenho base (seletor `.classe` ou `.classe:estado`, sem combinador nem outra classe) está no arquivo. */
const classesBase = (css: string) => {
  const s = new Set<string>();
  for (const m of semComentarios(css).matchAll(/([^{}]+)\{/g)) {
    for (const sel of m[1].split(',')) {
      const r = /^\.([a-zA-Z][\w-]*)(?::[\w-]+(?:\([^)]*\))?)*$/.exec(sel.trim());
      if (r) s.add(r[1]);
    }
  }
  return s;
};

describe('CSS do renderer', () => {
  it('nenhuma classe tem o desenho base em dois arquivos de área (colisão como a do .cartao-modelo)', () => {
    // estilo.css e casca.css são a base global; as áreas, os painéis e os componentes só estendem o que é deles
    const deArea = arquivosCss().filter((a) => !/[\\/](estilo|casca)\.css$/.test(a) && !a.includes(`${path.sep}estilo${path.sep}`));
    const dono = new Map<string, string>();
    const colisoes: string[] = [];
    for (const a of deArea) {
      for (const c of classesBase(fs.readFileSync(a, 'utf8'))) {
        const outro = dono.get(c);
        if (outro && outro !== a) colisoes.push(`.${c}: ${path.relative(RAIZ, outro)} e ${path.relative(RAIZ, a)}`);
        else dono.set(c, a);
      }
    }
    expect(colisoes).toEqual([]);
  });

  it('a Música não redefine o cartão de modelo da tela inicial', () => {
    const musica = fs.readFileSync(path.join(RAIZ, 'modulos', 'musica', 'musica.css'), 'utf8');
    expect(classesBase(musica).has('cartao-modelo')).toBe(false);
    expect(classesBase(musica).has('musica-modelo')).toBe(true);
  });
});
