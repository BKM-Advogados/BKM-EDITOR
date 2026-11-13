// Os efeitos do mixer como processadores por bloco (M-04): cada um dá, bit a bit, o mesmo que a função de buffer inteiro
// do motor antigo (musica-som.ts), em qualquer tamanho de bloco, e para no meio, vira JSON e continua noutro objeto sem
// mudar uma amostra. O limitador é causal: a saída vem `latencia` amostras atrasada. Ver docs/audio-grafo.md.
import {describe, expect, it} from 'vitest';
import {Compressor} from '../src/nucleo/audio-grafo/compressor';
import {Delay} from '../src/nucleo/audio-grafo/delay';
import {Eq3} from '../src/nucleo/audio-grafo/eq3';
import {Freeverb} from '../src/nucleo/audio-grafo/freeverb';
import {Limitador} from '../src/nucleo/audio-grafo/limitador';
import {executarOffline} from '../src/nucleo/audio-grafo/executor';
import {Grafo} from '../src/nucleo/audio-grafo/grafo';
import {Fonte} from '../src/nucleo/audio-grafo/processadores';
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
const rodar = (fazer: () => Processador, entrada: Float32Array[], bloco: number, extra = 0, parar?: number, params: Record<string, number> = {}) => {
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
    p.processar([ib], [ob], bn, {inicio: t, taxa: TAXA, param: (nome) => params[nome] ?? 0});
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
  const casos: {nome: string; fazer: () => Processador; params?: Record<string, number>; antigo: (x: Float32Array[]) => Float32Array[]}[] = [
    {nome: 'eq3', fazer: () => new Eq3(), params: {graves_db: 4, medios_db: -3, agudos_db: 6}, antigo: (x) => x.map((c) => {
      const y = c.slice();
      filtrarNoLugar(y, prateleiraGraves(200, 4, TAXA));
      filtrarNoLugar(y, sino(1000, 0.9, -3, TAXA));
      return filtrarNoLugar(y, prateleiraAgudos(5000, 6, TAXA));
    })},
    {nome: 'eq3 só agudos', fazer: () => new Eq3(), params: {graves_db: 0, medios_db: 0, agudos_db: -5}, antigo: (x) => x.map((c) => filtrarNoLugar(c.slice(), prateleiraAgudos(5000, -5, TAXA)))},
    {nome: 'compressor', fazer: () => new Compressor(), params: {limiar_db: -18, razao: 4, ataque_ms: 5, soltura_ms: 120, ganho_db: 3}, antigo: (x) => {
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
      for (const b of BLOCOS) igual(rodar(k.fazer, x, b, 0, undefined, k.params), esperado, `${k.nome}, bloco ${b}`);
      igual(rodar(k.fazer, x, 128, 0, 12_800, k.params), esperado, `${k.nome}, parando no meio`);
    });
  }

  it('limitador: causal com latência de 1,5 ms, a mesma redução e a mesma cauda', () => {
    for (const [teto, soltura, amp] of [[-1, 80, 0.8], [-6, 20, 1.5], [-0.3, 200, 0.3], [0, 50, 0.01]] as const) {
      const x = ruido(N, 11, amp);
      const esperado = x.map((c) => c.slice());
      const reducao = limitarNoLugar(esperado, teto, soltura, TAXA);
      expect(reducao > 0, `teto ${teto}: o teste tem que passar do teto`).toBe(true);
      const fazer = () => new Limitador(N);
      const params = {teto_db: teto, soltura_ms: soltura};
      const p = fazer();
      p.preparar(TAXA, 128);
      const la = p.latencia;
      expect(la).toBe(72);
      for (const b of [1, 64, 128, 999, N + 100]) {
        let lim: Limitador | null = null;
        const out = rodar(() => (lim = fazer()), x, b, la, undefined, params);
        igual(out.map((c) => c.subarray(la)), esperado, `teto ${teto}, bloco ${b}`);
        expect(lim!.reducao_db, `teto ${teto}`).toBe(reducao);
      }
      igual(rodar(fazer, x, 128, la, 9_000, params).map((c) => c.subarray(la)), esperado, `teto ${teto}, parando no meio`);
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
    const p = new Limitador(N);
    p.preparar(TAXA, 128);
    const out = rodar(() => new Limitador(N), comCauda, 128, p.latencia - 500, undefined, {teto_db: -1, soltura_ms: 60});
    igual(out.map((c) => c.subarray(p.latencia, p.latencia + N)), esperado, 'cauda');
  });
});

