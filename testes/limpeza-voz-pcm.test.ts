// A extração da FFT para src/nucleo/fft.ts não pode mudar o som: o hash do PCM da limpeza (sinal sintético fixo, as três
// intensidades) foi medido ANTES da extração e tem que continuar igual.
import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {limparVoz} from '../src/nucleo/limpeza-voz';

const TAXA = 48000;
const sinal = () => {
  let x = 12345;
  const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 0xffffffff) * 2 - 1;
  const v = new Float32Array(TAXA * 3);
  for (let i = 0; i < v.length; i++) {
    const t = i / TAXA;
    const fala = t % 1 < 0.6 ? 0.1 * (Math.sin(2 * Math.PI * 200 * t) + 0.5 * Math.sin(2 * Math.PI * 600 * t) + 0.3 * Math.sin(2 * Math.PI * 6000 * t)) : 0;
    v[i] = fala + 0.003 * rnd();
  }
  return v;
};

describe('limpeza de voz: PCM idêntico depois de extrair a FFT', () => {
  it.each([['leve', 'c31fbdb2b8d4e57a4200b4c556754ae7b639e8a3e60b283e2f2d0b9a10b5f123'], ['media', '82d5399ade20a4eb88df85d3cca86fea0340685195da1ae012cc6d82e842b56c'], ['forte', 'c900e418fe98ffc96cf41d79a23841b853b351da3784449668b5d267252d5533']] as const)('%s', async (intensidade, esperado) => {
    const r = await limparVoz([sinal()], TAXA, intensidade);
    const hash = createHash('sha256').update(Buffer.from(r.canais[0].buffer)).digest('hex');
    expect(hash).toBe(esperado);
  });
});
