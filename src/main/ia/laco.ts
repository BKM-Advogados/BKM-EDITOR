// Laço de agente próprio, no processo principal, para qualquer API no formato de chat da OpenAI: OpenAI, DeepSeek,
// Gemini (endpoint compatível), OpenRouter, Mistral, xAI, Groq, Ollama, LM Studio e qualquer endereço compatível. É o
// "padrão Cline": a pessoa escolhe o provedor, põe a chave (ou não, no modelo local) e conversa. As ferramentas são só
// as do MCP estudio, pelo mesmo HTTP com token por aba que os agentes de fora usam; quem pergunta antes de uma ação
// pesada é o portão do próprio servidor, não este laço. Sem dependência nova: fetch + o cliente MCP que o app já tem.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {EventoConversa} from '../../compartilhado/api';
import {cortarResultado} from '../../compartilhado/ferramentas';

export type ConexaoOpenAI = {
  base: string; // até o /v1 (ou equivalente): https://api.deepseek.com, http://127.0.0.1:11434/v1…
  chave?: string; // ausente no modelo local
  modelo: string;
  cabecalhos?: Record<string, string>; // ex.: OpenRouter pede HTTP-Referer e X-Title
};
type Mensagem = {role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ChamadaOpenAI[]; tool_call_id?: string} & Record<string, unknown>;
type ChamadaOpenAI = {id: string; type: 'function'; function: {name: string; arguments: string}};
type FerramentaOpenAI = {type: 'function'; function: {name: string; description?: string; parameters: Record<string, unknown>}};
export type UsoTurno = {entrada: number; entrada_cache: number; saida: number};

const MAX_PASSOS = 30;

/** Lê um corpo SSE ("data: {...}") linha a linha e devolve cada objeto JSON. */
async function* lerSse(corpo: ReadableStream<Uint8Array>) {
  const leitor = corpo.getReader();
  const dec = new TextDecoder();
  let resto = '';
  for (;;) {
    const {value, done} = await leitor.read();
    if (done) break;
    resto += dec.decode(value, {stream: true});
    let i: number;
    while ((i = resto.indexOf('\n')) >= 0) {
      const linha = resto.slice(0, i).trim();
      resto = resto.slice(i + 1);
      if (!linha.startsWith('data:')) continue;
      const dado = linha.slice(5).trim();
      if (dado === '[DONE]') return;
      try {
        yield JSON.parse(dado) as Record<string, any>;
      } catch {
        /* keep-alive ou linha partida */
      }
    }
  }
}

/** Erro da API em português, sem nunca repetir a chave. */
export const erroDaApi = (status: number, corpo: string) => {
  let msg = corpo.slice(0, 300);
  try {
    const j = JSON.parse(corpo);
    msg = String(j.error?.message ?? j.message ?? msg).slice(0, 300);
  } catch {
    /* texto puro */
  }
  if (status === 401 || status === 403) return `a chave foi recusada pelo provedor (${status}): ${msg}`;
  if (status === 402) return `sem saldo no provedor (402): ${msg}`;
  if (status === 429) return `limite de uso do provedor atingido agora (429): ${msg}`;
  if (status === 404) return `endereço ou modelo não encontrado (404): ${msg}`;
  return `o provedor respondeu ${status}: ${msg}`;
};

export class LacoOpenAI {
  private historico: Mensagem[] = [];
  private cliente: Client | null = null;
  private ferramentas: FerramentaOpenAI[] = [];
  private parada: AbortController | null = null;

  constructor(private readonly o: {
    conexao: ConexaoOpenAI;
    mcp: {url: string; headers: Record<string, string>};
    sistema: string;
    evento: (e: EventoConversa) => void;
    fetch?: typeof fetch;
  }) {}

  /** Histórico sem o sistema, para guardar a conversa e voltar depois. */
  exportar() {
    return this.historico.slice();
  }

  importar(h: Mensagem[]) {
    this.historico = h.filter((m) => m.role !== 'system');
  }

  get ocupado() {
    return this.parada !== null;
  }

  get modelo() {
    return this.o.conexao.modelo;
  }

  /** O seletor de modelo da conversa: vale a partir da próxima chamada ao provedor. */
  definirModelo(modelo: string) {
    this.o.conexao.modelo = modelo;
  }

  parar() {
    this.parada?.abort();
  }

  async fechar() {
    this.parar();
    await this.cliente?.close().catch(() => undefined);
    this.cliente = null;
  }

  private async conectar() {
    if (this.cliente) return;
    const c = new Client({name: 'estudio-laco', version: '0.1.0'});
    await c.connect(new StreamableHTTPClientTransport(new URL(this.o.mcp.url), {requestInit: {headers: this.o.mcp.headers}}));
    const {tools} = await c.listTools();
    this.ferramentas = tools.map((t) => ({type: 'function', function: {name: t.name, description: t.description, parameters: t.inputSchema as Record<string, unknown>}}));
    this.cliente = c;
  }

