// MCP do Claude Desktop (src/nucleo/mcp-desktop.ts, mcp/desktop.ts e a extensão .mcpb): com o app fechado, listar e
// escolher o projeto e trabalhar nele com a origem "Claude Desktop"; o portão sem o app (elicitação do cliente, ou recusa
// clara); com o app aberto, a chamada vai a ele pelo arquivo de descoberta, sem token colado, e passa pelo portão dele.
// No fim, a prova ponta a ponta: o .mcpb gerado, desempacotado, rodado como o Claude Desktop roda (node server/index.js),
// achando um Estúdio "instalado" numa pasta pessoal temporária, com um cliente MCP de verdade (o SDK).
import {execSync} from 'node:child_process';
import {copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import http from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {ElicitRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {arquivoDescoberta, descobertaViva, instalacoesPadrao, pastaDadosEstudio, type Descoberta, type Sistema} from '../src/nucleo/claude-desktop';
import {criarServidorDesktop, SEM_PORTAO, SEM_PROJETO} from '../src/nucleo/mcp-desktop';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {McpHttp, type Perguntador} from '../src/main/mcp-http';
import {criarClaudeDesktop} from '../src/main/claude-desktop';
import {Projeto} from '../src/nucleo/projeto';
import {deszipar} from '../mcpb/zip';

const RAIZ = path.join(__dirname, '..');
type Res = {isError?: boolean; content: {type: string; text: string}[]};
const textoDe = (r: unknown) => (r as Res).content.map((c) => c.text).join('\n');

let casa = '';
let projetos = '';
let dados = '';
const novoProjeto = (nome: string) => {
  const p = path.join(projetos, nome);
  cpSync(path.join(__dirname, 'fixtures', 'projeto'), p, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
  const m = JSON.parse(readFileSync(path.join(p, 'estudio.json'), 'utf-8'));
  writeFileSync(path.join(p, 'estudio.json'), JSON.stringify({...m, nome}, null, 2));
  return p;
};

// o "app": o McpHttp de verdade num servidor HTTP local, com o portão perguntando a uma lista
const pedidos: Parameters<Perguntador>[0][] = [];
let permitir = false;
let projetoDoApp: Projeto | null = null;
let servidorApp: http.Server;
let mcpApp: McpHttp;
let urlApp = '';

beforeAll(async () => {
  casa = mkdtempSync(path.join(tmpdir(), 'estudio-cdmcp-'));
  projetos = path.join(casa, 'Estudio');
  dados = path.join(casa, 'dados');
  mkdirSync(dados, {recursive: true});
  novoProjeto('Alfa');
  novoProjeto('Beta');
  mcpApp = new McpHttp(path.join(casa, 'cfg-app'), () => projetoDoApp, undefined, async (p) => (pedidos.push(p), {permitir}));
  servidorApp = http.createServer((req, res) => void mcpApp.atender(req, res).then((ok) => ok || res.writeHead(404).end()));
  await new Promise<void>((ok) => servidorApp.listen(0, '127.0.0.1', ok));
  urlApp = `http://127.0.0.1:${(servidorApp.address() as {port: number}).port}`;
});

afterAll(async () => {
  servidorApp.closeAllConnections();
  await new Promise((ok) => servidorApp.close(ok));
  rmSync(casa, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
});

/** O "app aberto" publica a descoberta como o main.ts faz (criarClaudeDesktop), na pasta de dados pedida. */
const abrirApp = (pastaDados: string, raiz: string | null) => {
  projetoDoApp = raiz ? new Projeto(raiz) : null;
  const cd = criarClaudeDesktop({dados: pastaDados, executavel: process.execPath, script: 'x', versao: '2.0.1', mcp: () => mcpApp, url: () => urlApp});
  cd.publicar(raiz);
  return cd;
};

const conectar = async (descoberta: () => Descoberta | null, o: {elicitar?: (msg: string) => {action: 'accept' | 'decline'; content?: Record<string, unknown>}} = {}) => {
  const d = criarServidorDesktop({dados, pastas: [projetos], descoberta,
    registrar: (s, projeto, origem, portao) => registrarFerramentas(s, projeto, 'agente', origem, undefined, undefined, portao)});
  const [a, b] = InMemoryTransport.createLinkedPair();
  await d.servidor.connect(a);
  const c = new Client({name: 'claude-desktop-falso', version: '0'}, o.elicitar ? {capabilities: {elicitation: {}}} : undefined);
  if (o.elicitar) c.setRequestHandler(ElicitRequestSchema, async (r) => o.elicitar!(r.params.message));
  await c.connect(b);
  return {c, d};
};

describe('MCP do Claude Desktop com o app fechado', () => {
  it('lista os projetos, recusa trabalhar sem escolha, escolhe e grava com a origem "Claude Desktop"', async () => {
    const {c, d} = await conectar(() => null);
    expect(c.getInstructions()).toMatch(/listar_projetos/);
    const nomes = (await c.listTools()).tools.map((t) => t.name);
    for (const n of ['listar_projetos', 'escolher_projeto', 'projeto_info', 'ler_documento', 'aplicar_patch']) expect(nomes).toContain(n);
    // todas as ferramentas que o manifesto do .mcpb anuncia existem de verdade
    const manifesto = JSON.parse(readFileSync(path.join(RAIZ, 'mcpb', 'manifest.json'), 'utf-8')) as {tools: {name: string}[]};
    for (const t of manifesto.tools) expect(nomes).toContain(t.name);

    const sem = await c.callTool({name: 'projeto_info', arguments: {}});
    expect(sem.isError).toBe(true);
    expect(textoDe(sem)).toBe(SEM_PROJETO);

    const lista = JSON.parse(textoDe(await c.callTool({name: 'listar_projetos', arguments: {}})));
    expect(lista).toMatchObject({app_aberto: false, aberto_no_app: null, escolhido: null});
    expect(lista.projetos.map((p: {nome: string}) => p.nome)).toEqual(['Alfa', 'Beta']);

    expect(textoDe(await c.callTool({name: 'escolher_projeto', arguments: {projeto: 'beta'}}))).toMatch(/^Projeto escolhido: Beta/);
    expect(d.escolhido()).toBe(path.resolve(projetos, 'Beta'));
    expect(JSON.parse(textoDe(await c.callTool({name: 'projeto_info', arguments: {}}))).nome).toBe('Beta');

    const lido = JSON.parse(textoDe(await c.callTool({name: 'ler_documento', arguments: {documento: 'cena3d', caminho: '/objetos/0/cor'}})));
    const r = await c.callTool({name: 'aplicar_patch', arguments: {documento: 'cena3d', versao_base: lido.versao, rotulo: 'pelo Claude Desktop',
      patch: [{op: 'replace', path: '/objetos/0/cor', value: '#0F0F0F'}]}});
    expect(r.isError).toBeFalsy();
    expect(new Projeto(path.join(projetos, 'Beta')).diario().slice(-1)[0]).toMatchObject({origem: 'Claude Desktop', autor: 'agente', rotulo: 'pelo Claude Desktop'});
    await d.fechar();
  });

  it('ferramenta sensível sem o app: pede pela confirmação do cliente; sem ela, não roda e diz para abrir o Estúdio', async () => {
    const semElicitar = await conectar(() => null);
    await semElicitar.c.callTool({name: 'escolher_projeto', arguments: {projeto: 'Alfa'}});
    const recusa = await semElicitar.c.callTool({name: 'ler_fonte', arguments: {url: 'https://exemplo.invalid/'}});
    expect(recusa.isError).toBe(true);
    expect(textoDe(recusa)).toBe(SEM_PORTAO);
    await semElicitar.d.fechar();

    const perguntas: string[] = [];
    const comElicitar = await conectar(() => null, {elicitar: (m) => (perguntas.push(m), {action: 'accept', content: {permitir: false}})});
    await comElicitar.c.callTool({name: 'escolher_projeto', arguments: {projeto: 'Alfa'}});
    const negado = await comElicitar.c.callTool({name: 'ler_fonte', arguments: {url: 'https://exemplo.invalid/'}});
    expect(textoDe(negado)).toMatch(/negou/);
    expect(perguntas[0]).toMatch(/abrir uma página da internet \(ler_fonte\)/);
    await comElicitar.d.fechar();
  });
});

describe('MCP do Claude Desktop com o app aberto (descoberta, sem token colado)', () => {
  it('opera no projeto do app, com o portão do app e a origem "Claude Desktop"; app sem projeto volta ao escolhido', async () => {
    const pastaDados = mkdtempSync(path.join(casa, 'dados-app-'));
    const alfa = path.join(projetos, 'Alfa');
    const app = abrirApp(pastaDados, alfa);
    const {c, d} = await conectar(() => descobertaViva(app.arquivoDescoberta));
    const lista = JSON.parse(textoDe(await c.callTool({name: 'listar_projetos', arguments: {}})));
    expect(lista).toMatchObject({app_aberto: true, aberto_no_app: path.resolve(alfa)});
    // sem escolher nada: vai ao projeto aberto no app
    expect(JSON.parse(textoDe(await c.callTool({name: 'projeto_info', arguments: {}}))).nome).toBe('Alfa');
    // escolher outro com o app aberto avisa que o app manda
    expect(textoDe(await c.callTool({name: 'escolher_projeto', arguments: {projeto: 'Beta'}}))).toMatch(/aberto em .*Alfa/);
    expect(JSON.parse(textoDe(await c.callTool({name: 'projeto_info', arguments: {}}))).nome).toBe('Alfa');
    // gravação pelo app: origem "Claude Desktop" no diário do projeto do app
    const lido = JSON.parse(textoDe(await c.callTool({name: 'ler_documento', arguments: {documento: 'capa', caminho: '/fundo'}})));
    await c.callTool({name: 'aplicar_patch', arguments: {documento: 'capa', versao_base: lido.versao, rotulo: 'fundo pelo Desktop',
      patch: [{op: 'replace', path: '/fundo', value: '#222222'}]}});
    expect(new Projeto(alfa).diario().slice(-1)[0]).toMatchObject({origem: 'Claude Desktop', rotulo: 'fundo pelo Desktop'});
    // ferramenta sensível: o cartão aparece no app, com a origem
    pedidos.length = 0;
    permitir = false;
    const negado = await c.callTool({name: 'ler_fonte', arguments: {url: 'https://exemplo.invalid/'}});
    expect(textoDe(negado)).toMatch(/negou/);
    expect(pedidos[0]).toMatchObject({origem: 'Claude Desktop', ferramenta: 'ler_fonte'});
    // o app fecha o projeto (409): a chamada roda aqui, no escolhido (Beta)
    projetoDoApp = null;
    expect(JSON.parse(textoDe(await c.callTool({name: 'projeto_info', arguments: {}}))).nome).toBe('Beta');
    app.retirar();
    await d.fechar();
  });
});

describe('extensão .mcpb de ponta a ponta (como o Claude Desktop roda)', () => {
  it('o lançador acha o Estúdio "instalado", lista, escolhe e grava; com o app aberto, passa por ele; sem o Estúdio, manda instalar', async () => {
    execSync('npm run mcp:build', {cwd: RAIZ, stdio: 'ignore'});
    execSync('npm run mcpb', {cwd: RAIZ, stdio: 'ignore'});
    const versao = JSON.parse(readFileSync(path.join(RAIZ, 'package.json'), 'utf-8')).version as string;
    // o Claude Desktop desempacota a extensão numa pasta dele
    const ext = path.join(casa, 'Claude Extensions', 'local.mcpb.bkm.estudio');
    for (const e of deszipar(readFileSync(path.join(RAIZ, 'out', 'mcpb', `Estudio-${versao}.mcpb`)))) {
      mkdirSync(path.dirname(path.join(ext, e.nome)), {recursive: true});
      writeFileSync(path.join(ext, e.nome), e.dados);
    }
    // uma pasta pessoal de mentira, com o ambiente que cada sistema usa para achar as pastas
    const home = path.join(casa, 'home');
    const env = {HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
      XDG_CONFIG_HOME: path.join(home, '.config')};
    const sistema: Sistema = {plataforma: process.platform, home, env};
    const rodar = async () => {
      const c = new Client({name: 'claude-desktop', version: '0'});
      // o mcp_config do manifesto: node ${__dirname}/server/index.js
      await c.connect(new StdioClientTransport({command: process.execPath, args: [path.join(ext, 'server', 'index.js')], env: {...env, PATH: process.env.PATH ?? ''},
        stderr: 'ignore'}));
      return c;
    };

    // sem o Estúdio: uma ferramenta só, que manda instalar
    const sem = await rodar();
    expect(sem.getInstructions()).toMatch(/^Instale o Estúdio/);
    expect((await sem.listTools()).tools.map((t) => t.name)).toEqual(['estudio_instalar']);
    expect(textoDe(await sem.callTool({name: 'estudio_instalar', arguments: {}}))).toMatch(/Instale o Estúdio/);
    await sem.close();

    // o Estúdio "instalado" no lugar padrão deste sistema: o executável (aqui, o node) e o desktop.cjs nos recursos
    const inst = instalacoesPadrao(sistema).at(-1)!; // no Mac, o ~/Applications (o /Applications é da máquina)
    mkdirSync(path.dirname(inst.executavel), {recursive: true});
    if (process.platform === 'win32') copyFileSync(process.execPath, inst.executavel);
    else symlinkSync(process.execPath, inst.executavel);
    mkdirSync(path.dirname(inst.script), {recursive: true});
    writeFileSync(inst.script, `require(${JSON.stringify(path.join(RAIZ, 'dist-mcp', 'desktop.cjs'))});\n`);
    // os projetos em ~/Estudio
    const gama = path.join(home, 'Estudio', 'Gama');
    cpSync(path.join(__dirname, 'fixtures', 'projeto'), gama, {recursive: true, filter: (f) => !f.endsWith('.mp4')});

    const c = await rodar();
    const nomes = (await c.listTools()).tools.map((t) => t.name);
    expect(nomes).toEqual(expect.arrayContaining(['listar_projetos', 'escolher_projeto', 'aplicar_patch', 'estado_do_editor']));
    const lista = JSON.parse(textoDe(await c.callTool({name: 'listar_projetos', arguments: {}})));
    expect(lista.app_aberto).toBe(false);
    expect(lista.projetos).toEqual([expect.objectContaining({pasta: path.resolve(gama), de: 'pasta'})]);
    await c.callTool({name: 'escolher_projeto', arguments: {projeto: gama}});
    const lido = JSON.parse(textoDe(await c.callTool({name: 'ler_documento', arguments: {documento: 'cena3d', caminho: '/objetos/0/cor'}})));
    await c.callTool({name: 'aplicar_patch', arguments: {documento: 'cena3d', versao_base: lido.versao, rotulo: 'app fechado',
      patch: [{op: 'replace', path: '/objetos/0/cor', value: '#123456'}]}});
    expect(new Projeto(gama).diario().slice(-1)[0]).toMatchObject({origem: 'Claude Desktop', rotulo: 'app fechado'});

    // o app abre o projeto: a próxima chamada vai a ele, pela descoberta na pasta de dados deste sistema
    const app = abrirApp(pastaDadosEstudio(sistema), gama);
    expect(arquivoDescoberta(sistema)).toBe(app.arquivoDescoberta);
    pedidos.length = 0;
    const negado = await c.callTool({name: 'ler_fonte', arguments: {url: 'https://exemplo.invalid/'}});
    expect(textoDe(negado)).toMatch(/negou/);
    expect(pedidos[0]).toMatchObject({origem: 'Claude Desktop', ferramenta: 'ler_fonte'});
    const info = JSON.parse(textoDe(await c.callTool({name: 'listar_projetos', arguments: {}})));
    expect(info).toMatchObject({app_aberto: true, aberto_no_app: path.resolve(gama)});
    app.retirar();
    await c.close();
  }, 120_000);
});
