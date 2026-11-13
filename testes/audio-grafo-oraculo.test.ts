// Oráculo da migração do motor (M-01): o render pelo grafo de processadores (renderizarMusica) tem que dar o mesmo PCM,
// bit a bit, que o motor antigo de buffer inteiro (renderizarMusicaAntigo), nos documentos de referência da M0 e em
// variações que cutucam as bordas (pan nos extremos, que gera −0; solo, mudo, ids repetidos, áudio faltando, master no
// limitador, blocos de tamanhos diferentes, a prévia com cache). Quem converter um adaptador em processador nativo roda
// isto: se algo mudar, o teste diz onde (mistura, stem de faixa, retorno, redução do limitador). Ver docs/audio-grafo.md.
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {audiosDaMusica, type DocMusica} from '../src/nucleo/musica';
import {renderizarMusica, renderizarMusicaAntigo, TAXA_MUSICA, type CacheSom, type ResultadoSom} from '../src/nucleo/musica-som';
import {grafoDaMusica, renderizarMusicaGrafo} from '../src/nucleo/audio-grafo/musica';
import {hashDoPcm} from '../src/nucleo/musica-hash';
import {lerWav} from '../src/main/ffmpeg-som';
import type {FonteAudio} from '../src/nucleo/loudness';

const PASTA = path.join(__dirname, 'fixtures', 'musica-referencia');
const nomes = readdirSync(PASTA).filter((f) => f.endsWith('.json') && f !== 'hashes.json').map((f) => f.replace(/\.json$/, '')).sort();
const lerDoc = (nome: string) => JSON.parse(readFileSync(path.join(PASTA, `${nome}.json`), 'utf8')) as DocMusica;
const fontesDe = (doc: DocMusica): Record<string, FonteAudio> =>
  Object.fromEntries(audiosDaMusica(doc).map((a) => [a, lerWav(readFileSync(path.join(PASTA, a)))]));

/** Bytes iguais (o hash do PCM), canal a canal, com a primeira amostra diferente na mensagem. */
const mesmoPcm = (a: Float32Array[], b: Float32Array[], onde: string) => {
  expect(a.length, `${onde}: canais`).toBe(b.length);
  for (let k = 0; k < a.length; k++) {
    expect(a[k].length, `${onde}: amostras do canal ${k}`).toBe(b[k].length);
    const ua = new Uint32Array(a[k].buffer, a[k].byteOffset, a[k].length), ub = new Uint32Array(b[k].buffer, b[k].byteOffset, b[k].length);
    let i = 0;
    while (i < ua.length && ua[i] === ub[i]) i++;
    expect(i === ua.length ? 'igual' : `difere na amostra ${i}: ${a[k][i]} contra ${b[k][i]}`, `${onde}: canal ${k}`).toBe('igual');
  }
};

/** O resultado inteiro igual: mistura, stems de faixa, retornos, redução do limitador, avisos e o que faltou. */
const mesmoResultado = (novo: ResultadoSom, antigo: ResultadoSom, onde: string) => {
  mesmoPcm(novo.canais, antigo.canais, `${onde} (mistura)`);
  expect({d: novo.duracao_s, t: novo.taxa, a: novo.avisos, f: novo.faltando, l: novo.limitador_db}, onde).toEqual({d: antigo.duracao_s, t: antigo.taxa, a: antigo.avisos, f: antigo.faltando, l: antigo.limitador_db});
  expect(Object.keys(novo.faixas ?? {}), `${onde}: faixas`).toEqual(Object.keys(antigo.faixas ?? {}));
  for (const [id, c] of Object.entries(antigo.faixas ?? {})) mesmoPcm(novo.faixas![id], c, `${onde} (faixa ${id})`);
  expect(Object.keys(novo.retornos ?? {}), `${onde}: retornos`).toEqual(Object.keys(antigo.retornos ?? {}));
  for (const [id, c] of Object.entries(antigo.retornos ?? {})) mesmoPcm(novo.retornos![id as 'reverb']!, c!, `${onde} (retorno ${id})`);
};

const comparar = (doc: DocMusica, fontes: Record<string, FonteAudio | undefined>, onde: string, o: {porFaixa?: boolean; bloco?: number; duracao_s?: number} = {}) => {
  const antigo = renderizarMusicaAntigo(doc, fontes, {porFaixa: o.porFaixa, duracao_s: o.duracao_s});
  const novo = renderizarMusicaGrafo(doc, fontes, {porFaixa: o.porFaixa, bloco: o.bloco, duracao_s: o.duracao_s});
  mesmoResultado(novo, antigo, onde);
  return novo;
};

describe('grafo contra o motor antigo: documentos de referência', () => {
  it('o render canônico do app é o do grafo', () => {
    expect(renderizarMusica).toBe(renderizarMusicaGrafo);
  });

  for (const nome of nomes) {
    it(`${nome}: mesmo PCM, mesmos stems e retornos`, () => {
      const doc = lerDoc(nome);
      comparar(doc, fontesDe(doc), nome, {porFaixa: true});
    });
  }
});

