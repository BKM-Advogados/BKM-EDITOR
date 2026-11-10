// Rodada 3 da frente Fala (docs/legendas.md): os defeitos da área e a régua das legendas. Cada describe cita o id.
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import {Legendas} from '../src/composicoes/cenas/Legendas';
import type {ClipeAudio} from '../src/nucleo/audio';
import {novoDocCenas, resolverCenas, type DocCenas} from '../src/nucleo/cenas';
import {
  aplicarDicionario, areaDaLegenda, capacidadeDaLegenda, DICIONARIO_CASA, termosDoDicionario, comTexto, CPS_MAX, cpsDe, fracaNoFim, legendasAoDividirClipe, legendasAoDuplicarClipe, legendasDaFala, legendasDeOutraTomada, legendasDoDocumento, lerLegendas,
  legendasNoDestino, limitesDoArrasto, linhasDaLegenda, MAX_SEGMENTO_MS, mesmaTomada, MIN_SEGMENTO_MS, nomeLivreDaLegenda, PAUSA_QUEBRA_MS, quebrarEmLinhas, quebrarEmSegmentos, resolverLegendas,
  palavrasDe, palavrasDuvidosas, passoDeQuadro, palavrasValidas, realinharPalavras, substituirEmLote, legendasDeArquivo, paraSrt, textoDeLegenda, type LegendasCenas,
} from '../src/nucleo/legendas';
import {avancosDaFonte, LETRAS_MEDIDAS, medidorDaFonte} from '../src/nucleo/medida-texto';
import {arquivosDeLegendaDoVideo, legendasNoTrecho, planoDasLegendas} from '../src/nucleo/legendas-exportacao';
import {argumentosVad, MODELO_VAD, palavrasDoWhisper, semAnotacoes, soNaVoz, tempoNoArquivo, trechoDoLogVad, Transcritor, type TrechoVad} from '../src/main/transcricao';

const tela = vi.hoisted(() => ({quadro: 0}));
vi.mock('remotion', async (original) => ({
  ...(await original<typeof import('remotion')>()),
  useCurrentFrame: () => tela.quadro,
  useVideoConfig: () => ({fps: 30, width: 1080, height: 1920, durationInFrames: 1, id: 'x', defaultProps: {}, props: {}}),
}));
const TEMA = novoDocCenas({largura: 1080, altura: 1920, fps: 30}).tema;
const FALA_C2 = JSON.parse(readFileSync(path.join(__dirname, '..', 'exemplos', 'exemplo', 'video', 'palavras.json'), 'utf-8')) as {w: string; s: number; e: number}[];

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

describe('SRT da tela não grava por cima (fala-D11)', () => {
  it('nomeLivreDaLegenda: o primeiro nome livre, com o .pt_BR junto da extensão', () => {
    const ha = new Set(['Mudar.srt', 'Mudar (2).srt', 'Mudar.pt_BR.srt']);
    const existe = (n: string) => ha.has(n);
    expect(nomeLivreDaLegenda('Outro.srt', existe)).toBe('Outro.srt');
    expect(nomeLivreDaLegenda('Mudar.srt', existe)).toBe('Mudar (3).srt');
    expect(nomeLivreDaLegenda('Mudar.pt_BR.srt', existe)).toBe('Mudar (2).pt_BR.srt');
  });
});

