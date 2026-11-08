// Um agente ACP falso para os testes (testes/acp-cliente.test.ts): fala o Agent Client Protocol v1 por stdio como o
// Gemini CLI, o Qwen Code ou o opencode, e usa de verdade o servidor MCP HTTP que o cliente manda no session/new.
// O turno: um pedaço de texto, uma leitura sem pedir licença, um pedido de permissão para aplicar o patch e, se
// permitido, o patch; no fim, o uso de tokens e end_turn. session/cancel encerra o turno com cancelled.
import readline from 'node:readline';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const sair = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const sessoes = new Map();
const esperando = new Map();
let proximo = 1000;
let cancelado = null;

const pedirAoCliente = (method, params) => new Promise((ok) => {
  const id = proximo++;
  esperando.set(id, ok);
  sair({jsonrpc: '2.0', id, method, params});
});
const atualizar = (sessionId, update) => sair({jsonrpc: '2.0', method: 'session/update', params: {sessionId, update}});
const texto = (r) => r.content?.find((c) => c.type === 'text')?.text ?? '';

const turno = async (id, {sessionId, prompt}) => {
  const s = sessoes.get(sessionId);
  cancelado = null;
  const pedido = prompt.map((b) => b.text ?? '').join(' ');
  atualizar(sessionId, {sessionUpdate: 'agent_message_chunk', content: {type: 'text', text: 'Vou ver '}});
  atualizar(sessionId, {sessionUpdate: 'agent_message_chunk', content: {type: 'text', text: 'o documento.'}});
  if (/demorar/.test(pedido)) {
    await new Promise((ok) => (cancelado = ok));
    return sair({jsonrpc: '2.0', id, result: {stopReason: 'cancelled'}});
  }
  atualizar(sessionId, {sessionUpdate: 'tool_call', toolCallId: 't1', title: 'estudio: ler_documento', kind: 'read', status: 'in_progress',
    rawInput: {documento: 'cena3d', caminho: '/objetos/0/cor'}});
  const lido = JSON.parse(texto(await s.mcp.callTool({name: 'ler_documento', arguments: {documento: 'cena3d', caminho: '/objetos/0/cor'}})));
  atualizar(sessionId, {sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', content: [{type: 'content', content: {type: 'text', text: JSON.stringify(lido)}}]});
  const entrada = {documento: 'cena3d', versao_base: lido.versao, rotulo: 'anel pelo agente ACP',
    patch: [{op: 'test', path: '/objetos/0/cor', value: lido.conteudo}, {op: 'replace', path: '/objetos/0/cor', value: '#123456'}]};
  atualizar(sessionId, {sessionUpdate: 'tool_call', toolCallId: 't2', title: 'estudio: aplicar_patch', kind: 'edit', status: 'pending', rawInput: entrada});
  const r = await pedirAoCliente('session/request_permission', {sessionId, toolCall: {toolCallId: 't2', title: 'estudio: aplicar_patch', kind: 'edit', rawInput: entrada},
    options: [{optionId: 'sim', name: 'Permitir', kind: 'allow_once'}, {optionId: 'sempre', name: 'Sempre', kind: 'allow_always'}, {optionId: 'nao', name: 'Negar', kind: 'reject_once'}]});
  const permitido = r.outcome?.outcome === 'selected' && r.outcome.optionId !== 'nao';
  if (permitido) {
    const res = await s.mcp.callTool({name: 'aplicar_patch', arguments: entrada});
    atualizar(sessionId, {sessionUpdate: 'tool_call_update', toolCallId: 't2', status: res.isError ? 'failed' : 'completed',
      content: [{type: 'content', content: {type: 'text', text: texto(res)}}]});
  } else {
    atualizar(sessionId, {sessionUpdate: 'tool_call_update', toolCallId: 't2', status: 'failed', content: [{type: 'content', content: {type: 'text', text: 'negado pela pessoa'}}]});
  }
  atualizar(sessionId, {sessionUpdate: 'agent_message_chunk', content: {type: 'text', text: permitido ? ' Pronto.' : ' Tudo bem, não mudei.'}});
  atualizar(sessionId, {sessionUpdate: 'usage_update', used: 4200, size: 1000000, cost: {amount: 0.0012, currency: 'USD'}});
  sair({jsonrpc: '2.0', id, result: {stopReason: 'end_turn'}});
};

readline.createInterface({input: process.stdin}).on('line', async (l) => {
  const m = JSON.parse(l);
  if (m.id !== undefined && m.method === undefined) {
    const ok = esperando.get(m.id);
    esperando.delete(m.id);
    return ok?.(m.result);
  }
  try {
    switch (m.method) {
      case 'initialize':
        return sair({jsonrpc: '2.0', id: m.id, result: {protocolVersion: 1, agentInfo: {name: 'acp-falso', version: '0'},
          agentCapabilities: {loadSession: true, mcpCapabilities: {http: true, sse: false}}, authMethods: []}});
      case 'session/new':
      case 'session/load': {
        const http = m.params.mcpServers.find((x) => x.type === 'http');
        const mcp = new Client({name: 'acp-falso', version: '0'});
        await mcp.connect(new StreamableHTTPClientTransport(new URL(http.url), {requestInit: {headers: Object.fromEntries(http.headers.map((h) => [h.name, h.value]))}}));
        const sessionId = m.params.sessionId ?? `s${sessoes.size + 1}`;
        sessoes.set(sessionId, {mcp});
        return sair({jsonrpc: '2.0', id: m.id, result: m.method === 'session/new' ? {sessionId} : null});
      }
      case 'session/prompt':
        return void turno(m.id, m.params);
      case 'session/cancel':
        return cancelado?.();
      default:
        if (m.id !== undefined) sair({jsonrpc: '2.0', id: m.id, error: {code: -32601, message: `sem ${m.method}`}});
    }
  } catch (e) {
    if (m.id !== undefined) sair({jsonrpc: '2.0', id: m.id, error: {code: -32603, message: String(e?.message ?? e)}});
  }
}).on('close', () => process.exit(0));
