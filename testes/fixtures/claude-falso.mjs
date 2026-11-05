// Um "claude -p" falso para os testes: fala o protocolo stream-json que o Claude Code 2.1.318 usa com o Agent SDK
// (abertura por control_request initialize, system/init, stream_event, assistant, user/tool_result, pedido de
// permissão can_use_tool e result). O modelo informado diz se a sessão foi nova ou retomada (--resume).
import readline from 'node:readline';

const args = process.argv.slice(2);
const sessao = args[args.indexOf('--resume') + 1] && args.includes('--resume') ? args[args.indexOf('--resume') + 1] : args[args.indexOf('--session-id') + 1];
const sair = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
let esperando = null;

const turno = async () => {
  sair({type: 'system', subtype: 'status', status: 'requesting', session_id: sessao});
  sair({type: 'stream_event', event: {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: 'Vou ver'}}, parent_tool_use_id: null});
  sair({type: 'stream_event', event: {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: ' o comentário.'}}, parent_tool_use_id: null});
  sair({type: 'assistant', message: {content: [{type: 'text', text: 'Vou ver o comentário.'}]}, parent_tool_use_id: null});
  sair({type: 'assistant', message: {content: [{type: 'tool_use', id: 't1', name: 'mcp__estudio__ler_comentario', input: {id: 'cmt_0001'}}]}, parent_tool_use_id: null});
  sair({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: 't1', content: '{"texto":"a lista está colada no título"}'}]}, parent_tool_use_id: null});
  sair({type: 'control_request', request_id: 'p1', request: {subtype: 'can_use_tool', tool_name: 'Bash', input: {command: 'echo oi'},
    permission_suggestions: [{type: 'addRules', rules: [{toolName: 'Bash'}], behavior: 'allow', destination: 'session'}]}});
  const decisao = await new Promise((ok) => (esperando = ok));
  if (decisao.behavior === 'allow') {
    sair({type: 'assistant', message: {content: [{type: 'tool_use', id: 't2', name: 'Bash', input: decisao.updatedInput}]}, parent_tool_use_id: null});
    sair({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: 't2', content: 'oi'}]}, parent_tool_use_id: null});
  }
  sair({type: 'assistant', message: {content: [{type: 'text', text: decisao.behavior === 'allow' ? 'Pronto.' : 'Tudo bem, não rodei.'}]}, parent_tool_use_id: null});
  sair({type: 'result', subtype: 'success', is_error: false, result: 'Pronto.', duration_ms: 1234, total_cost_usd: 0, session_id: sessao});
};

readline.createInterface({input: process.stdin}).on('line', (l) => {
  const m = JSON.parse(l);
  if (m.type === 'control_request' && m.request.subtype === 'initialize') {
    sair({type: 'control_response', response: {subtype: 'success', request_id: m.request_id, response: {commands: []}}});
    sair({type: 'system', subtype: 'init', session_id: sessao, model: args.includes('--resume') ? 'falso-retomado' : 'falso-novo'});
  } else if (m.type === 'control_request' && m.request.subtype === 'interrupt') {
    sair({type: 'control_response', response: {subtype: 'success', request_id: m.request_id, response: {still_queued: []}}});
  } else if (m.type === 'control_response' && esperando) {
    const ok = esperando;
    esperando = null;
    ok(m.response.response);
  } else if (m.type === 'user') void turno();
}).on('close', () => process.exit(0));