describe('dividir e duplicar clipe de voz levando as legendas (funções para o Som, fala-D12)', () => {
  const palavrasNaTela = (doc: DocCenas) => naTela(doc).segs.flatMap((s) => s.palavras.map((p) => `${p.w}@${p.s}`));
  const dividido = (doc: DocCenas, em_ms: number) => {
    const c = doc.audio!.faixas[0].clipes[0];
    const legendas = legendasAoDividirClipe(doc.legendas, {clipe: 'n1', novo: 'n2', em_ms, clipes: doc.audio!.faixas[0].clipes});
    const a = {...c, duracao_ms: em_ms - c.em};
    const b = {...c, id: 'n2', em: em_ms, corte_ms: (c.corte_ms ?? 0) + (em_ms - c.em), duracao_ms: c.duracao_ms - (em_ms - c.em)};
    return {...doc, audio: {faixas: [{...doc.audio!.faixas[0], clipes: [a, b]}]}, legendas};
  };

  it('dividir no meio de uma legenda: ela vira duas e nenhuma palavra some nem anda', () => {
    const doc = comClipe({}, LEG);
    const depois = dividido(doc, 2450);
    expect(palavrasNaTela(depois)).toEqual(palavrasNaTela(doc));
    expect(depois.legendas!.segmentos.map((s) => [s.texto, s.clipe])).toEqual([['Recebeu', 'n1'], ['proposta', 'n1'], ['de mudança', 'n2']]);
    expect(depois.legendas!.origens!.map((x) => x.clipe)).toEqual(['n1', 'n2']);
    expect(naTela(depois).avisos.filter((x) => /legenda/.test(x))).toEqual([]);
  });

  it('dividir depois de o clipe andar e com corte: o corte é o da tela', () => {
    const doc = comClipe({em: 3000, corte_ms: 0}, LEG); // gerado em 1000, arrastado para 3000
    const depois = dividido(doc, 4100);
    expect(palavrasNaTela(depois)).toEqual(palavrasNaTela(doc));
    expect(depois.legendas!.segmentos.filter((s) => s.clipe === 'n2').map((s) => s.texto)).toEqual(['proposta de mudança']);
  });

  it('duplicar: a cópia leva as legendas para onde o clipe novo for', () => {
    const doc = comClipe({}, LEG);
    const legendas = legendasAoDuplicarClipe(doc.legendas, {clipe: 'n1', novo: 'n2'})!;
    const c = doc.audio!.faixas[0].clipes[0];
    const copia = {...doc, audio: {faixas: [{...doc.audio!.faixas[0], clipes: [c, {...c, id: 'n2', em: 11_000}]}]}, legendas};
    const segs = naTela(copia).segs;
    expect(segs.map((s) => [s.texto, s.em])).toEqual([['Recebeu', 1000], ['proposta de mudança', 2000], ['Recebeu', 11_000], ['proposta de mudança', 12_000]]);
    expect(new Set(legendas.segmentos.map((s) => s.id)).size).toBe(4);
  });
});

describe('régua: pausa de 300 ms, 833 ms a 7 s e 17 caracteres por segundo', () => {
  const ws = (texto: string, passo = 300, de = 0) => texto.split(' ').map((w, i) => ({w, s: de + i * passo, e: de + i * passo + passo - 40}));

  it('as constantes são as da régua', () => {
    expect([PAUSA_QUEBRA_MS, MIN_SEGMENTO_MS, MAX_SEGMENTO_MS, CPS_MAX]).toEqual([300, 833, 7000, 17]);
  });

  it('o silêncio de 300 ms abre legenda nova; 250 ms não', () => {
    const fala = [...ws('a empresa mudou', 300), ...ws('de cidade', 300, 900 - 40 + 300)];
    expect(quebrarEmSegmentos(fala, {max_caracteres: 84}).map((s) => s.texto)).toEqual(['a empresa mudou', 'de cidade']);
    const colada = [...ws('a empresa mudou', 300), ...ws('de cidade', 300, 900 - 40 + 250)];
    expect(quebrarEmSegmentos(colada, {max_caracteres: 84}).map((s) => s.texto)).toEqual(['a empresa mudou de cidade']);
  });

  it('nenhuma legenda passa de 7 s', () => {
    const longa = ws(Array.from({length: 40}, (_, i) => `p${i}`).join(' '), 300);
    for (const s of quebrarEmSegmentos(longa, {max_caracteres: 1000})) expect(s.sai - s.em).toBeLessThanOrEqual(7000);
  });

  it('fala rápida ganha o vão até a próxima para ficar em 17 car/s; sem vão, a medida avisa', () => {
    // 38 caracteres ditos em 1 s, e a próxima frase 3 s depois: a legenda fica até 38/17 s
    const rapida = [...ws('Recebeu proposta para mudar de cidade?', 1000 / 6), {w: 'Sim.', s: 4000, e: 4300}];
    const [a] = quebrarEmSegmentos(rapida, {max_caracteres: 84});
    expect(a.sai - a.em).toBeGreaterThanOrEqual(Math.ceil((38 / 17) * 1000) - 1);
    expect(cpsDe(a)).toBeLessThanOrEqual(17);
    // colada na próxima, não dá para esticar: cpsDe diz quanto passou
    const colada = [...ws('Recebeu proposta para mudar de cidade?', 1000 / 6), {w: 'Sim.', s: 1100, e: 1400}];
    const [b] = quebrarEmSegmentos(colada, {max_caracteres: 84});
    expect(cpsDe(b)).toBeGreaterThan(17);
    expect(cpsDe({texto: 'linha um\nlinha dois', em: 0, sai: 1000})).toBe(19);
  });

  it('na narração do C2, a régua vale em toda legenda que tem vão para isso', () => {
    const segs = quebrarEmSegmentos(FALA_C2, {max_caracteres: 84});
    for (const [i, s] of segs.entries()) {
      expect(s.sai - s.em).toBeLessThanOrEqual(7000);
      const vao = (segs[i + 1]?.em ?? Infinity) - s.em;
      if (vao >= MIN_SEGMENTO_MS) expect(s.sai - s.em).toBeGreaterThanOrEqual(MIN_SEGMENTO_MS);
      if (vao >= (s.texto.length / 17) * 1000 + 1) expect(cpsDe(s)).toBeLessThanOrEqual(17);
    }
  });
});

