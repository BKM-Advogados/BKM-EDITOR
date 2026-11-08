// Rodada 3 da frente Fala (docs/legendas.md): os defeitos da área e a régua das legendas. Cada describe cita o id.
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import {Legendas} from '../src/composicoes/cenas/Legendas';
import type {ClipeAudio} from '../src/nucleo/audio';
import {novoDocCenas, resolverCenas, type DocCenas} from '../src/nucleo/cenas';
import {
  comTexto, lerLegendas, legendasDeOutraTomada, legendasDoDocumento, limitesDoArrasto, mesmaTomada, resolverLegendas, textoDeLegenda, type LegendasCenas,
} from '../src/nucleo/legendas';

const tela = vi.hoisted(() => ({quadro: 0}));
vi.mock('remotion', async (original) => ({
  ...(await original<typeof import('remotion')>()),
  useCurrentFrame: () => tela.quadro,
  useVideoConfig: () => ({fps: 30, width: 1080, height: 1920, durationInFrames: 1, id: 'x', defaultProps: {}, props: {}}),
}));
const TEMA = novoDocCenas({largura: 1080, altura: 1920, fps: 30}).tema;

const SRT = '1\r\n00:00:01,000 --> 00:00:02,500\r\nA rescisão e o aviso prévio\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nmudança de função\r\n';
/** Windows-1252: ã = E3, é = E9, ç = E7 (o "ANSI" do Bloco de Notas). */
const ansi = (s: string) => Uint8Array.from([...s].map((c) => {
  const n = c.charCodeAt(0);
  if (n > 0xff) throw new Error(`fora do Latin-1: ${c}`);
  return n;
}));

describe('legenda em ANSI importa com os acentos certos (video-N6)', () => {
  it('UTF-8 com e sem BOM, UTF-16 com BOM e Windows-1252', () => {
    const utf8 = new TextEncoder().encode(SRT);
    expect(textoDeLegenda(utf8)).toEqual({texto: SRT, codificacao: 'utf-8'});
    expect(textoDeLegenda(Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8])).texto.replace(/^﻿/, '')).toBe(SRT);
    const utf16 = new Uint8Array(2 + SRT.length * 2);
    utf16.set([0xff, 0xfe]);
    [...SRT].forEach((c, i) => utf16.set([c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8], 2 + i * 2));
    expect(textoDeLegenda(utf16)).toEqual({texto: SRT, codificacao: 'utf-16le'});
    const lido = textoDeLegenda(ansi(SRT));
    expect(lido.codificacao).toBe('windows-1252');
    expect(lido.texto).toBe(SRT);
    expect(lerLegendas(lido.texto, 'x.srt').segmentos.map((s) => s.texto)).toEqual(['A rescisão e o aviso prévio', 'mudança de função']);
    // sem a correção, o UTF-8 frouxo trocava cada acento pelo caractere de substituição
    expect(new TextDecoder('utf-8').decode(ansi(SRT))).toContain('�');
  });
});

describe('legenda se seleciona e se comenta no monitor (transversal-N7)', () => {
  it('o segmento leva data-origem com o caminho no documento e recebe o clique', () => {
    const legendas = resolverLegendas({segmentos: [{id: 'leg-1', em: 0, sai: 2000, texto: 'primeira'}, {id: 'leg-2', em: 2000, sai: 4000, texto: 'segunda'}]},
      {largura: 1080, altura: 1920, tema: TEMA, duracao_ms: 4000})!;
    tela.quadro = 75; // 2,5 s: a segunda
    const html = renderToStaticMarkup(React.createElement(Legendas, {legendas}));
    expect(html).toMatch(/data-origem="\/legendas\/segmentos\/1" style="pointer-events:auto/);
    // o monitor procura [data-origem] sob o clique (MonitorVideo.tsx, origemSob); a caixa de fora segue sem eventos
    expect(html).toMatch(/data-legendas="true" style="[^"]*pointer-events:none/);
  });
});

/** Vídeo de cenas com um clipe de voz e as legendas dele geradas com o clipe em `em` (corte 0). */
const comClipe = (clipe: Partial<ClipeAudio>, legendas: LegendasCenas): DocCenas => ({
  ...novoDocCenas({largura: 1080, altura: 1920, fps: 30}),
  cenas: [{id: 'c1', duracao_ms: 20_000, blocos: []}],
  audio: {faixas: [{id: 'voz', nome: 'Narração', papel: 'voz', clipes: [{id: 'n1', arquivo: 'midia/a.wav', em: 1000, duracao_ms: 8000, ...clipe}]}]},
  legendas,
});
const LEG: LegendasCenas = {
  segmentos: [
    {id: 'leg-1', em: 1000, sai: 1300, texto: 'Recebeu', palavras: [{w: 'Recebeu', s: 1000, e: 1300}], clipe: 'n1'},
    {id: 'leg-2', em: 2000, sai: 3000, texto: 'proposta de mudança', palavras: [{w: 'proposta', s: 2000, e: 2400}, {w: 'de', s: 2400, e: 2500}, {w: 'mudança', s: 2500, e: 3000}], clipe: 'n1'},
  ],
  origens: [{clipe: 'n1', arquivo: 'midia/a.wav', palavras: 'midia/a.wav.palavras.json', em: 1000, corte_ms: 0}],
};
const naTela = (doc: DocCenas) => {
  const r = resolverCenas(doc);
  return {segs: r.props.legendas_cenas?.segmentos ?? [], avisos: r.avisos};
};

