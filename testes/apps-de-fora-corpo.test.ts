// Porta fixa dos apps de IA de fora (auditoria do processo principal, P13): um corpo que não é JSON, com token válido,
// recebe resposta de erro em vez de virar rejeição solta no processo principal com a conexão pendurada.
import {cpSync, mkdtempSync, rmSync} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {AppsDeFora} from '../src/main/ia/apps-de-fora';
import {CofreMemoria} from '../src/main/ia/chaves';
import {McpHttp} from '../src/main/mcp-http';
import {Projeto} from '../src/nucleo/projeto';

const pastas: string[] = [];
afterAll(() => {
  for (const p of pastas) rmSync(p, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
});
const portaLivre = () => new Promise<number>((ok) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const p = (s.address() as net.AddressInfo).port;
    s.close(() => ok(p));
  });
});

describe('apps de fora: corpo inválido (P13)', () => {
  it('corpo que não é JSON recebe resposta de erro, sem rejeição solta', async () => {
    const pasta = mkdtempSync(path.join(os.tmpdir(), 'estudio-apps-corpo-'));
    pastas.push(pasta);
    cpSync(path.join(__dirname, 'fixtures', 'projeto'), pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
    const projeto = new Projeto(pasta);
    const mcp = new McpHttp(path.join(pasta, '.cfg'), () => projeto);
    const erros: string[] = [];
    const h = (e: unknown) => erros.push(String((e as Error)?.message ?? e));
    process.on('uncaughtException', h);
    process.on('unhandledRejection', h);
    const porta = await portaLivre();
    const apps = new AppsDeFora({pasta: path.join(pasta, '.dados'), cofre: new CofreMemoria(), mcp: () => mcp, ponte: () => ({exe: 'x', script: 'y'})});
    try {
      await apps.ligar(true, porta);
      const token = /Bearer (\w+)/.exec(apps.novo('Cursor').configs.http)![1];
      const status = await new Promise<number>((ok) => {
        const req = http.request({host: '127.0.0.1', port: porta, path: '/mcp', method: 'POST', agent: false,
          headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}}, (res) => (res.resume(), ok(res.statusCode!)));
        req.on('error', () => ok(-1));
        req.setTimeout(1500, () => (req.destroy(), ok(-2)));
        req.end('isto não é json');
      });
      await new Promise((r) => setTimeout(r, 100));
      expect(erros).toEqual([]);
      expect(status).toBeGreaterThanOrEqual(400);
    } finally {
      await apps.fechar();
      process.off('uncaughtException', h);
      process.off('unhandledRejection', h);
    }
  });
});
