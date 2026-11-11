// Ponte stdio → HTTP do MCP estudio (frente IA, rodada 3, "padrão Screenpipe"). Apps de IA que só aceitam servidor
// MCP por stdio (o Claude Desktop, por exemplo) rodam esta ponte, que repassa cada mensagem JSON-RPC ao MCP do Estúdio
// aberto, com o token do app. Assim a escrita passa pelo app (um escritor só, com diário, portão e Reverter), e não
// pelo MCP de arquivo (mcp/nucleo.ts). Sem dependência: o próprio Estúdio roda a ponte em modo Node
// (ELECTRON_RUN_AS_NODE=1), e o mcp:build a copia para dist-mcp/ponte.cjs.
// Uso: ESTUDIO_MCP_URL=http://127.0.0.1:<porta>/mcp ESTUDIO_MCP_TOKEN=<token> <Estudio.exe> dist-mcp/ponte.cjs
import readline from 'node:readline';

const url = process.env.ESTUDIO_MCP_URL;
const token = process.env.ESTUDIO_MCP_TOKEN;
const sair = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const erro = (id, mensagem) => id !== undefined && id !== null && sair({jsonrpc: '2.0', id, error: {code: -32000, message: mensagem}});

if (!url || !token) {
  process.stderr.write('estudio ponte: faltam ESTUDIO_MCP_URL e ESTUDIO_MCP_TOKEN (Estúdio › Configurações › IA › Apps de IA de fora)\n');
  process.exit(2);
}

// Cada mensagem segue na hora: notificação sem esperar, pedidos em paralelo (o servidor do app não guarda sessão entre
// pedidos). Uma chamada lenta (transcrever, o cartão do portão esperando a pessoa) não segura o ping nem o Parar: o
// notifications/cancelled aborta o fetch do pedido, o app vê a conexão fechar e cancela a ferramenta (e o cartão).
const abortos = new Map(); // id do pedido → AbortController do fetch dele
const pendentes = new Set();

const repassar = async (linha, msg) => {
  const temId = msg.id !== undefined && msg.id !== null;
  const parar = new AbortController();
  if (temId) abortos.set(msg.id, parar);
  try {
    let r;
    try {
      r = await fetch(url, {method: 'POST', body: linha, signal: parar.signal,
        headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`}});
    } catch (e) {
      if (parar.signal.aborted) return; // cancelado pelo cliente: ele não espera resposta
      return erro(msg.id, `o Estúdio não respondeu em ${url}: abra o app e ligue "Apps de IA de fora" (${e?.cause?.code ?? e?.message ?? e})`);
    }
    if (r.status === 202) return; // notificação: sem resposta
    let texto;
    try {
      texto = await r.text();
    } catch (e) {
      if (parar.signal.aborted) return;
      return erro(msg.id, `a resposta do Estúdio se perdeu: ${e?.message ?? e}`);
    }
    if (parar.signal.aborted) return;
    if (r.status === 401) return erro(msg.id, 'o token deste app foi revogado no Estúdio; gere outro em Configurações › IA');
    if (r.status === 409) return erro(msg.id, 'o Estúdio está aberto, mas sem projeto: abra um projeto');
    if (!r.ok) return erro(msg.id, `o Estúdio respondeu ${r.status}: ${texto.slice(0, 200)}`);
    if ((r.headers.get('content-type') ?? '').includes('text/event-stream')) {
      for (const l of texto.split('\n')) if (l.startsWith('data:')) process.stdout.write(`${l.slice(5).trim()}\n`);
    } else if (texto.trim()) {
      process.stdout.write(`${texto.trim()}\n`);
    }
  } finally {
    if (temId && abortos.get(msg.id) === parar) abortos.delete(msg.id);
  }
};

readline.createInterface({input: process.stdin}).on('line', (l) => {
  if (!l.trim()) return;
  let msg;
  try {
    msg = JSON.parse(l);
  } catch {
    return;
  }
  if (msg?.method === 'notifications/cancelled') {
    abortos.get(msg.params?.requestId)?.abort();
    return;
  }
  const p = repassar(l, msg);
  pendentes.add(p);
  void p.finally(() => pendentes.delete(p));
}).on('close', () => void Promise.allSettled([...pendentes]).then(() => process.exit(0)));
