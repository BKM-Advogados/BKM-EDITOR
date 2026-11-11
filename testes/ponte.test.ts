// A ponte stdio → HTTP (mcp/ponte.mjs, auditoria MCP M15): uma chamada lenta (transcrever, o cartão do portão esperando a
// pessoa) não segura o ping nem o Parar. O notifications/cancelled aborta o fetch do pedido, o app vê a conexão fechar e
// cancela a ferramenta, e a ponte não responde o pedido cancelado.
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {cpSync, mkdtempSync, rmSync} from 'node:fs';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {McpHttp} from '../src/main/mcp-http';
import {Projeto} from '../src/nucleo/projeto';

const PONTE = path.join(__dirname, '..', 'mcp', 'ponte.mjs');

type Chegada = {metodo: string; id?: unknown; ms: number};

const montar = async () => {
  const t0 = Date.now();
  const chegadas: Chegada[] = [];
  const fechadas: unknown[] = []; // pedidos cuja conexão o cliente fechou antes da resposta
  const srv = http.createServer((req, res) => {
    const pedacos: Buffer[] = [];
    req.on('data', (d: Buffer) => pedacos.push(d));
    req.on('end', () => {
      const m = JSON.parse(Buffer.concat(pedacos).toString('utf-8'));
      chegadas.push({metodo: m.method, id: m.id, ms: Date.now() - t0});
      if (m.method === 'tools/call') {
        const t = setTimeout(() => res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({jsonrpc: '2.0', id: m.id, result: {content: []}})), 3000);
        res.on('close', () => {
          if (!res.writableEnded) {
            clearTimeout(t);
            fechadas.push(m.id);
          }
        });
      } else if (m.id === undefined) res.writeHead(202).end();
      else res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({jsonrpc: '2.0', id: m.id, result: {}}));
    });
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/mcp`;
  const p = spawn(process.execPath, [PONTE], {env: {...process.env, ESTUDIO_MCP_URL: url, ESTUDIO_MCP_TOKEN: 'x'}});
  const saidas: {id?: unknown; result?: unknown; error?: unknown}[] = [];
  let resto = '';
  p.stdout.on('data', (d: Buffer) => {
    resto += d.toString('utf-8');
    const linhas = resto.split('\n');
    resto = linhas.pop() ?? '';
    for (const l of linhas) if (l.trim()) saidas.push(JSON.parse(l));
  });
  const mandar = (o: object) => p.stdin.write(`${JSON.stringify(o)}\n`);
  return {t0, chegadas, fechadas, srv, p, saidas, mandar};
};

let aberto: {srv: http.Server; p: ChildProcessWithoutNullStreams} | null = null;
afterEach(() => {
  aberto?.p.kill();
  aberto?.srv.closeAllConnections();
  aberto?.srv.close();
  aberto = null;
});

const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const ate = async (f: () => boolean, ms = 2000) => {
  const fim = Date.now() + ms;
  while (!f() && Date.now() < fim) await esperar(20);
};

describe('ponte stdio', () => {
  it('o ping chega enquanto uma chamada lenta espera, e a resposta dele sai na hora', async () => {
    const m = await montar();
    aberto = m;
    m.mandar({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'transcrever', arguments: {}}});
    await ate(() => m.chegadas.some((c) => c.id === 1), 5000); // a ponte já está de pé e a lenta, em curso
    const enviado = Date.now() - m.t0;
    m.mandar({jsonrpc: '2.0', method: 'notifications/initialized'});
    m.mandar({jsonrpc: '2.0', id: 2, method: 'ping'});
    await ate(() => m.saidas.some((s) => s.id === 2));
    const ping = m.chegadas.find((c) => c.metodo === 'ping')!;
    // a lenta leva 3 s: antes, o ping só chegava depois dela; com folga para a máquina carregada
    expect(ping.ms - enviado).toBeLessThan(1500);
    expect(m.chegadas.find((c) => c.metodo === 'notifications/initialized')!.ms - enviado).toBeLessThan(1500);
    expect(m.saidas.find((s) => s.id === 2)).toMatchObject({result: {}});
    expect(m.saidas.some((s) => s.id === 1)).toBe(false); // a lenta ainda não voltou
  });

  it('notifications/cancelled aborta o fetch do pedido e a ponte não o responde', async () => {
    const m = await montar();
    aberto = m;
    m.mandar({jsonrpc: '2.0', id: 7, method: 'tools/call', params: {name: 'transcrever', arguments: {}}});
    await ate(() => m.chegadas.some((c) => c.id === 7));
    m.mandar({jsonrpc: '2.0', method: 'notifications/cancelled', params: {requestId: 7, reason: 'Parar'}});
    await ate(() => m.fechadas.includes(7));
    expect(m.fechadas).toEqual([7]);
    expect(m.chegadas.some((c) => c.metodo === 'notifications/cancelled')).toBe(false);
    await esperar(200);
    expect(m.saidas.some((s) => s.id === 7)).toBe(false);
  });

  it('ao fechar a entrada, espera os pedidos em curso e sai', async () => {
    const m = await montar();
    aberto = m;
    m.mandar({jsonrpc: '2.0', id: 3, method: 'ping'});
    m.p.stdin.end();
    const codigo = await new Promise<number | null>((ok) => m.p.once('exit', ok));
    expect(codigo).toBe(0);
    expect(m.saidas.find((s) => s.id === 3)).toMatchObject({result: {}});
  });
});

describe('ponte stdio com o app de verdade', () => {
  it('o Parar do cliente chega ao portão: o cartão esperando a pessoa é cancelado', async () => {
    const pasta = mkdtempSync(path.join(tmpdir(), 'estudio-ponte-'));
    cpSync(path.join(__dirname, 'fixtures', 'projeto'), pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
    const projeto = new Projeto(pasta);
    let perguntou = false;
    let cancelou = false;
    const mcp = new McpHttp(path.join(pasta, '.cfg'), () => projeto, undefined, (p) => new Promise((ok) => {
      perguntou = true;
      p.sinal?.addEventListener('abort', () => (cancelou = true, ok({permitir: true})));
    }));
    mcp.registrarFixo('tok', 'Claude Desktop');
    const srv = http.createServer((req, res) => void mcp.atender(req, res).then((ok) => ok || res.writeHead(404).end()));
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/mcp`;
    const c = new Client({name: 'desktop', version: '0'});
    await c.connect(new StdioClientTransport({command: process.execPath, args: [PONTE], env: {...process.env, ESTUDIO_MCP_URL: url, ESTUDIO_MCP_TOKEN: 'tok'} as Record<string, string>}));
    try {
      const parar = new AbortController();
      const chamada = c.callTool({name: 'ler_fonte', arguments: {url: 'https://exemplo.org/'}}, undefined, {signal: parar.signal}).catch((e: Error) => e);
      await ate(() => perguntou);
      expect(perguntou).toBe(true);
      parar.abort('Parar');
      await ate(() => cancelou);
      expect(cancelou).toBe(true);
      expect(await chamada).toBeInstanceOf(Error);
      // a ponte segue atendendo depois do cancelamento
      expect((await c.listTools()).tools.length).toBeGreaterThan(10);
    } finally {
      await c.close();
      srv.closeAllConnections();
      srv.close();
      rmSync(pasta, {recursive: true, force: true});
    }
  });
});
