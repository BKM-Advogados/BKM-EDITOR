// O MCP da IDE passa pelo app quando ele está aberto no mesmo projeto (auditoria do núcleo, V3; decisão da reformulação):
// o app publica .estudio/mcp-app.json, o MCP por stdio repassa as chamadas de ferramenta a ele, e com o app fechado (ou
// sem projeto, ou um arquivo de um app que morreu) roda ali mesmo, com a trava.
import {cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {spawnSync} from 'node:child_process';
import os, {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {McpHttp} from '../src/main/mcp-http';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {ARQUIVO_MCP_APP, appAberto, publicarMcpApp, repassarAoAppQuandoAberto, retirarMcpApp} from '../src/nucleo/mcp-app';
import {Projeto} from '../src/nucleo/projeto';

let pasta = '';
let servidor: http.Server;
let origem = '';
let mcp: McpHttp;
let projetoAberto: Projeto | null = null;

beforeAll(async () => {
  pasta = mkdtempSync(path.join(tmpdir(), 'estudio-mcp-app-'));
  cpSync(path.join(__dirname, 'fixtures', 'projeto'), pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
  projetoAberto = new Projeto(pasta); // o Projeto do app
  mcp = new McpHttp(path.join(pasta, '.config-teste'), () => projetoAberto);
  servidor = http.createServer((req, res) => void mcp.atender(req, res).then((ok) => ok || res.writeHead(404).end()));
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  origem = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(() => {
  servidor?.close();
  rmSync(pasta, {recursive: true, force: true});
});

/** O MCP por stdio da IDE (um processo à parte): servidor local sobre outro Projeto da mesma pasta, com o repasse. */
const ide = async () => {
  const local = new McpServer({name: 'estudio', version: '0'});
  registrarFerramentas(local, new Projeto(pasta), 'agente', 'mcp');
  const [a, b] = InMemoryTransport.createLinkedPair();
  await local.connect(a);
  repassarAoAppQuandoAberto(a, pasta);
  const c = new Client({name: 'ide', version: '0'});
  await c.connect(b);
  return c;
};

const trocarCor = async (c: Client, cor: string) => {
  const ler = (await c.callTool({name: 'ler_documento', arguments: {documento: 'cena3d', caminho: '/objetos/0/cor'}})) as {content: {text: string}[]};
  const {versao} = JSON.parse(ler.content[0].text);
  return (await c.callTool({name: 'aplicar_patch', arguments: {documento: 'cena3d', versao_base: versao, rotulo: `cor ${cor}`,
    patch: [{op: 'replace', path: '/objetos/0/cor', value: cor}]}})) as {isError?: boolean; content: {text: string}[]};
};
const ultima = () => new Projeto(pasta).diario(0, {tolerante: true}).at(-1)!;

describe('descoberta do app aberto', () => {
  it('publica, acha, e retira só com o próprio token', () => {
    publicarMcpApp(pasta, {url: `${origem}/mcp`, token: 'abc'});
    expect(appAberto(pasta)).toMatchObject({url: `${origem}/mcp`, token: 'abc', pid: process.pid});
    retirarMcpApp(pasta, 'outro');
    expect(existsSync(path.join(pasta, ARQUIVO_MCP_APP))).toBe(true);
    retirarMcpApp(pasta, 'abc');
    expect(existsSync(path.join(pasta, ARQUIVO_MCP_APP))).toBe(false);
    expect(appAberto(pasta)).toBeNull();
  });

  it('ignora o arquivo de um app que morreu, de outra máquina ou publicado para outra pasta', () => {
    const base = {formato: 1, url: `${origem}/mcp`, token: 't', pid: process.pid, host: os.hostname(), raiz: pasta, em: ''};
    const com = (x: object) => {
      writeFileSync(path.join(pasta, ARQUIVO_MCP_APP), JSON.stringify({...base, ...x}));
      return appAberto(pasta);
    };
    expect(com({})).not.toBeNull();
    expect(com({pid: spawnSync(process.execPath, ['-e', '']).pid})).toBeNull();
    expect(com({host: 'outra-maquina'})).toBeNull();
    expect(com({raiz: path.join(pasta, 'outra')})).toBeNull();
    expect(com({url: 'http://exemplo.com/mcp'})).toBeNull();
    rmSync(path.join(pasta, ARQUIVO_MCP_APP));
  });
});

describe('repasse do MCP da IDE', () => {
  it('com o app aberto, a gravação vai pelo app (origem do token do app no diário)', async () => {
    const c = mcp.novaConexao(origem, 'IDE pelo app');
    publicarMcpApp(pasta, {url: c.url, token: c.headers.Authorization.slice('Bearer '.length)});
    const cliente = await ide();
    const r = await trocarCor(cliente, '#111111');
    expect(r.isError).toBeFalsy();
    expect(ultima()).toMatchObject({autor: 'agente', origem: 'IDE pelo app', rotulo: 'cor #111111'});
    await cliente.close();
  });

  it('com o app aberto e sem projeto (409), roda na IDE', async () => {
    projetoAberto = null;
    const cliente = await ide();
    expect((await trocarCor(cliente, '#222222')).isError).toBeFalsy();
    expect(ultima()).toMatchObject({origem: 'mcp', rotulo: 'cor #222222'});
    projetoAberto = new Projeto(pasta);
    await cliente.close();
  });

  it('com o token revogado (401), roda na IDE', async () => {
    publicarMcpApp(pasta, {url: `${origem}/mcp`, token: 'revogado'});
    const cliente = await ide();
    expect((await trocarCor(cliente, '#333333')).isError).toBeFalsy();
    expect(ultima()).toMatchObject({origem: 'mcp'});
    await cliente.close();
  });

  it('com o app fechado sem apagar o arquivo (conexão recusada), roda na IDE', async () => {
    const c = mcp.novaConexao(origem, 'IDE pelo app');
    publicarMcpApp(pasta, {url: c.url, token: c.headers.Authorization.slice('Bearer '.length)});
    await new Promise<void>((ok) => servidor.close(() => ok()));
    const cliente = await ide();
    expect((await trocarCor(cliente, '#444444')).isError).toBeFalsy();
    expect(ultima()).toMatchObject({origem: 'mcp', rotulo: 'cor #444444'});
    expect(JSON.parse(readFileSync(path.join(pasta, new Projeto(pasta).arquivoDoDocumento('cena3d')), 'utf-8')).objetos[0].cor).toBe('#444444');
    await cliente.close();
  });
});
