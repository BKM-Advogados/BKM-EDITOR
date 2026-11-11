// C15 (auditoria de conteúdo): proporCortes era O(n²·k) e travava a janela numa narração longa com "ãh" colados. A versão
// nova marca todos os presos na mesma volta e acha o trecho por busca binária: mesma saída, muito mais rápida.
import {describe, expect, it} from 'vitest';
import {proporCortes, type OpcoesCortes} from '../src/nucleo/cortes-fala';
import type {PalavraLegenda} from '../src/nucleo/legendas';
import {proporCortesV1} from './apoio/cortes-fala-v1';

const rnd = (s: number) => () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);

const narracaoAleatoria = (n: number, semente: number): PalavraLegenda[] => {
  const r = rnd(semente);
  const ps: PalavraLegenda[] = [];
  let t = r() * 2000;
  for (let i = 0; i < n; i++) {
    const enche = r() < 0.15;
    const dur = 80 + r() * 400;
    ps.push({w: enche ? ['ãh', 'hum', 'éé', 'ahn'][Math.floor(r() * 4)] : `p${i}`, s: Math.round(t), e: Math.round(t + dur)});
    const gap = r() < 0.1 ? 600 + r() * 2000 : r() < 0.3 ? -20 + r() * 60 : r() * 300; // às vezes sobrepõe
    t += dur + gap;
  }
  return ps;
};

const presosColados = (n: number) => {
  const ps: PalavraLegenda[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const preso = i % 50 === 49;
    ps.push({w: preso ? 'ãh' : `palavra${i}`, s: t, e: t + 250});
    t += preso ? 270 : 300;
  }
  return ps;
};

describe('C15: proporCortes em lote', () => {
  it('mesma saída que a versão anterior em 400 narrações aleatórias (sobreposição, pontas, opções variadas)', () => {
    for (let s = 1; s <= 400; s++) {
      const ps = narracaoAleatoria(20 + (s % 60), s);
      const o: OpcoesCortes = s % 3 === 0 ? {inicio_ms: 500, fim_ms: ps[ps.length - 1].e + 1500} : s % 3 === 1 ? {pausa_ms: 200, margem_ms: 40} : {};
      expect(proporCortes(ps, o)).toEqual(proporCortesV1(ps, o));
    }
  });

  it('mesma saída com presos colados', () => {
    const ps = presosColados(600);
    expect(proporCortes(ps)).toEqual(proporCortesV1(ps));
  });

  it('4000 palavras (~25 min) com 80 "ãh" colados em bem menos de 1 s (a versão anterior levava ~10 s)', () => {
    const ps = presosColados(4000);
    proporCortes(presosColados(500)); // aquece
    // o menor de três, para a máquina cheia (testes em paralelo) não decidir o resultado
    const tempos = [0, 1, 2].map(() => {
      const t0 = performance.now();
      proporCortes(ps);
      return performance.now() - t0;
    });
    expect(Math.min(...tempos)).toBeLessThan(800);
  });
});
