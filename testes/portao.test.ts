// O portão de permissão do MCP (src/nucleo/portao.ts) e a onda 1 das ferramentas da frente IA (src/nucleo/mcp-ia.ts):
// ferramenta "cartao" pergunta antes e não roda se a pessoa negar; "Sempre nesta conversa" não pergunta de novo;
// toda escrita volta com o seq do diário; reverter mudança de outra aba pergunta; desfazer só mexe no que é da aba;
// listar_mudancas tem limite; aplicar_patch devolve os avisos do resolvedor; o servidor manda instruções na abertura.
import {cpSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {z} from 'zod';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {McpHttp, type Perguntador} from '../src/main/mcp-http';
import {instalarPortao, mudancasDoResultado} from '../src/nucleo/portao';
import {Projeto} from '../src/nucleo/projeto';

let pasta = '';
let servidor: http.Server;
let mcp: McpHttp;
let base = '';
const pedidos: Parameters<Perguntador>[0][] = [];
let resposta: {permitir: boolean; sempre?: boolean} = {permitir: true};

beforeAll(async () => {
  pasta = mkdtempSync(path.join(tmpdir(), 'estudio-portao-'));
  cpSync(path.join(__dirname, 'fixtures', 'projeto'), pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
  const projeto = new Projeto(pasta);
  mcp = new McpHttp(path.join(pasta, '.config-teste'), () => projeto, undefined, async (p) => {
    pedidos.push(p);
    return resposta;
  });
  servidor = http.createServer((req, res) => void mcp.atender(req, res).then((ok) => ok || res.writeHead(404).end()));
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(() => {
  servidor?.close();
  rmSync(pasta, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
});

const conectar = async (origem: string) => {
  const cfg = JSON.parse(readFileSync(mcp.novaAba(base, origem), 'utf-8')).mcpServers.estudio;
  const c = new Client({name: 'teste', version: '0'});
  await c.connect(new StreamableHTTPClientTransport(new URL(cfg.url), {requestInit: {headers: cfg.headers}}));
  return c;
};
type Res = {isError?: boolean; content: {type: string; text: string}[]};
const chamar = async (c: Client, name: string, args: Record<string, unknown> = {}) => (await c.callTool({name, arguments: args})) as Res;
const texto = (r: Res) => r.content.map((x) => x.text).join('\n');

describe('portão de permissão (invólucro do registerTool)', () => {
  it('cartão: pergunta antes, não roda se negar; sempre nesta conversa não pergunta de novo; livre não pergunta', async () => {
    const s = new McpServer({name: 't', version: '0'});
    const projeto = new Projeto(pasta);
    let rodou = 0;
    const perguntas: string[] = [];
    let decide = false;
    instalarPortao(s, {projeto, origem: 'X 1', portao: {perguntar: async (p) => (perguntas.push(`${p.ferramenta}: ${p.motivo}`), decide)}});
    // uma ferramenta de outra frente, registrada depois do portão, sem saber dele
    s.registerTool('ler_fonte', {description: 'web', inputSchema: {url: z.string()}}, async () => (rodou++, {content: [{type: 'text', text: 'ok'}]}));
    s.registerTool('baixar_algo', {description: 'x', annotations: {openWorldHint: true}}, async () => (rodou++, {content: [{type: 'text', text: 'ok'}]}));
    s.registerTool('ler_algo', {description: 'x'}, async () => (rodou++, {content: [{type: 'text', text: 'ok'}]}));
    const [a, b] = InMemoryTransport.createLinkedPair();
    await s.connect(a);
    const c = new Client({name: 't', version: '0'});
    await c.connect(b);
    const negado = (await c.callTool({name: 'ler_fonte', arguments: {url: 'https://x'}})) as Res;
    expect(negado.isError).toBe(true);
    expect(rodou).toBe(0);
    decide = true;
    expect(((await c.callTool({name: 'baixar_algo', arguments: {}})) as Res).isError).toBeFalsy();
    expect(((await c.callTool({name: 'ler_algo', arguments: {}})) as Res).isError).toBeFalsy();
    expect(rodou).toBe(2);
    expect(perguntas).toEqual(['ler_fonte: abrir uma página da internet', 'baixar_algo: usar baixar algo, que sai do projeto']);
    await c.close();
  });

  it('toda escrita volta com o seq do diário; reverter mudança de outra aba pergunta; desfazer só mexe no da aba', async () => {
    const claude = await conectar('Claude 1');
    const deepseek = await conectar('DeepSeek 1');
    const lido = JSON.parse(texto(await chamar(claude, 'ler_documento', {documento: 'cena3d', caminho: '/objetos/0/cor'})));
    const r = await chamar(claude, 'aplicar_patch', {documento: 'cena3d', versao_base: lido.versao, rotulo: 'cor do Claude',
      patch: [{op: 'test', path: '/objetos/0/cor', value: lido.conteudo}, {op: 'replace', path: '/objetos/0/cor', value: '#123123'}]});
    const [m] = mudancasDoResultado(texto(r));
    expect(m).toMatchObject({rotulo: 'cor do Claude'});
    // o DeepSeek não desfaz o que é do Claude
    expect((await chamar(deepseek, 'desfazer')).isError).toBe(true);
    // e para reverter o do Claude precisa da pessoa
    pedidos.length = 0;
    resposta = {permitir: false};
    expect((await chamar(deepseek, 'reverter', {seq: m.seq})).isError).toBe(true);
    expect(pedidos[0]).toMatchObject({origem: 'DeepSeek 1', ferramenta: 'reverter'});
    expect(pedidos[0].motivo).toMatch(/Claude 1/);
    resposta = {permitir: true};
    const rev = await chamar(deepseek, 'reverter', {seq: m.seq});
    expect(rev.isError).toBeFalsy();
    expect(new Projeto(pasta).diario().slice(-1)[0]).toMatchObject({desfaz: m.seq, origem: 'DeepSeek 1'});
    // o Claude desfaz o próprio: já foi revertido, então não há o que desfazer dele
    expect(texto(await chamar(claude, 'desfazer'))).toMatch(/já foi revertida|nada para desfazer/);
    await claude.close();
    await deepseek.close();
  });

  it('listar_mudancas sem "desde" devolve só as últimas 50 (D14); guia, comentário e instruções', async () => {
    const p = new Projeto(pasta);
    for (let i = 0; i < 60; i++) p.aplicarPatch({documento: 'cena3d', patch: [{op: 'replace', path: '/objetos/0/cor', value: `#0000${String(i).padStart(2, '0')}`}], autor: 'pessoa', origem: 'interface'});
    const c = await conectar('Gemini CLI 1');
    expect(JSON.parse(texto(await chamar(c, 'listar_mudancas')))).toHaveLength(50);
    expect(JSON.parse(texto(await chamar(c, 'listar_mudancas', {limite: 5})))).toHaveLength(5);
    expect(texto(await chamar(c, 'guia_do_projeto')).length).toBeGreaterThan(200);
    const cm = JSON.parse(texto(await chamar(c, 'criar_comentario', {documento: 'cena3d', texto: 'o anel está escuro', objeto: '/objetos/0'})));
    expect(cm).toMatchObject({autor: 'Gemini CLI 1', estado: 'aberto', alvo: {objeto: '/objetos/0'}});
    await chamar(c, 'resolver_comentario', {id: cm.id});
    expect(JSON.parse(texto(await chamar(c, 'reabrir_comentario', {id: cm.id})))).toMatchObject({estado: 'aberto'});
    expect(c.getInstructions()).toMatch(/estado_do_editor/);
    await c.close();
  }, 30000); // 60 gravações reais no disco (uns 45 ms cada neste PC)

  it('aplicar_patch no vídeo de cenas devolve os avisos do resolvedor (video-D14)', async () => {
    const c = await conectar('Claude 2');
    await chamar(c, 'criar_documento', {modulo: 'video', titulo: 'aviso'});
    const doc = new Projeto(pasta).manifesto().documentos.find((d) => d.titulo === 'aviso')!;
    const lido = JSON.parse(texto(await chamar(c, 'ler_documento', {documento: doc.id})));
    const r = await chamar(c, 'aplicar_patch', {documento: doc.id, versao_base: lido.versao, patch: [{op: 'replace', path: '/cenas/0/duracao_ms', value: 100}]});
    expect(JSON.parse(r.content[0].text).avisos?.join(' ')).toMatch(/cena 1 tem duração 100 ms/);
    await c.close();
  });
});
