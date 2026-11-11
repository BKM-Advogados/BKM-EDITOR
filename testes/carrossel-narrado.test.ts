// A composição do carrossel narrado desenha as props do resolvedor sem marca fixa: o nome, o @ e o site vêm do roteiro,
// as cores são as do tema neutro, e um roteiro de antes do tema neutro ("tema": "c2", cor "cobre") monta do mesmo jeito.
// O Remotion vai de mentira (quadro na mão, Sequence que só mostra o trecho do quadro, sem áudio).
import {readFileSync} from 'node:fs';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import {resolverRoteiro, type Palavra, type Roteiro} from '../src/nucleo/roteiro/resolver';
import {TEMA_CARROSSEL_NEUTRO, temaDoCarrossel} from '../src/nucleo/roteiro/tema';

const tela = vi.hoisted(() => ({quadro: 0, fps: 30}));
vi.mock('remotion', async (original) => {
  const R = await original<typeof import('remotion')>();
  const React = await import('react');
  return {
    ...R,
    useCurrentFrame: () => tela.quadro,
    useVideoConfig: () => ({fps: tela.fps, width: 1080, height: 1920, durationInFrames: 1, id: 'x', defaultProps: {}, props: {}}),
    Sequence: ({from = 0, durationInFrames = Infinity, children}: {from?: number; durationInFrames?: number; children: React.ReactNode}) =>
      (tela.quadro >= from && tela.quadro < from + durationInFrames ? React.createElement(React.Fragment, null, children) : null),
    Html5Audio: () => null,
    Img: ({src}: {src: string}) => React.createElement('img', {src}),
  };
});

const {CarrosselTema} = await import('../src/composicoes/carrossel/CarrosselTema');
const REF = path.join(__dirname, 'fixtures', 'carrossel');
const ler = <T>(arq: string): T => JSON.parse(readFileSync(path.join(REF, arq), 'utf-8')) as T;
const desenhar = (props: Record<string, unknown>, ms: number) => {
  tela.quadro = Math.round((ms / 1000) * tela.fps);
  return renderToStaticMarkup(React.createElement(CarrosselTema as unknown as React.FC<Record<string, unknown>>, props));
};

describe('composição do carrossel narrado', () => {
  const props = resolverRoteiro(ler<Roteiro>('roteiro.json'), ler<Palavra[]>('palavras.json')).props as unknown as Record<string, unknown> & {cenas: {tipo: string; t_in: number}[]};
  const em = (tipo: string) => props.cenas.find((c) => c.tipo === tipo)!.t_in + 700;

  it('rodapé, vinheta e cartão final com a marca do roteiro, nas cores do tema neutro', () => {
    const parte = desenhar(props, em('parte'));
    expect(parte).toContain('ESCRITÓRIO EXEMPLO');
    expect(parte).toContain('@escritorio.exemplo');
    expect(parte.toLowerCase()).toContain(TEMA_CARROSSEL_NEUTRO.cores.destaque.toLowerCase());
    expect(desenhar(props, 400)).toContain('ESCRITÓRIO EXEMPLO'); // vinheta sem logo: o nome
    expect(desenhar(props, em('final'))).toContain('@escritorio.exemplo · exemplo.com.br');
    expect(desenhar({...props, logo: 'logo.png'}, 400)).toContain('logo.png');
  });

  it('sem marca no roteiro, nada de nome no rodapé nem na vinheta', () => {
    const vazio = {...props, marca: {nome: '', site: '', insta: ''}};
    const html = desenhar(vazio, em('parte'));
    expect(html).not.toContain('ESCRITÓRIO');
    expect(desenhar(vazio, 400)).not.toContain('ESCRITÓRIO');
  });

  it('roteiro antigo ("tema": "c2", linha "cobre") monta com o tema neutro', () => {
    const antigo = ler<Roteiro>('roteiro.json');
    antigo.tema = 'c2';
    (antigo.cenas[0].linhas as {cor?: string}[])[2].cor = 'cobre';
    const p = resolverRoteiro(antigo, ler<Palavra[]>('palavras.json')).props;
    expect(p.tema_carrossel).toBe('neutro');
    expect(temaDoCarrossel('c2')).toBe(TEMA_CARROSSEL_NEUTRO);
    const gancho = desenhar(p, (p.cenas[1].t_in as number) + 1500);
    expect(gancho).toContain('NA HORA DE USAR?');
  });
});
