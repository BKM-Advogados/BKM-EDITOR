// EQ, compressor e limitador nativos por bloco contra as funções do motor antigo (musica-som.ts), bit a bit, em sinais que
// cutucam as bordas: blocos de 1 amostra a maiores que o sinal, sinal mais curto que o lookahead do limitador, picos no
// fim, −0 e estado em JSON no meio do render. Ver docs/audio-grafo.md.
import {describe, expect, it} from 'vitest';
import {Grafo} from '../src/nucleo/audio-grafo/grafo';
import {executarOffline} from '../src/nucleo/audio-grafo/executor';
import {Fonte} from '../src/nucleo/audio-grafo/processadores';
import {Eq3} from '../src/nucleo/audio-grafo/eq3';
import {Compressor} from '../src/nucleo/audio-grafo/compressor';
import {Limitador} from '../src/nucleo/audio-grafo/limitador';
import type {Processador} from '../src/nucleo/audio-grafo/tipos';
import {comprimir, filtrarNoLugar, geradorDe, limitarNoLugar, prateleiraAgudos, prateleiraGraves, sino} from '../src/nucleo/musica-som';

const TAXA = 48000;
const sinal = (n: number, semente: number, amp = 1) => {
  const g = geradorDe(semente);
  return [0, 1].map((c) => Float32Array.from({length: n}, (_, i) => amp * (g() - 0.5) * 2 * (0.3 + Math.abs(Math.sin(i / 4000 + c))) ));
};
const copia = (x: Float32Array[]) => x.map((c) => Float32Array.from(c));
const igual = (a: Float32Array[], b: Float32Array[], onde: string) => {
  for (let k = 0; k < a.length; k++) {
    expect(a[k].length, onde).toBe(b[k].length);
    const ua = new Uint32Array(a[k].buffer, a[k].byteOffset, a[k].length), ub = new Uint32Array(b[k].buffer, b[k].byteOffset, b[k].length);
    let i = 0;
    while (i < ua.length && ua[i] === ub[i]) i++;
    expect(i === ua.length ? 'igual' : `difere na amostra ${i}: ${a[k][i]} contra ${b[k][i]}`, `${onde} canal ${k}`).toBe('igual');
  }
};
const rodar = (p: Processador, x: Float32Array[], bloco: number, params: Record<string, number> = {}) => {
  const g = new Grafo();
  g.no('fonte', new Fonte(x));
  g.no('fx', p, {params});
  g.ligar('fonte', 'fx');
  return executarOffline(g, {taxa: TAXA, n: x[0].length, bloco, saida: 'fx'}).canais;
};

const BLOCOS = [1, 7, 128, 1000, 1 << 20];

describe('EQ de três bandas nativo', () => {
  const antigo = (x: Float32Array[], gr: number, me: number, ag: number) => {
    const y = copia(x);
    for (const c of y) {
      if (gr) filtrarNoLugar(c, prateleiraGraves(200, gr, TAXA));
      if (me) filtrarNoLugar(c, sino(1000, 0.9, me, TAXA));
      if (ag) filtrarNoLugar(c, prateleiraAgudos(5000, ag, TAXA));
    }
    return y;
  };
  for (const [gr, me, ag] of [[4, 0, 0], [0, -6, 0], [0, 0, 3.5], [5, -3, 7], [-12, 12, -12]]) {
    it(`graves ${gr}, médios ${me}, agudos ${ag}: PCM idêntico em todos os tamanhos de bloco`, () => {
      const x = sinal(20000, 3);
      const ref = antigo(x, gr, me, ag);
      for (const b of BLOCOS) igual(rodar(new Eq3(), x, b, {graves_db: gr, medios_db: me, agudos_db: ag}), ref, `bloco ${b}`);
    });
  }
  it('estado em JSON no meio dá o mesmo que rodar direto', () => {
    const x = sinal(3000, 9);
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
    igual(saida2, ref.map((c) => c.subarray(1500)), 'segunda metade');
  });
});

