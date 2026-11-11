// Loudness nas bordas (auditoria de render, R1 e R5): alvo inalcançável ou clipe curto não pedem ao loudnorm valores fora
// da faixa (o ffmpeg nem começava e o render inteiro era apagado); a correção nunca piora o som, o clipe curto não anda no
// tempo, e cancelar durante a primeira medição cancela de verdade (não vira "sem som").
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {makeCancelSignal} from '@remotion/renderer';
import {corrigirArquivo} from '../src/main/loudness';
import {decodificarAudio, gravarWav, pastaDoFfmpeg} from '../src/main/ffmpeg-som';

const T = 48000;
const pastas: string[] = [];
afterAll(() => {
  for (const p of pastas) rmSync(p, {recursive: true, force: true});
});
let s = 12345;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
/** "fala" com crista alta: rajadas de sílaba e um estalo quase no fundo de escala a cada 2 s. */
const fala = (seg: number, amp: number) => {
  const n = Math.round(seg * T);
  const x = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) {
    const t = i / T;
    y = 0.7 * y + 0.3 * rnd();
    x[i] = amp * Math.max(0, Math.sin(2 * Math.PI * 4 * t)) ** 2 * (Math.sin(2 * Math.PI * 0.25 * t) > -0.6 ? 1 : 0) * y;
  }
  for (let k = T; k < n; k += 2 * T) for (let j = 0; j < 40; j++) x[k + j] = 0.95 * Math.sin(j / 3);
  return x;
};
const mp4 = (nome: string, x: Float32Array) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'estudio-loud-bordas-'));
  pastas.push(dir);
  const wav = path.join(dir, 'a.wav');
  writeFileSync(wav, gravarWav([x, x], T));
  const saida = path.join(dir, `${nome} é.mp4`);
  const ff = pastaDoFfmpeg();
  execFileSync(path.join(ff, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), ['-y', '-v', 'error', '-i', wav, '-c:a', 'aac', saida],
    {env: {...process.env, LD_LIBRARY_PATH: ff}});
  return saida;
};
const erro = (m: {i: number; tp: number}, alvo: number, pico: number) => Math.abs(m.i - alvo) + Math.max(0, m.tp - pico) * 2;

describe('R1 · loudness: alvo inalcançável não derruba a exportação', () => {
  it('2,5 s de fala com estalo, alvo −14: não lança, não piora e mantém a duração', async () => {
    const f = mp4('curta', fala(2.5, 0.1));
    const r = await corrigirArquivo(f, {duracao_s: 2.5});
    expect(r).not.toBeNull();
    expect(existsSync(f)).toBe(true);
    expect(erro(r!.depois, -14, -1)).toBeLessThanOrEqual(erro(r!.antes, -14, -1));
    const som = await decodificarAudio(f, {taxa: T, canais: 1});
    expect(Math.abs(som.canais[0].length / T - 2.5)).toBeLessThan(0.05);
  }, 60_000);

  it('com o silêncio de apoio (apad), o som não anda no tempo', async () => {
    const x = new Float32Array(2.5 * T);
    for (let i = 0; i < x.length; i++) {
      const t = i / T;
      if ((t >= 0.8 && t < 1.2) || (t >= 1.8 && t < 2.2)) x[i] = 0.05 * rnd();
    }
    for (let j = 0; j < 40; j++) x[T + j] = 0.95 * Math.sin(j / 3);
    const f = mp4('alinhado', x);
    const r = await corrigirArquivo(f, {duracao_s: 2.5});
    expect(r?.ajustado).toBe(true);
    const y = (await decodificarAudio(f, {taxa: T, canais: 1})).canais[0];
    const max = y.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const inicio = y.findIndex((v) => Math.abs(v) > 0.1 * max);
    expect(Math.abs(inicio / T - 0.8)).toBeLessThan(0.03); // AAC: o atraso do codificador fica em milissegundos
  }, 60_000);

  it('alvo −9 LUFS em fala com crista alta: no_alvo false, sem lançar', async () => {
    const f = mp4('alvo9', fala(20, 0.08));
    const r = await corrigirArquivo(f, {alvo_lufs: -9, duracao_s: 20});
    expect(r?.no_alvo).toBe(false);
    expect(r!.depois.i).toBeGreaterThan(-14);
  }, 120_000);
});

describe('R5 · cancelar durante a medição do loudness', () => {
  it('sinal já cancelado: corrigirArquivo lança "cancelado" em vez de seguir sem corrigir', async () => {
    const f = mp4('cancel', fala(5, 0.08));
    const {cancelSignal, cancel} = makeCancelSignal();
    cancel();
    await expect(corrigirArquivo(f, {cancelSignal})).rejects.toThrow(/cancel/);
  }, 60_000);
});
