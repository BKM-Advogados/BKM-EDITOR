// Apps de IA de fora (padrão Screenpipe, src/main/ia/apps-de-fora.ts e mcp/ponte.mjs): porta fixa só em 127.0.0.1, token
// por app que vira a origem no diário e passa pelo portão, recusa de página web (Origin) e de Host estranho, a ponte
// stdio para quem só aceita stdio, token que sobrevive a fechar o projeto e a reabrir o app, e revogar.
import {cpSync, mkdtempSync, rmSync} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {AppsDeFora} from '../src/main/ia/apps-de-fora';
import {CofreMemoria} from '../src/main/ia/chaves';
import {McpHttp, type Perguntador} from '../src/main/mcp-http';
import {Projeto} from '../src/nucleo/projeto';

const PONTE = path.join(__dirname, '..', 'mcp', 'ponte.mjs');
let pasta = '';
let dados = '';
const pedidos: Parameters<Perguntador>[0][] = [];
let mcp: McpHttp;
const cofre = new CofreMemoria();
let apps: AppsDeFora;
let porta = 0;

const portaLivre = () => new Promise<number>((ok) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const p = (s.address() as net.AddressInfo).port;
    s.close(() => ok(p));
  });
});

beforeAll(async () => {
  pasta = mkdtempSync(path.join(tmpdir(), 'estudio-apps-'));
  dados = mkdtempSync(path.join(tmpdir(), 'estudio-apps-dados-'));
  cpSync(path.join(__dirname, '..', 'exemplos', 'exemplo'), pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
  const projeto = new Projeto(pasta);
  mcp = new McpHttp(path.join(pasta, '.config-teste'), () => projeto, undefined, async (p) => (pedidos.push(p), {permitir: true}));
  apps = new AppsDeFora({pasta: dados, cofre, mcp: () => mcp, ponte: () => ({exe: process.execPath, script: PONTE})});
  porta = await portaLivre();
});

afterAll(async () => {
  await apps.fechar();
  rmSync(pasta, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
  rmSync(dados, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
});

const pedirCru = (headers: Record<string, string>) => new Promise<number>((ok) => {
  const r = http.request({host: '127.0.0.1', port: porta, path: '/mcp', method: 'POST', agent: false, headers: {'Content-Type': 'application/json', ...headers}}, (res) => {
    res.resume();
    ok(res.statusCode ?? 0);
  });
  r.on('error', () => ok(-1));
  r.end(JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list'}));
});

type Res = {isError?: boolean; content: {type: string; text: string}[]};

describe('apps de IA de fora', () => {
  it('liga a porta, cria o app, e ele edita por HTTP com a origem própria e o mesmo portão', async () => {
    expect(await apps.ligar(true, porta)).toMatchObject({ligado: true, ouvindo: true, porta});
    const {configs} = apps.novo('Cursor');
    const cfg = JSON.parse(configs.http).mcpServers.estudio;
    expect(cfg.url).toBe(`http://127.0.0.1:${porta}/mcp`);
    const c = new Client({name: 'cursor', version: '0'});
    await c.connect(new StreamableHTTPClientTransport(new URL(cfg.url), {requestInit: {headers: cfg.headers}}));
    const lido = JSON.parse(((await c.callTool({name: 'ler_documento', arguments: {documento: 'cena3d', caminho: '/objetos/0/cor'}})) as Res).content[0].text);
    await c.callTool({name: 'aplicar_patch', arguments: {documento: 'cena3d', versao_base: lido.versao, rotulo: 'pelo Cursor',
      patch: [{op: 'replace', path: '/objetos/0/cor', value: '#0F0F0F'}]}});
    const ultima = new Projeto(pasta).diario().slice(-1)[0];
    expect(ultima).toMatchObject({origem: 'Cursor', rotulo: 'pelo Cursor'});
    // ferramenta "cartao" pede a permissão da pessoa, com o nome do app
    new Projeto(pasta).aplicarPatch({documento: 'cena3d', patch: [{op: 'replace', path: '/objetos/0/cor', value: '#1F1F1F'}], autor: 'pessoa', origem: 'interface'});
    pedidos.length = 0;
    await c.callTool({name: 'reverter', arguments: {seq: new Projeto(pasta).ultimaSeq()}});
    expect(pedidos[0]).toMatchObject({origem: 'Cursor', ferramenta: 'reverter'});
    await c.close();
  });

  it('recusa página web (Origin) e Host estranho; sem token, 401', async () => {
    const {configs} = apps.novo('Cline');
    const auth = JSON.parse(configs.http).mcpServers.estudio.headers.Authorization;
    expect(await pedirCru({Authorization: auth, Origin: 'https://site-malicioso.example'})).toBe(403);
    expect(await pedirCru({Authorization: auth, Host: `evil.example:${porta}`})).toBe(403);
    expect(await pedirCru({})).toBe(401);
  });

  it('a ponte stdio repassa ao app: Claude Desktop e quem só aceita stdio', async () => {
    const {configs} = apps.novo('Claude Desktop');
    const s = JSON.parse(configs.stdio).mcpServers.estudio;
    expect(s.env.ELECTRON_RUN_AS_NODE).toBe('1');
    const c = new Client({name: 'desktop', version: '0'});
    await c.connect(new StdioClientTransport({command: process.execPath, args: [PONTE], env: {...process.env, ESTUDIO_MCP_URL: s.env.ESTUDIO_MCP_URL,
      ESTUDIO_MCP_TOKEN: s.env.ESTUDIO_MCP_TOKEN} as Record<string, string>}));
    expect(c.getInstructions()).toMatch(/estado_do_editor/);
    const {tools} = await c.listTools();
    expect(tools.map((t) => t.name)).toContain('aplicar_patch');
    const r = (await c.callTool({name: 'criar_comentario', arguments: {documento: 'cena3d', texto: 'pelo Claude Desktop'}})) as Res;
    expect(JSON.parse(r.content[0].text)).toMatchObject({autor: 'Claude Desktop'});
    await c.close();
  });

  it('o token sobrevive a fechar o projeto e a reabrir o app; revogar corta o acesso', async () => {
    const {id, configs} = apps.novo('Windsurf');
    const auth = JSON.parse(configs.http).mcpServers.estudio.headers.Authorization;
    mcp.esquecerTudo(); // projeto fechado: os tokens das abas somem, os dos apps ficam
    expect(await pedirCru({Authorization: auth, Accept: 'application/json, text/event-stream'})).toBe(200);
    // app reaberto: um MCP novo recebe os tokens guardados no cofre
    const projeto = new Projeto(pasta);
    mcp = new McpHttp(path.join(pasta, '.config-teste-2'), () => projeto);
    await apps.fechar();
    const reaberto = new AppsDeFora({pasta: dados, cofre, mcp: () => mcp, ponte: () => ({exe: process.execPath, script: PONTE})});
    await reaberto.iniciar();
    expect(reaberto.estado()).toMatchObject({ligado: true, ouvindo: true});
    expect(await pedirCru({Authorization: auth, Accept: 'application/json, text/event-stream'})).toBe(200);
    reaberto.revogar(id);
    expect(await pedirCru({Authorization: auth, Accept: 'application/json, text/event-stream'})).toBe(401);
    expect(() => reaberto.configs(id)).toThrow(/não achado/);
    await reaberto.fechar();
  });

  it('porta ocupada vira aviso em português, sem derrubar o app', async () => {
    const ocupada = net.createServer().listen(0, '127.0.0.1');
    await new Promise((ok) => ocupada.once('listening', ok));
    const p = (ocupada.address() as net.AddressInfo).port;
    const outro = new AppsDeFora({pasta: mkdtempSync(path.join(tmpdir(), 'estudio-apps-3-')), cofre: new CofreMemoria(), mcp: () => mcp,
      ponte: () => ({exe: 'x', script: 'y'})});
    expect(await outro.ligar(true, p)).toMatchObject({ligado: true, ouvindo: false, erro: expect.stringMatching(/já está em uso/)});
    await expect(outro.ligar(true, 80)).rejects.toThrow(/entre 1024 e 65535/);
    ocupada.close();
  });
});
