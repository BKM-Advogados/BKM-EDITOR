import {describe, expect, it} from 'vitest';
import {reamostrar} from '../src/nucleo/reamostrar';
import {naTaxa} from '../src/nucleo/musica-som';

const seno = (f: number, taxa: number, n: number, fase = 0) => Float32Array.from({length: n}, (_, i) => Math.sin(2 * Math.PI * f * i / taxa + fase));
const rms = (x: Float32Array, a: number, b: number) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };

describe('reamostrar', () => {
  it('mesma taxa devolve o mesmo vetor', () => {
    const x = seno(440, 48000, 100);
    expect(reamostrar(x, 48000, 48000)).toBe(x);
    expect(naTaxa({canais: [x], taxa: 48000}, 48000)[0]).toBe(x);
  });
  it('é determinística', () => {
    const x = seno(1000, 44100, 4000);
    expect(Array.from(reamostrar(x, 44100, 48000))).toEqual(Array.from(reamostrar(x, 44100, 48000)));
  });
  it('comprimento: floor(n * destino / origem)', () => {
    expect(reamostrar(new Float32Array(441), 44100, 48000, 'sinc').length).toBe(480);
    expect(reamostrar(new Float32Array(441), 44100, 48000, 'hermite').length).toBe(480);
  });
  it('sinc preserva um seno de 1 kHz (44,1 para 48 kHz) com erro mínimo e sem atraso', () => {
    const o = reamostrar(seno(1000, 44100, 8820), 44100, 48000, 'sinc');
    const ref = seno(1000, 48000, o.length);
    let e = 0;
    for (let i = 200; i < o.length - 200; i++) e = Math.max(e, Math.abs(o[i] - ref[i]));
    expect(e).toBeLessThan(1e-3);
  });
  it('sem atraso de grupo: o impulso fica na posição certa, na subida e na descida', () => {
    const imp = new Float32Array(2000); imp[1000] = 1;
    const up = reamostrar(imp, 24000, 48000, 'sinc');
    expect(up.indexOf(Math.max(...up))).toBe(2000);
    const dn = reamostrar(imp, 48000, 24000, 'sinc');
    expect(dn.indexOf(Math.max(...dn))).toBe(500);
    const h = reamostrar(imp, 24000, 48000, 'hermite');
    expect(h.indexOf(Math.max(...h))).toBe(2000);
  });
  it('sinc ao baixar a taxa rejeita o aliasing de um seno perto de Nyquist; Hermite (sem filtro) deixa passar', () => {
    // 20 kHz a 48 kHz descendo para 24 kHz: acima do Nyquist novo (12 kHz), deveria sumir.
    const x = seno(20000, 48000, 9600);
    const s = reamostrar(x, 48000, 24000, 'sinc');
    const h = reamostrar(x, 48000, 24000, 'hermite');
    expect(rms(s, 100, s.length - 100)).toBeLessThan(1e-3); // mais de 55 dB abaixo
    expect(rms(h, 100, h.length - 100)).toBeGreaterThan(0.1);
  });
  it('sinc deixa passar um seno perto do Nyquist da taxa nova (10 kHz para 24 kHz) quase sem perda', () => {
    const s = reamostrar(seno(10000, 48000, 9600), 48000, 24000, 'sinc');
    expect(rms(s, 100, s.length - 100) * Math.SQRT2).toBeGreaterThan(0.99);
  });
  it('Hermite é bom na faixa grave e mantém DC', () => {
    const o = reamostrar(seno(200, 44100, 4410), 44100, 48000, 'hermite');
    const ref = seno(200, 48000, o.length);
    let e = 0;
    for (let i = 4; i < o.length - 4; i++) e = Math.max(e, Math.abs(o[i] - ref[i]));
    expect(e).toBeLessThan(2e-4);
    const dc = reamostrar(new Float32Array(500).fill(0.5), 44100, 48000, 'sinc');
    expect(dc[250]).toBeCloseTo(0.5, 5);
  });
});