  /** Um pedido da pessoa: chama o modelo e as ferramentas até ele responder sem pedir ferramenta. */
  async enviar(texto: string) {
    if (this.parada) throw new Error('a conversa ainda está respondendo');
    const parada = new AbortController();
    this.parada = parada;
    const inicio = Date.now();
    const total: UsoTurno = {entrada: 0, entrada_cache: 0, saida: 0};
    this.historico.push({role: 'user', content: texto});
    try {
      await this.conectar();
      this.o.evento({tipo: 'estado', estado: 'requesting'});
      for (let passo = 0; passo < MAX_PASSOS; passo++) {
        const r = await this.chamarModelo(parada.signal);
        total.entrada += r.uso?.entrada ?? 0;
        total.entrada_cache += r.uso?.entrada_cache ?? 0;
        total.saida += r.uso?.saida ?? 0;
        this.historico.push(r.mensagem);
        if (r.mensagem.content) this.o.evento({tipo: 'mensagem', texto: r.mensagem.content});
        const chamadas = r.mensagem.tool_calls ?? [];
        if (!chamadas.length) break;
        for (const ch of chamadas) {
          let entrada: Record<string, unknown> = {};
          try {
            entrada = JSON.parse(ch.function.arguments || '{}');
          } catch {
            /* argumento quebrado: vai vazio e a ferramenta reclama */
          }
          this.o.evento({tipo: 'ferramenta', uso: ch.id, nome: ch.function.name, entrada});
          const resultado = await this.chamarFerramenta(ch.function.name, entrada, parada.signal);
          this.o.evento({tipo: 'resultado', uso: ch.id, ok: resultado.ok, texto: cortarResultado(resultado.texto)});
          this.historico.push({role: 'tool', tool_call_id: ch.id, content: resultado.texto});
        }
        if (passo === MAX_PASSOS - 1) this.o.evento({tipo: 'erro', mensagem: `parei depois de ${MAX_PASSOS} passos seguidos sem resposta final`});
      }
      this.o.evento({tipo: 'uso', ...total});
      this.o.evento({tipo: 'fim', erro: false, duracao_ms: Date.now() - inicio});
    } catch (e) {
      const parou = parada.signal.aborted;
      this.o.evento({tipo: 'fim', erro: !parou, texto: parou ? 'parado' : (e as Error).message, duracao_ms: Date.now() - inicio});
    } finally {
      this.parada = null;
    }
  }

  private async chamarModelo(sinal: AbortSignal) {
    const {conexao} = this.o;
    const f = this.o.fetch ?? fetch;
    const resp = await f(`${conexao.base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: sinal,
      headers: {'Content-Type': 'application/json', ...(conexao.chave ? {Authorization: `Bearer ${conexao.chave}`} : {}), ...conexao.cabecalhos},
      body: JSON.stringify({model: conexao.modelo, stream: true, stream_options: {include_usage: true},
        messages: [{role: 'system', content: this.o.sistema}, ...this.historico],
        ...(this.ferramentas.length ? {tools: this.ferramentas} : {})}),
    });
    if (!resp.ok || !resp.body) throw new Error(erroDaApi(resp.status, await resp.text().catch(() => '')));
    let texto = '';
    let raciocinio = '';
    const extras: Record<string, unknown> = {};
    const chamadas: ChamadaOpenAI[] = [];
    let uso: UsoTurno | undefined;
    for await (const pedaco of lerSse(resp.body)) {
      if (pedaco.usage) {
        const u = pedaco.usage;
        uso = {entrada: u.prompt_tokens ?? 0, saida: u.completion_tokens ?? 0,
          entrada_cache: u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0};
      }
      const d = pedaco.choices?.[0]?.delta;
      if (!d) continue;
      if (typeof d.content === 'string' && d.content) {
        texto += d.content;
        this.o.evento({tipo: 'texto', delta: d.content});
      }
      if (typeof d.reasoning_content === 'string') raciocinio += d.reasoning_content;
      // o Gemini compatível manda a assinatura do raciocínio em extra_content; ela volta igual no turno seguinte
      if (d.extra_content) Object.assign(extras, {extra_content: d.extra_content});
      for (const t of d.tool_calls ?? []) {
        const c = (chamadas[t.index ?? 0] ??= {id: '', type: 'function', function: {name: '', arguments: ''}});
        if (t.id) c.id = t.id;
        if (t.function?.name) c.function.name += t.function.name;
        if (t.function?.arguments) c.function.arguments += t.function.arguments;
        if (t.extra_content) (c as Record<string, unknown>).extra_content = t.extra_content;
      }
    }
    const lista = chamadas.filter(Boolean).map((c, i) => ({...c, id: c.id || `chamada_${Date.now()}_${i}`}));
    // o DeepSeek exige o reasoning_content de volta em todo turno com ferramentas (02-provedores.md)
    const mensagem: Mensagem = {role: 'assistant', content: texto || null, ...(lista.length ? {tool_calls: lista} : {}),
      ...(raciocinio ? {reasoning_content: raciocinio} : {}), ...extras};
    return {mensagem, uso};
  }

  private async chamarFerramenta(nome: string, entrada: Record<string, unknown>, sinal: AbortSignal) {
    try {
      const r = (await this.cliente!.callTool({name: nome, arguments: entrada}, undefined, {signal: sinal, timeout: 15 * 60 * 1000})) as {
        isError?: boolean; content?: {type: string; text?: string}[]};
      const texto = (r.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n') || '(sem texto)';
      return {ok: !r.isError, texto};
    } catch (e) {
      if (sinal.aborted) throw e;
      return {ok: false, texto: `erro: ${(e as Error).message}`};
    }
  }
}
