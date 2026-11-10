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
import type {PedidoPortao, Portao} from '../nucleo/portao';
import type {Projeto} from '../nucleo/projeto';
import type {ServicoNarracao} from '../nucleo/narracao-servico';

/** Quem pergunta à pessoa no app (ipc-ia.ts). sempre: a pessoa marcou "Sempre nesta conversa". */
export type Perguntador = (p: PedidoPortao & {origem: string}) => Promise<{permitir: boolean; sempre?: boolean}>;

type Aba = {origem: string; arquivo?: string; fixo?: boolean}; // fixo: app de IA de fora, com token que sobrevive a trocar de projeto

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
  private sempre = new Map<string, Set<string>>(); // por token: ferramentas que a pessoa liberou nesta conversa

  constructor(private readonly pastaConfig: string, private readonly projeto: () => Projeto | null, private readonly rede?: Rede,
    private readonly perguntador?: Perguntador) {}

  /** Token e arquivo de configuração (--mcp-config) para uma aba nova do Claude. */
  novaAba(base: string, origem: string): string {
    return this.novaConexao(base, origem).arquivo;
  }

  /** O mesmo, com o endereço e o cabeçalho à mão: o laço próprio e os agentes ACP recebem assim, sem ler o arquivo. */
  novaConexao(base: string, origem: string) {
    const token = randomBytes(18).toString('hex');
    mkdirSync(this.pastaConfig, {recursive: true});
    const arquivo = path.join(this.pastaConfig, `aba-${token.slice(0, 8)}.json`);
    const url = `${base}/mcp`;
    const headers = {Authorization: `Bearer ${token}`};
    const config = {mcpServers: {estudio: {type: 'http', url, headers}}};
    writeFileSync(arquivo, JSON.stringify(config, null, 2), {encoding: 'utf-8', mode: 0o600});
    this.abas.set(token, {origem, arquivo});
    return {arquivo, url, headers};
  }

  /** Projeto fechado: esquece os tokens das abas; os dos apps de fora (registrarFixo) ficam até a pessoa revogar. */
  esquecerTudo() {
    for (const [token, a] of [...this.abas]) {
      if (a.fixo) continue;
      if (a.arquivo) rmSync(a.arquivo, {force: true});
      this.abas.delete(token);
      this.sempre.delete(token);
    }
  }

  /** Padrão Screenpipe (frente IA): um app de IA de fora (Cursor, Cline, Claude Desktop) entra com um token próprio, que
   *  vira a origem no diário e passa pelo mesmo portão de permissão. */
  registrarFixo(token: string, origem: string) {
    this.abas.set(token, {origem, fixo: true});
  }

  esquecerFixo(token: string) {
    this.abas.delete(token);
    this.sempre.delete(token);
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
    const servidor = new McpServer({name: 'estudio', version: '0.1.0'}, {instructions: INSTRUCOES_MCP});
    // frente IA: o portão pergunta à pessoa pelo app; "Sempre nesta conversa" vale para o token desta aba
    const perguntar = this.perguntador;
    const portao: Portao | undefined = perguntar && {
      perguntar: async (p) => {
        const lembradas = this.sempre.get(token!);
        if (lembradas?.has(p.ferramenta)) return true;
        const r = await perguntar({...p, origem: aba.origem});
        if (r.permitir && r.sempre) this.sempre.set(token!, new Set([...(lembradas ?? []), p.ferramenta]));
        return r.permitir;
      },
    };
    registrarFerramentas(servidor, projeto, 'agente', aba.origem, this.rede, transcritorMcp, portao, narradorMcp);
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
