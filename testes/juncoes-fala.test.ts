// Correções de junção da frente Fala com as outras frentes (rodada 2, 07/11/2026; relatório de qualidade r2, seção 6):
// uma legenda por quadro na troca (video-N3), área e quebra da legenda por destino na exportação (video-N1,
// transversal-N2), transcrição pelo original do clipe limpo com carimbo do áudio e "gerar" que só faz o que falta
// (video-N4, som-N3, som-N4, transversal-N1), e o destino do transcrever longe do manifesto e dos documentos
// (transversal-N6).
import {mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import {Legendas} from '../src/composicoes/cenas/Legendas';
import {novoDocCenas, resolverCenas, type DocCenas} from '../src/nucleo/cenas';
import {Projeto} from '../src/nucleo/projeto';
import {fonteDoAudio, Transcritor} from '../src/main/transcricao';
import {
  areaDaLegenda, arquivoDaFala, recusaDoDestino, caracteresPorLinha, comTexto, conferirFala, ENTRA_LEGENDA_MS, legendaNoAr, legendasDaFala, legendasDoDocumento, legendasNoDestino, levarCorrecoes,
  palavrasValidas, resolverLegendas, SAI_LEGENDA_MS, VERSAO_PALAVRAS, type LegendasP, type PalavraLegenda, type SegmentoLegenda, type SegmentoLegendaP,
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

describe('a fala do clipe: original da voz limpa, carimbo do áudio e gerar só o que falta (video-N4, som-N3, som-N4, transversal-N1)', () => {
  const PALAVRAS = FALA.slice(0, 40);
  const lidas = (mapa: Record<string, unknown>) => (c: string) => mapa[c];
  const docCom = (clipes: {id: string; arquivo: string; original?: string; em?: number}[], legendas?: DocCenas['legendas']): DocCenas => ({
    ...novoDocCenas({largura: 1080, altura: 1920, fps: 30}),
    audio: {faixas: [{id: 'voz', nome: 'Narração', papel: 'voz', clipes: clipes.map((c) => ({em: 0, duracao_ms: 20_000, ...c}))}]},
    ...(legendas ? {legendas} : {}),
  });
  const gravadas = (sha256: string, palavras = PALAVRAS) => ({versao: VERSAO_PALAVRAS, fonte: {tamanho: 10, modificado_ms: 1, sha256}, palavras});

  it('o clipe de voz limpa lê a transcrição do original, e as legendas registram o original', () => {
    const c = {id: 'a', arquivo: 'midia/n.wav.media.limpo.wav', original: 'midia/n.wav'};
    expect(arquivoDaFala(c)).toBe('midia/n.wav');
    expect(arquivoDaFala({arquivo: 'midia/n.wav'})).toBe('midia/n.wav');
    const r = legendasDoDocumento(docCom([c]), lidas({'midia/n.wav.palavras.json': gravadas('s1')}), {largura: 1080, altura: 1920});
    expect(r.faltam).toEqual([]);
    expect(r.geradas).toBeGreaterThan(3);
    expect(r.legendas.origens).toEqual([{clipe: 'a', arquivo: 'midia/n.wav', palavras: 'midia/n.wav.palavras.json', em: 0, corte_ms: 0, sha256: 's1'}]);
  });

  it('gerar faz só o que falta: o clipe que já tem legendas (corrigidas à mão) fica igual, e o outro ganha as suas', () => {
    const base = legendasDoDocumento(docCom([{id: 'a', arquivo: 'midia/a.wav'}]), lidas({'midia/a.wav.palavras.json': gravadas('sa')}), {largura: 1080, altura: 1920}).legendas;
    const corrigida = {...base, segmentos: [...base.segmentos.map((s, i) => (i === 0 ? comTexto(s, s.texto.replace('Recebeu', 'RECEBEU')) : s)),
      {id: 'manual', em: 30_000, sai: 31_000, texto: 'criada à mão'}]};
    const doc = docCom([{id: 'a', arquivo: 'midia/a.wav'}, {id: 'b', arquivo: 'midia/b.wav', em: 22_000}], corrigida);
    const mapa = {'midia/a.wav.palavras.json': gravadas('sa'), 'midia/b.wav.palavras.json': gravadas('sb')};
    const r = legendasDoDocumento(doc, lidas(mapa), {largura: 1080, altura: 1920});
    expect(r.mantidos).toEqual(['a']);
    const semId = (ss: SegmentoLegenda[]) => ss.map(({id: _i, ...s}) => s);
    expect(semId(r.legendas.segmentos.filter((s) => s.clipe === 'a'))).toEqual(semId(corrigida.segmentos.filter((s) => s.clipe === 'a')));
    expect(r.legendas.segmentos.filter((s) => s.clipe === 'b').length).toBe(r.geradas);
    expect(r.legendas.segmentos.some((s) => s.texto === 'criada à mão')).toBe(true);
    expect(r.legendas.origens?.map((o) => o.clipe)).toEqual(['a', 'b']);
    // nada a gerar: nenhum clipe novo
    const tudo = legendasDoDocumento({...doc, legendas: r.legendas}, lidas(mapa), {largura: 1080, altura: 1920});
    expect(tudo).toMatchObject({clipes: 0, geradas: 0, mantidos: ['a', 'b']});
  });

  it('refazer leva a palavra corrigida à mão da mesma tomada; da tomada regravada, não', () => {
    const doc0 = docCom([{id: 'a', arquivo: 'midia/a.wav'}]);
    const base = legendasDoDocumento(doc0, lidas({'midia/a.wav.palavras.json': gravadas('sa')}), {largura: 1080, altura: 1920}).legendas;
    const s0 = base.segmentos[0];
    const corrigida = {...base, segmentos: [comTexto(s0, s0.texto.replace('Recebeu', 'RECEBEU')), ...base.segmentos.slice(1)]};
    // o clipe andou 2 s depois de gerar: a correção acha a palavra pelo tempo do arquivo
    const doc = {...docCom([{id: 'a', arquivo: 'midia/a.wav', em: 2000}]), legendas: corrigida};
    const mesma = legendasDoDocumento(doc, lidas({'midia/a.wav.palavras.json': gravadas('sa')}), {largura: 1080, altura: 1920, refazer: true});
    expect(mesma.corrigidas).toBe(1);
    expect(mesma.legendas.segmentos[0].texto.startsWith('RECEBEU')).toBe(true);
    expect(mesma.legendas.segmentos[0].em).toBe(s0.em + 2000);
    const outra = legendasDoDocumento(doc, lidas({'midia/a.wav.palavras.json': gravadas('outra-tomada')}), {largura: 1080, altura: 1920, refazer: ['a']});
    expect(outra.corrigidas).toBe(0);
    expect(outra.legendas.segmentos[0].texto.startsWith('Recebeu')).toBe(true);
    // levarCorrecoes sozinho: sem origem do clipe, nada passa
    expect(levarCorrecoes({segmentos: corrigida.segmentos}, 'a', PALAVRAS).n).toBe(0);
  });

  it('conferirFala: carimbo igual vale; outra data pede o sha256; outro tamanho ou sem carimbo é velha', () => {
    const lido = {versao: VERSAO_PALAVRAS, fonte: {tamanho: 100, modificado_ms: 5000.4, sha256: 'abc'}, palavras: PALAVRAS};
    expect(conferirFala(lido, {tamanho: 100, modificado_ms: 5000.9})).toBe('em_dia');
    expect(conferirFala(lido, {tamanho: 100, modificado_ms: 9000})).toBe('conferir');
    expect(conferirFala(lido, {tamanho: 101, modificado_ms: 5000})).toBe('velha');
    expect(conferirFala(PALAVRAS, {tamanho: 100, modificado_ms: 5000})).toBe('velha');
    expect(conferirFala({...lido, palavras: []}, {tamanho: 100, modificado_ms: 5000})).toBe('falta');
    expect(palavrasValidas(lido)).toHaveLength(40);
    expect(palavrasValidas(PALAVRAS)).toHaveLength(40);
  });

  it('Transcritor.conferir no disco: a tomada regravada com o mesmo nome fica velha; copiada com outra data, não', () => {
    const pasta = mkdtempSync(path.join(tmpdir(), 'estudio-juncoes-fala-'));
    try {
      mkdirSync(path.join(pasta, 'midia'));
      const audio = path.join(pasta, 'midia', 'narracao.wav');
      writeFileSync(audio, Buffer.alloc(4096, 1));
      const projeto = new Projeto(pasta);
      const t = new Transcritor({pasta: path.join(pasta, 'modelos')});
      expect(t.conferir(projeto, 'midia/narracao.wav')).toBe('falta');
      const carimbar = () => projeto.gravarTexto('midia/narracao.wav.palavras.json', JSON.stringify({versao: VERSAO_PALAVRAS, fonte: fonteDoAudio(audio), palavras: PALAVRAS}));
      carimbar();
      expect(t.conferir(projeto, 'midia/narracao.wav')).toBe('em_dia');
      // a mesma tomada com outra data (cópia, git clone): o sha256 confere
      utimesSync(audio, new Date(2020, 0, 1), new Date(2020, 0, 1));
      expect(t.conferir(projeto, 'midia/narracao.wav')).toBe('em_dia');
      // outra tomada do mesmo tamanho
      writeFileSync(audio, Buffer.alloc(4096, 2));
      utimesSync(audio, new Date(2021, 0, 1), new Date(2021, 0, 1));
      expect(t.conferir(projeto, 'midia/narracao.wav')).toBe('velha');
      // outra tomada de outro tamanho
      carimbar();
      writeFileSync(audio, Buffer.alloc(8192, 3));
      expect(t.conferir(projeto, 'midia/narracao.wav')).toBe('velha');
      // a lista sem carimbo (versão 1) conta como velha
      projeto.gravarTexto('midia/narracao.wav.palavras.json', JSON.stringify(PALAVRAS));
      expect(t.conferir(projeto, 'midia/narracao.wav')).toBe('velha');
    } finally {
      rmSync(pasta, {recursive: true, force: true});
    }
  });
});

describe('destino das palavras (transversal-N6)', () => {
  it('recusa o manifesto, os documentos, os comentários, a pesquisa, .estudio/ e o .json que não é lista de palavras', () => {
    const docs = ['video/video.json', 'imagem/capa.json'];
    expect(recusaDoDestino('video/palavras.json', docs)).toBeNull();
    expect(recusaDoDestino('video/palavras.json', docs, {doc: FALA})).toBeNull();
    expect(recusaDoDestino('video/palavras.json', docs, {doc: []})).toBeNull();
    expect(recusaDoDestino('./estudio.json', docs)).toContain('manifesto');
    expect(recusaDoDestino('midia/../Estudio.JSON', docs)).toContain('manifesto');
    expect(recusaDoDestino('imagem\\capa.json', docs)).toContain('documento');
    expect(recusaDoDestino('comentarios.json', docs)).toContain('comentários');
    expect(recusaDoDestino('.estudio/diario.json', docs)).toContain('do app');
    expect(recusaDoDestino('midia/x.json', docs, {doc: {tipo: 'cenas'}})).toContain('não é uma lista de palavras');
    expect(recusaDoDestino('midia/x.json', docs, {doc: undefined})).toContain('não é uma lista de palavras');
    expect(recusaDoDestino('midia/x.txt', docs)).toContain('.json');
  });

  it('o Transcritor recusa antes de transcrever (vale também para o pedido pela interface)', async () => {
    const pasta = mkdtempSync(path.join(tmpdir(), 'estudio-juncoes-destino-'));
    try {
      mkdirSync(path.join(pasta, 'midia'));
      mkdirSync(path.join(pasta, 'video'));
      writeFileSync(path.join(pasta, 'midia', 'narracao.wav'), 'RIFF');
      const manifesto = JSON.stringify({formato: 1, nome: 'x', documentos: [{id: 'video', modulo: 'video', caminho: 'video/video.json', titulo: 'V'}]});
      writeFileSync(path.join(pasta, 'estudio.json'), manifesto);
      writeFileSync(path.join(pasta, 'video', 'video.json'), '{}');
      const projeto = new Projeto(pasta);
      const t = new Transcritor({pasta: path.join(pasta, 'modelos')});
      await expect(t.transcrever(projeto, {arquivo: 'midia/narracao.wav', destino: 'estudio.json'})).rejects.toThrow('manifesto');
      await expect(t.transcrever(projeto, {arquivo: 'midia/narracao.wav', destino: 'video/video.json'})).rejects.toThrow('documento');
      expect(readFileSync(path.join(pasta, 'estudio.json'), 'utf-8')).toBe(manifesto);
      expect(t.estado().ocupado).toBeUndefined();
    } finally {
      rmSync(pasta, {recursive: true, force: true});
    }
  });
});
