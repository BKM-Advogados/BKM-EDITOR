// Freeverb e delay nativos por bloco (retornos 1 e 2): PCM idêntico às funções antigas de musica-som.ts (`reverberar`,
// `atrasar`), em qualquer tamanho de bloco, em várias taxas e configurações, e com estado em JSON. O oráculo do
// documento inteiro está em audio-grafo-oraculo.test.ts. Ver docs/audio-grafo.md.
import {describe, expect, it} from 'vitest';
import {Delay as DelayEstereo} from '../src/nucleo/audio-grafo/delay';
import {executarOffline} from '../src/nucleo/audio-grafo/executor';
import {Freeverb} from '../src/nucleo/audio-grafo/freeverb';
import {Grafo} from '../src/nucleo/audio-grafo/grafo';
import {Fonte} from '../src/nucleo/audio-grafo/processadores';
import type {EstadoProcessador, Processador} from '../src/nucleo/audio-grafo/tipos';
import {atrasar, geradorDe, reverberar} from '../src/nucleo/musica-som';

const estereo = (n: number, semente: number) => [semente, semente + 100].map((s) => {
  const g = geradorDe(s);
  const x = Float32Array.from({length: n}, () => g() * 2 - 1);
  for (let i = 0; i < n; i += 997) x[i] = 0; // valores pequenos e zeros: cantos de arredondamento
  x[3] = 1e-30;
  x[5] = -1e-30;
  return x;
});

const rodar = (p: Processador, x: Float32Array[], taxa: number, bloco: number) => {
  const g = new Grafo();
  g.no('f', new Fonte(x));
  g.no('p', p);
  g.ligar('f', 'p');
  return executarOffline(g, {taxa, n: x[0].length, saida: 'p', bloco}).canais;
};
const igual = (a: Float32Array[], b: Float32Array[]) => {
  for (let c = 0; c < 2; c++) {
    expect(a[c].length).toBe(b[c].length);
    for (let i = 0; i < a[c].length; i++) if (!Object.is(a[c][i], b[c][i])) throw new Error(`canal ${c} amostra ${i}: ${a[c][i]} != ${b[c][i]}`);
  }
};

describe('Freeverb nativo', () => {
  for (const [taxa, tam, amo] of [[48000, 0.5, 0.5], [44100, 0, 0], [48000, 1, 1], [22050, 0.8, 0.2], [96000, 0.3, 0.9]]) {
    it(`igual a reverberar (${taxa} Hz, tamanho ${tam}, amortecimento ${amo}), com blocos de 1, 128 e maior que a música`, () => {
      const n = 6000;
      const x = estereo(n, 7);
      const ref = reverberar(x.map((c) => Float32Array.from(c)), tam, amo, taxa);
      for (const bloco of [1, 128, 777, n + 50]) igual(rodar(new Freeverb(tam, amo), x, taxa, bloco), ref);
    });
  }
  it('estado em JSON: parar no meio, restaurar noutro e continuar dá o mesmo; resetar volta ao silêncio', () => {
    const n = 4000, meio = 1531, taxa = 48000;
    const x = estereo(n, 11);
    const ctx = {inicio: 0, taxa, param: () => 0};
    const saidas = (m: number) => [[new Float32Array(m), new Float32Array(m)]];
    const a = new Freeverb(0.6, 0.4);
    a.preparar(taxa, n);
    const pa = saidas(meio);
    a.processar([x.map((c) => c.subarray(0, meio))], pa, meio, ctx);
    const b = new Freeverb(0.6, 0.4);
    b.preparar(taxa, n);
    b.restaurar(JSON.parse(JSON.stringify(a.estado())) as EstadoProcessador);
    const pb = saidas(n - meio);
    b.processar([x.map((c) => c.subarray(meio))], pb, n - meio, ctx);
    const ref = reverberar(x, 0.6, 0.4, taxa);
    igual([Float32Array.from([...pa[0][0], ...pb[0][0]]), Float32Array.from([...pa[0][1], ...pb[0][1]])], ref);
    b.resetar();
    expect(Math.max(...(b.estado().lados as {pentes: number[][]}[]).flatMap((l) => l.pentes.flat()).map(Math.abs))).toBe(0);
  });
});

describe('delay estéreo nativo', () => {
  for (const pingue of [true, false]) {
    for (const [taxa, atraso, fb, brilho] of [[48000, 0.375, 0.4, 0.5], [44100, 0.0001, 0.9, 0], [48000, 0.2, 0, 1], [22050, 0.5, 0.95, 0.3]]) {
      it(`igual a atrasar (${pingue ? 'pingue-pongue' : 'normal'}, ${taxa} Hz, ${atraso} s, realimentação ${fb}, brilho ${brilho})`, () => {
        const n = 30000;
        const x = estereo(n, 5);
        const ref = atrasar(x.map((c) => Float32Array.from(c)), atraso, fb, brilho, pingue, taxa);
        for (const bloco of [1, 128, 1000, n + 5]) igual(rodar(new DelayEstereo(atraso, fb, brilho, pingue), x, taxa, bloco), ref);
      });
    }
  }
  it('estado em JSON: parar no meio, restaurar noutro e continuar dá o mesmo; resetar zera', () => {
    const n = 9000, meio = 4321, taxa = 48000;
    const x = estereo(n, 3);
    const ctx = {inicio: 0, taxa, param: () => 0};
    const saidas = (m: number) => [[new Float32Array(m), new Float32Array(m)]];
    const a = new DelayEstereo(0.1, 0.6, 0.4, true);
    a.preparar(taxa, n);
    const pa = saidas(meio);
    a.processar([x.map((c) => c.subarray(0, meio))], pa, meio, ctx);
    const b = new DelayEstereo(0.1, 0.6, 0.4, true);
    b.preparar(taxa, n);
    b.restaurar(JSON.parse(JSON.stringify(a.estado())) as EstadoProcessador);
    const pb = saidas(n - meio);
    b.processar([x.map((c) => c.subarray(meio))], pb, n - meio, ctx);
    const ref = atrasar(x, 0.1, 0.6, 0.4, true, taxa);
    igual([Float32Array.from([...pa[0][0], ...pb[0][0]]), Float32Array.from([...pa[0][1], ...pb[0][1]])], ref);
    b.resetar();
    expect(b.estado().k).toBe(0);
    expect(Math.max(...(b.estado().l as number[]).map(Math.abs))).toBe(0);
  });
});
