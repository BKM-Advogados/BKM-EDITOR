// O MCP por HTTP do app (o que as abas do Claude usam): token por aba, autor e origem no diário, recusa sem token.
import {cpSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {McpHttp} from '../src/main/mcp-http';
import {Projeto} from '../src/nucleo/projeto';

let pasta = '';
let servidor: http.Server;
let origem = '';
let mcp: McpHttp;

beforeAll(async () => {
  pasta = mkdtempSync(path.join(tmpdir(), 'estudio-http-'));
  cpSync(path.join(__dirname, 'fixtures', 'projeto'), pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
  const projeto = new Projeto(pasta);
  mcp = new McpHttp(path.join(pasta, '.config-teste'), () => projeto);
  servidor = http.createServer((req, res) => void mcp.atender(req, res).then((ok) => ok || res.writeHead(404).end()));
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  origem = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(() => {
  servidor?.close();
  rmSync(pasta, {recursive: true, force: true});
});

const conectar = async (headers: Record<string, string>) => {
  const c = new Client({name: 'teste', version: '0'});
  await c.connect(new StreamableHTTPClientTransport(new URL(`${origem}/mcp`), {requestInit: {headers}}));
  return c;
};

describe('MCP por HTTP', () => {
  it('recusa pedido sem token da aba', async () => {
    await expect(conectar({})).rejects.toThrow();
  });

  it('aplica patch como agente da aba e grava a origem no diário', async () => {
    const arquivo = mcp.novaAba(origem, 'Claude 1');
    const cfg = JSON.parse(readFileSync(arquivo, 'utf-8'));
    expect(cfg.mcpServers.estudio).toMatchObject({type: 'http', url: `${origem}/mcp`});
    const c = await conectar(cfg.mcpServers.estudio.headers);
    const ler = (await c.callTool({name: 'ler_documento', arguments: {documento: 'cena3d', caminho: '/objetos/0/cor'}})) as {content: {text: string}[]};
    const lido = JSON.parse(ler.content[0].text);
    expect(lido.conteudo).toBe('#4A90D9');
    const r = (await c.callTool({name: 'aplicar_patch', arguments: {documento: 'cena3d', versao_base: lido.versao, rotulo: 'anel mais claro',
      patch: [{op: 'test', path: '/objetos/0/cor', value: '#4A90D9'}, {op: 'replace', path: '/objetos/0/cor', value: '#9CC8F5'}]}})) as {isError?: boolean};
    expect(r.isError).toBeFalsy();
    const diario = new Projeto(pasta).diario();
    expect(diario[diario.length - 1]).toMatchObject({autor: 'agente', origem: 'Claude 1', rotulo: 'anel mais claro'});
    await c.close();
  });
});

// corpo cru por http.request; cortes: posições em que o corpo é partido em write() separados
const postar = (headers: Record<string, string>, corpo: Buffer | string, cortes: number[] = []) => new Promise<{status: number; texto: string}>((ok) => {
  const r = http.request(`${origem}/mcp`, {method: 'POST', agent: false,
    headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers}}, (res) => {
    const pedacos: Buffer[] = [];
    res.on('data', (d: Buffer) => pedacos.push(d));
    res.on('end', () => ok({status: res.statusCode ?? 0, texto: Buffer.concat(pedacos).toString('utf-8')}));
  });
  r.on('error', (e) => ok({status: -1, texto: String(e)}));
  r.setTimeout(3000, () => (r.destroy(), ok({status: -2, texto: 'sem resposta'})));
  const b = Buffer.isBuffer(corpo) ? corpo : Buffer.from(corpo);
  let i = 0;
  const mandar = () => {
    const n = cortes.shift();
    if (n === undefined) return void r.end(b.subarray(i));
    r.write(b.subarray(i, n));
    i = n;
    setTimeout(mandar, 30);
  };
  mandar();
});

describe('MCP por HTTP: o corpo do pedido', () => {
  const chamada = (id: number, name: string, args: Record<string, unknown>) => JSON.stringify({jsonrpc: '2.0', id, method: 'tools/call', params: {name, arguments: args}});
  const resultado = (texto: string) => JSON.parse(JSON.parse(texto).result.content[0].text);
  let headers: Record<string, string> = {};
  const versao = async () => resultado((await postar(headers, chamada(1, 'ler_documento', {documento: 'cena3d', caminho: '/objetos/0'}))).texto).versao as string;
  const nomeGravado = () => JSON.parse(readFileSync(path.join(pasta, '3d', 'cena.json'), 'utf-8')).objetos[0].nome as string;

  beforeAll(() => {
    headers = JSON.parse(readFileSync(mcp.novaAba(origem, 'Claude corpo'), 'utf-8')).mcpServers.estudio.headers;
  });

  it('um "ç" partido entre dois pedaços chega inteiro ao documento', async () => {
    const valor = 'ação '.repeat(20);
    const b = Buffer.from(chamada(2, 'aplicar_patch', {documento: 'cena3d', versao_base: await versao(), patch: [{op: 'replace', path: '/objetos/0/nome', value: valor}]}));
    const r = await postar(headers, b, [b.indexOf(Buffer.from('ç')) + 1]); // entre 0xC3 e 0xA7
    expect(r.status).toBe(200);
    expect(nomeGravado()).toBe(valor);
  });

  it('um pedido único de 512 KB em português grava sem U+FFFD', async () => {
    const valor = 'ação€ '.repeat(512 * 1024 / 10);
    const r = await postar(headers, chamada(3, 'aplicar_patch', {documento: 'cena3d', versao_base: await versao(), patch: [{op: 'replace', path: '/objetos/0/nome', value: valor}]}));
    expect(r.status).toBe(200);
    const gravado = nomeGravado();
    expect(gravado.includes('\uFFFD')).toBe(false);
    expect(gravado).toBe(valor);
  });

  it('JSON inválido recebe 400 com o erro de parse do JSON-RPC', async () => {
    const r = await postar(headers, '{"jsonrpc":');
    expect(r.status).toBe(400);
    expect(JSON.parse(r.texto)).toMatchObject({jsonrpc: '2.0', id: null, error: {code: -32700}});
  });

  it('corpo acima do teto recebe 413 sem ser lido', async () => {
    const {TETO_CORPO} = await import('../src/main/mcp-http');
    const r = await postar({...headers, 'Content-Length': String(TETO_CORPO + 1)}, '{');
    expect(r.status).toBe(413);
  });
});
