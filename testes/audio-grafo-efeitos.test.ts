// Os efeitos do mixer como processadores por bloco (M-04): cada um dá, bit a bit, o mesmo que a função de buffer inteiro
// do motor antigo (musica-som.ts), em qualquer tamanho de bloco, e para no meio, vira JSON e continua noutro objeto sem
// mudar uma amostra. O limitador é causal: a saída vem `latencia` amostras atrasada. Ver docs/audio-grafo.md.
import {describe, expect, it} from 'vitest';
import {Compressor} from '../src/nucleo/audio-grafo/compressor';
import {Delay} from '../src/nucleo/audio-grafo/delay';
import {Eq3} from '../src/nucleo/audio-grafo/eq3';
import {Freeverb} from '../src/nucleo/audio-grafo/freeverb';
import {Limitador} from '../src/nucleo/audio-grafo/limitador';
import type {Processador} from '../src/nucleo/audio-grafo/tipos';
import {atrasar, comprimir, filtrarNoLugar, geradorDe, limitarNoLugar, prateleiraAgudos, prateleiraGraves, reverberar, sino} from '../src/nucleo/musica-som';

const TAXA = 48000;
const ruido = (n: number, semente: number, amp = 0.8) => {
  const g = geradorDe(semente);
  // ruído com rajadas: passa do teto do limitador e mexe no compressor; alguns −0 e zeros no meio
  return [0, 1].map(() => Float32Array.from({length: n}, (_, i) => (i % 997 < 40 ? 0 : i % 5003 < 300 ? g() * 2.5 : g() * amp * Math.sin(i / 3000)) || -0));
};

/** Roda o processador em blocos de `bloco` sobre a entrada (silêncio depois do fim), por `n + extra` amostras; com
 *  `parar`, serializa o estado no meio e continua num objeto novo. */
const rodar = (fazer: () => Processador, entrada: Float32Array[], bloco: number, extra = 0, parar?: number) => {
  let p = fazer();
  p.preparar(TAXA, bloco);
  p.resetar();
  const total = entrada[0].length + extra;
  const out = [new Float32Array(total), new Float32Array(total)];
  const ib = [new Float32Array(bloco), new Float32Array(bloco)], ob = [new Float32Array(bloco), new Float32Array(bloco)];
  for (let t = 0; t < total; t += bloco) {
    if (parar !== undefined && t >= parar && t - bloco < parar) {
      const json = JSON.parse(JSON.stringify(p.estado()));
      p = fazer();
      p.preparar(TAXA, bloco);
      p.restaurar(json);
    }
    const bn = Math.min(bloco, total - t);
    for (let c = 0; c < 2; c++) for (let i = 0; i < bn; i++) ib[c][i] = entrada[c][t + i] ?? 0;
    p.processar([ib], [ob], bn, {inicio: t, taxa: TAXA, param: () => 0});
    for (let c = 0; c < 2; c++) out[c].set(ob[c].subarray(0, bn), t);
  }
  return out;
};

const igual = (a: Float32Array[], b: Float32Array[], onde: string) => {
  for (let c = 0; c < a.length; c++) {
    const x = new Uint32Array(a[c].buffer, a[c].byteOffset, a[c].length), y = new Uint32Array(b[c].buffer, b[c].byteOffset, b[c].length);
    expect(x.length, onde).toBe(y.length);
    let i = 0;
    while (i < x.length && x[i] === y[i]) i++;
    expect(i === x.length ? 'igual' : `canal ${c}, amostra ${i}: ${a[c][i]} ≠ ${b[c][i]}`, onde).toBe('igual');
  }
};

const N = 30_000;
const BLOCOS = [1, 7, 128, 4096, N + 10];

