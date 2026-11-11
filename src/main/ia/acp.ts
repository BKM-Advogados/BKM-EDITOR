// Cliente mínimo do Agent Client Protocol (ACP, v1, Apache-2.0): JSON-RPC 2.0 por linhas no stdio de um agente
// (Gemini CLI, Qwen Code, opencode, goose, Codex com adaptador, Antigravity). Escrito à mão, sem o pacote
// @agentclientprotocol/sdk, para não trazer 9 MB de esquemas e um módulo só-ESM ao processo principal: o app usa só
// initialize, authenticate, session/new, session/load, session/prompt, session/cancel, session/update e
// session/request_permission. Os formatos vêm do schema/v1/schema.json do SDK 2.4.0.
import type {Readable, Writable} from 'node:stream';
import readline from 'node:readline';

export type McpHttpAcp = {type: 'http'; name: string; url: string; headers: {name: string; value: string}[]};
export type OpcaoPermissao = {optionId: string; name: string; kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'};
export type PedidoPermissaoAcp = {sessionId: string; toolCall: Record<string, any>; options: OpcaoPermissao[]};
export type RespostaPermissaoAcp = {outcome: {outcome: 'cancelled'} | {outcome: 'selected'; optionId: string}};
export type AtualizacaoAcp = {sessionId: string; update: {sessionUpdate: string} & Record<string, any>};
export type InicioAcp = {
  protocolVersion: number;
  agentCapabilities?: {loadSession?: boolean; promptCapabilities?: {image?: boolean}; mcpCapabilities?: {http?: boolean; sse?: boolean}};
  authMethods?: {id: string; name?: string; description?: string; type?: string}[];
  agentInfo?: {name?: string; title?: string; version?: string} | null;
};

export class ErroAcp extends Error {
  constructor(readonly codigo: number, mensagem: string, readonly dados?: unknown) {
    super(mensagem);
  }
}

type Pendente = {ok: (v: any) => void; falha: (e: Error) => void};

export class ClienteAcp {
  private proximo = 1;
  private pendentes = new Map<number, Pendente>();
  private fechado = false;

  constructor(
    private readonly saida: Writable, // stdin do agente
    entrada: Readable, // stdout do agente
    private readonly o: {
      atualizacao: (a: AtualizacaoAcp) => void;
      permissao: (p: PedidoPermissaoAcp) => Promise<RespostaPermissaoAcp>;
      log?: (direcao: '>' | '<', linha: string) => void;
    },
  ) {
    readline.createInterface({input: entrada}).on('line', (l) => this.linha(l));
    entrada.on('close', () => this.encerrar(new Error('o agente fechou a conexão')));
  }

  inicializar() {
    return this.pedir<InicioAcp>('initialize', {protocolVersion: 1, clientCapabilities: {fs: {readTextFile: false, writeTextFile: false}, terminal: false},
      clientInfo: {name: 'estudio', title: 'Estúdio', version: '0.3.0'}});
  }

  autenticar(methodId: string) {
    return this.pedir('authenticate', {methodId});
  }

  novaSessao(cwd: string, mcpServers: McpHttpAcp[]) {
    return this.pedir<{sessionId: string; models?: unknown; modes?: unknown}>('session/new', {cwd, mcpServers});
  }

  carregarSessao(sessionId: string, cwd: string, mcpServers: McpHttpAcp[]) {
    return this.pedir('session/load', {sessionId, cwd, mcpServers});
  }

  /** Um turno: resolve quando o agente termina, com o motivo (end_turn, cancelled, max_tokens, refusal…). */
  mandar(sessionId: string, texto: string) {
    return this.pedir<{stopReason: string}>('session/prompt', {sessionId, prompt: [{type: 'text', text: texto}]});
  }

  cancelar(sessionId: string) {
    this.notificar('session/cancel', {sessionId});
  }

  encerrar(e = new Error('conexão encerrada')) {
    if (this.fechado) return;
    this.fechado = true;
    for (const p of this.pendentes.values()) p.falha(e);
    this.pendentes.clear();
  }

  private pedir<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.fechado) return Promise.reject(new Error('conexão encerrada'));
    const id = this.proximo++;
    return new Promise<T>((ok, falha) => {
      this.pendentes.set(id, {ok, falha});
      this.escrever({jsonrpc: '2.0', id, method, params});
    });
  }

  private notificar(method: string, params: unknown) {
    if (!this.fechado) this.escrever({jsonrpc: '2.0', method, params});
  }

  private escrever(o: unknown) {
    if (this.fechado || !this.saida.writable) return; // resposta que chega depois de fechar (permissão cancelada ao matar)
    const l = JSON.stringify(o);
    this.o.log?.('>', l);
    this.saida.write(`${l}\n`);
  }

  private linha(l: string) {
    if (!l.trim()) return;
    this.o.log?.('<', l);
    let m: Record<string, any>;
    try {
      m = JSON.parse(l);
    } catch {
      return; // agente que escreve log no stdout: ignora a linha
    }
    if (m.id !== undefined && m.method === undefined) {
      const p = this.pendentes.get(m.id);
      if (!p) return;
      this.pendentes.delete(m.id);
      if (m.error) p.falha(new ErroAcp(m.error.code ?? -1, m.error.message ?? 'erro do agente', m.error.data));
      else p.ok(m.result);
      return;
    }
    if (m.method === 'session/update') return this.o.atualizacao(m.params);
    if (m.method === 'session/request_permission' && m.id !== undefined) {
      void this.o.permissao(m.params).then(
        (r) => this.escrever({jsonrpc: '2.0', id: m.id, result: r}),
        () => this.escrever({jsonrpc: '2.0', id: m.id, result: {outcome: {outcome: 'cancelled'}}}),
      );
      return;
    }
    // o app não oferece fs nem terminal ao agente: qualquer outro pedido volta como método desconhecido
    if (m.id !== undefined) this.escrever({jsonrpc: '2.0', id: m.id, error: {code: -32601, message: `método não suportado pelo Estúdio: ${m.method}`}});
  }
}
