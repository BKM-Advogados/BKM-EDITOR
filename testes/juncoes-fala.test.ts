// Correções de junção da frente Fala com as outras frentes (rodada 2, 07/11/2026; relatório de qualidade r2, seção 6):
// uma legenda por quadro na troca (video-N3), área e quebra da legenda por destino na exportação (video-N1,
// transversal-N2), transcrição pelo original do clipe limpo com carimbo do áudio e "gerar" que só faz o que falta
// (video-N4, som-N3, som-N4, transversal-N1), e o destino do transcrever longe do manifesto e dos documentos
// (transversal-N6).
import {readFileSync} from 'node:fs';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import {Legendas} from '../src/composicoes/cenas/Legendas';
import {novoDocCenas, resolverCenas} from '../src/nucleo/cenas';
import {
  areaDaLegenda, caracteresPorLinha, ENTRA_LEGENDA_MS, legendaNoAr, legendasDaFala, legendasNoDestino, resolverLegendas, SAI_LEGENDA_MS, type LegendasP, type PalavraLegenda,
  type SegmentoLegendaP,
} from '../src/nucleo/legendas';

const tela = vi.hoisted(() => ({quadro: 0, fps: 30, largura: 1080, altura: 1920}));
vi.mock('remotion', async (original) => ({
  ...(await original<typeof import('remotion')>()),
  useCurrentFrame: () => tela.quadro,
  useVideoConfig: () => ({fps: tela.fps, width: tela.largura, height: tela.altura, durationInFrames: 1, id: 'x', defaultProps: {}, props: {}}),
}));

const RAIZ = path.join(__dirname, '..');
const FALA = JSON.parse(readFileSync(path.join(RAIZ, 'exemplos', 'exemplo', 'video', 'palavras.json'), 'utf-8')) as PalavraLegenda[];
const TEMA = novoDocCenas({largura: 1080, altura: 1920, fps: 30}).tema;

/** As legendas da narração do C2 (72 s de fala corrida) num estilo, já resolvidas para a composição. */
const legendasC2 = (predefinicao: 'classica' | 'caixa' | 'karaoke', largura = 1080, altura = 1920): LegendasP => {
  const clipe = {id: 'n1', arquivo: 'midia/narracao.wav', em: 0, duracao_ms: 80_000};
  const leg = legendasDaFala([{clipe, faixa: {nome: 'Narração'}, palavras: FALA, caminhoPalavras: 'x'}], {estilo: {predefinicao}, largura, altura});
  return resolverLegendas(leg, {largura, altura, tema: TEMA, duracao_ms: 80_000})!;
};

/** Quantas legendas o componente desenha no quadro, e com que opacidade. */
const desenhadas = (legendas: LegendasP, quadro: number) => {
  tela.quadro = quadro;
  const html = renderToStaticMarkup(React.createElement(Legendas, {legendas}));
  return [...html.matchAll(/data-legenda="([^"]+)" style="opacity:([\d.e-]+)/g)].map((m) => ({origem: m[1], opacidade: Number(m[2])}));
};

describe('uma legenda por quadro (video-N3)', () => {
  for (const estilo of ['classica', 'caixa', 'karaoke'] as const) {
    it(`na fala corrida do C2 (${estilo}), nunca duas na tela, e a da hora está inteira`, () => {
      const leg = legendasC2(estilo);
      const segs = leg.segmentos;
      // o caso do defeito: uma sai no mesmo ms em que a próxima entra
      const coladas = segs.filter((s, i) => segs[i + 1] && s.sai === segs[i + 1].em);
      expect(coladas.length).toBeGreaterThan(5);
      // os primeiros 30 s de fala (todo quadro desenhado pelo componente)
      const ate = segs.findIndex((s) => s.em > 30_000);
      const ultimo = Math.ceil((segs[ate - 1].sai + SAI_LEGENDA_MS) / 1000 * tela.fps);
      let trocas = 0;
      let antes: string | undefined;
      const vistas = new Set<string>();
      for (let q = 0; q <= ultimo; q++) {
        const d = desenhadas(leg, q);
        expect(d.length).toBeLessThanOrEqual(1);
        const ms = (q / tela.fps) * 1000;
        const noAr = segs.filter((s) => ms >= s.em && ms < s.sai);
        if (noAr.length) {
          // a legenda da fala da hora aparece, inteira
          expect(d[0]?.origem).toBe(noAr[noAr.length - 1].origem);
          expect(d[0]?.opacidade).toBe(1);
        }
        if (d[0] && antes && d[0].origem !== antes) trocas++;
        if (d[0]) {
          antes = d[0].origem;
          vistas.add(antes);
        }
      }
      // todas aparecem, cada uma num trecho só (nenhuma volta depois de trocada)
      for (const s of segs.slice(0, ate)) expect(vistas.has(s.origem)).toBe(true);
      expect(trocas).toBe(vistas.size - 1);
    }, 20_000);
  }

  it('no vão curto a que sai apaga na primeira metade e a que entra acende na segunda', () => {
    const seg = (id: string, em: number, sai: number): SegmentoLegendaP => ({id, em, sai, texto: id, palavras: [{w: id, s: em, e: sai}], origem: `/legendas/segmentos/${id}`});
    const segs = [seg('a', 0, 1000), seg('b', 1100, 2000), seg('c', 3000, 4000)];
    expect(legendaNoAr(segs, 999)).toMatchObject({s: {id: 'a'}, opacidade: 1});
    expect(legendaNoAr(segs, 1025)).toMatchObject({s: {id: 'a'}, opacidade: 0.5});
    expect(legendaNoAr(segs, 1050)).toBeNull();
    expect(legendaNoAr(segs, 1075)).toMatchObject({s: {id: 'b'}, opacidade: 0.5, entrada: 0.5});
    // vão longo: 120 ms para apagar, 120 para acender, e nada no meio
    expect(legendaNoAr(segs, 2000 + SAI_LEGENDA_MS / 2)).toMatchObject({s: {id: 'b'}, opacidade: 0.5});
    expect(legendaNoAr(segs, 2500)).toBeNull();
    expect(legendaNoAr(segs, 3000 - ENTRA_LEGENDA_MS / 2)).toMatchObject({s: {id: 'c'}, entrada: 0.5});
    expect(legendaNoAr(segs, 4000 + SAI_LEGENDA_MS)).toBeNull();
    // duas vozes ao mesmo tempo: fica a que começou por último
    expect(legendaNoAr([seg('x', 0, 3000), seg('y', 1000, 2000)], 1500)?.s.id).toBe('y');
    expect(legendaNoAr([seg('x', 0, 3000), seg('y', 1000, 2000)], 2500)?.s.id).toBe('x');
  });

  it('a faixa da marca acende com a legenda da hora, sem somar duas', () => {
    const leg = legendasC2('classica');
    const faixa = {...leg, estilo: {...leg.estilo, caixa: 'faixa' as const}};
    const s = leg.segmentos.find((x, i) => leg.segmentos[i + 1]?.em === x.sai)!;
    tela.quadro = Math.round((s.sai / 1000) * tela.fps);
    const html = renderToStaticMarkup(React.createElement(Legendas, {legendas: faixa}));
    expect(html.match(/data-legenda=/g)?.length).toBe(1);
  });
});