describe('linhas: 42 caracteres, corte equilibrado sem palavra fraca no fim e largura medida na fonte (fala-D6)', () => {
  const porLetra = (largura: number) => ({largura, medir: (s: string) => s.length, max_caracteres: 42});
  const ws = (t: string) => t.split(' ');

  it('uma linha quando cabe; duas equilibradas quando não; pontuação ajuda', () => {
    expect(quebrarEmLinhas(ws('Recebeu proposta de mudança?'), porLetra(42))).toEqual([ws('Recebeu proposta de mudança?')]);
    const duas = quebrarEmLinhas(ws('Antes de responder, entenda as regras da transferência'), porLetra(36));
    expect(duas.map((l) => l.join(' '))).toEqual(['Antes de responder,', 'entenda as regras da transferência']);
  });

  it('não deixa artigo, preposição, auxiliar nem "não" no fim da primeira linha', () => {
    for (const texto of ['o empregador vai pagar o frete da mudança inteira', 'a empresa não pode mudar o contrato sem acordo', 'quem decide é o juiz da vara do trabalho local']) {
      const [a] = quebrarEmLinhas(ws(texto), porLetra(28));
      expect(fracaNoFim(a[a.length - 1]), `${texto} → ${a.join(' ')}`).toBe(false);
    }
    // a vírgula libera: "de," pode fechar a linha
    expect(fracaNoFim('de,')).toBe(false);
  });

  it('quando nem duas cabem, quantas precisar, cada uma dentro da largura', () => {
    const linhas = quebrarEmLinhas(ws('um dois três quatro cinco seis sete oito nove dez onze doze treze'), porLetra(14));
    expect(linhas.length).toBeGreaterThan(2);
    for (const l of linhas) expect(l.join(' ').length).toBeLessThanOrEqual(14);
  });

  it('o SRT e o VTT nunca passam de 42 caracteres por linha', () => {
    const longa = 'A transferência do empregado para outra cidade depende da sua concordância, com exceções importantes previstas em lei';
    for (const l of linhasDaLegenda(longa)) expect(l.length).toBeLessThanOrEqual(42);
  });

  it('o medidor usa a tabela da fonte: a Mono é 0,6 em por letra e a acentuada vale a base', () => {
    expect(medidorDaFonte({familia: 'IBM Plex Mono', peso: 400, tam: 100})('abc')).toBeCloseTo(180);
    const inter = medidorDaFonte({familia: '"Inter", sans-serif', peso: 600, tam: 1000});
    expect(inter('ã')).toBe(inter('a'));
    expect(inter('Recebeu')).toBe([...'Recebeu'].reduce((s, ch) => s + avancosDaFonte('Inter', 600)[LETRAS_MEDIDAS.indexOf(ch)], 0));
    expect(medidorDaFonte({familia: 'Inter', peso: 800, tam: 100})('abc')).toBeGreaterThan(medidorDaFonte({familia: 'Inter', peso: 400, tam: 100})('abc'));
    expect(medidorDaFonte({familia: 'Inter', peso: 600, tam: 100, maiusculas: true})('abc')).toBe(medidorDaFonte({familia: 'Inter', peso: 600, tam: 100})('ABC'));
    // fonte própria de kit (sem tabela): mede como a Inter
    expect(medidorDaFonte({familia: 'Fonte da Marca', peso: 600, tam: 100})('abc')).toBe(medidorDaFonte({familia: 'Inter', peso: 600, tam: 100})('abc'));
  });

  for (const [largura, altura] of [[1920, 1080], [1080, 1920], [1080, 1350]] as const) {
    it(`a narração do C2 em ${largura}×${altura}: toda legenda cabe em duas linhas medidas, de até 42 caracteres`, () => {
      for (const predefinicao of ['classica', 'karaoke', 'caixa'] as const) {
        const leg = legendasDaFala([{clipe: {id: 'n1', arquivo: 'a.wav', em: 0, duracao_ms: 80_000}, faixa: {}, palavras: FALA_C2, caminhoPalavras: 'x'}],
          {estilo: {predefinicao}, largura, altura, fonte: 'Inter'});
        const cap = capacidadeDaLegenda({predefinicao, fonte: 'Inter'}, largura, altura);
        for (const s of leg.segmentos) {
          const linhas = quebrarEmLinhas(s.palavras!.map((p) => p.w), cap);
          expect(linhas.length, `${predefinicao}: ${s.texto}`).toBeLessThanOrEqual(2);
          for (const l of linhas) {
            expect(l.join(' ').length).toBeLessThanOrEqual(42);
            expect(cap.medir(l.join(' '))).toBeLessThanOrEqual(cap.largura);
          }
        }
      }
    });
  }

  it('a composição desenha as linhas medidas, sem palavra fraca no fim da primeira', () => {
    const texto = 'A transferência depende da sua concordância por escrito';
    const palavras = texto.split(' ').map((w, i) => ({w, s: i * 200, e: i * 200 + 180}));
    const legendas = resolverLegendas({segmentos: [{id: 'leg-1', em: 0, sai: 4000, texto, palavras}], estilo: {predefinicao: 'classica'}},
      {largura: 1080, altura: 1920, tema: TEMA, duracao_ms: 4000})!;
    tela.quadro = 30;
    const html = renderToStaticMarkup(React.createElement(Legendas, {legendas}));
    const linhas = [...html.matchAll(/<div><span style="[^"]*">(.*?)<\/span><\/div>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
    expect(linhas.length).toBe(2);
    expect(linhas.join(' ')).toBe(texto);
    for (const l of linhas) expect(l.length).toBeLessThanOrEqual(42);
    expect(fracaNoFim(linhas[0].split(' ').pop()!)).toBe(false);
  });
});

describe('legenda no corte 1:1 do 4:5 e acima das legendas do YouTube (fala-D8)', () => {
  it('4:5: dentro do quadrado por padrão; com no_quadrado false, a altura toda', () => {
    const a = areaDaLegenda(1080, 1350);
    expect(a.topo).toBeGreaterThanOrEqual(135 / 1350);
    expect(a.base).toBeLessThanOrEqual(1 - 135 / 1350);
    expect(areaDaLegenda(1080, 1350, {no_quadrado: false}).base).toBeCloseTo(0.94);
    const doc = resolverLegendas({segmentos: [{id: 'leg-1', em: 0, sai: 1000, texto: 'oi'}]}, {largura: 1080, altura: 1350, tema: TEMA, duracao_ms: 1000})!;
    expect(doc.area).toEqual(a);
    const toda = resolverLegendas({segmentos: [{id: 'leg-1', em: 0, sai: 1000, texto: 'oi'}], estilo: {predefinicao: 'classica', no_quadrado: false}},
      {largura: 1080, altura: 1350, tema: TEMA, duracao_ms: 1000})!;
    expect(toda.area.base).toBeCloseTo(0.94);
    // o vídeo quadrado já é 1:1: nada muda nele
    expect(areaDaLegenda(1080, 1080)).toEqual(areaDaLegenda(1080, 1080, {no_quadrado: false}));
    expect(areaDaLegenda(1080, 1080).base).toBeCloseTo(0.94);
  });

  it('16:9 com o SRT junto: acima da faixa das legendas automáticas; sem, embaixo como antes', () => {
    expect(areaDaLegenda(1920, 1080).base).toBeCloseTo(0.89);
    expect(areaDaLegenda(1920, 1080, {legendas_youtube: true}).base).toBeLessThanOrEqual(0.76);
    const leg = resolverLegendas({segmentos: [{id: 'leg-1', em: 0, sai: 1000, texto: 'oi'}]}, {largura: 1920, altura: 1080, tema: TEMA, duracao_ms: 1000})!;
    expect(legendasNoDestino(leg, 1920, 1080, {largura: 1920, altura: 1080}, {legendas_youtube: true}).area.base).toBeLessThanOrEqual(0.76);
    // o 9:16 não muda: a base já fica acima dos 484 px de baixo e dentro do corte 3:4
    expect(areaDaLegenda(1080, 1920)).toEqual(areaDaLegenda(1080, 1920, {no_quadrado: false, legendas_youtube: true}));
  });
});

describe('Clássica: a palavra falada tem pista além da cor', () => {
  it('fundo leve na cor de destaque só na palavra da hora, sem mexer no lugar do texto', () => {
    const palavras = [{w: 'Recebeu', s: 0, e: 400}, {w: 'proposta', s: 400, e: 900}];
    const legendas = resolverLegendas({segmentos: [{id: 'leg-1', em: 0, sai: 1500, texto: 'Recebeu proposta', palavras}], estilo: {predefinicao: 'classica'}},
      {largura: 1080, altura: 1920, tema: TEMA, duracao_ms: 1500})!;
    expect(legendas.estilo.pista).toBe('fundo');
    tela.quadro = 15; // 500 ms: "proposta"
    const html = renderToStaticMarkup(React.createElement(Legendas, {legendas}));
    const spans = [...html.matchAll(/<span style="([^"]*)">(Recebeu|proposta)<\/span>/g)].map((m) => [m[2], m[1]]);
    expect(spans.find(([w]) => w === 'proposta')![1]).toMatch(/background:rgba\(.*0\.24\).*margin:0 -/);
    expect(spans.find(([w]) => w === 'Recebeu')![1]).not.toContain('background');
    // o Karaokê segue só com a cor e as apagadas
    const k = resolverLegendas({segmentos: [{id: 'leg-1', em: 0, sai: 1500, texto: 'Recebeu proposta', palavras}], estilo: {predefinicao: 'karaoke'}},
      {largura: 1080, altura: 1920, tema: TEMA, duracao_ms: 1500})!;
    expect(renderToStaticMarkup(React.createElement(Legendas, {legendas: k}))).not.toMatch(/background:rgba\([^)]*0\.24\)/);
  });
});

