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
  cpSync(path.join(__dirname, '..', 'exemplos', 'exemplo'), pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
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
    expect(lido.conteudo).toBe('#C88155');
    const r = (await c.callTool({name: 'aplicar_patch', arguments: {documento: 'cena3d', versao_base: lido.versao, rotulo: 'anel mais claro',
      patch: [{op: 'test', path: '/objetos/0/cor', value: '#C88155'}, {op: 'replace', path: '/objetos/0/cor', value: '#E4B492'}]}})) as {isError?: boolean};
    expect(r.isError).toBeFalsy();
    const diario = new Projeto(pasta).diario();
    expect(diario[diario.length - 1]).toMatchObject({autor: 'agente', origem: 'Claude 1', rotulo: 'anel mais claro'});
    await c.close();
  });
});
