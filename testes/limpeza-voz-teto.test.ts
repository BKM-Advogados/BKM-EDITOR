// Teto da limpeza de voz (auditoria de render, R7): ela segura o arquivo inteiro na memória (pico de ~1 GB em 10 min de
// estéreo), então um áudio acima de ~20 min de estéreo (40 de mono) é recusado antes de decodificar, com uma mensagem que
// diz o que fazer; o estéreo continua estéreo e o que cabe segue limpando.
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {gravarPlano, planoDoProjeto} from '../src/nucleo/criar-projeto';
import {Projeto} from '../src/nucleo/projeto';
import {lerDuracao, medirEntrada, pastaDoFfmpeg} from '../src/main/ffmpeg-som';
import {arquivoLimpo, excedeLimpeza, limparArquivo, MAX_AMOSTRAS_LIMPEZA} from '../src/main/limpeza-voz';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-limpeza-teto-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));
const ff = pastaDoFfmpeg();
const ffmpeg = (...args: string[]) => execFileSync(path.join(ff, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), ['-v', 'error', '-y', ...args],
  {env: {...process.env, LD_LIBRARY_PATH: ff}, windowsHide: true});
/** Silêncio AAC de `segundos`: 10 s codificados e repetidos sem recodificar (rápido mesmo para 21 min). */
const silencio = (destino: string, segundos: number, canais: 'mono' | 'stereo') => {
  const dez = path.join(tmp, `dez-${canais}.mp4`);
  if (!existsSync(dez)) ffmpeg('-f', 'lavfi', '-i', `anullsrc=r=48000:cl=${canais}`, '-t', '10', '-c:a', 'aac', '-b:a', '32k', dez);
  ffmpeg('-stream_loop', String(Math.ceil(segundos / 10) - 1), '-i', dez, '-c', 'copy', destino);
};

describe('R7 · teto da limpeza de voz', () => {
  it('lê a duração que o ffmpeg escreve (e não inventa quando ele não sabe)', () => {
    expect(lerDuracao('  Duration: 00:21:02.67, start: 0.000000, bitrate: 3 kb/s')).toBeCloseTo(1262.67, 2);
    expect(lerDuracao('  Duration: 01:00:00.00, start')).toBe(3600);
    expect(lerDuracao('  Duration: N/A, bitrate: N/A')).toBeNull();
  });

  it('20 min de estéreo ou 40 de mono a 48 kHz cabem; acima disso, a mensagem diz o tamanho e o que fazer', () => {
    expect(MAX_AMOSTRAS_LIMPEZA).toBe(20 * 60 * 48000 * 2);
    expect(excedeLimpeza({duracao_s: 20 * 60, taxa: 48000, canais: 2})).toBeNull();
    expect(excedeLimpeza({duracao_s: 40 * 60, taxa: 48000, canais: 1})).toBeNull();
    const longo = excedeLimpeza({duracao_s: 62 * 60, taxa: 48000, canais: 2});
    expect(longo).toMatch(/1 h 02 min em estéreo/);
    expect(longo).toMatch(/até 20 min/);
    expect(longo).toMatch(/Divida a gravação/);
    expect(excedeLimpeza({duracao_s: 41 * 60, taxa: 48000, canais: 1})).toMatch(/41 min em mono.*até 40 min/);
    expect(excedeLimpeza({duracao_s: null, taxa: 48000, canais: 2})).toBeNull(); // sem duração, não bloqueia
  });

  it('um arquivo de 21 min em estéreo é recusado antes de decodificar, e nada é gravado', async () => {
    const p = new Projeto(gravarPlano(path.join(tmp, 'longo'), planoDoProjeto({nome: 'longo', modelo: 'video-branco'})));
    mkdirSync(p.caminho('midia'), {recursive: true});
    silencio(p.caminho('midia/live.mp4'), 21 * 60, 'stereo');
    expect(await medirEntrada(p.caminho('midia/live.mp4'))).toMatchObject({canais: 2, taxa: 48000});
    const antes = process.memoryUsage().rss;
    await expect(limparArquivo(p, 'midia/live.mp4', 'media')).rejects.toThrow(/21 min em estéreo.*até 20 min/);
    expect(process.memoryUsage().rss - antes).toBeLessThan(200 * 1024 * 1024); // não decodificou os ~480 MB do áudio
    expect(p.existe(arquivoLimpo('midia/live.mp4'))).toBe(false);
  }, 60_000);

  it('o que cabe segue limpando, em estéreo', async () => {
    const p = new Projeto(gravarPlano(path.join(tmp, 'curto'), planoDoProjeto({nome: 'curto', modelo: 'video-branco'})));
    mkdirSync(p.caminho('midia'), {recursive: true});
    silencio(p.caminho('midia/fala.mp4'), 10, 'stereo');
    const r = await limparArquivo(p, 'midia/fala.mp4', 'media');
    expect(await medirEntrada(p.caminho(r.arquivo))).toMatchObject({canais: 2});
  }, 60_000);
});