// Pelo executor, com os parâmetros ligados como no grafo da música, e com as bordas: sinal mais curto que o lookahead, pico
// na primeira e na última amostra, −0 e estado em JSON no meio.
const sinalFx = (n: number, semente: number, amp = 1) => {
  const g = geradorDe(semente);
  return [0, 1].map((c) => Float32Array.from({length: n}, (_, i) => amp * (g() - 0.5) * 2 * (0.3 + Math.abs(Math.sin(i / 4000 + c))) ));
};
const copiaFx = (x: Float32Array[]) => x.map((c) => Float32Array.from(c));
const igualFx = (a: Float32Array[], b: Float32Array[], onde: string) => {
  for (let k = 0; k < a.length; k++) {
    expect(a[k].length, onde).toBe(b[k].length);
    const ua = new Uint32Array(a[k].buffer, a[k].byteOffset, a[k].length), ub = new Uint32Array(b[k].buffer, b[k].byteOffset, b[k].length);
    let i = 0;
    while (i < ua.length && ua[i] === ub[i]) i++;
    expect(i === ua.length ? 'igual' : `difere na amostra ${i}: ${a[k][i]} contra ${b[k][i]}`, `${onde} canal ${k}`).toBe('igual');
  }
};
const rodarFx = (p: Processador, x: Float32Array[], bloco: number, params: Record<string, number> = {}) => {
  const g = new Grafo();
  g.no('fonte', new Fonte(x));
  g.no('fx', p, {params});
  g.ligar('fonte', 'fx');
  return executarOffline(g, {taxa: TAXA, n: x[0].length, bloco, saida: 'fx'}).canais;
};

const BLOCOS_FX = [1, 7, 128, 1000, 1 << 20];

describe('EQ de três bandas nativo', () => {
  const antigo = (x: Float32Array[], gr: number, me: number, ag: number) => {
    const y = copiaFx(x);
    for (const c of y) {
      if (gr) filtrarNoLugar(c, prateleiraGraves(200, gr, TAXA));
      if (me) filtrarNoLugar(c, sino(1000, 0.9, me, TAXA));
      if (ag) filtrarNoLugar(c, prateleiraAgudos(5000, ag, TAXA));
    }
    return y;
  };
  for (const [gr, me, ag] of [[4, 0, 0], [0, -6, 0], [0, 0, 3.5], [5, -3, 7], [-12, 12, -12]]) {
    it(`graves ${gr}, médios ${me}, agudos ${ag}: PCM idêntico em todos os tamanhos de bloco`, () => {
      const x = sinalFx(20000, 3);
      const ref = antigo(x, gr, me, ag);
      for (const b of BLOCOS_FX) igualFx(rodarFx(new Eq3(), x, b, {graves_db: gr, medios_db: me, agudos_db: ag}), ref, `bloco ${b}`);
    });
  }
  it('estado em JSON no meio dá o mesmo que rodar direto', () => {
    const x = sinalFx(3000, 9);
    const ref = antigo(x, 5, -3, 7);
    const ctx = (inicio: number) => ({inicio, taxa: TAXA, param: (nome: string) => ({graves_db: 5, medios_db: -3, agudos_db: 7} as Record<string, number>)[nome]});
    const a = new Eq3();
    a.preparar(TAXA, 1500);
    const saida = [new Float32Array(1500), new Float32Array(1500)];
    a.processar([x.map((c) => c.subarray(0, 1500))], [saida], 1500, ctx(0));
    const b = new Eq3();
    b.preparar(TAXA, 1500);
    b.restaurar(JSON.parse(JSON.stringify(a.estado())));
    const saida2 = [new Float32Array(1500), new Float32Array(1500)];
    b.processar([x.map((c) => c.subarray(1500))], [saida2], 1500, ctx(1500));
    igualFx(saida2, ref.map((c) => c.subarray(1500)), 'segunda metade');
  });
});

