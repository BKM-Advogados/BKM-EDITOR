// A animação exportada leva a marca d'água e as fontes do kit (auditoria de render, R3): o componente registrado passa
// pelo mesmo embrulho dos outros tipos, e o tema (fontes/…, midia/logo-…) e a marca d'água são lidos da raiz do projeto
// (base_projeto), enquanto as camadas continuam em <raiz>/midia. Sem a raiz, o logo ia para …/midia/midia/ e o render caía.
import {mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterAll, describe, expect, it, vi} from 'vitest';
import {novaAnimacao, resolverAnimacao} from '../src/nucleo/animacao';
import {gravarPlano, planoDoProjeto} from '../src/nucleo/criar-projeto';
import {SessaoProjeto} from '../src/main/sessao-projeto';

vi.mock('remotion', async (original) => {
  const R = await original<typeof import('remotion')>();
  const React = await import('react');
  return {
    ...R,
    useCurrentFrame: () => 0,
    useVideoConfig: () => ({fps: 30, width: 400, height: 400, durationInFrames: 30, id: 'x', defaultProps: {}, props: {}}),
    Img: ({src}: {src: string}) => React.createElement('img', {src}),
  };
});
const {COMPOSICOES} = await import('../src/composicoes/registro');

const BASE = 'http://127.0.0.1:9/token';
const pastas: string[] = [];
afterAll(() => {
  for (const p of pastas) rmSync(p, {recursive: true, force: true});
});

describe("R3 · a animação exportada com marca d'água e fontes do kit", () => {
  const doc = {...novaAnimacao(400, 400), duracao_ms: 1000, camadas: [
    {id: 'i', tipo: 'imagem', x: 0, y: 0, largura: 100, altura: 100, src: 'camada.png'}]};
  const {props} = resolverAnimacao(doc as never, `${BASE}/midia`);
  const marca = {logo: 'midia/logo-k.png', x: 0.05, y: 0.05, largura: 0.4, altura: 0.2, alinhar: 'esquerda', opacidade: 1, segura: true};

  it('a marca d\'água sai por cima, com o logo lido da raiz do projeto; as camadas seguem em midia/', () => {
    const html = renderToStaticMarkup(React.createElement(COMPOSICOES.Animacao, {...props, base_projeto: BASE, marca_dagua: marca}));
    expect(html).toContain('data-marca-dagua');
    expect(html).toContain(`src="${BASE}/midia/logo-k.png"`);
    expect(html).not.toContain('/midia/midia/');
    expect(html).toContain(`src="${BASE}/midia/camada.png"`);
  });

  it('sem marca nas props, nada por cima (a prévia normal)', () => {
    const html = renderToStaticMarkup(React.createElement(COMPOSICOES.Animacao, {...props, base_projeto: BASE}));
    expect(html).not.toContain('data-marca-dagua');
  });

  it('as props da animação levam a raiz do projeto (base_projeto) e a mídia em <raiz>/midia', () => {
    const raiz = mkdtempSync(path.join(os.tmpdir(), 'estudio-anim-base-'));
    pastas.push(raiz);
    gravarPlano(raiz, planoDoProjeto({nome: 'Animação', modelo: 'animacao-branco'}));
    const s = new SessaoProjeto(raiz, () => undefined);
    const entrada = s.projeto.manifesto().documentos.find((d) => d.modulo === 'animacao');
    expect(entrada).toBeTruthy();
    const montado = s.propsVideo(entrada!.id, BASE);
    expect('props' in montado && montado.props).toMatchObject({composicao: 'Animacao', base_midia: `${BASE}/midia`, base_projeto: BASE});
  });
});
