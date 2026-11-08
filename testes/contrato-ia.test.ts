// Suíte de contrato das conversas com IA (src/main/ia/sessoes.ts): o mesmo pedido passa pelas três vias (o Claude
// Code falso, o laço próprio contra a API falsa e um agente ACP falso) e os eventos que chegam à tela têm a mesma
// forma: pronto, texto, ação com nome sem prefixo, resultado, permissão respondida pelos mesmos botões, fim. Nas vias
// que usam o MCP de verdade, a mudança entra no diário com o rótulo da aba. Fecha com o catálogo de provedores, sem
// a chave em lugar nenhum da resposta.
import {cpSync, mkdtempSync, rmSync} from 'node:fs';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {EventoConversa} from '../src/compartilhado/api';
import {FERRAMENTAS_ESTUDIO, normalizarFerramenta} from '../src/compartilhado/ferramentas';
import {CofreMemoria} from '../src/main/ia/chaves';
import {SessoesIA} from '../src/main/ia/sessoes';
import {estadoDosProvedores} from '../src/main/ipc-ia';
import {McpHttp} from '../src/main/mcp-http';
import {Projeto} from '../src/nucleo/projeto';
import {criarApiFalsa, ultimoResultado} from './fixtures/api-falsa';

const CLAUDE_FALSO = path.join(__dirname, 'fixtures', 'claude-falso.mjs');
const ACP_FALSO = path.join(__dirname, 'fixtures', 'acp-falso.mjs');
let pasta = '';
let servidor: http.Server;
let mcp: McpHttp;
let base = '';

