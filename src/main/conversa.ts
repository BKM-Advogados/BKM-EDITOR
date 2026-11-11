// Conversa com o Claude sem cara de terminal. É o mesmo `claude` que a pessoa instalou e logou, no modo sem tela
// (`-p` com entrada e saída stream-json, o protocolo que o Agent SDK da Anthropic usa para falar com ele): cada linha
// que sai vira um evento para a interface desenhar (texto, ações como cartões, pedidos de permissão). O binário não é
// modificado e o app nunca toca nas credenciais; o login continua sendo o da Anthropic (/login no terminal).
// Parar = pedido de interrupção pelo próprio canal. Parada há 10 min, a conversa hiberna (libera a memória do
// processo) e volta sozinha com --resume na próxima mensagem.
import {execFile, spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import readline from 'node:readline';
import type {ContaClaude, EventoConversa} from '../compartilhado/api';
import {ambienteLimpo, citarCmd, ehCmd, matarArvore, PATH_COM_LOCAL} from './terminais';
import {cortarResultado} from '../compartilhado/ferramentas';

const OCIOSA_MS = 10 * 60 * 1000;

type Conversa = {
  id: number;
  sessao: string;
  arquivoMcp?: string;
  cwd: string;
  proc: ChildProcessWithoutNullStreams | null;
  iniciada: boolean; // a sessão já existe no disco do claude: daqui em diante é --resume
  ocupada: boolean;
  fila: string[];
  ocioso: NodeJS.Timeout | null;
  pedidos: Map<string, Record<string, unknown>>; // pedidos de permissão esperando a pessoa
  modelo?: string;
  modeloAtivo?: string; // o --model com que o processo vivo subiu
};

type Opcoes = {
  evento: (id: number, e: EventoConversa) => void;
  claude: () => string | null;
  vivas: () => number; // abas do Claude no terminal, que contam no mesmo limite
  prefixo?: string[]; // argumentos antes dos do claude (o teste roda um claude falso com o node)
  ambienteExtra?: Record<string, string>;
};

export class Conversas {
  private conversas = new Map<number, Conversa>();
  private proximo = 1;

  constructor(private readonly o: Opcoes) {}

  /** Sessões do Claude com processo vivo (contam no limite do perfil de RAM). */
  vivas() {
    return [...this.conversas.values()].filter((c) => c.proc).length;
  }

  abrir(o: {cwd: string; arquivoMcp?: string; sessao?: string}) {
    const id = this.proximo++;
    const c: Conversa = {id, sessao: o.sessao ?? randomUUID(), arquivoMcp: o.arquivoMcp, cwd: o.cwd, proc: null, iniciada: Boolean(o.sessao),
      ocupada: false, fila: [], ocioso: null, pedidos: new Map()};
    this.conversas.set(id, c);
    return {id, sessao: c.sessao};
  }

  enviar(id: number, texto: string, limite: number) {
    const c = this.conversas.get(id);
    if (!c) throw new Error('conversa encerrada');
    // seletor de modelo (rodada 3): o modelo novo vale na próxima mensagem; o processo volta com --resume e --model
    if (c.proc && c.modeloAtivo !== c.modelo) this.matar(c);
    if (!c.proc) {
      if (this.vivas() + this.o.vivas() >= limite) throw new Error(`limite de ${limite} sessões do Claude abertas neste PC; hiberne uma para continuar`);
      this.iniciar(c);
    }
    this.escrever(c, {type: 'user', message: {role: 'user', content: texto}, parent_tool_use_id: null});
    c.ocupada = true;
    this.armarOcioso(c);
  }

  /** Resposta da pessoa a um pedido de permissão. `sempre` usa as sugestões que o próprio Claude mandou. */
  permitir(id: number, pedido: string, decisao: 'permitir' | 'negar', sempre = false) {
    const c = this.conversas.get(id);
    const req = c?.pedidos.get(pedido);
    if (!c || !req) return;
    c.pedidos.delete(pedido);
    const resposta = decisao === 'permitir'
      ? {behavior: 'allow', updatedInput: req.input ?? {}, ...(sempre && Array.isArray(req.permission_suggestions) ? {updatedPermissions: req.permission_suggestions} : {})}
      : {behavior: 'deny', message: 'A pessoa negou esta ação no Estúdio.'};
    this.escrever(c, {type: 'control_response', response: {subtype: 'success', request_id: pedido, response: resposta}});
  }

  /** O seletor de modelo da conversa; vazio volta ao padrão da conta. */
  definirModelo(id: number, modelo?: string) {
    const c = this.conversas.get(id);
    if (c) c.modelo = modelo || undefined;
  }

  parar(id: number) {
    const c = this.conversas.get(id);
    if (!c?.proc) return;
    this.escrever(c, {type: 'control_request', request_id: `parar-${Date.now()}`, request: {subtype: 'interrupt'}});
  }

  /** Encerra o processo e guarda a sessão: a próxima mensagem volta com --resume. */
  hibernar(id: number) {
    const c = this.conversas.get(id);
    if (!c) return null;
    this.matar(c);
    return c.sessao;
  }

  /** `agora`: ao fechar o app não há 1,5 s de espera (o processo principal sai antes e o agente ficaria órfão). */
  fechar(id: number, agora = false) {
    const c = this.conversas.get(id);
    if (!c) return;
    this.matar(c, agora);
    this.conversas.delete(id);
  }

  fecharTodas(o: {agora?: boolean} = {}) {
    for (const id of [...this.conversas.keys()]) this.fechar(id, o.agora);
  }

  private iniciar(c: Conversa) {
    const exe = this.o.claude();
    if (!exe) throw new Error('o Claude Code não está instalado nesta máquina (claude.ai/install)');
    const args = [...(this.o.prefixo ?? []), '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      // os pedidos de permissão chegam por este mesmo canal (control_request can_use_tool) e viram cartões na tela
      '--permission-prompt-tool=stdio',
      ...(c.iniciada ? ['--resume', c.sessao] : ['--session-id', c.sessao]),
      // as ferramentas do projeto ficam liberadas: só mexem nos JSON do projeto, com diário e desfazer
      ...(c.arquivoMcp ? ['--mcp-config', c.arquivoMcp, '--allowedTools', 'mcp__estudio'] : []),
      ...(c.modelo ? ['--model', c.modelo] : [])];
    // claude.cmd do npm (transversal-D22): pelo cmd.exe, com os argumentos entre aspas quando precisam
    const cmd = ehCmd(exe);
    const proc = spawn(cmd ? `"${exe}"` : exe, cmd ? args.map(citarCmd) : args,
      {cwd: c.cwd, windowsHide: true, shell: cmd, env: {...ambienteLimpo(), PATH: PATH_COM_LOCAL(), ESTUDIO_PROJETO: c.cwd, ...this.o.ambienteExtra}});
    c.proc = proc;
    c.iniciada = true;
    c.modeloAtivo = c.modelo;
    readline.createInterface({input: proc.stdout}).on('line', (l) => this.linha(c, l));
    let erro = '';
    proc.stderr.on('data', (d: Buffer) => {
      erro = (erro + d.toString()).slice(-2000);
    });
    proc.stdin.on('error', () => undefined); // EPIPE: o claude saiu no meio da escrita; o 'exit' avisa a tela
    proc.on('error', (e) => {
      // spawn que falhou (ENOENT) não emite 'exit': sem isto, a conversa conta como viva para sempre
      if (c.proc === proc) {
        c.proc = null;
        c.ocupada = false;
        c.pedidos.clear();
        if (c.ocioso) clearTimeout(c.ocioso);
        c.ocioso = null;
      }
      this.o.evento(c.id, {tipo: 'erro', mensagem: e.message});
    });
    proc.on('exit', (codigo) => {
      if (c.proc !== proc) return; // já foi substituído (hibernou e voltou)
      c.proc = null;
      c.ocupada = false;
      c.pedidos.clear();
      if (c.ocioso) clearTimeout(c.ocioso);
      this.o.evento(c.id, {tipo: 'saiu', codigo, detalhe: codigo ? ultimaLinhaUtil(erro) : undefined});
    });
    this.escrever(c, {type: 'control_request', request_id: `abrir-${c.id}`, request: {subtype: 'initialize'}});
  }

  private escrever(c: Conversa, o: unknown) {
    c.proc?.stdin.write(`${JSON.stringify(o)}\n`);
  }

  private matar(c: Conversa, agora = false) {
    if (c.ocioso) clearTimeout(c.ocioso);
    c.ocioso = null;
    const p = c.proc;
    c.proc = null;
    c.ocupada = false;
    c.pedidos.clear();
    if (!p) return;
    try {
      p.stdin.end();
      if (agora) matarArvore(p);
      else setTimeout(() => matarArvore(p), 1500);
    } catch {
      /* já saiu */
    }
  }

  private armarOcioso(c: Conversa) {
    if (c.ocioso) clearTimeout(c.ocioso);
    c.ocioso = setTimeout(() => {
      if (c.ocupada || c.pedidos.size) return this.armarOcioso(c);
      this.matar(c);
      this.o.evento(c.id, {tipo: 'hibernou'});
    }, OCIOSA_MS);
  }

  private linha(c: Conversa, l: string) {
    let m: Record<string, any>;
    try {
      m = JSON.parse(l);
    } catch {
      return;
    }
    const ev = (e: EventoConversa) => this.o.evento(c.id, e);
    switch (m.type) {
      case 'system':
        if (m.subtype === 'init') ev({tipo: 'pronto', sessao: m.session_id, modelo: m.model});
        else if (m.subtype === 'status' && typeof m.status === 'string') ev({tipo: 'estado', estado: m.status});
        else if (m.subtype === 'api_retry') ev({tipo: 'estado', estado: 'tentando de novo'});
        return;
      case 'stream_event': {
        const e = m.event;
        if (m.parent_tool_use_id) return; // subagentes: só o resumo final aparece
        if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') ev({tipo: 'texto', delta: e.delta.text});
        return;
      }
      case 'assistant': {
        if (m.parent_tool_use_id) return;
        for (const b of m.message?.content ?? []) {
          if (b.type === 'text' && b.text) ev({tipo: 'mensagem', texto: b.text});
          else if (b.type === 'tool_use') ev({tipo: 'ferramenta', uso: b.id, nome: b.name, entrada: b.input ?? {}});
        }
        return;
      }
      case 'user': {
        if (m.parent_tool_use_id) return;
        const conteudo = Array.isArray(m.message?.content) ? m.message.content : [];
        for (const b of conteudo) {
          if (b.type !== 'tool_result') continue;
          const texto = typeof b.content === 'string' ? b.content
            : Array.isArray(b.content) ? b.content.filter((x: any) => x.type === 'text').map((x: any) => x.text).join('\n') : '';
          ev({tipo: 'resultado', uso: b.tool_use_id, ok: !b.is_error, texto: cortarResultado(texto)});
        }
        return;
      }
      case 'result':
        c.ocupada = false;
        ev({tipo: 'fim', erro: Boolean(m.is_error), texto: typeof m.result === 'string' ? m.result : undefined,
          custo_usd: m.total_cost_usd, duracao_ms: m.duration_ms});
        this.armarOcioso(c);
        return;
      case 'control_request': {
        const req = m.request ?? {};
        if (req.subtype === 'can_use_tool') {
          c.pedidos.set(m.request_id, req);
          ev({tipo: 'permissao', pedido: m.request_id, ferramenta: req.tool_name, entrada: req.input ?? {}, titulo: req.title ?? req.display_name,
            motivo: req.decision_reason, pode_sempre: Array.isArray(req.permission_suggestions) && req.permission_suggestions.length > 0});
        } else {
          // pedidos que o Estúdio não atende (diálogos, MCP do host): responde erro para o Claude seguir sem esperar
          this.escrever(c, {type: 'control_response', response: {subtype: 'error', request_id: m.request_id, error: 'não suportado pelo Estúdio'}});
        }
        return;
      }
      case 'control_cancel_request':
        if (c.pedidos.delete(m.request_id)) ev({tipo: 'permissao-cancelada', pedido: m.request_id});
        return;
      default:
        return;
    }
  }
}

const ultimaLinhaUtil = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/hook/i.test(l)).pop()?.slice(0, 300);

/** Estado do login do Claude Code da pessoa (só lê `claude auth status`; nunca toca nas credenciais). */
export const contaClaude = (exe: string | null): Promise<ContaClaude> =>
  new Promise((ok) => {
    const chaveApi = Boolean(process.env.ANTHROPIC_API_KEY);
    if (!exe) return ok({instalado: false, logado: false, metodo: 'none', chave_api: chaveApi});
    execFile(exe, ['auth', 'status'], {windowsHide: true, timeout: 15000, env: {...ambienteLimpo(), PATH: PATH_COM_LOCAL()}}, (_e, saida) => {
      try {
        const s = JSON.parse(saida);
        ok({instalado: true, logado: Boolean(s.loggedIn), metodo: String(s.authMethod ?? 'none'), email: s.email ?? s.account?.email,
          plano: s.subscriptionType ?? s.plan, chave_api: chaveApi});
      } catch {
        ok({instalado: true, logado: false, metodo: 'desconhecido', chave_api: chaveApi});
      }
    });
  });
