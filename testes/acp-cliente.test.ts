// O cliente ACP do app (src/main/ia/acp.ts) contra o agente ACP falso, que usa de verdade o MCP estudio passado no
// session/new: o servidor HTTP com cabeçalho chega ao agente, o pedido de permissão volta com a opção escolhida, o
// patch entra no diário com a origem da aba, e o session/cancel encerra o turno com cancelled.
import {spawn} from 'node:child_process';
import {cpSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {ClienteAcp, type AtualizacaoAcp, type PedidoPermissaoAcp} from '../src/main/ia/acp';
import {McpHttp} from '../src/main/mcp-http';
import {Projeto} from '../src/nucleo/projeto';

const FALSO = path.join(__dirname, 'fixtures', 'acp-falso.mjs');
let pasta = '';
let servidor: http.Server;
let mcp: McpHttp;
let base = '';

beforeAll(async () => {
  pasta = mkdtempSync(path.join(tmpdir(), 'estudio-acp-'));
  cpSync(path.join(__dirname, 'fixtures', 'projeto'), pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
  const projeto = new Projeto(pasta);
  mcp = new McpHttp(path.join(pasta, '.config-teste'), () => projeto);
  servidor = http.createServer((req, res) => void mcp.atender(req, res).then((ok) => ok || res.writeHead(404).end()));
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(() => {
  servidor?.close();
  rmSync(pasta, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
});

const abrir = async (origem: string, decidir: (p: PedidoPermissaoAcp) => string | null) => {
  const proc = spawn(process.execPath, [FALSO], {cwd: __dirname, windowsHide: true}); // fora da pasta do projeto, para o rm do fim não esbarrar
  const atualizacoes: AtualizacaoAcp[] = [];
  const pedidos: PedidoPermissaoAcp[] = [];
  const cliente = new ClienteAcp(proc.stdin, proc.stdout, {
    atualizacao: (a) => atualizacoes.push(a),
    permissao: async (p) => {
      pedidos.push(p);
      const id = decidir(p);
      return {outcome: id ? {outcome: 'selected', optionId: id} : {outcome: 'cancelled'}};
    },
  });
  const inicio = await cliente.inicializar();
  const cfg = JSON.parse(readFileSync(mcp.novaAba(base, origem), 'utf-8')).mcpServers.estudio;
  const {sessionId} = await cliente.novaSessao(pasta, [{type: 'http', name: 'estudio', url: cfg.url,
    headers: Object.entries(cfg.headers as Record<string, string>).map(([name, value]) => ({name, value}))}]);
  return {proc, cliente, inicio, sessionId, atualizacoes, pedidos};
};

describe('cliente ACP', () => {
  it('permitir: o agente usa o MCP do cliente e o patch entra no diário com a origem da aba', async () => {
    const a = await abrir('Gemini CLI 1', (p) => p.options.find((o) => o.kind === 'allow_once')!.optionId);
    expect(a.inicio.agentCapabilities?.mcpCapabilities?.http).toBe(true);
    const fim = await a.cliente.mandar(a.sessionId, 'deixe o anel escuro');
    a.cliente.encerrar();
    a.proc.kill();
    expect(fim.stopReason).toBe('end_turn');
    expect(a.pedidos).toHaveLength(1);
    expect(a.pedidos[0].toolCall.rawInput).toMatchObject({documento: 'cena3d'});
    const tipos = a.atualizacoes.map((x) => x.update.sessionUpdate);
    expect(tipos).toEqual(expect.arrayContaining(['agent_message_chunk', 'tool_call', 'tool_call_update', 'usage_update']));
    expect(new Projeto(pasta).diario().slice(-1)[0]).toMatchObject({autor: 'agente', origem: 'Gemini CLI 1', rotulo: 'anel pelo agente ACP'});
  });

  it('negar: nada muda no documento e o agente segue', async () => {
    const antes = new Projeto(pasta).diario().length;
    const a = await abrir('Gemini CLI 2', (p) => p.options.find((o) => o.kind === 'reject_once')!.optionId);
    const fim = await a.cliente.mandar(a.sessionId, 'deixe o anel escuro');
    a.cliente.encerrar();
    a.proc.kill();
    expect(fim.stopReason).toBe('end_turn');
    expect(new Projeto(pasta).diario().length).toBe(antes);
    const ultimo = a.atualizacoes.filter((x) => x.update.sessionUpdate === 'tool_call_update').pop();
    expect(ultimo?.update.status).toBe('failed');
  });

  it('cancelar: o turno termina com cancelled', async () => {
    const a = await abrir('Gemini CLI 3', () => null);
    const turno = a.cliente.mandar(a.sessionId, 'vai demorar');
    await new Promise((ok) => setTimeout(ok, 200));
    a.cliente.cancelar(a.sessionId);
    const fim = await turno;
    a.cliente.encerrar();
    a.proc.kill();
    expect(fim.stopReason).toBe('cancelled');
  });
});
