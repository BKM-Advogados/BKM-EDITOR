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

describe('tokens usados no CSS do renderer', () => {
  it('toda var(--x) usada existe (a Animação usava --bg-painel, --fg, --azul e --mono, que caíam no tema do GitHub)', () => {
    const todos = arquivosCss();
    const tsx = (dir = RAIZ): string[] =>
      fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? tsx(p) : /\.tsx?$/.test(e.name) ? [p] : [];
      });
    const css = todos.map((a) => semComentarios(fs.readFileSync(a, 'utf8'))).join('\n');
    const codigo = tsx().map((a) => fs.readFileSync(a, 'utf8')).join('\n');
    // definidas no CSS ou por estilo inline / gerador de tokens ('--x': valor)
    const definidas = new Set([...css.matchAll(/(--[\w-]+)\s*:/g), ...codigo.matchAll(/['"](--[\w-]+)['"]\s*[:,]/g)].map((m) => m[1]));
    const usadas = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    const faltam = [...usadas].filter((u) => !definidas.has(u) && !u.startsWith('--dv-'));
    expect(faltam).toEqual([]);
  });

  it('a Animação não tem mais fallback de outro tema', () => {
    const anim = fs.readFileSync(path.join(RAIZ, 'modulos', 'animacao', 'animacao.css'), 'utf8');
    expect(anim).not.toMatch(/--bg-painel|var\(--fg|--azul|var\(--mono|#0d1117|#161b22|#f0f6fc|#ff5252/i);
  });
});

describe('tema do dockview', () => {
  it('as variáveis vêm só de estilo/tokens.ts (nenhum CSS declara o tema), e a aba da frente fica sublinhada', () => {
    const comTema = arquivosCss().filter((a) => /--dv-[\w-]+\s*:/.test(fs.readFileSync(a, 'utf8')));
    expect(comTema).toEqual([]);
    const casca = fs.readFileSync(path.join(RAIZ, 'casca', 'casca.css'), 'utf8');
    expect(casca).toMatch(/\.dv-active-group \.dv-tab\.dv-active-tab::before \{ background: var\(--acento\)/);
  });
});

describe('tipo legível', () => {
  it('nada abaixo de 11 px e nenhum rótulo em caixa alta', () => {
    const pequenos: string[] = [];
    const caixaAlta: string[] = [];
    for (const a of arquivosCss()) {
      const css = semComentarios(fs.readFileSync(a, 'utf8'));
      for (const m of css.matchAll(/(?:font-size|font)\s*:[^;}]*/g)) {
        for (const t of m[0].matchAll(/(?<![\d.])(\d+(?:\.\d+)?)px/g)) {
          // em `font:` o tamanho vem antes da barra; altura de linha (depois da barra) não conta
          const antes = m[0].slice(0, t.index);
          if (!antes.includes('/') && Number(t[1]) > 0 && Number(t[1]) < 11) pequenos.push(`${path.relative(RAIZ, a)}: ${m[0].trim()}`);
        }
      }
      for (const m of css.matchAll(/([^{}]+)\{[^}]*text-transform:\s*uppercase/g)) caixaAlta.push(`${path.relative(RAIZ, a)}: ${m[1].trim()}`);
    }
    expect(pequenos).toEqual([]);
    expect(caixaAlta.filter((c) => !/input\.hex/.test(c))).toEqual([]);
  });

  it('o corpo da interface é o --tam-3 (13 px)', () => {
    const estilo = fs.readFileSync(path.join(RAIZ, 'estilo.css'), 'utf8');
    expect(estilo).toMatch(/html, body, #raiz \{[^}]*font: var\(--tam-3\)/);
  });
});

describe('abas do grupo do inspetor', () => {
  it('ficam com o nome curto antes de virar só ícone, e a Pesquisa não usa mais a aspa', () => {
    const casca = fs.readFileSync(path.join(RAIZ, 'casca', 'casca.css'), 'utf8');
    const tsx = fs.readFileSync(path.join(RAIZ, 'casca', 'Casca.tsx'), 'utf8');
    expect(casca).toMatch(/@container \(max-width: 300px\)/);
    expect(tsx).toMatch(/comentarios: 'Coment\.', historico: 'Hist\.'/);
    expect(tsx).not.toMatch(/pesquisa: <Quote/);
  });
});

describe('modo comentário', () => {
  it('o monitor ganha a borda âmbar e o cursor de pino, e o rodapé diz como sair', () => {
    const estilo = fs.readFileSync(path.join(RAIZ, 'estilo.css'), 'utf8');
    expect(estilo).toMatch(/\.casca\.modo-comentario \.monitor \{ box-shadow: inset 0 0 0 2px var\(--comentario\); \}/);
    expect(estilo).toMatch(/\.casca\.modo-comentario \.monitor[^{]*\{\s*cursor: url\(/);
    const rodape = fs.readFileSync(path.join(RAIZ, 'casca', 'Rodape.tsx'), 'utf8');
    expect(rodape).toContain('Modo comentário');
    expect(rodape).toContain('<kbd>Esc</kbd> sai');
  });
});

describe('seleção com uma forma só', () => {
  it('monitor, linha do tempo e arranjo marcam a seleção com 2 px no acento (o branco fica para as alças)', () => {
    const estilo = fs.readFileSync(path.join(RAIZ, 'estilo.css'), 'utf8');
    const musica = fs.readFileSync(path.join(RAIZ, 'modulos', 'musica', 'musica.css'), 'utf8');
    expect(estilo).toMatch(/\.sobreposicao \.caixa-sel \{[^}]*border: 2px solid var\(--acento\)/);
    expect(estilo).toMatch(/\.lt \.bloco\.sel \{ outline: 2px solid var\(--acento\)/);
    expect(estilo).toMatch(/\.lt \.clipe\.sel \{ outline: 2px solid var\(--acento\)/);
    expect(musica).toMatch(/\.mclipe\.sel \{ outline: 2px solid var\(--acento\)/);
  });
});

describe('cores só nos tokens (item 19)', () => {
  it('nenhum CSS do renderer escreve cor em hexadecimal nem rgba(): só var(--…) de estilo/tokens.ts', () => {
    const achados = arquivosCss().flatMap((a) => {
      const css = semComentarios(fs.readFileSync(a, 'utf8'));
      return [...css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)].map((m) => `${path.relative(RAIZ, a)}: ${m[0]}`);
    });
    expect(achados).toEqual([]);
  });

  it('o arquivo de tokens existe e é o único com as cores da interface', () => {
    const tokens = fs.readFileSync(path.join(RAIZ, 'estilo', 'tokens.ts'), 'utf8');
    expect(tokens).toMatch(/'--acento': '#70b8ff'/);
    expect(arquivosCss().some((a) => a.includes(`${path.sep}estilo${path.sep}`))).toBe(false);
  });
});