describe('trocar uma palavra por duas reparte só o tempo dela (fala-D5)', () => {
  const seg = {id: 'leg-1', em: 0, sai: 2000, texto: 'o FGTS cai na conta',
    palavras: [{w: 'o', s: 0, e: 100}, {w: 'FGTS', s: 120, e: 700}, {w: 'cai', s: 750, e: 950}, {w: 'na', s: 960, e: 1050}, {w: 'conta', s: 1060, e: 1500}]};
  const tempos = (ps: {w: string; s: number; e: number}[]) => ps.map((p) => `${p.w}@${p.s}-${p.e}`);

  it('na lista (comTexto) e no substituir em lote, as outras palavras ficam no tempo delas', () => {
    const r = comTexto(seg, 'o Fundo de Garantia cai na conta');
    expect(tempos(r.palavras!).filter((x) => /^(o|cai|na|conta)@/.test(x))).toEqual(['o@0-100', 'cai@750-950', 'na@960-1050', 'conta@1060-1500']);
    const novas = r.palavras!.slice(1, 4);
    expect(novas.map((p) => p.w)).toEqual(['Fundo', 'de', 'Garantia']);
    expect(novas[0].s).toBe(120);
    expect(novas[2].e).toBe(700);
    const lote = substituirEmLote([seg], 'FGTS', 'Fundo de Garantia', {palavra_inteira: true}).segmentos[0];
    expect(lote.palavras).toEqual(r.palavras);
  });

  it('no patch do texto (palavrasDe), igual; tirar uma palavra não mexe nas outras', () => {
    expect(palavrasDe({...seg, texto: 'o Fundo de Garantia cai na conta'})).toEqual(comTexto(seg, 'o Fundo de Garantia cai na conta').palavras);
    expect(tempos(palavrasDe({...seg, texto: 'o FGTS cai conta'}))).toEqual(['o@0-100', 'FGTS@120-700', 'cai@750-950', 'conta@1060-1500']);
  });

  it('palavra nova sem vão divide o tempo da vizinha de antes', () => {
    const r = realinharPalavras(seg.palavras, ['o', 'FGTS', 'sempre', 'cai', 'na', 'conta']);
    expect(r.map((p) => p.w)).toEqual(['o', 'FGTS', 'sempre', 'cai', 'na', 'conta']);
    expect(r[1].s).toBe(120);
    expect(r[2].e).toBe(700);
    expect(tempos(r.slice(3))).toEqual(['cai@750-950', 'na@960-1050', 'conta@1060-1500']);
  });
});

