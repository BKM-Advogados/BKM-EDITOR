// MCP "estudio" por HTTP local, servido pelo processo principal (docs/arquitetura.md, por memória: por stdio cada aba do
// Claude subiria um processo a mais). Sem estado entre pedidos: cada POST monta servidor e transporte, responde e fecha.
// Cada aba tem um token próprio no cabeçalho, que diz ao diário de qual aba veio a mudança. A rede do ler_fonte (o
// net.fetch do Electron, montado no processo principal) chega pelo construtor.
import {randomBytes} from 'node:crypto';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {registrarFerramentas, type Rede, type TranscritorMcp} from '../nucleo/ferramentas-mcp';
import {INSTRUCOES_MCP} from '../nucleo/mcp-ia';
import {pedidoLocal} from './pedido-local';
import {autorAceito, CABECALHO_AUTOR, CABECALHO_CONVERSA, CABECALHO_ORIGEM, conversaValida, origemDaIde, rotuloAceito} from '../nucleo/mcp-app';
import type {PedidoPortao, Portao} from '../nucleo/portao';
import type {Projeto} from '../nucleo/projeto';
import type {ServicoNarracao} from '../nucleo/narracao-servico';

/** Quem pergunta à pessoa no app (ipc-ia.ts). sempre: a pessoa marcou "Sempre nesta conversa". */
export type Perguntador = (p: PedidoPortao & {origem: string}) => Promise<{permitir: boolean; sempre?: boolean}>;

// fixo: app de IA de fora, com token que sobrevive a trocar de projeto; ide: o token do MCP da IDE (mcp-app.ts), um só
// para todas as conversas dela, que se distinguem pelo cabeçalho X-Estudio-Conversa
type Aba = {origem: string; arquivo?: string; fixo?: boolean; ide?: boolean};

// frente Fala: o transcritor local (transcricao.ts) chega depois do construtor, pelo registro do IPC da fala
let transcritorMcp: TranscritorMcp | undefined;
export const definirTranscritorMcp = (t: TranscritorMcp) => {
  transcritorMcp = t;
};
// narração por IA: o serviço com a chave do cofre chega pelo registro do IPC da narração (ipc-narracao.ts)
let narradorMcp: ServicoNarracao | undefined;
export const definirNarradorMcp = (s: ServicoNarracao) => {
  narradorMcp = s;
};

export class McpHttp {
  private abas = new Map<string, Aba>();
  private sempre = new Map<string, Set<string>>(); // por conversa (token, e a conversa da IDE): ferramentas que a pessoa liberou

  constructor(private readonly pastaConfig: string, private readonly projeto: () => Projeto | null, private readonly rede?: Rede,
    private readonly perguntador?: Perguntador) {}

  /** Token e arquivo de configuração (--mcp-config) para uma aba nova do Claude. */
  novaAba(base: string, origem: string): string {
    return this.novaConexao(base, origem).arquivo;
  }

  /** O mesmo, com o endereço e o cabeçalho à mão: o laço próprio e os agentes ACP recebem assim, sem ler o arquivo. */
  novaConexao(base: string, origem: string, o: {ide?: boolean} = {}) {
    const token = randomBytes(18).toString('hex');
    mkdirSync(this.pastaConfig, {recursive: true});
    const arquivo = path.join(this.pastaConfig, `aba-${token.slice(0, 8)}.json`);
    const url = `${base}/mcp`;
    const headers = {Authorization: `Bearer ${token}`};
    const config = {mcpServers: {estudio: {type: 'http', url, headers}}};
    writeFileSync(arquivo, JSON.stringify(config, null, 2), {encoding: 'utf-8', mode: 0o600});
    this.abas.set(token, {origem, arquivo, ...(o.ide ? {ide: true} : {})});
    return {arquivo, url, headers};
  }

  /** Projeto fechado: esquece os tokens das abas; os dos apps de fora (registrarFixo) ficam até a pessoa revogar. */
  esquecerTudo() {
    for (const [token, a] of [...this.abas]) {
      if (a.fixo) continue;
      if (a.arquivo) rmSync(a.arquivo, {force: true});
      this.abas.delete(token);
      this.esquecerSempre(token);
    }
  }

  private esquecerSempre(token: string) {
    for (const chave of [...this.sempre.keys()]) if (chave === token || chave.startsWith(`${token} `)) this.sempre.delete(chave);
  }

  /** Padrão Screenpipe (frente IA): um app de IA de fora (Cursor, Cline, Claude Desktop) entra com um token próprio, que
   *  vira a origem no diário e passa pelo mesmo portão de permissão. */
  registrarFixo(token: string, origem: string) {
    this.abas.set(token, {origem, fixo: true});
  }

  esquecerFixo(token: string) {
    this.abas.delete(token);
    this.esquecerSempre(token);
  }

