// Marco 2 da frente IA: o cofre de chaves (sem o texto da chave no arquivo), a tabela de preços (pico do DeepSeek e
// troca de preço do Gemini por data), a configuração por provedor, o teste da chave na lista de modelos (recusada não
// grava; sem rede grava e avisa), o custo estimado no evento de uso, a soma do mês e o seletor de modelo do laço.
import {cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {EventoConversa} from '../src/compartilhado/api';
import {CofreArquivo, type Cifra} from '../src/main/ia/cofre-arquivo';
import {ConfiguracaoIA} from '../src/main/ia/config';
import {custoEstimado} from '../src/main/ia/precos';
import {SessoesIA} from '../src/main/ia/sessoes';
import {definirCofre, estadoDosProvedores, gravarChave} from '../src/main/ipc-ia';
import {McpHttp} from '../src/main/mcp-http';
import {Projeto} from '../src/nucleo/projeto';
import {criarApiFalsa} from './fixtures/api-falsa';

// cifra de teste: troca o texto por base64 invertido com um prefixo; o que importa é a chave não aparecer no arquivo
const cifraFalsa = (disponivel = true): Cifra => ({
  disponivel: () => disponivel,
  cifrar: (t) => Buffer.from(`X:${Buffer.from(t).toString('base64').split('').reverse().join('')}`),
  decifrar: (b) => Buffer.from(b.toString().slice(2).split('').reverse().join(''), 'base64').toString(),
});

let pasta = '';
beforeAll(() => {
  pasta = mkdtempSync(path.join(tmpdir(), 'estudio-iacfg-'));
});
afterAll(() => rmSync(pasta, {recursive: true, force: true, maxRetries: 10, retryDelay: 200}));

describe('cofre de chaves', () => {
  it('grava cifrado, lê de volta, apaga, e o arquivo nunca tem o texto da chave', () => {
    const arquivo = path.join(pasta, 'c1', 'chaves.json');
    const c = new CofreArquivo(arquivo, cifraFalsa());
    c.gravar('deepseek', 'sk-segredo-abcdef123456');
    expect(readFileSync(arquivo, 'utf-8')).not.toContain('sk-segredo-abcdef123456');
    expect(new CofreArquivo(arquivo, cifraFalsa()).ler('deepseek')).toBe('sk-segredo-abcdef123456');
    c.apagar('deepseek');
    expect(new CofreArquivo(arquivo, cifraFalsa()).ler('deepseek')).toBeUndefined();
  });

  it('sem cifra do sistema, a chave vale só nesta sessão e nada vai para o disco', () => {
    const arquivo = path.join(pasta, 'c2', 'chaves.json');
    const c = new CofreArquivo(arquivo, cifraFalsa(false));
    c.gravar('openai', 'sk-so-na-sessao-999999');
    expect(c.persistente()).toBe(false);
    expect(c.ler('openai')).toBe('sk-so-na-sessao-999999');
    expect(existsSync(arquivo)).toBe(false);
  });

  it('arquivo estragado não derruba: começa vazio', () => {
    const arquivo = path.join(pasta, 'c3.json');
    writeFileSync(arquivo, '{isto não é json');
    expect(new CofreArquivo(arquivo, cifraFalsa()).ler('x')).toBeUndefined();
  });
});

describe('tabela de preços', () => {
  const uso = {entrada: 1_000_000, entrada_cache: 400_000, saida: 100_000};
  it('DeepSeek flash fora do pico (sábado) e no pico (segunda, 07:00 UTC, dobra)', () => {
    const fora = custoEstimado('deepseek', 'deepseek-flash', uso, new Date('2026-11-07T15:00:00Z'))!;
    // 600 mil sem cache × 0,15 + 400 mil do cache × 0,003 + 100 mil de saída × 0,60, por milhão
    expect(fora.usd).toBeCloseTo(0.09 + 0.0012 + 0.06, 6);
    expect(fora.pico).toBe(false);
    const pico = custoEstimado('deepseek', 'deepseek-flash', uso, new Date('2026-11-09T07:00:00Z'))!;
    expect(pico.usd).toBeCloseTo(fora.usd * 2, 6);
    expect(pico.pico).toBe(true);
  });
  it('Gemini 3.6 Flash muda de preço em 01/01/2027; modelo fora da tabela não tem custo', () => {
    const u = {entrada: 1_000_000, entrada_cache: 0, saida: 0};
    expect(custoEstimado('gemini', 'gemini-3.6-flash', u, new Date('2026-12-31T12:00:00Z'))!.usd).toBeCloseTo(0.75);
    expect(custoEstimado('gemini', 'gemini-3.6-flash', u, new Date('2027-01-01T12:00:00Z'))!.usd).toBeCloseTo(1.5);
    expect(custoEstimado('openai', 'qualquer', u)).toBeUndefined();
  });
});

describe('configuração e chave', () => {
  it('endereço inválido é recusado; o uso do mês soma', () => {
    const cfg = new ConfiguracaoIA(path.join(pasta, 'cfg1'));
    expect(() => cfg.configurar('ollama', {base: 'javascript:alert(1)'})).toThrow(/http/);
    cfg.configurar('ollama', {base: 'http://127.0.0.1:11434/v1/', modelo: 'llama3.2'});
    expect(cfg.provedor('ollama')).toEqual({base: 'http://127.0.0.1:11434/v1', modelo: 'llama3.2'});
    cfg.registrarUso('deepseek', {entrada: 100, entrada_cache: 40, saida: 10}, 0.001);
    cfg.registrarUso('deepseek', {entrada: 50, entrada_cache: 0, saida: 5}, 0.002);
    expect(cfg.usoDoMes().deepseek).toMatchObject({entrada: 150, cache: 40, saida: 15, turnos: 2});
    expect(cfg.usoDoMes().deepseek.custo_usd).toBeCloseTo(0.003);
  });

  it('testa a chave na lista de modelos: recusada não grava, aceita grava e lista, sem rede grava e avisa', async () => {
    const cofre = new CofreArquivo(path.join(pasta, 'c4', 'chaves.json'), cifraFalsa());
    const cfg = new ConfiguracaoIA(path.join(pasta, 'cfg2'));
    definirCofre(cofre, cfg);
    const api = await criarApiFalsa({chave: 'sk-boa-1234567890', modelos: ['m-b', 'm-a'], roteiro: []});
    cfg.configurar('compativel', {base: api.url});
    const ruim = await gravarChave('compativel', 'sk-ruim-0000000000');
    expect(ruim.ok).toBe(false);
    expect(ruim.mensagem).not.toContain('sk-ruim');
    expect(cofre.ler('compativel')).toBeUndefined();
    const boa = await gravarChave('compativel', 'sk-boa-1234567890');
    expect(boa).toMatchObject({ok: true, persistente: true, modelos: ['m-a', 'm-b']});
    expect(cofre.ler('compativel')).toBe('sk-boa-1234567890');
    await api.fechar();
    const semRede = await gravarChave('compativel', 'sk-outra-1234567890');
    expect(semRede.ok).toBe(true);
    expect(semRede.mensagem).toMatch(/não deu para testar/);
    expect(await gravarChave('compativel', 'curta')).toMatchObject({ok: false});
    // a lista para a tela: o compatível sem modelo ainda falta o modelo; a chave não aparece
    const lista = await estadoDosProvedores({claudeInstalado: false, acharExe: async () => null});
    const comp = lista.find((p) => p.id === 'compativel')!;
    expect(comp).toMatchObject({falta: 'modelo', chave_origem: 'cofre', chave_final: '7890', cofre_persistente: true});
    expect(JSON.stringify(lista)).not.toContain('sk-outra-1234567890');
  });
});

describe('custo e seletor de modelo na conversa', () => {
  let servidor: http.Server;
  let mcp: McpHttp;
  let base = '';
  let proj = '';
  beforeAll(async () => {
    proj = mkdtempSync(path.join(tmpdir(), 'estudio-iacusto-'));
    cpSync(path.join(__dirname, '..', 'exemplos', 'exemplo'), proj, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
    const projeto = new Projeto(proj);
    mcp = new McpHttp(path.join(proj, '.config-teste'), () => projeto);
    servidor = http.createServer((req, res) => void mcp.atender(req, res).then((ok) => ok || res.writeHead(404).end()));
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    servidor?.close();
    rmSync(proj, {recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  });

  it('o uso do turno ganha o custo da tabela, vai para a soma do mês, e o modelo novo vale na próxima mensagem', async () => {
    const api = await criarApiFalsa({chave: 'sk-custo-1234567890', roteiro: [
      {texto: 'Oi.', uso: {entrada: 10_000, saida: 1_000, cache: 4_000}},
      {texto: 'De novo.', uso: {entrada: 1_000, saida: 100}},
    ]});
    const cofre = new CofreArquivo(path.join(pasta, 'c5', 'chaves.json'), cifraFalsa());
    cofre.gravar('deepseek', 'sk-custo-1234567890');
    const somas: {modelo: string; custo?: number}[] = [];
    const eventos: EventoConversa[] = [];
    let fim: () => void = () => undefined;
    const sessoes = new SessoesIA({
      evento: (_id, e) => {
        eventos.push(e);
        if (e.tipo === 'fim') fim();
      },
      claude: {claude: () => null}, vivasTerminal: () => 0, cofre, sistema: () => 's', conexao: (o) => mcp.novaConexao(base, o),
      ambiente: () => ({}), aoUso: (_p, modelo, _u, custo) => somas.push({modelo, custo}),
    });
    const a = sessoes.abrir({cwd: proj, provedor: 'deepseek', base: api.url});
    await new Promise<void>((ok) => ((fim = ok), sessoes.enviar(a.id, 'oi', 4)));
    const uso = eventos.find((e) => e.tipo === 'uso') as Extract<EventoConversa, {tipo: 'uso'}>;
    expect(uso.custo_usd).toBeGreaterThan(0);
    expect(somas[0]).toMatchObject({modelo: 'deepseek-flash'});
    sessoes.definirModelo(a.id, 'deepseek-v4-pro');
    await new Promise<void>((ok) => ((fim = ok), sessoes.enviar(a.id, 'de novo', 4)));
    sessoes.fecharTodas();
    await api.fechar();
    expect(api.pedidos.map((p) => p.modelo)).toEqual(['deepseek-flash', 'deepseek-v4-pro']);
    expect(eventos.filter((e) => e.tipo === 'pronto').map((e) => (e as {modelo?: string}).modelo)).toEqual(['deepseek-flash', 'deepseek-v4-pro']);
    expect(somas[1]).toMatchObject({modelo: 'deepseek-v4-pro'});
  });
});

describe('seletor de modelo no Claude', () => {
  it('o modelo escolhido vale na próxima mensagem: o claude volta com --resume e --model', async () => {
    const {Conversas} = await import('../src/main/conversa');
    const modelos: (string | undefined)[] = [];
    let fim: () => void = () => undefined;
    const conversas = new Conversas({claude: () => process.execPath, prefixo: [path.join(__dirname, 'fixtures', 'claude-falso.mjs')], vivas: () => 0,
      evento: (_id, e) => {
        if (e.tipo === 'pronto') modelos.push(e.modelo);
        if (e.tipo === 'permissao') conversas.permitir(1, e.pedido, 'negar');
        if (e.tipo === 'fim') fim();
      }});
    const {id} = conversas.abrir({cwd: __dirname});
    await new Promise<void>((ok) => ((fim = ok), conversas.enviar(id, 'oi', 4)));
    conversas.definirModelo(id, 'opus');
    await new Promise<void>((ok) => ((fim = ok), conversas.enviar(id, 'de novo', 4)));
    conversas.fecharTodas();
    expect(modelos).toEqual(['falso-novo', 'opus']);
  });
});
