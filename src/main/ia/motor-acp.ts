// Uma conversa com um agente que fala ACP (Gemini CLI, Qwen Code, opencode, goose, Antigravity), traduzida para os
// mesmos eventos da conversa do Claude: texto em pedaços, ação como cartão, pedido de permissão com os mesmos botões,
// uso de tokens e fim do turno. O agente é o da pessoa, com a configuração e o login dela; o app só manda o MCP estudio
// da aba no session/new. Como no Claude, o processo sobe na primeira mensagem e volta com session/load depois de
// hibernar (quando o agente oferece).
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import type {EventoConversa} from '../../compartilhado/api';
import {cortarResultado} from '../../compartilhado/ferramentas';
import {ClienteAcp, type InicioAcp, type McpHttpAcp, type OpcaoPermissao, type PedidoPermissaoAcp, type RespostaPermissaoAcp} from './acp';

export type OpcoesAcp = {
  comando: () => Promise<{arquivo: string; args: string[]; shell?: boolean} | null>; // executável já resolvido; .cmd do npm vai com shell
  cwd: string;
  mcp: {url: string; headers: Record<string, string>};
  ambiente: Record<string, string>;
  evento: (e: EventoConversa) => void;
};

type Pendente = {opcoes: OpcaoPermissao[]; ok: (r: RespostaPermissaoAcp) => void};

const textoDe = (conteudo: any): string => {
  if (!conteudo) return '';
  if (Array.isArray(conteudo)) return conteudo.map(textoDe).join('');
  if (conteudo.type === 'text') return conteudo.text ?? '';
  if (conteudo.type === 'content') return textoDe(conteudo.content);
  return '';
};

export class SessaoAcp {
  readonly sessao = randomUUID();
  private proc: ChildProcessWithoutNullStreams | null = null;
  private cliente: ClienteAcp | null = null;
  private inicio: InicioAcp | null = null;
  private idAgente: string | null = null; // sessionId que o agente deu
  private pendentes = new Map<string, Pendente>();
  private segmento = ''; // texto desde a última ação, para o evento "mensagem"
  private ocupada = false;
  private custoVisto = 0;

  constructor(private readonly o: OpcoesAcp) {}

  vivo() {
    return this.proc !== null;
  }

  async enviar(texto: string) {
    if (this.ocupada) throw new Error('a conversa ainda está respondendo');
    this.ocupada = true;
    const t0 = Date.now();
    try {
      await this.garantir();
      this.o.evento({tipo: 'estado', estado: 'requesting'});
      const r = await this.cliente!.mandar(this.idAgente!, texto);
      this.fecharSegmento();
      this.o.evento({tipo: 'fim', erro: r.stopReason === 'refusal', texto: r.stopReason === 'cancelled' ? 'parado' : r.stopReason === 'end_turn' ? undefined : r.stopReason,
        duracao_ms: Date.now() - t0});
    } catch (e) {
      this.fecharSegmento();
      this.o.evento({tipo: 'fim', erro: true, texto: (e as Error).message, duracao_ms: Date.now() - t0});
    } finally {
      this.ocupada = false;
    }
  }

  permitir(pedido: string, decisao: 'permitir' | 'negar', sempre = false) {
    const p = this.pendentes.get(pedido);
    if (!p) return;
    this.pendentes.delete(pedido);
    const tipos = decisao === 'negar' ? ['reject_once', 'reject_always'] : sempre ? ['allow_always', 'allow_once'] : ['allow_once', 'allow_always'];
    const op = tipos.map((k) => p.opcoes.find((x) => x.kind === k)).find(Boolean);
    p.ok(op ? {outcome: {outcome: 'selected', optionId: op.optionId}} : {outcome: {outcome: 'cancelled'}});
  }

  parar() {
    if (!this.cliente || !this.idAgente) return;
    // a especificação manda o cliente responder "cancelled" a todo pedido de permissão pendente
    for (const [id, p] of this.pendentes) {
      p.ok({outcome: {outcome: 'cancelled'}});
      this.o.evento({tipo: 'permissao-cancelada', pedido: id});
    }
    this.pendentes.clear();
    this.cliente.cancelar(this.idAgente);
  }

  /** Encerra o processo; a próxima mensagem sobe de novo e, se o agente souber, carrega a mesma sessão. */
  hibernar() {
    this.matar();
    return this.sessao;
  }

  fechar() {
    this.matar();
    this.idAgente = null;
  }

  private matar() {
    this.cliente?.encerrar();
    this.cliente = null;
    const p = this.proc;
    this.proc = null;
    for (const x of this.pendentes.values()) x.ok({outcome: {outcome: 'cancelled'}});
    this.pendentes.clear();
    if (!p) return;
    try {
      p.stdin.end();
      setTimeout(() => p.exitCode === null && p.kill(), 1500);
    } catch {
      /* já saiu */
    }
  }