describe('grafo contra o motor antigo: bordas', () => {
  const base = () => lerDoc('delay-limitador');

  it('o tamanho do bloco não muda um bit (1, 7, 128, 1000 e maior que a música)', () => {
    const doc = lerDoc('sidechain-automacao');
    const fontes = fontesDe(doc);
    const ref = hashDoPcm(renderizarMusicaAntigo(doc, fontes).canais);
    for (const bloco of [1, 7, 128, 1000, 1 << 22]) expect(hashDoPcm(renderizarMusicaGrafo(doc, fontes, {bloco, duracao_s: bloco === 1 ? 2 : undefined}).canais), `bloco ${bloco}`)
      .toBe(bloco === 1 ? hashDoPcm(renderizarMusicaAntigo(doc, fontes, {duracao_s: 2}).canais) : ref);
  });

  it('pan nos extremos (−0 no lado calado), volumes, retornos com volume e master acima do limitador', () => {
    const doc = base();
    doc.mixer.faixas!.forEach((f, i) => {
      f.pan = i % 2 ? 1 : -1;
      f.volume_db = i - 2;
      f.reverb = 0.4;
      f.delay = 0.3;
    });
    const m = doc.mixer.master ?? {};
    doc.mixer.master = {...m, volume_db: 4, reverb: {...m.reverb, volume_db: -2}, delay: {...m.delay, volume_db: 3}};
    comparar(doc, {}, 'extremos', {porFaixa: true});
  });

  it('uma faixa só, toda de um lado e sem nada depois: o master soma do +0 (o lado calado sai +0, não −0)', () => {
    const doc = base();
    doc.mixer.faixas.forEach((f, i) => {
      f.solo = i === 0;
      f.pan = 1;
      f.reverb = 0;
      f.delay = 0;
    });
    doc.mixer.master = {volume_db: 0, limitador: {ativo: false}};
    const r = comparar(doc, {}, 'um lado só', {porFaixa: true});
    const stem = Object.values(r.faixas!)[0][0];
    expect(stem.some((v) => Object.is(v, -0)), 'o stem tem −0 no lado calado').toBe(true);
    expect(r.canais[0].some((v) => Object.is(v, -0)), 'a mistura não tem −0').toBe(false);
  });

  it('solo de canal e de faixa, faixa muda, canal sem faixa no documento, sem limitador e sem retornos', () => {
    const doc = base();
    doc.canais[0].solo = true;
    doc.canais[1].solo = true;
    comparar(doc, {}, 'solo de canal', {porFaixa: true});
    const d2 = base();
    d2.mixer.faixas![0].solo = true;
    d2.mixer.faixas![1].mudo = true;
    d2.mixer.master = {...d2.mixer.master, limitador: {ativo: false}};
    d2.mixer.faixas!.forEach((f) => {
      f.reverb = 0;
      f.delay = 0;
    });
    comparar(d2, {}, 'solo de faixa, sem limitador', {porFaixa: true});
    const d3 = base();
    d3.mixer.faixas = [];
    comparar(d3, {}, 'faixas implícitas', {porFaixa: true});
  });

  it('ids repetidos de faixa e de canal (o motor antigo aceita; o grafo não pode quebrar)', () => {
    const doc = base();
    doc.canais[1].faixa_mixer = doc.canais[0].faixa_mixer;
    doc.canais.push({...doc.canais[0]});
    doc.mixer.faixas!.push({...doc.mixer.faixas![0]});
    comparar(doc, {}, 'ids repetidos', {porFaixa: true});
  });

  it('áudio que falta: calado, nos avisos e em faltando, igual', () => {
    const doc = lerDoc('sintetizadores-audio');
    comparar(doc, {}, 'sem as fontes', {porFaixa: true});
  });

  it('duração pedida mais curta e mais longa que a música', () => {
    const doc = lerDoc('efeito-sonoro');
    comparar(doc, {}, 'curta', {duracao_s: 0.3});
    comparar(doc, {}, 'longa', {duracao_s: 5});
  });

  it('a prévia com cache: mesmo PCM e as mesmas chaves no cache que o motor antigo, mexendo e voltando', () => {
    const doc = lerDoc('batida');
    const fontes = fontesDe(doc);
    const cNovo: CacheSom = new Map(), cAntigo: CacheSom = new Map();
    const passos: ((d: DocMusica) => void)[] = [
      () => {},
      (d) => (d.mixer.faixas![0].volume_db = -6),
      (d) => (d.mixer.faixas![1].reverb = 0.5),
      (d) => (d.mixer.master = {...d.mixer.master, volume_db: -2}),
      () => {},
    ];
    for (const [i, mexer] of passos.entries()) {
      const d = structuredClone(doc);
      mexer(d);
      const novo = renderizarMusicaGrafo(d, fontes, {cache: cNovo, porFaixa: i % 2 === 0});
      const antigo = renderizarMusicaAntigo(d, fontes, {cache: cAntigo, porFaixa: i % 2 === 0});
      mesmoResultado(novo, antigo, `passo ${i}`);
      expect([...cNovo.keys()].sort(), `chaves do cache no passo ${i}`).toEqual([...cAntigo.keys()].sort());
    }
  });

  it('o grafo da música tem os nós com os endereços da M-02 e ordem estável', () => {
    const doc = lerDoc('sidechain-automacao');
    const a = grafoDaMusica(doc, {});
    const b = grafoDaMusica(doc, {});
    expect(a.grafo.ordemTopologica()).toEqual(b.grafo.ordemTopologica());
    const ids = [...a.grafo.nos.keys()];
    expect(ids).toContain('master');
    expect(ids.some((id) => /^faixa:[^/]+\/volume_pan$/.test(id))).toBe(true);
    expect(ids.some((id) => /^faixa:[^/]+\/automacao$/.test(id))).toBe(true);
    expect([...a.grafo.automacoes.keys()].every((e) => /^(faixa:[^/]+|master)\/volume_db$/.test(e))).toBe(true);
    expect(a.taxa).toBe(TAXA_MUSICA);
  });
});