beforeAll(async () => {
  pasta = mkdtempSync(path.join(tmpdir(), 'estudio-contrato-'));
  cpSync(path.join(__dirname, '..', 'exemplos', 'exemplo'), pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
  const projeto = new Projeto(pasta);
  mcp = new McpHttp(path.join(pasta, '.config-teste'), () => projeto);
  servidor = http.createServer((req, res) => void mcp.atender(req, res).then((ok) => ok || res.writeHead(404).end()));
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(async () => {
  servidor?.close();
  // os agentes rodam com a pasta do projeto como cwd e saem em até 1,5 s depois de fechados
  await new Promise((ok) => setTimeout(ok, 2500));
  rmSync(pasta, {recursive: true, force: true, maxRetries: 10, retryDelay: 200});
}, 15000);

const montar = (cofre = new CofreMemoria()) => {
  const eventos = new Map<number, EventoConversa[]>();
  let sessoes!: SessoesIA;
  const fins = new Map<number, () => void>();
  sessoes = new SessoesIA({
    evento: (id, e) => {
      (eventos.get(id) ?? eventos.set(id, []).get(id)!).push(e);
      // a "pessoa" permite tudo, como num clique em Permitir
      if (e.tipo === 'permissao') setTimeout(() => sessoes.permitir(id, e.pedido, 'permitir'), 10);
      if (e.tipo === 'fim') fins.get(id)?.();
    },
    claude: {claude: () => process.execPath, prefixo: [CLAUDE_FALSO]},
    vivasTerminal: () => 0,
    cofre,
    sistema: () => 'teste',
    conexao: (origem) => mcp.novaConexao(base, origem),
    ambiente: () => ({...process.env} as Record<string, string>),
    acharExe: async () => ({arquivo: process.execPath, shell: false, prefixo: [ACP_FALSO]}),
  });
  const turno = (id: number, texto: string) => new Promise<EventoConversa[]>((ok) => {
    fins.set(id, () => ok(eventos.get(id) ?? []));
    sessoes.enviar(id, texto, 8);
  });
  return {sessoes, turno};
};

/** O contrato comum: o que a tela precisa receber de qualquer provedor. */
const conferirContrato = (ev: EventoConversa[]) => {
  const tipos = ev.map((e) => e.tipo);
  expect(tipos).toContain('pronto');
  expect(tipos).toContain('texto');
  expect(tipos.indexOf('pronto')).toBeLessThan(tipos.indexOf('texto'));
  expect(tipos[tipos.length - 1]).toBe('fim');
  expect(ev.find((e) => e.tipo === 'fim')).toMatchObject({erro: false});
  const acoes = ev.filter((e) => e.tipo === 'ferramenta') as Extract<EventoConversa, {tipo: 'ferramenta'}>[];
  expect(acoes.length).toBeGreaterThan(0);
  for (const a of acoes) {
    expect(['estudio', 'interno']).toContain(normalizarFerramenta(a.nome, FERRAMENTAS_ESTUDIO).servidor);
    expect(ev.some((e) => e.tipo === 'resultado' && e.uso === a.uso)).toBe(true);
  }
};

describe('contrato das conversas com IA', () => {
  it('Claude (claude -p falso): mesma forma de eventos e permissão pelo mesmo botão', async () => {
    const {sessoes, turno} = montar();
    const a = sessoes.abrir({cwd: pasta, provedor: 'claude'});
    expect(a).toMatchObject({provedor: 'claude', rotulo: 'Claude 1'});
    const ev = await turno(a.id, 'resolva o comentário');
    sessoes.fecharTodas();
    conferirContrato(ev);
    expect(ev.some((e) => e.tipo === 'permissao')).toBe(true);
  });

  it('laço próprio (DeepSeek contra a API falsa): forma igual e diário com o rótulo da aba', async () => {
    const cofre = new CofreMemoria();
    cofre.gravar('deepseek', 'sk-contrato-777');
    const api = await criarApiFalsa({chave: 'sk-contrato-777', roteiro: [
      {texto: 'Vou ler.', ferramentas: [{nome: 'ler_documento', args: {documento: 'cena3d', caminho: '/objetos/0/cor'}}]},
      {ferramentas: [{nome: 'aplicar_patch', args: (p) => ({documento: 'cena3d', versao_base: JSON.parse(ultimoResultado(p)).versao, rotulo: 'contrato laço',
        patch: [{op: 'replace', path: '/objetos/0/cor', value: '#0A0A0A'}]})}]},
      {texto: 'Pronto.', uso: {entrada: 900, saida: 12}},
    ]});
    const {sessoes, turno} = montar(cofre);
    const a = sessoes.abrir({cwd: pasta, provedor: 'deepseek', base: api.url});
    expect(a.rotulo).toBe('DeepSeek 1');
    const ev = await turno(a.id, 'escureça o anel');
    sessoes.fecharTodas();
    await api.fechar();
    conferirContrato(ev);
    expect(ev.find((e) => e.tipo === 'pronto')).toMatchObject({modelo: 'deepseek-flash'});
    expect(new Projeto(pasta).diario().slice(-1)[0]).toMatchObject({origem: 'DeepSeek 1', rotulo: 'contrato laço'});
    expect(JSON.stringify(ev)).not.toContain('sk-contrato-777');
  });

  it('agente ACP falso (no papel do Gemini CLI): forma igual, permissão pelo mesmo botão e diário com o rótulo', async () => {
    const {sessoes, turno} = montar();
    const a = sessoes.abrir({cwd: pasta, provedor: 'gemini-cli'});
    expect(a.rotulo).toBe('Gemini CLI 1');
    const ev = await turno(a.id, 'escureça o anel');
    expect(sessoes.vivas()).toBe(1);
    sessoes.fecharTodas();
    conferirContrato(ev);
    expect(ev.some((e) => e.tipo === 'permissao')).toBe(true);
    expect(new Projeto(pasta).diario().slice(-1)[0]).toMatchObject({origem: 'Gemini CLI 1', rotulo: 'anel pelo agente ACP'});
  });

  it('provedor por chave sem chave: recusa ao abrir, em português', () => {
    const {sessoes} = montar();
    expect(() => sessoes.abrir({cwd: pasta, provedor: 'openai'})).toThrow(/falta/);
  });
});

describe('catálogo de provedores para a tela', () => {
  it('diz o que falta e nunca devolve a chave', async () => {
    const anterior = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'sk-do-ambiente-12345';
    try {
      const lista = await estadoDosProvedores({claudeInstalado: true, acharExe: async (n) => (n === 'gemini' ? 'C:/x/gemini.cmd' : null)});
      const por = Object.fromEntries(lista.map((p) => [p.id, p]));
      expect(por.claude).toMatchObject({pronto: true});
      expect(por.deepseek).toMatchObject({pronto: true, chave_origem: 'ambiente', chave_final: '2345', servidor: 'China'});
      expect(por.ollama).toMatchObject({pronto: false, falta: 'modelo'});
      expect(por['gemini-cli']).toMatchObject({pronto: true, via: 'acp'});
      expect(por.qwen).toBeUndefined(); // agente não instalado não aparece
      expect(JSON.stringify(lista)).not.toContain('sk-do-ambiente-12345');
    } finally {
      if (anterior === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = anterior;
    }
  });

  it('normaliza o nome da ferramenta de cada agente', () => {
    expect(normalizarFerramenta('mcp__estudio__aplicar_patch')).toEqual({servidor: 'estudio', nome: 'aplicar_patch'});
    expect(normalizarFerramenta('estudio__ler_documento')).toEqual({servidor: 'estudio', nome: 'ler_documento'});
    expect(normalizarFerramenta('aplicar_patch (estudio MCP Server)')).toEqual({servidor: 'estudio', nome: 'aplicar_patch'});
    expect(normalizarFerramenta('aplicar_patch', FERRAMENTAS_ESTUDIO)).toEqual({servidor: 'estudio', nome: 'aplicar_patch'});
    expect(normalizarFerramenta('run_shell_command')).toEqual({servidor: 'interno', nome: 'shell'});
    expect(normalizarFerramenta('Bash')).toEqual({servidor: 'interno', nome: 'shell'});
  });
});
