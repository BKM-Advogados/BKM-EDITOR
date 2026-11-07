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
import type {Projeto} from '../nucleo/projeto';

type Aba = {origem: string; arquivo: string};

// frente Fala: o transcritor local (transcricao.ts) chega depois do construtor, pelo registro do IPC da fala
let transcritorMcp: TranscritorMcp | undefined;
export const definirTranscritorMcp = (t: TranscritorMcp) => {
  transcritorMcp = t;
};

export class McpHttp {
  private abas = new Map<string, Aba>();

  constructor(private readonly pastaConfig: string, private readonly projeto: () => Projeto | null, private readonly rede?: Rede) {}

  /** Token e arquivo de configuração (--mcp-config) para uma aba nova do Claude. */
  novaAba(base: string, origem: string): string {
    const token = randomBytes(18).toString('hex');
    mkdirSync(this.pastaConfig, {recursive: true});
    const arquivo = path.join(this.pastaConfig, `aba-${token.slice(0, 8)}.json`);
    const config = {mcpServers: {estudio: {type: 'http', url: `${base}/mcp`, headers: {Authorization: `Bearer ${token}`}}}};
    writeFileSync(arquivo, JSON.stringify(config, null, 2), {encoding: 'utf-8', mode: 0o600});
    this.abas.set(token, {origem, arquivo});
    return arquivo;
  }

  esquecerTudo() {
    for (const a of this.abas.values()) rmSync(a.arquivo, {force: true});
    this.abas.clear();
  }

  /** Atende /mcp; devolve false se o pedido não é para cá. */
  async atender(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    if (!req.url?.startsWith('/mcp')) return false;
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
    let corpo = '';
    for await (const pedaco of req) corpo += pedaco;
    const servidor = new McpServer({name: 'estudio', version: '0.1.0'});
    registrarFerramentas(servidor, projeto, 'agente', aba.origem, this.rede, transcritorMcp);
    const transporte = new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true});
    res.on('close', () => {
      void transporte.close();
      void servidor.close();
    });
    await servidor.connect(transporte);
    await transporte.handleRequest(req, res, corpo ? JSON.parse(corpo) : undefined);
    return true;
  }
}