  /** Autor e origem no diário, e a chave do "Sempre nesta conversa". A aba é uma conversa só; o token da IDE serve a
   *  todos os processos dela, e cada um diz a sua conversa (ide-<id>) e o seu autor, que não pode ser um reservado. */
  private quem(token: string, aba: Aba, req: http.IncomingMessage): {autor: string; origem: string; chave: string} | {erro: string} {
    if (!aba.ide) return {autor: 'agente', origem: aba.origem, chave: token};
    const conversa = req.headers[CABECALHO_CONVERSA];
    const bruto = req.headers[CABECALHO_AUTOR];
    let autor = 'agente';
    if (typeof bruto === 'string') {
      try {
        autor = decodeURIComponent(bruto);
      } catch {
        autor = '';
      }
      if (!autorAceito(autor)) return {erro: `o autor "${autor}" não pode gravar pelo Estúdio; use outro --autor`};
    }
    // o nome do harness (--origem): ilegível ou fora do formato, a origem fica sem ele (não recusa: não grava por cima de nada)
    let rotulo: string | undefined;
    const brutoOrigem = req.headers[CABECALHO_ORIGEM];
    if (typeof brutoOrigem === 'string') {
      try {
        rotulo = decodeURIComponent(brutoOrigem);
      } catch {
        rotulo = undefined;
      }
      if (!rotuloAceito(rotulo)) rotulo = undefined;
    }
    return conversaValida(conversa) ? {autor, origem: origemDaIde(conversa, rotulo), chave: `${token} ${conversa}`} : {autor, origem: aba.origem, chave: token};
  }

  /** Atende /mcp; devolve false se o pedido não é para cá. */
  async atender(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    if (!req.url?.startsWith('/mcp')) return false;
    if (!pedidoLocal(req)) {
      res.writeHead(403, {'Content-Type': 'text/plain'}).end('recusado');
      return true;
    }
    const token = /^Bearer\s+(\S+)$/.exec(req.headers.authorization ?? '')?.[1];
    const aba = token ? this.abas.get(token) : undefined;
    const projeto = this.projeto();
    if (!aba || !projeto) {
      res.writeHead(aba ? 409 : 401, {'Content-Type': 'application/json'}).end(JSON.stringify({erro: aba ? 'nenhum projeto aberto' : 'token inválido'}));
      return true;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, {Allow: 'POST'}).end();
      return true;
    }
    const corpo = await lerCorpo(req);
    if (corpo === null) {
      res.writeHead(413, {'Content-Type': 'application/json', Connection: 'close'})
        .end(JSON.stringify({jsonrpc: '2.0', id: null, error: {code: -32600, message: `pedido maior que ${TETO_CORPO / 1024 / 1024} MB`}}));
      return true;
    }
    let mensagem: unknown;
    try {
      mensagem = corpo ? JSON.parse(corpo) : undefined;
    } catch {
      res.writeHead(400, {'Content-Type': 'application/json'})
        .end(JSON.stringify({jsonrpc: '2.0', id: null, error: {code: -32700, message: 'o corpo não é JSON válido'}}));
      return true;
    }
    const quem = this.quem(token!, aba, req);
    if ('erro' in quem) {
      res.writeHead(400, {'Content-Type': 'application/json'}).end(JSON.stringify({jsonrpc: '2.0', id: null, error: {code: -32600, message: quem.erro}}));
      return true;
    }
    const servidor = new McpServer({name: 'estudio', version: '0.1.0'}, {instructions: INSTRUCOES_MCP});
    // frente IA: o portão pergunta à pessoa pelo app; "Sempre nesta conversa" vale para esta conversa (aba ou conversa da IDE)
    const perguntar = this.perguntador;
    const portao: Portao | undefined = perguntar && {
      perguntar: async (p) => {
        const lembradas = this.sempre.get(quem.chave);
        if (lembradas?.has(p.ferramenta)) return true;
        const r = await perguntar({...p, origem: quem.origem});
        if (r.permitir && r.sempre) this.sempre.set(quem.chave, new Set([...(this.sempre.get(quem.chave) ?? []), p.ferramenta]));
        return r.permitir;
      },
    };
    registrarFerramentas(servidor, projeto, quem.autor, quem.origem, this.rede, transcritorMcp, portao, narradorMcp);
    const transporte = new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true});
    res.on('close', () => {
      void transporte.close();
      void servidor.close();
    });
    await servidor.connect(transporte);
    await transporte.handleRequest(req, res, mensagem);
    return true;
  }
}

/** Teto do corpo de um pedido: bem acima de qualquer patch real, abaixo do que pesaria no processo principal. */
export const TETO_CORPO = 32 * 1024 * 1024;

/** O corpo inteiro como texto, ou null se passa do teto. Os pedaços se juntam antes de virar texto: um acento partido
 *  entre dois pedaços (corpo acima de ~64 KB) viraria U+FFFD gravado no documento e no diário. */
const lerCorpo = (req: http.IncomingMessage) => new Promise<string | null>((ok, falha) => {
  if (Number(req.headers['content-length'] ?? 0) > TETO_CORPO) {
    req.resume();
    return ok(null);
  }
  const pedacos: Buffer[] = [];
  let total = 0;
  let estourou = false;
  req.on('data', (pedaco: Buffer) => {
    if (estourou) return; // o resto é descartado; a resposta 413 sai com Connection: close
    total += pedaco.length;
    if (total <= TETO_CORPO) return void pedacos.push(pedaco);
    estourou = true;
    pedacos.length = 0;
    ok(null);
  });
  req.on('end', () => estourou || ok(Buffer.concat(pedacos).toString('utf-8')));
  req.on('error', falha);
});
