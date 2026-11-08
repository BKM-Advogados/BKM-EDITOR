// Prova técnica F0 (docs/ia.md): um agente ACP real (Qwen Code) dirigido por uma API falsa no formato OpenAI, falando
// com o MCP estudio de verdade, sem chave nem conta. Só roda com ESTUDIO_QWEN apontando para o cli-entry.js do Qwen
// Code instalado fora do repositório (o pacote tem 156 MB e não é dependência do app).
import {spawn, execFileSync} from 'node:child_process';
import {cpSync, mkdtempSync, readFileSync, rmSync, mkdirSync} from 'node:fs';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {McpHttp} from '../src/main/mcp-http';
import {ClienteAcp, type AtualizacaoAcp, type PedidoPermissaoAcp} from '../src/main/ia/acp';
import {Projeto} from '../src/nucleo/projeto';
import {criarApiFalsa, ultimoResultado} from './fixtures/api-falsa';

const QWEN = process.env.ESTUDIO_QWEN;
const limpar: (() => unknown)[] = [];
afterAll(async () => {
  for (const f of limpar.reverse()) await f();
});

const memoriaMb = (pid: number) => {
  try {
    const s = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`], {encoding: 'utf-8'});
    return Math.round(Number(s.trim()) / 1048576);
  } catch {
    return -1;
  }
};

describe.skipIf(!QWEN)('F0: Qwen Code por ACP com a API falsa e o MCP estudio', () => {
  it('lê, pede permissão, aplica o patch com a origem da aba e termina', async () => {
    const pasta = mkdtempSync(path.join(tmpdir(), 'estudio-f0-'));
    cpSync(path.join(__dirname, '..', 'exemplos', 'exemplo'), pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
    const casa = path.join(pasta, '.casa-qwen');
    mkdirSync(casa, {recursive: true});
    limpar.push(() => rmSync(pasta, {recursive: true, force: true}));
    const projeto = new Projeto(pasta);
    const mcp = new McpHttp(path.join(pasta, '.config-teste'), () => projeto);
    const srv = http.createServer((req, res) => void mcp.atender(req, res).then((ok) => ok || res.writeHead(404).end()));
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    limpar.push(() => srv.close());
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const cfg = JSON.parse(readFileSync(mcp.novaAba(base, 'DeepSeek 1'), 'utf-8')).mcpServers.estudio;

    const api = await criarApiFalsa({chave: 'chave-falsa', modelos: ['falso-1'], roteiro: [
      {texto: 'Vou ler a cor do anel.', ferramentas: [{nome: 'ler_documento', args: {documento: 'cena3d', caminho: '/objetos/0/cor'}}], uso: {entrada: 1000, saida: 20}},
      {ferramentas: [{nome: 'aplicar_patch', args: (p) => ({documento: 'cena3d', versao_base: JSON.parse(ultimoResultado(p)).versao, rotulo: 'anel mais claro',
        patch: [{op: 'test', path: '/objetos/0/cor', value: '#C88155'}, {op: 'replace', path: '/objetos/0/cor', value: '#E4B492'}]})}], uso: {entrada: 1200, saida: 40}},
      {texto: 'Pronto: o anel ficou mais claro.', uso: {entrada: 1300, saida: 10}},
    ]});
    limpar.push(() => api.fechar());

    const proc = spawn(process.execPath, [QWEN!, '--acp'], {cwd: pasta, windowsHide: true,
      env: {...process.env, HOME: casa, USERPROFILE: casa, OPENAI_API_KEY: 'chave-falsa', OPENAI_BASE_URL: api.url, OPENAI_MODEL: 'falso-1'}});
    limpar.push(() => proc.kill());
    let erro = '';
    proc.stderr.on('data', (d) => (erro = (erro + d).slice(-4000)));

    const atualizacoes: AtualizacaoAcp[] = [];
    const permissoes: PedidoPermissaoAcp[] = [];
    const log: string[] = [];
    const cliente = new ClienteAcp(proc.stdin, proc.stdout, {
      atualizacao: (a) => atualizacoes.push(a),
      permissao: async (p) => {
        permissoes.push(p);
        const sim = p.options.find((o) => o.kind === 'allow_once') ?? p.options[0];
        return {outcome: {outcome: 'selected', optionId: sim.optionId}};
      },
      log: (d, l) => log.push(`${d} ${l.slice(0, 400)}`),
    });
    try {
      const inicio = await cliente.inicializar();
      console.log('[F0] initialize:', JSON.stringify(inicio));
      const mcpServers = [{type: 'http' as const, name: 'estudio', url: cfg.url, headers: Object.entries(cfg.headers as Record<string, string>).map(([name, value]) => ({name, value}))}];
      let sessao: {sessionId: string};
      try {
        sessao = await cliente.novaSessao(pasta, mcpServers);
      } catch (e) {
        const metodo = inicio.authMethods?.find((m) => /openai|api/i.test(`${m.id} ${m.name}`))?.id;
        console.log('[F0] session/new falhou:', (e as Error).message, '→ authenticate', metodo);
        if (!metodo) throw e;
        await cliente.autenticar(metodo);
        sessao = await cliente.novaSessao(pasta, mcpServers);
      }
      const t0 = Date.now();
      const fim = await cliente.mandar(sessao.sessionId, 'Deixe o anel mais claro.');
      const ms = Date.now() - t0;
      const ram = memoriaMb(proc.pid!);
      console.log('[F0] stopReason:', fim.stopReason, '· ms:', ms, '· RAM do qwen (MB):', ram);
      console.log('[F0] ferramentas que o qwen ofereceu ao modelo:', JSON.stringify(api.pedidos[0]?.ferramentas));
      console.log('[F0] tipos de atualização:', [...new Set(atualizacoes.map((a) => a.update.sessionUpdate))].join(', '));
      console.log('[F0] pedidos de permissão:', JSON.stringify(permissoes.map((p) => ({titulo: p.toolCall.title, opcoes: p.options.map((o) => o.kind)}))));
      console.log('[F0] chamadas à API falsa:', api.pedidos.length, '· stream:', api.pedidos.map((p) => p.stream).join(','));
      const diario = new Projeto(pasta).diario();
      expect(fim.stopReason).toBe('end_turn');
      expect(diario[diario.length - 1]).toMatchObject({autor: 'agente', origem: 'DeepSeek 1', rotulo: 'anel mais claro'});
      expect(atualizacoes.some((a) => a.update.sessionUpdate === 'agent_message_chunk')).toBe(true);
    } catch (e) {
      console.log('[F0] stderr do qwen:', erro);
      console.log('[F0] protocolo:\n', log.slice(-40).join('\n'));
      throw e;
    } finally {
      cliente.encerrar();
    }
  }, 120000);
});
