// Legendas do vídeo de cenas e a parte pura da transcrição local (docs/legendas.md): tokens do whisper em palavras
// (com o JSON real do whisper.cpp na narração do C2), quebra em legendas, legendas que andam com o clipe, estilos e área
// segura, editar em lote, SRT e VTT de ida e volta, e o zip e o download conferido do transcritor.
import {mkdtempSync, readFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {afterAll, describe, expect, it} from 'vitest';
import {novoDocCenas, resolverCenas, type DocCenas} from '../src/nucleo/cenas';
import {
  areaDaLegenda, carimboLegenda, caracteresPorLinha, comTexto, dividirSegmento, estimarPalavras, juntarSegmentos, legendasDaFala, legendasDeArquivo, legendasDoDocumento,
  lerLegendas, linhasDaLegenda, localizar, palavrasDe, palavrasDoClipe, paraSrt, paraVtt, PREDEFINICOES_LEGENDA, quebrarEmSegmentos, requebrar, resolverEstilo,
  resolverLegendas, substituirEmLote, type LegendasCenas, type PalavraLegenda, type SegmentoLegenda,
} from '../src/nucleo/legendas';
import {norm} from '../src/nucleo/roteiro/resolver';
import {baixarConferido, extrairZip, palavrasDoWhisper} from '../src/main/transcricao';

const RAIZ = path.join(__dirname, '..');
const REFERENCIA = JSON.parse(readFileSync(path.join(RAIZ, 'exemplos', 'exemplo', 'video', 'palavras.json'), 'utf-8')) as PalavraLegenda[];
const WHISPER = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'fala', 'whisper-c2-small.json'), 'utf-8'));
const temporarias: string[] = [];
afterAll(() => temporarias.forEach((p) => rmSync(p, {recursive: true, force: true})));