describe('legenda na área e na quebra de cada destino (video-N1, transversal-N2)', () => {
  const palavras = (l: LegendasP) => l.segmentos.flatMap((s) => s.palavras.map((p) => `${p.w}@${p.s}`));

  it('16:9 exportado em 9:16: a área do 9:16, fora dos 484 px de baixo, e cada legenda cabe em duas linhas', () => {
    const doc = legendasC2('classica', 1920, 1080);
    const reels = legendasNoDestino(doc, 1080, 1920, {largura: 1920, altura: 1080});
    expect(reels.area).toEqual(areaDaLegenda(1080, 1920));
    expect(reels.area.base).toBeLessThan(1 - 484 / 1920);
    const max = caracteresPorLinha({predefinicao: 'classica'}, 1080, 1920) * 2;
    expect(caracteresPorLinha({predefinicao: 'classica'}, 1920, 1080) * 2).toBeGreaterThan(max);
    expect(doc.segmentos.some((s) => s.texto.length > max)).toBe(true);
    for (const s of reels.segmentos) expect(s.texto.length).toBeLessThanOrEqual(max);
    expect(reels.segmentos.length).toBeGreaterThan(doc.segmentos.length);
    // nenhuma palavra some ou muda de tempo; os pedaços ficam dentro da legenda de onde vieram, em ordem e sem sobrepor
    expect(palavras(reels)).toEqual(palavras(doc));
    reels.segmentos.forEach((s, i) => {
      const mae = doc.segmentos.find((m) => m.origem === s.origem)!;
      expect(s.em).toBeGreaterThanOrEqual(mae.em);
      expect(s.sai).toBeLessThanOrEqual(mae.sai);
      if (i) expect(s.em).toBeGreaterThanOrEqual(reels.segmentos[i - 1].sai);
    });
    expect(new Set(reels.segmentos.map((s) => s.id)).size).toBe(reels.segmentos.length);
  });

  it('9:16 exportado em 16:9: desce para a área do 16:9 e não divide nada', () => {
    const doc = legendasC2('karaoke');
    const yt = legendasNoDestino(doc, 1920, 1080, {largura: 1080, altura: 1920});
    expect(yt.area).toEqual(areaDaLegenda(1920, 1080));
    expect(yt.area.base).toBeGreaterThan(doc.area.base);
    expect(yt.segmentos).toEqual(doc.segmentos);
  });

  it('na mesma proporção do documento sai igual à prévia', () => {
    const doc = legendasC2('classica');
    const menor = legendasNoDestino(doc, 720, 1280, {largura: 1080, altura: 1920});
    expect(menor).toEqual(doc);
  });

  it('a prévia do documento segue com a área do formato dele', () => {
    const d = novoDocCenas({largura: 1920, altura: 1080, fps: 30});
    const props = resolverCenas({...d, legendas: {segmentos: [{id: 'leg-1', em: 0, sai: 1000, texto: 'oi'}]}}).props;
    expect(props.legendas_cenas?.area).toEqual(areaDaLegenda(1920, 1080));
  });
});