describe('confiança do whisper na lista: palavra abaixo de 0,6 vai para "confira"', () => {
  it('a certeza vem do palavras.json até a legenda resolvida; corrigida, sai da lista', () => {
    const lidas = palavrasValidas({versao: 2, fonte: {tamanho: 1}, palavras: [{w: 'Recebeu', s: 0, e: 300, p: 0.95}, {w: 'propósito', s: 300, e: 700, p: 0.41},
      {w: 'de', s: 700, e: 800, p: 0.9}, {w: 'mudar.', s: 800, e: 1200, p: 0.88}]});
    expect(lidas[1].p).toBe(0.41);
    const leg = legendasDaFala([{clipe: {id: 'n1', arquivo: 'a.wav', em: 0, duracao_ms: 5000}, faixa: {}, palavras: lidas, caminhoPalavras: 'x'}], {largura: 1080, altura: 1920});
    const s = leg.segmentos[0];
    expect(palavrasDuvidosas(s.palavras)).toEqual(['propósito']);
    const tela = resolverLegendas(leg, {largura: 1080, altura: 1920, tema: TEMA, duracao_ms: 5000})!;
    expect(palavrasDuvidosas(tela.segmentos[0].palavras)).toEqual(['propósito']);
    // a pessoa corrigiu: a palavra trocada perde o p, e a lista não pede mais para conferir
    expect(palavrasDuvidosas(comTexto(s, 'Recebeu proposta de mudar.').palavras)).toEqual([]);
    // "25 %" juntado fica com a menor certeza dos pedaços
    expect(quebrarEmSegmentos([{w: '25', s: 0, e: 200, p: 0.9}, {w: '%', s: 200, e: 300, p: 0.5}], {max_caracteres: 42})[0].palavras).toEqual([{w: '25%', s: 0, e: 300, p: 0.5}]);
  });
});