describe('compressor nativo', () => {
  const c = {ativo: true, limiar_db: -20, razao: 4, ataque_ms: 5, soltura_ms: 90, ganho_db: 3};
  it('PCM idêntico em todos os tamanhos de bloco', () => {
    const x = sinal(30000, 5);
    const ref = copia(x);
    comprimir(ref, c, TAXA);
    for (const b of BLOCOS) igual(rodar(new Compressor(), x, b, {limiar_db: c.limiar_db, razao: c.razao, ataque_ms: c.ataque_ms, soltura_ms: c.soltura_ms, ganho_db: c.ganho_db}), ref, `bloco ${b}`);
  });
  it('o −0 da entrada passa como no motor antigo', () => {
    const x = sinal(500, 6, 1e-3);
    x[0][3] = -0; x[1][4] = -0;
    const ref = copia(x);
    comprimir(ref, c, TAXA);
    igual(rodar(new Compressor(), x, 128, {limiar_db: c.limiar_db, razao: c.razao, ataque_ms: c.ataque_ms, soltura_ms: c.soltura_ms, ganho_db: c.ganho_db}), ref, '−0');
  });
});

describe('limitador nativo (causal, latência de 1,5 ms)', () => {
  const lat = Math.round(0.0015 * TAXA);
  it('declara a latência do lookahead', () => {
    const l = new Limitador(TAXA);
    l.preparar(TAXA, 128);
    expect(l.latencia).toBe(lat);
  });
  const casos: [string, () => Float32Array[], number, number][] = [
    ['música forte, teto −1 dB', () => sinal(40000, 11, 2.5), -1, 80],
    ['teto −12 dB, soltura curta', () => sinal(25000, 12, 3), -12, 10],
    ['só um pico no fim', () => { const x = sinal(9000, 13, 0.2); x[0][8999] = 3; return x; }, -3, 200],
    ['pico na primeira amostra', () => { const x = sinal(9000, 14, 0.2); x[1][0] = -4; return x; }, -1, 80],
    ['nada passa do teto', () => sinal(10000, 15, 0.1), -1, 80],
    ['sinal mais curto que o lookahead', () => sinal(40, 16, 3), -1, 80],
    ['uma amostra', () => sinal(1, 17, 3), -1, 80],
    ['−0 sem redução', () => { const x = sinal(2000, 18, 0.1); x[0][5] = -0; return x; }, -1, 80],
  ];
  for (const [nome, fazer, teto, soltura] of casos) {
    it(`${nome}: PCM e redução idênticos em todos os tamanhos de bloco`, () => {
      const x = fazer();
      const ref = copia(x);
      const reducao = limitarNoLugar(ref, teto, soltura, TAXA);
      for (const b of BLOCOS) {
        const l = new Limitador(TAXA);
        igual(rodar(l, x, b, {teto_db: teto, soltura_ms: soltura}), ref, `bloco ${b}`);
        expect(l.reducao_db, `bloco ${b}: redução`).toBe(reducao);
      }
    });
  }
  it('estado em JSON no meio dá o mesmo que rodar direto', () => {
    const x = sinal(6000, 21, 3);
    const ref = copia(x);
    limitarNoLugar(ref, -2, 60, TAXA);
    const ctx = (inicio: number) => ({inicio, taxa: TAXA, param: (nome: string) => ({teto_db: -2, soltura_ms: 60} as Record<string, number>)[nome]});
    const a = new Limitador(TAXA);
    a.preparar(TAXA, 3000);
    const o1 = [new Float32Array(3000), new Float32Array(3000)];
    a.processar([x.map((c) => c.subarray(0, 3000))], [o1], 3000, ctx(0));
    const b = new Limitador(TAXA);
    b.preparar(TAXA, 3000);
    b.restaurar(JSON.parse(JSON.stringify(a.estado())));
    const o2 = [new Float32Array(3000), new Float32Array(3000)];
    b.processar([x.map((c) => c.subarray(3000))], [o2], 3000, ctx(3000));
    // a saída da segunda metade é a do original deslocada pela latência: confere a parte que não depende da primeira
    igual(o2.map((c) => c.subarray(lat)), ref.map((c) => c.subarray(3000, 6000 - lat)), 'segunda metade');
  });
});
