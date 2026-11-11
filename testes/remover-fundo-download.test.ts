// Download do modelo de remover fundo (auditoria do processo principal, P8): pasta sem escrita vira rejeição (e não
// exceção solta com o botão travado em "baixando"), e um download grande não acumula ouvintes a cada espera de 'drain'.
import {createHash} from 'node:crypto';
import {chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {baixarModelo} from '../src/main/remover-fundo';
import {MODELO_FUNDO} from '../src/nucleo/remover-fundo';

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pastas: string[] = [];
afterAll(() => {
  for (const p of pastas) rmSync(p, {recursive: true, force: true});
});
const pastaNova = () => {
  const p = mkdtempSync(path.join(os.tmpdir(), 'estudio-modelos-'));
  pastas.push(p);
  return p;
};
const root = process.getuid?.() === 0;

describe('remover fundo: download do modelo (P8)', () => {
  it.skipIf(root || process.platform === 'win32')('pasta do modelo sem escrita vira rejeição, não exceção solta', async () => {
    const erros: string[] = [];
    const h = (e: unknown) => erros.push(String((e as Error)?.message ?? e));
    process.on('uncaughtException', h);
    process.on('unhandledRejection', h);
    const pasta = pastaNova();
    const dados = new Uint8Array(1024);
    const mod = {...MODELO_FUNDO, bytes: dados.byteLength, sha256: 'x'};
    mkdirSync(path.join(pasta, mod.id));
    chmodSync(path.join(pasta, mod.id), 0o555);
    const r = await Promise.race([
      baixarModelo({pasta, modelo: mod, buscar: async () => new Response(dados)}).then(() => 'resolveu', () => 'rejeitou'),
      esperar(1500).then(() => 'pendente'),
    ]);
    chmodSync(path.join(pasta, mod.id), 0o755);
    process.off('uncaughtException', h);
    process.off('unhandledRejection', h);
    expect(erros).toEqual([]);
    expect(r).toBe('rejeitou');
  });

  it('download grande não acumula ouvintes de "error" (MaxListenersExceededWarning)', async () => {
    const avisos: string[] = [];
    const h = (w: Error) => avisos.push(w.name);
    process.on('warning', h);
    const pedaco = new Uint8Array(256 * 1024);
    const n = 64;
    const sha = createHash('sha256');
    for (let i = 0; i < n; i++) sha.update(pedaco);
    const corpo = new ReadableStream({start(c) {
      for (let i = 0; i < n; i++) c.enqueue(pedaco);
      c.close();
    }});
    const pasta = pastaNova();
    await baixarModelo({pasta, modelo: {...MODELO_FUNDO, bytes: pedaco.byteLength * n, sha256: sha.digest('hex')}, buscar: async () => new Response(corpo)});
    await esperar(50);
    process.off('warning', h);
    expect(avisos).not.toContain('MaxListenersExceededWarning');
  });

  it('modelo que não confere não deixa o .parcial para trás', async () => {
    const pasta = pastaNova();
    const dados = new Uint8Array(4096);
    await expect(baixarModelo({pasta, modelo: {...MODELO_FUNDO, bytes: dados.byteLength, sha256: 'errado'}, buscar: async () => new Response(dados)}))
      .rejects.toThrow(/não confere/);
    expect(readdirSync(path.join(pasta, MODELO_FUNDO.id))).toEqual([]);
  });
});