/** Palavras erradas (distância de edição sem acento, caixa e pontuação) por palavra da referência. */
const taxaDeErro = (ref: {w: string}[], hip: {w: string}[]) => {
  const a = ref.map((p) => norm(p.w));
  const b = hip.map((p) => norm(p.w));
  const d = Array.from({length: a.length + 1}, (_, i) => Array.from({length: b.length + 1}, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length] / a.length;
};

describe('tokens do whisper.cpp em palavras', () => {
  const palavras = palavrasDoWhisper(WHISPER);

  it('a narração do C2 (small, guloso, com o vocabulário) sai com menos de 5% de palavras erradas', () => {
    expect(palavras.length).toBeGreaterThan(185);
    expect(taxaDeErro(REFERENCIA, palavras)).toBeLessThan(0.05);
    // o narrador fala "pra": com o vocabulário, o whisper escreve como ouviu
    expect(palavras.slice(0, 6).map((p) => p.w)).toEqual(['Recebeu', 'proposta', 'pra', 'mudar', 'de', 'cidade?']);
  });

  it('tempos em ordem, sem sobreposição, e a pontuação não estica a palavra por cima da pausa', () => {
    for (let i = 1; i < palavras.length; i++) {
      expect(palavras[i].s).toBeGreaterThanOrEqual(palavras[i - 1].s);
      expect(palavras[i - 1].e).toBeLessThanOrEqual(palavras[i].s);
      expect(palavras[i].e).toBeGreaterThan(palavras[i].s);
    }
    const cidade = palavras.find((p) => p.w === 'cidade?')!;
    expect(cidade.e).toBeLessThan(2200); // o "?" do whisper vem em 2490 ms, no fim da pausa
  });

  it('o começo das palavras fica perto do da referência (mediana abaixo de 200 ms)', () => {
    const erros: number[] = [];
    let j = 0;
    for (const r of REFERENCIA) {
      const k = palavras.findIndex((p, i) => i >= j && norm(p.w) === norm(r.w));
      if (k < 0 || k - j > 3) continue;
      erros.push(Math.abs(palavras[k].s - r.s));
      j = k + 1;
    }
    erros.sort((x, y) => x - y);
    expect(erros.length).toBeGreaterThan(170);
    expect(erros[Math.floor(erros.length / 2)]).toBeLessThan(200);
  });

  it('pula os tokens especiais e junta pedaços de palavra', () => {
    const json = {transcription: [{tokens: [
      {text: '[_BEG_]', offsets: {from: 0, to: 0}}, {text: ' Rece', offsets: {from: 100, to: 200}}, {text: 'beu', offsets: {from: 200, to: 400}},
      {text: ' 40', offsets: {from: 500, to: 700}}, {text: '%', offsets: {from: 700, to: 800}}, {text: '.', offsets: {from: 1500, to: 1510}}, {text: '[_TT_75]', offsets: {from: 1510, to: 1510}},
    ]}]};
    expect(palavrasDoWhisper(json)).toEqual([{w: 'Recebeu', s: 100, e: 400, p: 1}, {w: '40%.', s: 500, e: 800, p: 1}]);
  });
});

describe('quebrar as palavras em legendas', () => {
  const segs = quebrarEmSegmentos(REFERENCIA, {max_caracteres: 42});

  it('cada palavra entra uma vez, na ordem, e nenhuma legenda passa da largura nem invade a próxima', () => {
    expect(segs.flatMap((s) => s.palavras!.map((p) => p.w)).join(' ')).toBe(REFERENCIA.map((p) => p.w).join(' ').replace(' %', '%'));
    for (const [i, s] of segs.entries()) {
      expect(s.texto.length).toBeLessThanOrEqual(42);
      expect(s.sai).toBeGreaterThan(s.em);
      if (segs[i + 1]) expect(s.sai).toBeLessThanOrEqual(segs[i + 1].em);
    }
  });

  it('fecha no fim da frase e na pausa longa', () => {
    // "Recebeu proposta para mudar de cidade?" termina com "?" e a próxima frase começa depois de 440 ms
    expect(segs[0].texto).toBe('Recebeu proposta para mudar de cidade?');
    expect(segs.every((s) => !/[.?!]/.test(s.texto.slice(0, -1).replace(/\d[.,]\d/g, '')))).toBe(true);
    const pausa = quebrarEmSegmentos([{w: 'um', s: 0, e: 300}, {w: 'dois', s: 1200, e: 1500}], {max_caracteres: 42});
    expect(pausa.map((s) => s.texto)).toEqual(['um', 'dois']);
  });

  it('junta "25 %" e "seguro -desemprego", e respeita o máximo de palavras', () => {
    const r = quebrarEmSegmentos([{w: '25', s: 0, e: 200}, {w: '%', s: 200, e: 300}, {w: 'seguro', s: 300, e: 600}, {w: '-desemprego', s: 600, e: 900}], {max_caracteres: 42});
    expect(r[0].texto).toBe('25% seguro-desemprego');
    const tres = quebrarEmSegmentos(REFERENCIA, {max_caracteres: 42, max_palavras: 3});
    expect(Math.max(...tres.map((s) => s.palavras!.length))).toBeLessThanOrEqual(3);
  });

  it('legenda curta ganha tempo até 0,7 s, sem invadir a próxima', () => {
    const r = quebrarEmSegmentos([{w: 'Sim.', s: 0, e: 150}, {w: 'Não.', s: 400, e: 600}, {w: 'Talvez.', s: 3000, e: 3200}], {max_caracteres: 42});
    expect(r.map((s) => [s.em, s.sai])).toEqual([[0, 400], [400, 1100], [3000, 3700]]);
  });
});

const docComNarracao = (): DocCenas => ({
  ...novoDocCenas({largura: 1080, altura: 1920, fps: 30}),
  cenas: [{id: 'c1', duracao_ms: 20000, blocos: []}],
  audio: {faixas: [
    {id: 'narracao', nome: 'Narração', papel: 'voz', clipes: [{id: 'clipe-1', arquivo: 'midia/fala.wav', em: 1000, duracao_ms: 8000, corte_ms: 500}]},
    {id: 'entrevista', nome: 'Entrevista', papel: 'voz', clipes: [{id: 'clipe-2', arquivo: 'midia/dra.wav', nome: 'Dra. Ana', em: 12000, duracao_ms: 4000}]},
    {id: 'musica', nome: 'Música', papel: 'musica', clipes: [{id: 'clipe-3', arquivo: 'midia/cama.mp3', em: 0, duracao_ms: 20000}]},
  ]},
});
const FALA: PalavraLegenda[] = [
  {w: 'antes', s: 0, e: 300}, {w: 'do', s: 300, e: 450}, {w: 'corte.', s: 450, e: 480},
  {w: 'Primeira', s: 600, e: 1000}, {w: 'regra.', s: 1000, e: 1400}, {w: 'Segunda', s: 2500, e: 2900}, {w: 'regra.', s: 2900, e: 3300}, {w: 'depois', s: 9000, e: 9300},
];

describe('legendas a partir da fala dos clipes', () => {
  it('as palavras vão para o tempo do vídeo (em − corte) e só as do trecho que o clipe toca', () => {
    const c = palavrasDoClipe(FALA, {id: 'clipe-1', arquivo: 'midia/fala.wav', em: 1000, duracao_ms: 8000, corte_ms: 500});
    expect(c.map((p) => p.w)).toEqual(['Primeira', 'regra.', 'Segunda', 'regra.']);
    expect(c[0]).toEqual({w: 'Primeira', s: 1100, e: 1500});
  });

  it('o falante é o nome do clipe ou, sem ele, o da faixa; a música não entra', () => {
    const doc = docComNarracao();
    const lidas: Record<string, PalavraLegenda[]> = {'midia/fala.wav.palavras.json': FALA, 'midia/dra.wav.palavras.json': [{w: 'Pode', s: 100, e: 300}, {w: 'sim.', s: 300, e: 600}]};
    const r = legendasDoDocumento(doc, (c) => lidas[c], {largura: 1080, altura: 1920});
    expect(r.faltam).toEqual([]);
    expect(r.legendas.segmentos.map((s) => [s.texto, s.falante, s.clipe])).toEqual([
      ['Primeira regra.', 'Narração', 'clipe-1'], ['Segunda regra.', 'Narração', 'clipe-1'], ['Pode sim.', 'Dra. Ana', 'clipe-2'],
    ]);
    expect(r.legendas.segmentos.map((s) => s.id)).toEqual(['leg-1', 'leg-2', 'leg-3']);
    expect(r.legendas.origens).toEqual([
      {clipe: 'clipe-1', arquivo: 'midia/fala.wav', palavras: 'midia/fala.wav.palavras.json', em: 1000, corte_ms: 500},
      {clipe: 'clipe-2', arquivo: 'midia/dra.wav', palavras: 'midia/dra.wav.palavras.json', em: 12000, corte_ms: 0},
    ]);
  });

  it('sem transcrição o clipe vai em "faltam"; pedir um clipe só troca as legendas dele', () => {
    const doc = docComNarracao();
    const r1 = legendasDoDocumento(doc, (c) => (c === 'midia/fala.wav.palavras.json' ? FALA : undefined), {largura: 1080, altura: 1920});
    expect(r1.faltam).toEqual(['midia/dra.wav']);
    doc.legendas = {...r1.legendas, segmentos: [...r1.legendas.segmentos, {id: 'leg-9', em: 15000, sai: 16000, texto: 'feita à mão'}]};
    const r2 = legendasDoDocumento(doc, () => [{w: 'Pode', s: 100, e: 300}], {largura: 1080, altura: 1920, clipe: 'clipe-2'});
    expect(r2.legendas.segmentos.map((s) => s.texto)).toEqual(['Primeira regra.', 'Segunda regra.', 'Pode', 'feita à mão']);
  });
});

describe('resolver: as legendas andam com o clipe', () => {
  const base = () => {
    const doc = docComNarracao();
    doc.legendas = legendasDaFala([{clipe: doc.audio!.faixas[0].clipes[0], faixa: doc.audio!.faixas[0], palavras: FALA, caminhoPalavras: 'midia/fala.wav.palavras.json'}],
      {largura: 1080, altura: 1920});
    return doc;
  };

  it('documento sem legendas não ganha legendas_cenas nas props', () => {
    expect('legendas_cenas' in resolverCenas(novoDocCenas({largura: 1080, altura: 1920, fps: 30})).props).toBe(false);
  });

  it('clipe movido 2 s para a frente leva as legendas junto', () => {
    const doc = base();
    const antes = resolverCenas(doc).props.legendas_cenas!.segmentos.map((s) => s.em);
    doc.audio!.faixas[0].clipes[0].em = 3000;
    const depois = resolverCenas(doc).props.legendas_cenas!;
    expect(depois.segmentos.map((s) => s.em)).toEqual(antes.map((t) => t + 2000));
    expect(depois.segmentos[0].palavras[0].s).toBe(3100);
    expect(depois.segmentos[0].origem).toBe('/legendas/segmentos/0');
  });

  it('clipe aparado no começo: as palavras cortadas somem e o resto fica no lugar', () => {
    const doc = base();
    const c = doc.audio!.faixas[0].clipes[0];
    // apara 2 s do começo: o clipe começa em 3000 com corte 2500; o "zero do arquivo" não muda (1000 − 500 = 3000 − 2500)
    Object.assign(c, {em: 3000, corte_ms: 2500, duracao_ms: 6000});
    const segs = resolverCenas(doc).props.legendas_cenas!.segmentos;
    expect(segs.map((s) => s.texto)).toEqual(['Segunda regra.']);
    expect(segs[0].em).toBe(3000);
  });

  it('clipe apagado: as legendas ficam onde estavam, com aviso; segmento quebrado vira aviso', () => {
    const doc = base();
    doc.audio!.faixas[0].clipes = [];
    (doc.legendas!.segmentos as unknown[]).push({id: 'ruim', texto: 'sem tempo'});
    const r = resolverCenas(doc);
    expect(r.props.legendas_cenas!.segmentos.map((s) => s.em)).toEqual([1100, 3000]);
    expect(r.avisos.join(' ')).toContain('clipe "clipe-1"');
    expect(r.avisos.join(' ')).toContain('uma legenda está sem começo, fim ou texto');
  });

  it('texto editado à mão (outro número de palavras) é o que aparece, com o tempo das palavras estimado', () => {
    const doc = base();
    doc.legendas!.segmentos[0].texto = 'A primeira regra de todas.';
    const s = resolverCenas(doc).props.legendas_cenas!.segmentos[0];
    expect(s.palavras.map((p) => p.w)).toEqual(['A', 'primeira', 'regra', 'de', 'todas.']);
    expect(s.palavras[0].s).toBe(s.em);
    expect(s.palavras[4].e).toBe(s.sai);
  });

  it('o estilo pega as cores e a fonte do tema, e o que o documento muda por cima', () => {
    const tema = {fundo: '#101010', texto: '#FAFAFA', destaque: '#C88155', suave: '#999999', fonte: 'Archivo'};
    const e = resolverEstilo({predefinicao: 'karaoke', posicao: 'cima', cor_destaque: '#FF0000'}, tema);
    expect([e.posicao, e.cor, e.cor_destaque, e.fonte, e.apagadas, e.tam]).toEqual(['cima', '#FAFAFA', '#FF0000', 'Archivo', true, PREDEFINICOES_LEGENDA.karaoke.tam]);
    expect(resolverEstilo({predefinicao: 'nao-existe' as never, tam: 5}, tema).id).toBe('classica');
  });
});

describe('área segura e largura', () => {
  it('9:16 fica entre o topo e a base cobertos pelas redes e longe da coluna de botões', () => {
    const a = areaDaLegenda(1080, 1920);
    expect(a.topo).toBeCloseTo(250 / 1920 + 0.01, 3);
    expect(a.base).toBeCloseTo(1 - 484 / 1920 - 0.01, 3);
    expect(a.esq).toBeCloseTo(140 / 1080, 3);
    expect(a.dir).toBe(a.esq);
  });

  it('16:9 sai dos controles do YouTube; 4:5 fica na área de título de 90%', () => {
    expect(areaDaLegenda(1920, 1080)).toEqual({topo: 0.11, base: 0.89, esq: 0.05, dir: 0.05});
    expect(areaDaLegenda(1080, 1350)).toEqual({topo: 0.060000000000000005, base: 0.94, esq: 0.05, dir: 0.05});
  });

  it('caracteres por linha crescem no 16:9 e caem na letra grande', () => {
    const v = caracteresPorLinha({predefinicao: 'classica'}, 1080, 1920);
    expect(caracteresPorLinha({predefinicao: 'classica'}, 1920, 1080)).toBeGreaterThan(v * 1.5);
    expect(caracteresPorLinha({predefinicao: 'caixa'}, 1080, 1920)).toBeLessThan(v);
  });

  it('trocar de estilo quebra de novo: na "Palavra em caixa", até 3 palavras por vez, sem perder nenhuma', () => {
    const leg: LegendasCenas = {segmentos: quebrarEmSegmentos(REFERENCIA, {max_caracteres: 60}).map((s, i) => ({id: `leg-${i + 1}`, ...s, clipe: 'c', falante: 'Narração'}))};
    const r = requebrar(leg, {predefinicao: 'caixa'}, 1080, 1920);
    expect(Math.max(...r.segmentos.map((s) => s.palavras!.length))).toBeLessThanOrEqual(3);
    expect(r.segmentos.map((s) => s.texto).join(' ')).toBe(leg.segmentos.map((s) => s.texto).join(' '));
    expect(r.segmentos.every((s) => s.falante === 'Narração' && s.clipe === 'c')).toBe(true);
  });
});

describe('editar: texto, juntar, dividir, localizar e substituir', () => {
  const seg: SegmentoLegenda = {id: 'leg-1', em: 1000, sai: 3000, texto: 'Você não é obrigado', palavras: [
    {w: 'Você', s: 1000, e: 1300}, {w: 'não', s: 1300, e: 1500}, {w: 'é', s: 1500, e: 1600}, {w: 'obrigado', s: 1600, e: 2200}]};

  it('trocar o texto com o mesmo número de palavras mantém o tempo de cada uma', () => {
    const r = comTexto(seg, 'Você não está obrigado');
    expect(r.palavras!.map((p) => [p.w, p.s])).toEqual([['Você', 1000], ['não', 1300], ['está', 1500], ['obrigado', 1600]]);
  });

  it('com outro número de palavras, espalha no tempo que as antigas ocupavam', () => {
    const r = comTexto(seg, 'Ninguém é obrigado a aceitar');
    expect(r.palavras!.length).toBe(5);
    expect(r.palavras![0].s).toBe(1000);
    expect(r.palavras![4].e).toBe(2200);
    expect(palavrasDe(r).map((p) => p.w).join(' ')).toBe('Ninguém é obrigado a aceitar');
  });

  it('juntar e dividir voltam ao que era', () => {
    const b: SegmentoLegenda = {id: 'leg-2', em: 3000, sai: 4000, texto: 'a aceitar.'};
    const j = juntarSegmentos(seg, b);
    expect([j.em, j.sai, j.texto, j.palavras!.length]).toEqual([1000, 4000, 'Você não é obrigado a aceitar.', 6]);
    const [x, y] = dividirSegmento(j, 'leg-9', 4)!;
    expect([x.texto, y.texto, y.id, y.em]).toEqual(['Você não é obrigado', 'a aceitar.', 'leg-9', j.palavras![4].s]);
    expect(dividirSegmento({id: 'u', em: 0, sai: 500, texto: 'só'}, 'z')).toBeNull();
    const meio = dividirSegmento({id: 'm', em: 0, sai: 4000, texto: 'Primeira regra, a mudança depende de você'}, 'n')!;
    expect(meio[0].texto).toBe('Primeira regra,');
  });

  it('localizar ignora caixa e acento; substituir em lote conta as trocas e não perde o tempo', () => {
    const segs: SegmentoLegenda[] = [seg, {id: 'leg-2', em: 3000, sai: 4000, texto: 'NAO é obrigado não'}, {id: 'leg-3', em: 4000, sai: 5000, texto: 'nãozinho'}];
    expect(localizar(segs, 'nao')).toEqual(['leg-1', 'leg-2', 'leg-3']);
    expect(localizar(segs, 'não', {palavra_inteira: true})).toEqual(['leg-1', 'leg-2']);
    expect(localizar(segs, 'NAO', {caixa: true})).toEqual(['leg-2']);
    const r = substituirEmLote(segs, 'não', 'nunca', {palavra_inteira: true});
    expect(r.trocas).toBe(2);
    expect(r.segmentos.map((s) => s.texto)).toEqual(['Você nunca é obrigado', 'NAO é obrigado nunca', 'nãozinho']);
    expect(r.segmentos[0].palavras![1]).toEqual({w: 'nunca', s: 1300, e: 1500});
    expect(substituirEmLote(segs, 'obrigado', '', {}).segmentos[0].texto).toBe('Você não é');
  });

  it('tempo estimado pelo tamanho da palavra', () => {
    const p = estimarPalavras('a extraordinária', 0, 1000);
    expect(p[0].e).toBeLessThan(300);
    expect(p[1]).toMatchObject({w: 'extraordinária', e: 1000});
  });
});

describe('SRT e VTT', () => {
  const segs = [
    {em: 1000, sai: 3456, texto: 'Recebeu proposta para mudar de cidade?', falante: 'Narração'},
    {em: 3500, sai: 7001, texto: 'Antes de responder, entenda as regras da transferência para o seu caso.', falante: 'Dra. Ana'},
    {em: 3_725_042, sai: 3_727_000, texto: 'Fim & 1 < 2'},
  ];

  it('carimbos no formato de cada um', () => {
    expect(carimboLegenda(3_725_042, ',')).toBe('01:02:05,042');
    expect(carimboLegenda(1500, '.')).toBe('00:00:01.500');
  });

  it('SRT vai e volta sem perder um milissegundo', () => {
    const srt = paraSrt(segs);
    expect(srt.startsWith('1\n00:00:01,000 --> 00:00:03,456\nRecebeu proposta para mudar de cidade?\n\n2\n')).toBe(true);
    const lido = lerLegendas(srt, 'x.srt');
    expect(lido.formato).toBe('srt');
    expect(lido.avisos).toEqual([]);
    expect(lido.segmentos.map((s) => [s.em, s.sai])).toEqual(segs.map((s) => [s.em, s.sai]));
    expect(lido.segmentos.map((s) => s.texto.replace(/\n/g, ' '))).toEqual(segs.map((s) => s.texto));
  });

  it('VTT vai e volta com o falante na marca de voz e os caracteres escapados', () => {
    const vtt = paraVtt(segs);
    expect(vtt.startsWith('WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.456\n<v Narração>Recebeu')).toBe(true);
    expect(vtt).toContain('Fim &amp; 1 &lt; 2');
    const lido = lerLegendas(vtt);
    expect(lido.formato).toBe('vtt');
    expect(lido.segmentos.map((s) => [s.em, s.sai, s.falante])).toEqual(segs.map((s) => [s.em, s.sai, s.falante]));
    expect(lido.segmentos[2].texto).toBe('Fim & 1 < 2');
  });

  it('a linha longa quebra em duas equilibradas; a quebra à mão manda', () => {
    expect(linhasDaLegenda(segs[1].texto, 42)).toEqual(['Antes de responder, entenda as regras', 'da transferência para o seu caso.']);
    expect(linhasDaLegenda('um\ndois')).toEqual(['um', 'dois']);
  });

  it('lê os arquivos do mundo: BOM, CRLF, sem número, MM:SS, ajustes de cue, NOTE, STYLE e etiquetas', () => {
    const vtt = '﻿WEBVTT - legendas\r\n\r\nSTYLE\r\n::cue { color: yellow }\r\n\r\nNOTE isto é comentário\r\n\r\n00:01.000 --> 00:02.500 align:start position:10%\r\n'
      + '<c.amarelo><i>Olá</i></c> <00:01.500>mundo\r\n\r\n00:00:03.000 --> 00:00:04.000\r\n<v.loud Juiz>Silêncio!\r\n';
    const r = lerLegendas(vtt, 'a.vtt');
    expect(r.segmentos).toEqual([{em: 1000, sai: 2500, texto: 'Olá mundo'}, {em: 3000, sai: 4000, texto: 'Silêncio!', falante: 'Juiz'}]);
    const srt = '1\r\n00:00:01,5 --> 00:00:02,000\r\n{\\an8}<font color="red">Em cima</font>\r\n\r\nlixo sem tempo\r\n\r\n3\r\n00:00:05,000 --> 00:00:04,000\r\nvolta no tempo\r\n';
    const s = lerLegendas(srt, 'b.srt');
    expect(s.segmentos[0]).toEqual({em: 1500, sai: 2000, texto: 'Em cima'});
    expect(s.segmentos[1].sai).toBe(5100);
    expect(s.avisos).toEqual(['trecho sem tempo ignorado: "lixo sem tempo"']);
  });

  it('o arquivo importado vira legendas do documento, com o tempo das palavras estimado', () => {
    const {legendas} = legendasDeArquivo(paraSrt(segs.slice(0, 2)), 'a.srt', {predefinicao: 'karaoke'});
    expect(legendas.estilo?.predefinicao).toBe('karaoke');
    expect(legendas.segmentos.map((s) => s.id)).toEqual(['leg-1', 'leg-2']);
    const p = resolverLegendas(legendas, {largura: 1080, altura: 1920, tema: novoDocCenas({largura: 1080, altura: 1920, fps: 30}).tema, duracao_ms: 60000})!;
    expect(p.segmentos[0].palavras.length).toBe(6);
  });
});

describe('transcritor: zip e download conferido', () => {
  /** Zip mínimo com uma entrada guardada e uma em deflate, numa pasta, como o pacote do whisper.cpp. */
  const montarZip = (arquivos: {nome: string; dados: Buffer; deflate?: boolean}[]) => {
    const locais: Buffer[] = [];
    const centrais: Buffer[] = [];
    let pos = 0;
    for (const a of arquivos) {
      const corpo = a.deflate ? deflateRawSync(a.dados) : a.dados;
      const nome = Buffer.from(a.nome, 'utf-8');
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(a.deflate ? 8 : 0, 8);
      local.writeUInt32LE(corpo.length, 18);
      local.writeUInt32LE(a.dados.length, 22);
      local.writeUInt16LE(nome.length, 26);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(a.deflate ? 8 : 0, 10);
      central.writeUInt32LE(corpo.length, 20);
      central.writeUInt32LE(a.dados.length, 24);
      central.writeUInt16LE(nome.length, 28);
      central.writeUInt32LE(pos, 42);
      locais.push(local, nome, corpo);
      centrais.push(central, nome);
      pos += 30 + nome.length + corpo.length;
    }
    const dir = Buffer.concat(centrais);
    const fim = Buffer.alloc(22);
    fim.writeUInt32LE(0x06054b50, 0);
    fim.writeUInt16LE(arquivos.length, 8);
    fim.writeUInt16LE(arquivos.length, 10);
    fim.writeUInt32LE(dir.length, 12);
    fim.writeUInt32LE(pos, 16);
    return Buffer.concat([...locais, dir, fim]);
  };

  it('extrai só o que pede, sem as pastas do zip', () => {
    const pasta = mkdtempSync(path.join(tmpdir(), 'estudio-zip-'));
    temporarias.push(pasta);
    const exe = Buffer.from('MZ'.repeat(5000));
    const zip = montarZip([{nome: 'Release/whisper-cli.exe', dados: exe, deflate: true}, {nome: 'Release/whisper.dll', dados: Buffer.from('dll')},
      {nome: 'Release/', dados: Buffer.alloc(0)}, {nome: 'Release/leia.txt', dados: Buffer.from('não')}]);
    expect(extrairZip(zip, pasta, (n) => n.endsWith('.exe') || n.endsWith('.dll'))).toEqual(['whisper-cli.exe', 'whisper.dll']);
    expect(readFileSync(path.join(pasta, 'whisper-cli.exe')).equals(exe)).toBe(true);
    expect(existsSync(path.join(pasta, 'leia.txt'))).toBe(false);
    expect(() => extrairZip(Buffer.from('não é zip'), pasta, () => true)).toThrow(/zip válido/);
  });

  it('baixa por um .parcial e só fica com o arquivo se o SHA-256 bater', async () => {
    const pasta = mkdtempSync(path.join(tmpdir(), 'estudio-baixar-'));
    temporarias.push(pasta);
    const dados = Buffer.from('modelo de mentira '.repeat(1000));
    const sha256 = createHash('sha256').update(dados).digest('hex');
    const buscar = async () => new Response(new Blob([dados]).stream(), {status: 200});
    const andamentos: number[] = [];
    const destino = path.join(pasta, 'm.bin');
    await baixarConferido({url: 'https://exemplo/m.bin', destino, bytes: dados.length, sha256, buscar, andamento: (r) => andamentos.push(r)});
    expect(readFileSync(destino).equals(dados)).toBe(true);
    expect(andamentos[andamentos.length - 1]).toBe(dados.length);
    const outro = path.join(pasta, 'errado.bin');
    await expect(baixarConferido({url: 'https://exemplo/m.bin', destino: outro, bytes: dados.length, sha256: '0'.repeat(64), buscar})).rejects.toThrow(/não confere/);
    expect(existsSync(outro) || existsSync(`${outro}.parcial`)).toBe(false);
    await expect(baixarConferido({url: 'https://exemplo/m.bin', destino: outro, bytes: 10, sha256, buscar})).rejects.toThrow(/passou do tamanho/);
    await expect(baixarConferido({url: 'https://exemplo/x', destino: outro, bytes: 10, sha256, buscar: async () => new Response('nada', {status: 404})})).rejects.toThrow(/HTTP 404/);
  });
});
