// Acessibilidade básica (ux/pesquisa-ux-visual.md, item 20): botão só de ícone tem nome para o leitor de tela, o aviso
// do rodapé é anunciado, o foco tem 2 px, os alvos têm 24 px e o movimento some quando o sistema pede.
import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

const RAIZ = path.join(__dirname, '..', 'src', 'renderer');
const arquivos = (dir = RAIZ, ext = '.tsx'): string[] =>
  fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? arquivos(p, ext) : e.name.endsWith(ext) ? [p] : [];
  });

/** As tags <button …> do arquivo (o fim é o ">" fora de chaves e de texto). */
const botoes = (s: string) => {
  const r: string[] = [];
  for (let i = s.indexOf('<button'); i >= 0; i = s.indexOf('<button', i + 7)) {
    let j = i + 7;
    let prof = 0;
    let aspas: string | null = null;
    for (; j < s.length; j++) {
      const c = s[j];
      if (aspas) {
        if (c === aspas) aspas = null;
      } else if (c === '"' || (prof > 0 && (c === "'" || c === '`'))) aspas = c;
      else if (c === '{') prof++;
      else if (c === '}') prof--;
      else if (c === '>' && prof === 0) break;
    }
    r.push(s.slice(i, j + 1));
  }
  return r;
};

describe('acessibilidade', () => {
  it('todo botão só de ícone (.bti) tem aria-label', () => {
    const sem = arquivos().flatMap((a) => botoes(fs.readFileSync(a, 'utf8'))
      .filter((t) => /className=(\{[^]*?\bbti\b|"[^"]*\bbti\b)/.test(t) && !/aria-label/.test(t))
      .map((t) => `${path.relative(RAIZ, a)}: ${t.slice(0, 90).replace(/\s+/g, ' ')}`));
    expect(sem).toEqual([]);
  });

  it('o aviso do rodapé é anunciado', () => {
    const rodape = fs.readFileSync(path.join(RAIZ, 'casca', 'Rodape.tsx'), 'utf8');
    expect(rodape).toMatch(/className=\{`aviso \$\{avisoVivo\.tipo\}`\}[^>]*role="status" aria-live="polite"/);
  });

  it('foco de 2 px, alvos de 24 px e movimento reduzido', () => {
    const css = arquivos(RAIZ, '.css').map((a) => fs.readFileSync(a, 'utf8')).join('\n');
    expect(css).toMatch(/:focus-visible \{ outline: 2px solid var\(--foco\); outline-offset: 2px; \}/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/:root\[data-movimento="reduzido"\]/);
    expect(css).toMatch(/\.bt\.mini \{ height: var\(--controle-p\)/);
    expect(css).toMatch(/\.aba-doca \.aba-x \{[^}]*width: 20px; height: 20px/);
    expect(css).not.toMatch(/\.bt-min\b/);
  });
});