describe('compressor nativo', () => {
  const c = {ativo: true, limiar_db: -20, razao: 4, ataque_ms: 5, soltura_ms: 90, ganho_db: 3};
  it('PCM idêntico em todos os tamanhos de bloco', () => {
    const x = sinalFx(30000, 5);
    const ref = copiaFx(x);
    comprimir(ref, c, TAXA);
    for (const b of BLOCOS_FX) igualFx(rodarFx(new Compressor(), x, b, {limiar_db: c.limiar_db, razao: c.razao, ataque_ms: c.ataque_ms, soltura_ms: c.soltura_ms, ganho_db: c.ganho_db}), ref, `bloco ${b}`);
  });
  it('o −0 da entrada passa como no motor antigo', () => {
    const x = sinalFx(500, 6, 1e-3);
    x[0][3] = -0; x[1][4] = -0;
    const ref = copiaFx(x);
    comprimir(ref, c, TAXA);
    igualFx(rodarFx(new Compressor(), x, 128, {limiar_db: c.limiar_db, razao: c.razao, ataque_ms: c.ataque_ms, soltura_ms: c.soltura_ms, ganho_db: c.ganho_db}), ref, '−0');
  });
});

describe('limitador nativo (causal, latência de 1,5 ms)', () => {
  const lat = Math.round(0.0015 * TAXA);
  it('declara a latência do lookahead', () => {
    const l = new Limitador();
    l.preparar(TAXA, 128);
    expect(l.latencia).toBe(lat);
  });
  const casos: [string, () => Float32Array[], number, number][] = [
    ['música forte, teto −1 dB', () => sinalFx(40000, 11, 2.5), -1, 80],
    ['teto −12 dB, soltura curta', () => sinalFx(25000, 12, 3), -12, 10],
    ['só um pico no fim', () => { const x = sinalFx(9000, 13, 0.2); x[0][8999] = 3; return x; }, -3, 200],
    ['pico na primeira amostra', () => { const x = sinalFx(9000, 14, 0.2); x[1][0] = -4; return x; }, -1, 80],
    ['nada passa do teto', () => sinalFx(10000, 15, 0.1), -1, 80],
    ['sinal mais curto que o lookahead', () => sinalFx(40, 16, 3), -1, 80],
    ['uma amostra', () => sinalFx(1, 17, 3), -1, 80],
    ['−0 sem redução', () => { const x = sinalFx(2000, 18, 0.1); x[0][5] = -0; return x; }, -1, 80],
  ];
  for (const [nome, fazer, teto, soltura] of casos) {
    it(`${nome}: PCM e redução idênticos em todos os tamanhos de bloco`, () => {
      const x = fazer();
      const ref = copiaFx(x);
      const reducao = limitarNoLugar(ref, teto, soltura, TAXA);
      for (const b of BLOCOS_FX) {
        const l = new Limitador();
        igualFx(rodarFx(l, x, b, {teto_db: teto, soltura_ms: soltura}), ref, `bloco ${b}`);
        expect(l.reducao_db, `bloco ${b}: redução`).toBe(reducao);
      }
    });
  }
  it('estado em JSON no meio dá o mesmo que rodar direto', () => {
    const x = sinalFx(6000, 21, 3);
    const ref = copiaFx(x);
    limitarNoLugar(ref, -2, 60, TAXA);
    const ctx = (inicio: number) => ({inicio, taxa: TAXA, param: (nome: string) => ({teto_db: -2, soltura_ms: 60} as Record<string, number>)[nome]});
    const a = new Limitador();
    a.preparar(TAXA, 3000);
    const o1 = [new Float32Array(3000), new Float32Array(3000)];
    a.processar([x.map((c) => c.subarray(0, 3000))], [o1], 3000, ctx(0));
    const b = new Limitador();
    b.preparar(TAXA, 3000);
    b.restaurar(JSON.parse(JSON.stringify(a.estado())));
    const o2 = [new Float32Array(3000), new Float32Array(3000)];
    b.processar([x.map((c) => c.subarray(3000))], [o2], 3000, ctx(3000));
    // a saída da segunda metade é a do original deslocada pela latência: confere a parte que não depende da primeira
    igualFx(o2.map((c) => c.subarray(lat)), ref.map((c) => c.subarray(3000, 6000 - lat)), 'segunda metade');
  });
});