describe('a legenda não acompanha o arquivo trocado do clipe (som-N2)', () => {
  it('outra tomada: a legenda fica onde nasceu, com aviso, e o painel e o MCP sabem', () => {
    // a pessoa aparou 2 s do começo e depois trocou o arquivo: o corte volta a 0
    const trocado = comClipe({arquivo: 'midia/b.wav', corte_ms: 0}, {...LEG, origens: [{...LEG.origens![0], corte_ms: 2000, em: 1000}]});
    const {segs, avisos} = naTela(trocado);
    expect(segs.map((s) => s.em)).toEqual([1000, 2000]); // sem andar os 2 s
    expect(avisos.join(' ')).toContain('são de outro arquivo');
    expect(legendasDeOutraTomada(trocado)).toEqual(['n1']);
  });

  it('a voz limpa é a mesma tomada, pelo original ou pelo .limpo.wav guardado antes da rodada 3', () => {
    const limpo = {arquivo: 'midia/a.wav.media.limpo.wav', original: 'midia/a.wav', em: 3000};
    const doc = comClipe(limpo, LEG);
    expect(legendasDeOutraTomada(doc)).toEqual([]);
    expect(naTela(doc).segs.map((s) => s.em)).toEqual([3000, 4000]);
    const antiga = comClipe(limpo, {...LEG, origens: [{...LEG.origens![0], arquivo: 'midia/a.wav.media.limpo.wav'}]});
    expect(legendasDeOutraTomada(antiga)).toEqual([]);
    expect(mesmaTomada({arquivo: 'midia/x.wav'}, {arquivo: 'midia/y.wav'})).toBe(false);
  });

  it('refazer a legenda de outra tomada não leva a correção da antiga', () => {
    const corrigida: LegendasCenas = {...LEG, segmentos: [comTexto(LEG.segmentos[0], 'RECEBEU'), LEG.segmentos[1]]};
    const doc = comClipe({arquivo: 'midia/b.wav'}, corrigida);
    const lidas = {'midia/b.wav.palavras.json': [{w: 'Recebeu', s: 0, e: 300}, {w: 'outra', s: 1000, e: 1400}]};
    const r = legendasDoDocumento(doc, (c) => lidas[c as keyof typeof lidas], {largura: 1080, altura: 1920, refazer: true});
    expect(r.corrigidas).toBe(0);
    expect(r.legendas.segmentos[0].texto.startsWith('Recebeu')).toBe(true);
  });
});

describe('a legenda arrastada para fora do clipe não some calada (som-N6)', () => {
  it('fora do trecho: aviso em vez de sumir sem dizer', () => {
    const arrastada = {...LEG, segmentos: [{...LEG.segmentos[0], em: 600, sai: 900, palavras: [{w: 'Recebeu', s: 600, e: 900}]}, LEG.segmentos[1]]};
    const {segs, avisos} = naTela(comClipe({}, arrastada));
    expect(segs.map((s) => s.id)).toEqual(['leg-2']);
    expect(avisos.join(' ')).toContain('a legenda 1 ficou fora do trecho que o clipe de voz toca');
  });

  it('a ponta esticada pela pessoa fica; só o clipe aparado corta', () => {
    const esticada = {...LEG, segmentos: [{...LEG.segmentos[0], em: 500, sai: 1300}, {...LEG.segmentos[1], sai: 9500}]};
    expect(naTela(comClipe({}, esticada)).segs.map((s) => [s.em, s.sai])).toEqual([[500, 1300], [2000, 9500]]);
    // o clipe aparado no fim, em 2,6 s: "mudança" sai e a legenda acaba no fim do clipe
    const aparado = naTela(comClipe({duracao_ms: 1600}, LEG)).segs[1];
    expect(aparado.texto).toBe('proposta de');
    expect(aparado.sai).toBe(2600);
  });

  it('limitesDoArrasto: a legenda anda com as palavras até a borda do clipe', () => {
    const doc = comClipe({}, LEG);
    // "Recebeu" de 1000 a 1300: o meio (1150) não passa do começo do clipe (1000)
    expect(limitesDoArrasto(doc, LEG.segmentos[0])).toEqual({min: -150, max: 9000 - 1 - 1150});
    expect(limitesDoArrasto(doc, {id: 'x', em: 0, sai: 500, texto: 'à mão'})).toBeNull();
    // o clipe andou 2 s depois de gerar: o limite é o da tela
    expect(limitesDoArrasto(comClipe({em: 3000}, LEG), LEG.segmentos[0])).toEqual({min: -150, max: 11_000 - 1 - 3150});
  });
});
