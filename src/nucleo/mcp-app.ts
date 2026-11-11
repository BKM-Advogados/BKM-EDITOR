// O MCP da IDE passa pelo app quando ele está aberto no mesmo projeto (decisão da reformulação, auditoria do núcleo V3).
// O app, ao abrir um projeto, publica em .estudio/mcp-app.json o endereço do MCP por HTTP dele (src/main/mcp-http.ts),
// um token só para isso, o pid e a máquina; ao fechar, apaga. O MCP por stdio (mcp/nucleo.ts, um processo por conversa
// da IDE) confere o arquivo a cada chamada de ferramenta: com o app vivo, repassa a chamada a ele, e a gravação passa
// pelo portão, pelo aviso na tela e por um escritor só; com o app fechado (ou sem projeto, ou o token revogado), roda
// ali mesmo, com a trava de arquivo (trava-escrita.ts). O arquivo está no .gitignore do projeto (.estudio/mcp*).
import {existsSync, mkdirSync, readFileSync, rmSync} from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import type {JSONRPCMessage} from '@modelcontextprotocol/sdk/types.js';
import {gravarAtomico} from './gravar-seguro';
import {PASTA_INTERNA} from './projeto';

export const ARQUIVO_MCP_APP = `${PASTA_INTERNA}/mcp-app.json`;

export type ConexaoApp = {formato: 1; url: string; token: string; pid: number; host: string; raiz: string; em: string};

const arquivo = (raiz: string) => path.join(raiz, ARQUIVO_MCP_APP);
const mesmaPasta = (a: string, b: string) => {
  const n = (p: string) => path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
};

const vivo = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** O app abriu o projeto: o MCP da IDE passa a falar com ele. */
export const publicarMcpApp = (raiz: string, c: {url: string; token: string}) => {
  const conexao: ConexaoApp = {formato: 1, url: c.url, token: c.token, pid: process.pid, host: os.hostname(), raiz: path.resolve(raiz), em: new Date().toISOString()};
  mkdirSync(path.dirname(arquivo(raiz)), {recursive: true});
  gravarAtomico(arquivo(raiz), `${JSON.stringify(conexao, null, 2)}\n`);
};

/** O app fechou o projeto: apaga o arquivo se ainda for o dele (outro Estúdio pode ter aberto a mesma pasta depois). */
export const retirarMcpApp = (raiz: string, token: string) => {
  try {
    const c = JSON.parse(readFileSync(arquivo(raiz), 'utf-8')) as Partial<ConexaoApp>;
    if (c.token === token) rmSync(arquivo(raiz), {force: true});
  } catch {
    /* já não está */
  }
};

/** A conexão com o app aberto neste projeto, ou null: sem arquivo, de outra máquina (pasta sincronizada), de um app que
 *  morreu sem apagar ou publicado para outra pasta (projeto copiado com a .estudio junto). */
export const appAberto = (raiz: string): ConexaoApp | null => {
  if (!existsSync(arquivo(raiz))) return null;
  try {
    const c = JSON.parse(readFileSync(arquivo(raiz), 'utf-8')) as Partial<ConexaoApp>;
    if (c.formato !== 1 || typeof c.url !== 'string' || typeof c.token !== 'string' || typeof c.pid !== 'number' || typeof c.raiz !== 'string') return null;
    if (c.host !== os.hostname() || !vivo(c.pid) || !mesmaPasta(c.raiz, raiz)) return null;
    if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(c.url)) return null; // só o app desta máquina
    return c as ConexaoApp;
  } catch {
    return null;
  }
};

type Resposta = {status: number; tipo: string; texto: string};

const postar = (c: ConexaoApp, corpo: string) =>
  new Promise<Resposta>((ok, falhou) => {
    // sem prazo: o portão espera a pessoa responder no app (até 10 min)
    const req = http.request(c.url, {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${c.token}`, 'Content-Length': Buffer.byteLength(corpo)}}, (res) => {
      let texto = '';
      res.setEncoding('utf-8');
      res.on('data', (d: string) => (texto += d));
      res.on('end', () => ok({status: res.statusCode ?? 0, tipo: String(res.headers['content-type'] ?? ''), texto}));
      res.on('error', falhou);
    });
    req.on('error', falhou);
    req.end(corpo);
  });

const erroJsonRpc = (id: unknown, message: string): JSONRPCMessage => ({jsonrpc: '2.0', id: id as string | number, error: {code: -32000, message}});

/** Repassa uma mensagem JSON-RPC ao app. Devolve a resposta, ou null quando o app não a atende (fechou, sem projeto,
 *  token revogado) e a chamada deve rodar aqui; o pedido recusado na conexão não chegou a rodar no app. */
export const encaminharAoApp = async (c: ConexaoApp, msg: JSONRPCMessage): Promise<JSONRPCMessage | null> => {
  const id = (msg as {id?: unknown}).id;
  let r: Resposta;
  try {
    r = await postar(c, JSON.stringify(msg));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ECONNREFUSED') return null;
    return erroJsonRpc(id, `o Estúdio aberto neste projeto não respondeu (${(e as Error).message}); tente de novo`);
  }
  if (r.status === 401 || r.status === 409) return null;
  if (r.status < 200 || r.status >= 300) return erroJsonRpc(id, `o Estúdio respondeu ${r.status}: ${r.texto.slice(0, 200)}`);
  const mensagens = r.tipo.includes('text/event-stream')
    ? r.texto.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean)
    : [r.texto.trim()].filter(Boolean);
  for (const m of mensagens.reverse()) {
    try {
      const lida = JSON.parse(m) as JSONRPCMessage & {id?: unknown};
      if (lida.id === id) return lida;
    } catch {
      /* linha que não é JSON */
    }
  }
  return erroJsonRpc(id, 'o Estúdio respondeu sem o resultado da ferramenta');
};

const ehChamadaDeFerramenta = (msg: JSONRPCMessage) => (msg as {method?: string; id?: unknown}).method === 'tools/call' && (msg as {id?: unknown}).id !== undefined;

/** Liga o repasse no transporte de um servidor já conectado: cada tools/call vai ao app quando ele está aberto neste
 *  projeto; o resto (initialize, a lista de ferramentas) e as chamadas com o app fechado ficam no servidor local. As
 *  chamadas repassadas seguem uma de cada vez, na ordem em que chegaram. */
export const repassarAoAppQuandoAberto = (t: Transport, raiz: string, o: {encontrar?: typeof appAberto} = {}) => {
  const local = t.onmessage;
  if (!local) throw new Error('conecte o servidor ao transporte antes de ligar o repasse');
  const encontrar = o.encontrar ?? appAberto;
  let fila: Promise<unknown> = Promise.resolve();
  t.onmessage = (msg, extra) => {
    if (!ehChamadaDeFerramenta(msg)) return local(msg, extra);
    fila = fila.then(async () => {
      const app = encontrar(raiz);
      const r = app ? await encaminharAoApp(app, msg) : null;
      if (r) await t.send(r); // o app já rodou: se a resposta não sair, não roda de novo aqui
      else local(msg, extra);
    }).catch(() => undefined);
  };
};
