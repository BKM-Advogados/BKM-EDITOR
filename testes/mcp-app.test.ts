// O MCP da IDE passa pelo app quando ele está aberto no mesmo projeto (auditoria do núcleo, V3; decisão da reformulação):
// o app publica .estudio/mcp-app.json, o MCP por stdio repassa as chamadas de ferramenta a ele, e com o app fechado (ou
// sem projeto, ou um arquivo de um app que morreu) roda ali mesmo, com a trava.
import {cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import http from 'node:http';
import net, {type AddressInfo} from 'node:net';
import {spawnSync} from 'node:child_process';
import os, {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {McpHttp} from '../src/main/mcp-http';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {ARQUIVO_MCP_APP, appAberto, type ConexaoApp, type CriarConexao, encaminharAoApp, origemDaIde, pedidoNaoSaiu, rotuloAceito, publicarMcpApp, repassarAoAppQuandoAberto,
  retirarMcpApp} from '../src/nucleo/mcp-app';
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
const ide = async (conversa?: string, encontrar?: (raiz: string) => ConexaoApp | null, prazo?: number, rotulo?: string) => {
  const local = new McpServer({name: 'estudio', version: '0'});
  registrarFerramentas(local, new Projeto(pasta), 'agente', conversa ? origemDaIde(conversa, rotulo) : 'mcp');
  const [a, b] = InMemoryTransport.createLinkedPair();
  await local.connect(a);
  repassarAoAppQuandoAberto(a, pasta, {...(conversa ? {quem: {conversa, autor: 'agente', ...(rotulo ? {rotulo} : {})}} : {}), ...(encontrar ? {encontrar} : {}), ...(prazo ? {prazo} : {})});
  const c = new Client({name: 'ide', version: '0'});
  await c.connect(b);
  return c;
};

const trocarCor = async (c: Client, cor: string, objeto = 0) => {
  const ler = (await c.callTool({name: 'ler_documento', arguments: {documento: 'cena3d', caminho: `/objetos/${objeto}/cor`}})) as {content: {text: string}[]};
  const {versao} = JSON.parse(ler.content[0].text);
  return (await c.callTool({name: 'aplicar_patch', arguments: {documento: 'cena3d', versao_base: versao, rotulo: `cor ${cor}`,
    patch: [{op: 'replace', path: `/objetos/${objeto}/cor`, value: cor}]}})) as {isError?: boolean; content: {text: string}[]};
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

  it('o nome do harness (--origem) vai junto da conversa, pelo app e sem ele (docs/harnesses.md)', async () => {
    expect(origemDaIde('abcdef')).toBe('ide-abcdef');
    expect(origemDaIde('abcdef', 'Gemini CLI')).toBe('ide-abcdef Gemini CLI');
    for (const ok of ['Codex', 'Gemini CLI', 'VS Code', 'opencode', 'Antigravity']) expect(rotuloAceito(ok)).toBe(true);
    for (const ruim of ['', ' Codex', 'a\nb', 'x'.repeat(40), 'ide-<script>', 12]) expect(rotuloAceito(ruim)).toBe(false);
    const c = mcp.novaConexao(origem, 'mcp', {ide: true});
    publicarMcpApp(pasta, {url: c.url, token: c.headers.Authorization.slice('Bearer '.length)});
    const pelo = await ide('cccccc', undefined, undefined, 'Gemini CLI');
    expect((await trocarCor(pelo, '#c00000')).isError).toBeFalsy();
    expect(ultima()).toMatchObject({autor: 'agente', origem: 'ide-cccccc Gemini CLI'}); // pelo app (cabeçalho X-Estudio-Origem)
    retirarMcpApp(pasta, c.headers.Authorization.slice('Bearer '.length));
    expect((await trocarCor(pelo, '#c00001')).isError).toBeFalsy();
    expect(ultima()).toMatchObject({autor: 'agente', origem: 'ide-cccccc Gemini CLI'}); // com o app fechado, ali mesmo
    await pelo.close();
  });

  it('cada conversa da IDE grava com a origem dela, e o desfazer de uma não desfaz a da outra', async () => {
    const c = mcp.novaConexao(origem, 'mcp', {ide: true});
    publicarMcpApp(pasta, {url: c.url, token: c.headers.Authorization.slice('Bearer '.length)});
    const [a, b] = [await ide('aaaaaa'), await ide('bbbbbb')];
    expect((await trocarCor(a, '#a00000')).isError).toBeFalsy();
    expect(ultima()).toMatchObject({autor: 'agente', origem: 'ide-aaaaaa', rotulo: 'cor #a00000'});
    expect((await trocarCor(b, '#b00000', 1)).isError).toBeFalsy();
    expect(ultima()).toMatchObject({autor: 'agente', origem: 'ide-bbbbbb', rotulo: 'cor #b00000'});
    const desfez = (await a.callTool({name: 'desfazer', arguments: {}})) as {isError?: boolean; content: {text: string}[]};
    expect(desfez.isError).toBeFalsy();
    expect(JSON.parse(desfez.content[0].text).desfeitas[0]).toContain('cor #a00000');
    expect(ultima()).toMatchObject({origem: 'ide-aaaaaa', rotulo: 'reverter: cor #a00000'});
    // com o app fechado, a mesma conversa segue sendo ela: o desfazer acha só as dela
    retirarMcpApp(pasta, c.headers.Authorization.slice('Bearer '.length));
    const outra = (await b.callTool({name: 'desfazer', arguments: {}})) as {isError?: boolean; content: {text: string}[]};
    expect(JSON.parse(outra.content[0].text).desfeitas[0]).toContain('cor #b00000');
    expect(ultima()).toMatchObject({origem: 'ide-bbbbbb', rotulo: 'reverter: cor #b00000'});
    await a.close();
    await b.close();
  });

  it('com o app aberto e sem projeto (409), roda na IDE', async () => {
    projetoAberto = null;
    const cliente = await ide();
    expect((await trocarCor(cliente, '#222222')).isError).toBeFalsy();
    expect(ultima()).toMatchObject({origem: 'mcp', rotulo: 'cor #222222'});
    projetoAberto = new Projeto(pasta);
    await cliente.close();
  });

  it('com o app vivo recusando o token (401), responde erro e não grava sem o portão', async () => {
    publicarMcpApp(pasta, {url: `${origem}/mcp`, token: 'revogado'});
    const antes = ultima().seq;
    const cliente = await ide();
    await expect(trocarCor(cliente, '#333333')).rejects.toThrow(/recusou a conexão; reabra o projeto no app/);
    expect(ultima().seq).toBe(antes);
    await cliente.close();
  });

  it('token recusado e republicado: relê o arquivo e passa pelo app', async () => {
    const c = mcp.novaConexao(origem, 'IDE republicada', {ide: true});
    publicarMcpApp(pasta, {url: c.url, token: c.headers.Authorization.slice('Bearer '.length)});
    const atual = appAberto(pasta)!;
    let leituras = 0; // a primeira leitura vê o token velho (a tela recarregou entre a leitura e o pedido)
    const cliente = await ide(undefined, () => (++leituras === 1 ? {...atual, token: 'velho'} : appAberto(pasta)));
    expect((await trocarCor(cliente, '#353535')).isError).toBeFalsy();
    expect(ultima()).toMatchObject({origem: 'IDE republicada', rotulo: 'cor #353535'});
    await cliente.close();
  });

  it('token recusado e o app fechou o projeto (arquivo apagado): roda na IDE', async () => {
    let leituras = 0;
    const velho = {formato: 1 as const, url: `${origem}/mcp`, token: 'velho', pid: process.pid, host: os.hostname(), raiz: pasta, em: ''};
    const cliente = await ide(undefined, () => (++leituras === 1 ? velho : null));
    expect((await trocarCor(cliente, '#363636')).isError).toBeFalsy();
    expect(ultima()).toMatchObject({origem: 'mcp', rotulo: 'cor #363636'});
    await cliente.close();
  });

  it('app travado sem fechar a conexão: estoura o prazo e responde erro, sem gravar', async () => {
    const pendentes: http.ServerResponse[] = [];
    const mudo = http.createServer((_req, res) => void pendentes.push(res)); // aceita e nunca responde
    await new Promise<void>((ok) => mudo.listen(0, '127.0.0.1', ok));
    const travado = {formato: 1 as const, url: `http://127.0.0.1:${(mudo.address() as AddressInfo).port}/mcp`, token: 't', pid: process.pid,
      host: os.hostname(), raiz: pasta, em: ''};
    const antes = ultima().seq;
    const cliente = await ide(undefined, () => travado, 300);
    const inicio = Date.now();
    await expect(trocarCor(cliente, '#373737')).rejects.toThrow(/não respondeu em .* min; nada foi gravado/);
    expect(Date.now() - inicio).toBeLessThan(5000);
    expect(ultima().seq).toBe(antes);
    await cliente.close();
    for (const res of pendentes) res.destroy();
    await new Promise<void>((ok) => mudo.close(() => ok()));
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

describe('conexão com o app que cai: roda na IDE só se o pedido não saiu daqui', () => {
  const conexao = (url: string): ConexaoApp => ({formato: 1, url, token: 't', pid: process.pid, host: os.hostname(), raiz: pasta, em: ''});
  const chamada = {jsonrpc: '2.0' as const, id: 7, method: 'tools/call', params: {name: 'aplicar_patch', arguments: {}}};
  const escutar = async (s: http.Server | net.Server) => {
    await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
    return `http://127.0.0.1:${(s.address() as AddressInfo).port}/mcp`;
  };
  const fechar = (s: http.Server | net.Server) => new Promise<void>((ok) => s.close(() => ok()));
  /** Uma conexão que cai com `codigo` antes de abrir (o que o macOS pode dar numa porta que acabou de fechar). */
  const caiAntes = (codigo: string): CriarConexao => () => {
    const s = new net.Socket();
    process.nextTick(() => s.destroy(Object.assign(new Error(`connect ${codigo}`), {code: codigo})));
    return s;
  };

  it('a regra: só antes de a conexão abrir, e só recusada ou derrubada', () => {
    for (const c of ['ECONNREFUSED', 'ECONNRESET', 'EPIPE']) {
      expect(pedidoNaoSaiu(c, false), c).toBe(true);
      expect(pedidoNaoSaiu(c, true), c).toBe(false);
    }
    expect(pedidoNaoSaiu('ETIMEDOUT', false)).toBe(false);
    expect(pedidoNaoSaiu(undefined, false)).toBe(false);
  });

  it('porta fechada: recusada, roda na IDE', async () => {
    const s = http.createServer();
    const url = await escutar(s);
    await fechar(s);
    expect(await encaminharAoApp(conexao(url), chamada)).toBeNull();
  });

  it('ECONNRESET ou EPIPE antes de conectar (macOS): roda na IDE', async () => {
    for (const codigo of ['ECONNRESET', 'EPIPE']) {
      expect(await encaminharAoApp(conexao('http://127.0.0.1:9/mcp'), chamada, undefined, 5000, caiAntes(codigo)), codigo).toBeNull();
    }
    const outro = await encaminharAoApp(conexao('http://127.0.0.1:9/mcp'), chamada, undefined, 5000, caiAntes('EHOSTUNREACH'));
    expect(outro).toMatchObject({id: 7, error: {message: expect.stringMatching(/não respondeu/)}});
  });

  it('conectou e caiu no meio (o app pode ter gravado): erro, não roda de novo aqui', async () => {
    let recebidos = 0;
    const s = http.createServer((req) => {
      recebidos++;
      req.socket.resetAndDestroy(); // derruba com RST depois de ler o pedido
    });
    const url = await escutar(s);
    const r = await encaminharAoApp(conexao(url), chamada);
    expect(recebidos).toBe(1);
    expect(r).toMatchObject({id: 7, error: {message: expect.stringMatching(/não respondeu \(.*\); tente de novo/)}});
    const cru = net.createServer((sock) => sock.once('data', () => sock.resetAndDestroy())); // sem nem passar pelo http
    const url2 = await escutar(cru);
    expect(await encaminharAoApp(conexao(url2), chamada)).toMatchObject({id: 7, error: {code: -32000}});
    await fechar(s);
    await fechar(cru);
  });

  it('cada chamada vai por conexão nova: o app que fecha não derruba um pedido já escrito numa conexão velha', async () => {
    // a falha do CI no Mac Intel ("read ECONNRESET"): a chamada saía por uma conexão keep-alive de antes, que o app já
    // tinha fechado; caía depois de "conectada" e virava erro em vez de rodar na IDE
    let conexoes = 0;
    const s = http.createServer((_req, res) => res.writeHead(200, {'Content-Type': 'application/json', Connection: 'keep-alive'})
      .end(JSON.stringify({jsonrpc: '2.0', id: 7, result: {content: []}})));
    s.on('connection', () => conexoes++);
    const url = await escutar(s);
    expect(await encaminharAoApp(conexao(url), chamada)).toMatchObject({id: 7, result: {}});
    expect(await encaminharAoApp(conexao(url), chamada)).toMatchObject({id: 7, result: {}});
    expect(conexoes).toBe(2);
    const fechou = fechar(s);
    s.closeAllConnections();
    const r = encaminharAoApp(conexao(url), chamada);
    await fechou;
    expect(await r).toBeNull();
  });
});
