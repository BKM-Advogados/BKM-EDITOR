// Agente ACP mínimo (testes/agentes-ciclo.test.ts): sobe, abre a sessão e, a cada mensagem, pede permissão e espera.
import readline from 'node:readline';
const sair = (o) => process.stdout.write(JSON.stringify(o) + '\n');
readline.createInterface({input: process.stdin}).on('line', (l) => {
  const m = JSON.parse(l);
  if (m.method === 'initialize') return sair({jsonrpc: '2.0', id: m.id, result: {protocolVersion: 1, agentCapabilities: {mcpCapabilities: {http: true}}}});
  if (m.method === 'session/new') return sair({jsonrpc: '2.0', id: m.id, result: {sessionId: 's1'}});
  if (m.method === 'session/prompt') return sair({jsonrpc: '2.0', id: 999, method: 'session/request_permission',
    params: {sessionId: 's1', toolCall: {title: 'x'}, options: [{optionId: 'sim', name: 'Sim', kind: 'allow_once'}]}});
});