describe('dicionário da casa e do vídeo: volta a valer a cada geração', () => {
  const fala = [{w: 'a', s: 0, e: 100}, {w: 'clt', s: 120, e: 500}, {w: 'garante', s: 520, e: 900}, {w: 'o', s: 950, e: 1000}, {w: 'fgts.', s: 1020, e: 1500},
    {w: 'Recebeu', s: 2500, e: 2800}, {w: 'propósito.', s: 2820, e: 3300}];
  const doc = (dicionario?: {de: string; para: string}[]) => ({
    audio: {faixas: [{id: 'voz', nome: 'Narração', papel: 'voz' as const, clipes: [{id: 'n1', arquivo: 'midia/n.wav', em: 0, duracao_ms: 4000}]}]},
    ...(dicionario ? {legendas: {segmentos: [], dicionario}} : {}),
  });
  const ler = () => fala;

  it('as siglas da casa saem em caixa alta, com o tempo de cada palavra guardado', () => {
    const r = legendasDoDocumento(doc(), ler, {largura: 1080, altura: 1920});
    const textos = r.legendas.segmentos.map((s) => s.texto);
    expect(textos.join(' ')).toContain('a CLT garante o FGTS.');
    expect(r.dicionario).toBeGreaterThanOrEqual(1);
    const s0 = r.legendas.segmentos[0];
    expect(s0.palavras!.find((p) => p.w === 'CLT')).toMatchObject({s: 120, e: 500});
  });

  it('a troca guardada no vídeo vale ao gerar e ao gerar de novo; os termos vão ao whisper', () => {
    const d = doc([{de: 'propósito', para: 'proposta'}]);
    const r = legendasDoDocumento(d, ler, {largura: 1080, altura: 1920});
    expect(r.legendas.segmentos.map((s) => s.texto).join(' ')).toContain('Recebeu proposta.');
    const de = legendasDoDocumento({...d, legendas: r.legendas}, ler, {largura: 1080, altura: 1920, refazer: true});
    expect(de.legendas.segmentos.map((s) => s.texto).join(' ')).toContain('Recebeu proposta.');
    expect(de.legendas.dicionario).toEqual([{de: 'propósito', para: 'proposta'}]);
    expect(termosDoDicionario(de.legendas)).toEqual(['proposta']);
    expect(aplicarDicionario([{id: 'x', em: 0, sai: 1, texto: 'CLT já certa'}], DICIONARIO_CASA).trocas).toBe(0);
  });
});