describe('efeitos por bloco = motor antigo', () => {
  const casos: {nome: string; fazer: () => Processador; antigo: (x: Float32Array[]) => Float32Array[]}[] = [
    {nome: 'eq3', fazer: () => new Eq3({graves_db: 4, medios_db: -3, agudos_db: 6}), antigo: (x) => x.map((c) => {
      const y = c.slice();
      filtrarNoLugar(y, prateleiraGraves(200, 4, TAXA));
      filtrarNoLugar(y, sino(1000, 0.9, -3, TAXA));
      return filtrarNoLugar(y, prateleiraAgudos(5000, 6, TAXA));
    })},
    {nome: 'eq3 só agudos', fazer: () => new Eq3({graves_db: 0, medios_db: 0, agudos_db: -5}), antigo: (x) => x.map((c) => filtrarNoLugar(c.slice(), prateleiraAgudos(5000, -5, TAXA)))},
    {nome: 'compressor', fazer: () => new Compressor({ativo: true, limiar_db: -18, razao: 4, ataque_ms: 5, soltura_ms: 120, ganho_db: 3}), antigo: (x) => {
      const y = x.map((c) => c.slice());
      comprimir(y, {ativo: true, limiar_db: -18, razao: 4, ataque_ms: 5, soltura_ms: 120, ganho_db: 3}, TAXA);
      return y;
    }},
    {nome: 'freeverb', fazer: () => new Freeverb(0.7, 0.4), antigo: (x) => reverberar(x, 0.7, 0.4, TAXA)},
    {nome: 'delay', fazer: () => new Delay(0.123, 0.55, 0.3, false), antigo: (x) => atrasar(x, 0.123, 0.55, 0.3, false, TAXA)},
    {nome: 'delay pingue-pongue', fazer: () => new Delay(0.05, 0.7, 0.9, true), antigo: (x) => atrasar(x, 0.05, 0.7, 0.9, true, TAXA)},
  ];
  for (const k of casos) {
    it(`${k.nome}: blocos de 1 a maior que o sinal, e o estado em JSON no meio`, () => {
      const x = ruido(N, 5);
      const esperado = k.antigo(x.map((c) => c.slice()));
      for (const b of BLOCOS) igual(rodar(k.fazer, x, b), esperado, `${k.nome}, bloco ${b}`);
      igual(rodar(k.fazer, x, 128, 0, 12_800), esperado, `${k.nome}, parando no meio`);
    });
  }

  it('limitador: causal com latência de 1,5 ms, a mesma redução e a mesma cauda', () => {
    for (const [teto, soltura, amp] of [[-1, 80, 0.8], [-6, 20, 1.5], [-0.3, 200, 0.3], [0, 50, 0.01]] as const) {
      const x = ruido(N, 11, amp);
      const esperado = x.map((c) => c.slice());
      const reducao = limitarNoLugar(esperado, teto, soltura, TAXA);
      expect(reducao > 0, `teto ${teto}: o teste tem que passar do teto`).toBe(true);
      const fazer = () => new Limitador(teto, soltura, N);
      const p = fazer();
      p.preparar(TAXA, 128);
      const la = p.latencia;
      expect(la).toBe(72);
      for (const b of [1, 64, 128, 999, N + 100]) {
        let lim: Limitador | null = null;
        const out = rodar(() => (lim = fazer()), x, b, la);
        igual(out.map((c) => c.subarray(la)), esperado, `teto ${teto}, bloco ${b}`);
        expect(lim!.reducao_db, `teto ${teto}`).toBe(reducao);
      }
      igual(rodar(fazer, x, 128, la, 9_000).map((c) => c.subarray(la)), esperado, `teto ${teto}, parando no meio`);
    }
  });

  it('limitador: o que chega depois do fim (a cauda de um reverb) não muda a música', () => {
    const x = ruido(N, 3, 1.4);
    const esperado = x.map((c) => c.slice());
    limitarNoLugar(esperado, -1, 60, TAXA);
    const comCauda = x.map((c) => {
      const y = new Float32Array(N + 500);
      y.set(c);
      y.fill(3, N); // muito acima do teto, depois do fim
      return y;
    });
    const p = new Limitador(-1, 60, N);
    p.preparar(TAXA, 128);
    const out = rodar(() => new Limitador(-1, 60, N), comCauda, 128, p.latencia - 500);
    igual(out.map((c) => c.subarray(p.latencia, p.latencia + N)), esperado, 'cauda');
  });
});