  private mcpServers(): McpHttpAcp[] {
    return [{type: 'http', name: 'estudio', url: this.o.mcp.url, headers: Object.entries(this.o.mcp.headers).map(([name, value]) => ({name, value}))}];
  }

  private async garantir() {
    if (this.cliente) return;
    const cmd = await this.o.comando();
    if (!cmd) throw new Error('o agente não está instalado neste PC');
    const proc = spawn(cmd.shell ? `"${cmd.arquivo}"` : cmd.arquivo, cmd.args, {cwd: this.o.cwd, windowsHide: true, env: this.o.ambiente, shell: cmd.shell});
    this.proc = proc;
    let erro = '';
    proc.stderr.on('data', (d: Buffer) => (erro = (erro + d.toString()).slice(-2000)));
    proc.on('exit', (codigo) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.cliente?.encerrar(new Error(`o agente parou${erro ? `: ${erro.trim().split(/\r?\n/).pop()?.slice(0, 300)}` : ''}`));
      this.cliente = null;
      this.o.evento({tipo: 'saiu', codigo, detalhe: codigo ? erro.trim().split(/\r?\n/).pop()?.slice(0, 300) : undefined});
    });
    proc.on('error', (e) => this.o.evento({tipo: 'erro', mensagem: e.message}));
    const cliente = new ClienteAcp(proc.stdin, proc.stdout, {
      atualizacao: (a) => this.atualizar(a.update),
      permissao: (p) => this.pedirPermissao(p),
    });
    this.cliente = cliente;
    this.inicio = await cliente.inicializar();
    if (!this.inicio.agentCapabilities?.mcpCapabilities?.http) throw new Error('este agente não aceita servidor MCP por HTTP do app');
    const nome = this.inicio.agentInfo?.title ?? this.inicio.agentInfo?.name;
    if (this.idAgente && this.inicio.agentCapabilities?.loadSession) {
      await cliente.carregarSessao(this.idAgente, this.o.cwd, this.mcpServers());
    } else {
      if (this.idAgente) this.o.evento({tipo: 'erro', mensagem: 'este agente não retoma conversas: a próxima resposta começa do zero'});
      this.idAgente = (await cliente.novaSessao(this.o.cwd, this.mcpServers())).sessionId;
    }
    this.o.evento({tipo: 'pronto', sessao: this.sessao, modelo: nome ?? undefined});
  }

  private fecharSegmento() {
    if (this.segmento) this.o.evento({tipo: 'mensagem', texto: this.segmento});
    this.segmento = '';
  }

  private atualizar(u: Record<string, any>) {
    switch (u.sessionUpdate) {
      case 'agent_message_chunk': {
        const t = textoDe(u.content);
        if (!t) return;
        this.segmento += t;
        this.o.evento({tipo: 'texto', delta: t});
        return;
      }
      case 'agent_thought_chunk':
        this.o.evento({tipo: 'estado', estado: 'pensando'});
        return;
      case 'tool_call':
        this.fecharSegmento();
        this.o.evento({tipo: 'ferramenta', uso: u.toolCallId, nome: u.name ?? u.title ?? 'ferramenta', entrada: u.rawInput ?? {}});
        if (u.status === 'completed' || u.status === 'failed') this.o.evento({tipo: 'resultado', uso: u.toolCallId, ok: u.status === 'completed', texto: cortarResultado(textoDe(u.content))});
        return;
      case 'tool_call_update':
        if (u.status === 'completed' || u.status === 'failed') this.o.evento({tipo: 'resultado', uso: u.toolCallId, ok: u.status === 'completed', texto: cortarResultado(textoDe(u.content))});
        return;
      case 'usage_update': {
        // o ACP manda o contexto ocupado (não os tokens do turno) e, às vezes, o custo da sessão: vira o custo do turno
        if (u.cost?.currency !== 'USD' || typeof u.cost.amount !== 'number') return;
        const delta = Math.max(0, u.cost.amount - this.custoVisto);
        this.custoVisto = u.cost.amount;
        if (delta > 0) this.o.evento({tipo: 'uso', entrada: 0, entrada_cache: 0, saida: 0, custo_usd: delta});
        return;
      }
      default:
        return;
    }
  }

  private pedirPermissao(p: PedidoPermissaoAcp) {
    return new Promise<RespostaPermissaoAcp>((ok) => {
      const pedido = `acp-${randomUUID()}`;
      this.pendentes.set(pedido, {opcoes: p.options, ok});
      const t = p.toolCall ?? {};
      this.o.evento({tipo: 'permissao', pedido, ferramenta: t.name ?? t.title ?? 'ferramenta', entrada: t.rawInput ?? {}, titulo: t.title,
        pode_sempre: p.options.some((x) => x.kind === 'allow_always')});
    });
  }
}