describe('início e fim pelo teclado, um quadro por vez', () => {
  it('passoDeQuadro encaixa na grade de quadros do vídeo', () => {
    expect(passoDeQuadro(1000, 30, 1)).toBe(33); // do quadro 30 ao 31
    expect(passoDeQuadro(1000, 30, -1)).toBe(-33);
    expect(passoDeQuadro(1010, 30, 1)).toBe(23); // fora da grade: o próximo quadro inteiro
    expect(passoDeQuadro(1010, 30, -1)).toBe(-10);
    expect(passoDeQuadro(0, 30, -1)).toBe(0);
    expect(passoDeQuadro(1000, 25, 1)).toBe(40);
  });
});

describe('legendas na exportação: queimar, só o SRT ou os dois, por destino', () => {
  it('o plano de cada destino; no 16:9 com o SRT junto, a legenda sobe acima das do YouTube', () => {
    expect(planoDasLegendas(undefined, {largura: 1080, altura: 1920})).toEqual({queimar: true, srt: false, legendas_youtube: false});
    expect(planoDasLegendas('srt', {largura: 1920, altura: 1080})).toEqual({queimar: false, srt: true, legendas_youtube: false});
    expect(planoDasLegendas('ambos', {largura: 1920, altura: 1080})).toEqual({queimar: true, srt: true, legendas_youtube: true});
    expect(planoDasLegendas('ambos', {largura: 1080, altura: 1920}).legendas_youtube).toBe(false);
  });

  it('com trecho, as legendas saem contadas do zero e cortadas nas pontas', () => {
    const segs = [{em: 0, sai: 1000, texto: 'a'}, {em: 1500, sai: 3000, texto: 'b'}, {em: 4000, sai: 5000, texto: 'c'}];
    expect(legendasNoTrecho(segs, {de_ms: 2000, ate_ms: 4500})).toEqual([{em: 0, sai: 1000, texto: 'b'}, {em: 2000, sai: 2500, texto: 'c'}]);
    expect(legendasNoTrecho(segs, null)).toBe(segs);
  });

  it('o SRT ao lado do vídeo tem o nome dele, o .pt_BR.srt do Facebook, e não grava por cima', () => {
    const segs = [{em: 0, sai: 1000, texto: 'Recebeu proposta'}];
    const ha = new Set(['Mudar - 9x16.srt']);
    const r = arquivosDeLegendaDoVideo('Mudar - 9x16', segs, null, (n) => ha.has(n));
    expect(r.map((a) => a.nome)).toEqual(['Mudar - 9x16 (2).srt', 'Mudar - 9x16.pt_BR.srt', 'Mudar - 9x16.vtt']);
    expect(r[0].texto).toBe(paraSrt(segs));
    expect(r[2].texto.startsWith('WEBVTT')).toBe(true);
    expect(arquivosDeLegendaDoVideo('x', segs, {de_ms: 5000, ate_ms: 6000}, () => false)).toEqual([]);
  });

  it('o SRT de fora guarda as palavras repartidas pelo tamanho, marcadas como estimadas', () => {
    const {legendas} = legendasDeArquivo('1\n00:00:01,000 --> 00:00:02,000\nRecebeu proposta\n', 'x.srt');
    expect(legendas.segmentos[0]).toMatchObject({palavras_estimadas: true});
    expect(legendas.segmentos[0].palavras!.map((p) => p.w)).toEqual(['Recebeu', 'proposta']);
    expect(legendas.segmentos[0].palavras![0].s).toBe(1000);
    expect(legendas.segmentos[0].palavras![1].e).toBe(2000);
  });
});

