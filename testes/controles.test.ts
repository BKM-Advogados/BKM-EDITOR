// Controles de formulário da casa (ux/pesquisa-ux-visual.md, item 13): nada de <select>, caixa de marcar ou rádio
// nativos no renderer, e os próprios com papel e estado para o leitor de tela.
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {Caixa, Escolha, Interruptor, Segmentado} from '../src/renderer/componentes/Controles';

const RAIZ = path.join(__dirname, '..', 'src', 'renderer');
const tsx = (dir = RAIZ): string[] =>
  fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? tsx(p) : e.name.endsWith('.tsx') ? [p] : [];
  });

describe('controles da casa', () => {
  it('nenhum <select>, caixa de marcar ou rádio nativo na interface', () => {
    const achados = tsx().flatMap((a) => {
      const t = fs.readFileSync(a, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      return /<select\b|type=["']checkbox["']|type=["']radio["']/.test(t) ? [path.relative(RAIZ, a)] : [];
    });
    expect(achados).toEqual([]);
  });

  it('caixa e interruptor dizem o estado', () => {
    const c = renderToStaticMarkup(React.createElement(Caixa, {marcado: true, aoMudar: () => undefined}, 'Espelhar'));
    expect(c).toContain('role="checkbox"');
    expect(c).toContain('aria-checked="true"');
    expect(c).toContain('Espelhar');
    const i = renderToStaticMarkup(React.createElement(Interruptor, {ligado: false, aoMudar: () => undefined, rotulo: 'Mudo'}));
    expect(i).toContain('role="switch"');
    expect(i).toContain('aria-checked="false"');
  });

  it('segmentado é um grupo de rádio com a opção escolhida marcada e só ela no Tab', () => {
    const s = renderToStaticMarkup(React.createElement(Segmentado<string>, {rotulo: 'Tema', valor: 'claro', aoMudar: () => undefined,
      opcoes: [['escuro', 'Escuro'], ['claro', 'Claro']]}));
    expect(s).toContain('role="radiogroup"');
    expect(s).toContain('aria-label="Tema"');
    expect(s.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(s).toMatch(/aria-checked="true" tabindex="0"[^>]*>Claro/);
    expect(s.match(/tabindex="-1"/g)).toHaveLength(1);
  });

  it('escolha fechada mostra o valor e avisa que abre uma lista', () => {
    const e = renderToStaticMarkup(React.createElement(Escolha<string>, {rotulo: 'Ordem', valor: 'recentes', aoMudar: () => undefined,
      opcoes: [['nome', 'Por nome'], ['recentes', 'Mais recentes']]}));
    expect(e).toContain('role="combobox"');
    expect(e).toContain('aria-haspopup="listbox"');
    expect(e).toContain('aria-expanded="false"');
    expect(e).toContain('Mais recentes');
    const vazia = renderToStaticMarkup(React.createElement(Escolha<string>, {rotulo: 'Estilo', valor: undefined, vazio: 'Estilo…', aoMudar: () => undefined, opcoes: [['a', 'A']]}));
    expect(vazia).toContain('Estilo…');
  });
});
