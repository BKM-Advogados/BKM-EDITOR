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

describe('MCP por HTTP: as conversas da IDE pelo token do app (mcp-app.ts)', () => {
  let outro: http.Server;
  let base = '';
  const perguntas: string[] = [];
  beforeAll(async () => {
    const projeto = new Projeto(pasta);
    const comPortao = new McpHttp(path.join(pasta, '.config-teste-2'), () => projeto, undefined, async (p) => {
      perguntas.push(p.origem);
      return {permitir: true, sempre: true};
    });
    outro = http.createServer((req, res) => void comPortao.atender(req, res).then((ok) => ok || res.writeHead(404).end()));
    await new Promise<void>((ok) => outro.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(outro.address() as AddressInfo).port}`;
    const ide = comPortao.novaConexao(base, 'mcp', {ide: true});
    const aba = comPortao.novaConexao(base, 'Claude 9');
    cabecalhos = {ide: ide.headers, aba: aba.headers};
  });
  afterAll(() => outro?.close());
  let cabecalhos: {ide: Record<string, string>; aba: Record<string, string>};

  const cliente = async (headers: Record<string, string>) => {
    const c = new Client({name: 'teste', version: '0'});
    await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {requestInit: {headers}}));
    return c;
  };
  const trocar = async (c: Client, valor: number) => {
    const {versao} = JSON.parse(((await c.callTool({name: 'ler_documento', arguments: {documento: 'cena3d', caminho: '/objetos/0/cor'}})) as {content: {text: string}[]}).content[0].text);
    const r = (await c.callTool({name: 'aplicar_patch', arguments: {documento: 'cena3d', versao_base: versao, rotulo: `cor ${valor}`,
      patch: [{op: 'replace', path: '/objetos/0/cor', value: `#00000${valor}`}]}})) as {isError?: boolean};
    expect(r.isError).toBeFalsy();
    return new Projeto(pasta).diario(0, {tolerante: true}).at(-1)!;
  };

  it('"Sempre nesta conversa" vale só para a conversa que marcou', async () => {
    const dono = await cliente({...cabecalhos.ide, 'X-Estudio-Conversa': 'c0c0c0'});
    const a = await cliente({...cabecalhos.ide, 'X-Estudio-Conversa': 'a1a1a1'});
    const b = await cliente({...cabecalhos.ide, 'X-Estudio-Conversa': 'b2b2b2'});
    const m1 = await trocar(dono, 1);
    const m2 = await trocar(dono, 2);
    expect(m1).toMatchObject({autor: 'agente', origem: 'ide-c0c0c0'});
    // reverter a mudança de outra conversa pergunta à pessoa; com "Sempre", a mesma conversa não pergunta de novo
    expect(((await a.callTool({name: 'reverter', arguments: {seq: m2.seq, mesmo_se_mudou: true}})) as {isError?: boolean}).isError).toBeFalsy();
    expect(((await a.callTool({name: 'reverter', arguments: {seq: m1.seq, mesmo_se_mudou: true}})) as {isError?: boolean}).isError).toBeFalsy();
    expect(perguntas).toEqual(['ide-a1a1a1']);
    // outra conversa da mesma IDE (mesmo token) pergunta
    const m3 = await trocar(dono, 3);
    await b.callTool({name: 'reverter', arguments: {seq: m3.seq, mesmo_se_mudou: true}});
    expect(perguntas).toEqual(['ide-a1a1a1', 'ide-b2b2b2']);
    for (const c of [dono, a, b]) await c.close();
  });

  it('o autor vem do processo da IDE, menos os reservados; a aba do app ignora os cabeçalhos', async () => {
    const outroAutor = await cliente({...cabecalhos.ide, 'X-Estudio-Conversa': 'd3d3d3', 'X-Estudio-Autor': encodeURIComponent('revisão')});
    expect(await trocar(outroAutor, 4)).toMatchObject({autor: 'revisão', origem: 'ide-d3d3d3'});
    await outroAutor.close();
    await expect(cliente({...cabecalhos.ide, 'X-Estudio-Conversa': 'e4e4e4', 'X-Estudio-Autor': 'pessoa'})).rejects.toThrow();
    const aba = await cliente({...cabecalhos.aba, 'X-Estudio-Conversa': 'f5f5f5', 'X-Estudio-Autor': 'pessoa'});
    expect(await trocar(aba, 5)).toMatchObject({autor: 'agente', origem: 'Claude 9'});
    await aba.close();
  });
});