describe('VAD: o tempo das palavras volta ao relógio do arquivo e o que não é fala não vira palavra', () => {
  // o que o whisper-cli escreve no stderr com --vad (medido na narração do C2 depois de 14 s de silêncio e música)
  const LOG = [
    'whisper_vad: vad_segment_info: orig_start: 14.27, orig_end: 16.22, vad_start: 0.00, vad_end: 1.95',
    'whisper_vad: vad_segment_info: orig_start: 16.74, orig_end: 19.58, vad_start: 2.15, vad_end: 4.99',
  ];
  const mapa = LOG.map(trechoDoLogVad) as TrechoVad[];

  it('lê a tabela dos trechos de voz e leva cada tempo ao arquivo', () => {
    expect(mapa[0]).toEqual({orig_ms: 14270, orig_fim_ms: 16220, vad_ms: 0, vad_fim_ms: 1950});
    expect(trechoDoLogVad('whisper_full_with_state: progress =  50%')).toBeNull();
    expect(tempoNoArquivo(mapa, 10)).toBe(14280);
    // na folga entre os trechos: o começo vai ao próximo trecho e o fim fica no fim do trecho em que estava
    expect(tempoNoArquivo(mapa, 2100)).toBe(16740);
    expect(tempoNoArquivo(mapa, 2100, 'fim')).toBe(16370);
    expect(tempoNoArquivo(mapa, 1900, 'fim')).toBe(16170);
    expect(tempoNoArquivo(mapa, 2150)).toBe(16740);
    expect(tempoNoArquivo(mapa, 3000)).toBe(17590);
    expect(tempoNoArquivo([], 500)).toBe(500);
  });

  it('as palavras saem no relógio do arquivo; sem a tabela, pela diferença do segmento', () => {
    const json = {transcription: [{offsets: {from: 14270, to: 19580}, tokens: [
      {text: '[_BEG_]', offsets: {from: 0, to: 0}},
      {text: ' Recebeu', offsets: {from: 10, to: 240}, p: 0.9},
      {text: ' proposta', offsets: {from: 2200, to: 2600}, p: 0.8},
    ]}]};
    expect(palavrasDoWhisper(json, 0, {mapa}).map((w) => [w.w, w.s, w.e])).toEqual([['Recebeu', 14280, 14510], ['proposta', 16790, 17190]]);
    expect(palavrasDoWhisper(json, 0, {mapa: []}).map((w) => [w.w, w.s])).toEqual([['Recebeu', 14270], ['proposta', 16460]]);
    // sem VAD, como sempre
    expect(palavrasDoWhisper(json).map((w) => w.s)).toEqual([10, 2200]);
  });

  it('tira "[Som de fio]", "[música]", "(risos)" e "♪", e deixa o "(CLT)" e o colchete que não fecha', () => {
    const ws = ['[Som', 'de', 'fio]', 'Recebeu', '(risos)', '(CLT)', '♪', '[música].'].map((w) => ({w}));
    expect(semAnotacoes(ws).map((x) => x.w)).toEqual(['Recebeu', '(CLT)']);
    expect(semAnotacoes(['[nota', 'sem', 'fim'].map((w) => ({w}))).map((x) => x.w)).toEqual(['[nota', 'sem', 'fim']);
  });

  it('como filtro: fica a frase que encosta num trecho de voz; a palavra isolada no silêncio sai', () => {
    const ps = [{w: 'Obrigado.', s: 2000, e: 2400}, {w: 'Recebeu', s: 14100, e: 14500}, {w: 'proposta', s: 14600, e: 15000}, {w: 'fim', s: 16400, e: 16600}];
    expect(soNaVoz(ps, [{de: 14270, ate: 16220}]).map((p) => p.w)).toEqual(['Recebeu', 'proposta', 'fim']);
    expect(soNaVoz(ps, [])).toEqual([]);
    // o começo do vídeo do WhatsApp: o detector só achou voz em 2,9 s, mas a frase vem colada desde 0,16 s
    const zap = [{w: 'Amigo,', s: 160, e: 630}, {w: 'você', s: 880, e: 1380}, {w: 'perdeu', s: 1390, e: 2140}, {w: 'seu', s: 2150, e: 2530},
      {w: 'emprego', s: 2940, e: 3260}];
    expect(soNaVoz(zap, [{de: 2910, ate: 6000}]).map((p) => p.w)).toEqual(['Amigo,', 'você', 'perdeu', 'seu', 'emprego']);
  });

  it('o detector de voz entra nos argumentos e na lista do que falta baixar (0,9 MB, com SHA-256)', () => {
    const a = argumentosVad('C:/m/ggml-silero.bin');
    expect(a.slice(0, 3)).toEqual(['--vad', '-vm', 'C:/m/ggml-silero.bin']);
    expect(MODELO_VAD.url).toContain('/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/');
    expect(MODELO_VAD.sha256).toMatch(/^[0-9a-f]{64}$/);
    const pasta = mkdtempSync(path.join(tmpdir(), 'estudio-vad-'));
    try {
      expect(new Transcritor({pasta}).estado().falta.some((f) => f.includes(MODELO_VAD.arquivo))).toBe(true);
      expect(new Transcritor({pasta, vad: false}).estado().falta.some((f) => f.includes(MODELO_VAD.arquivo))).toBe(false);
    } finally {
      rmSync(pasta, {recursive: true, force: true});
    }
  });
});
