// O laço próprio (src/main/ia/laco.ts) contra a API falsa no formato OpenAI e o MCP estudio de verdade: um provedor
// com chave (no papel do DeepSeek, que exige o reasoning_content de volta) e um modelo local sem chave (no papel do
// Ollama). Confere a sequência de eventos, o diário com a origem da aba, o uso de tokens e que a chave não vaza.
import {cpSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {EventoConversa} from '../src/compartilhado/api';
import {LacoOpenAI} from '../src/main/ia/laco';
import {McpHttp} from '../src/main/mcp-http';
import {Projeto} from '../src/nucleo/projeto';
import {criarApiFalsa, ultimoResultado, type RespostaFalsa} from './fixtures/api-falsa';

let pasta = '';
let servidor: http.Server;
let mcp: McpHttp;
let base = '';

beforeAll(async () => {
  pasta = mkdtempSync(path.join(tmpdir(), 'estudio-laco-'));
  cpSync(path.join(__dirname, 'fixtures', 'projeto'), pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
  const projeto = new Projeto(pasta);
  mcp = new McpHttp(path.join(pasta, '.config-teste'), () => projeto);
  servidor = http.createServer((req, res) => void mcp.atender(req, res).then((ok) => ok || res.writeHead(404).end()));
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(() => {
  servidor?.close();
  rmSync(pasta, {recursive: true, force: true});
});

const roteiroDoAnel = (cor: string, nova: string): RespostaFalsa[] => [
  {texto: 'Vou ler a cor do anel.', raciocinio: 'preciso da versão', ferramentas: [{nome: 'ler_documento', args: {documento: 'cena3d', caminho: '/objetos/0/cor'}}],
    uso: {entrada: 1000, saida: 20, cache: 600}},
  {raciocinio: 'agora o patch', ferramentas: [{nome: 'aplicar_patch', args: (p) => ({documento: 'cena3d', versao_base: JSON.parse(ultimoResultado(p)).versao,
    rotulo: 'anel mais claro', patch: [{op: 'test', path: '/objetos/0/cor', value: cor}, {op: 'replace', path: '/objetos/0/cor', value: nova}]})}],
    uso: {entrada: 1200, saida: 40, cache: 1000}},
  {texto: 'Pronto: o anel ficou mais claro.', uso: {entrada: 1300, saida: 10, cache: 1200}},
];

const montar = async (origem: string, conexao: {base: string; chave?: string; modelo: string}) => {
  const eventos: EventoConversa[] = [];
  const cfg = JSON.parse(readFileSync(mcp.novaAba(base, origem), 'utf-8')).mcpServers.estudio;
  const laco = new LacoOpenAI({conexao, mcp: {url: cfg.url, headers: cfg.headers}, sistema: 'Você edita projetos do Estúdio pelo MCP estudio.',
    evento: (e) => eventos.push(e)});
  return {laco, eventos};
};

describe('laço próprio no formato OpenAI', () => {
  it('provedor com chave: lê, aplica o patch com a origem da aba, devolve o raciocínio e soma o uso', async () => {
    const api = await criarApiFalsa({chave: 'sk-segredo-123', roteiro: roteiroDoAnel('#4A90D9', '#9CC8F5')});
    const {laco, eventos} = await montar('DeepSeek 1', {base: api.url, chave: 'sk-segredo-123', modelo: 'deepseek-flash'});
    await laco.enviar('Deixe o anel mais claro.');
    await laco.fechar();
    await api.fechar();

    const tipos = eventos.map((e) => e.tipo);
    expect(tipos.filter((t) => t === 'ferramenta')).toHaveLength(2);
    expect(tipos[tipos.length - 1]).toBe('fim');
    expect(eventos.find((e) => e.tipo === 'fim')).toMatchObject({erro: false});
    expect(eventos.filter((e) => e.tipo === 'resultado').every((e) => (e as {ok: boolean}).ok)).toBe(true);
    expect(eventos.find((e) => e.tipo === 'uso')).toMatchObject({entrada: 3500, entrada_cache: 2800, saida: 70});
    expect(eventos.filter((e) => e.tipo === 'texto').map((e) => (e as {delta: string}).delta).join('')).toContain('Pronto: o anel ficou mais claro.');
    const diario = new Projeto(pasta).diario();
    expect(diario[diario.length - 1]).toMatchObject({autor: 'agente', origem: 'DeepSeek 1', rotulo: 'anel mais claro'});
    // o DeepSeek exige o reasoning_content de todos os turnos de volta quando há ferramentas
    const ultimo = api.pedidos[api.pedidos.length - 1];
    expect(ultimo.mensagens.filter((m) => m.role === 'assistant').map((m) => m.reasoning_content)).toEqual(['preciso da versão', 'agora o patch']);
    expect(ultimo.ferramentas).toContain('aplicar_patch');
    // a chave vai só no cabeçalho do provedor: nunca num evento para a tela
    expect(JSON.stringify(eventos)).not.toContain('sk-segredo-123');
  });

  it('modelo local sem chave: lista os modelos e conversa sem cabeçalho de autorização', async () => {
    const api = await criarApiFalsa({modelos: ['llama3.2', 'qwen2.5'], roteiro: roteiroDoAnel('#9CC8F5', '#C8E0F8')});
    const lista = await (await fetch(`${api.url}/models`)).json();
    expect(lista.data.map((m: {id: string}) => m.id)).toEqual(['llama3.2', 'qwen2.5']);
    const {laco, eventos} = await montar('Ollama 1', {base: api.url, modelo: 'llama3.2'});
    await laco.enviar('Deixe o anel mais claro.');
    await laco.fechar();
    await api.fechar();
    expect(api.pedidos.every((p) => p.autorizacao === undefined && p.modelo === 'llama3.2')).toBe(true);
    expect(eventos.find((e) => e.tipo === 'fim')).toMatchObject({erro: false});
    expect(new Projeto(pasta).diario().slice(-1)[0]).toMatchObject({origem: 'Ollama 1'});
  });

  it('chave recusada vira mensagem em português, sem a chave no texto', async () => {
    const api = await criarApiFalsa({chave: 'sk-certa', roteiro: []});
    const {laco, eventos} = await montar('OpenAI 1', {base: api.url, chave: 'sk-errada-999', modelo: 'gpt-x'});
    await laco.enviar('oi');
    await laco.fechar();
    await api.fechar();
    const fim = eventos.find((e) => e.tipo === 'fim') as {erro: boolean; texto?: string};
    expect(fim.erro).toBe(true);
    expect(fim.texto).toMatch(/chave foi recusada/);
    expect(JSON.stringify(eventos)).not.toContain('sk-errada-999');
  });

  it('parar no meio encerra o turno como parado', async () => {
    const api = await criarApiFalsa({roteiro: roteiroDoAnel('#F0D0B8', '#FFFFFF')});
    const {laco, eventos} = await montar('Groq 1', {base: api.url, modelo: 'x'});
    const turno = laco.enviar('Deixe o anel mais claro.');
    laco.parar();
    await turno;
    await laco.fechar();
    await api.fechar();
    expect(eventos.find((e) => e.tipo === 'fim')).toMatchObject({erro: false, texto: 'parado'});
  });
});
