// Todas as conversas com IA do projeto aberto, de qualquer provedor, atrás de uma interface só: o painel abre, manda,
// permite, para, hiberna e fecha sem saber quem responde. Três vias (provedores.ts): o Claude Code da pessoa
// (conversa.ts, sem mudança), o laço próprio no formato da OpenAI (laco.ts) e os agentes ACP (motor-acp.ts). Os ids
// são do app; cada via guarda os seus por dentro. Os eventos saem iguais (EventoConversa).
import {execFile} from 'node:child_process';
import type {EventoConversa} from '../../compartilhado/api';
import {Conversas} from '../conversa';
import {acharChave, type Cofre} from './chaves';
import {LacoOpenAI} from './laco';
import {SessaoAcp} from './motor-acp';
import {custoEstimado, type UsoTokens} from './precos';
import {provedor as acharProvedor, type Provedor} from './provedores';

type Conexao = {arquivo: string; url: string; headers: Record<string, string>};

type Item =
  | {via: 'claude-cli'; provedor: Provedor; interno: number; sessao: string}
  | {via: 'openai'; provedor: Provedor; laco: LacoOpenAI; sessao: string; modelo: string; pronto: boolean}
  | {via: 'acp'; provedor: Provedor; acp: SessaoAcp; sessao: string};

export type OpcoesSessoes = {
  evento: (id: number, e: EventoConversa) => void;
  claude: Omit<ConstructorParameters<typeof Conversas>[0], 'evento' | 'vivas'>;
  vivasTerminal: () => number; // abas de terminal com agente vivo, que contam no mesmo limite
  cofre: Cofre;
  sistema: (cwd: string) => string;
  conexao: (origem: string) => Conexao; // token novo do MCP estudio para a aba (mcp-http.ts)
  ambiente: () => Record<string, string>; // ambiente limpo para os agentes
  acharExe?: (nome: string) => Promise<{arquivo: string; shell: boolean; prefixo?: string[]} | null>; // prefixo: o teste roda um agente falso com o node
  fetch?: typeof fetch;
  config?: (provedor: string) => {modelo?: string; base?: string}; // o que a pessoa escolheu em Configurações › IA
  aoUso?: (provedor: string, modelo: string, u: UsoTokens, custo_usd?: number) => void; // soma do mês
};

/** Executável no PATH, aceitando o .cmd que o npm cria no Windows. */
export const acharExecutavel = (nome: string, ambiente: NodeJS.ProcessEnv = process.env): Promise<{arquivo: string; shell: boolean} | null> =>
  new Promise((ok) => {
    const windows = process.platform === 'win32';
    execFile(windows ? 'where' : 'which', [nome], {windowsHide: true, env: ambiente}, (e, saida) => {
      if (e) return ok(null);
      const linhas = saida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (!windows) return ok(linhas[0] ? {arquivo: linhas[0], shell: false} : null);
      const exe = linhas.find((l) => /\.exe$/i.test(l));
      if (exe) return ok({arquivo: exe, shell: false});
      const cmd = linhas.find((l) => /\.(cmd|bat)$/i.test(l));
      ok(cmd ? {arquivo: cmd, shell: true} : null);
    });
  });

export class SessoesIA {
  private itens = new Map<number, Item>();
  private proximo = 1;
  private contagem = new Map<string, number>();
  private readonly claude: Conversas;
  private readonly doInterno = new Map<number, number>(); // id do Conversas → id do app

  constructor(private readonly o: OpcoesSessoes) {
    this.claude = new Conversas({...o.claude, vivas: () => o.vivasTerminal() + this.vivasAcp(),
      evento: (interno, e) => {
        const id = this.doInterno.get(interno);
        if (id !== undefined) o.evento(id, e);
      }});
  }

  /** Processos de agente vivos (Claude e ACP): contam no limite do perfil de RAM. O laço próprio não sobe processo. */
  vivas() {
    return this.claude.vivas() + this.vivasAcp();
  }

  private vivasAcp() {
    return [...this.itens.values()].filter((i) => i.via === 'acp' && i.acp.vivo()).length;
  }

  /** Nome curto para o título e para o diário: "DeepSeek 1", "Claude 2". As abas de terminal usam a mesma conta. */
  novoRotulo(provedorId: string) {
    const p = acharProvedor(provedorId);
    const n = (this.contagem.get(provedorId) ?? 0) + 1;
    this.contagem.set(provedorId, n);
    const curto = (p?.nome ?? provedorId).replace(/\s*\(.*\)$/, '');
    return `${curto} ${n}`;
  }

  abrir(o: {cwd: string; provedor?: string; sessao?: string; modelo?: string; base?: string}) {
    const p = acharProvedor(o.provedor ?? 'claude');
    if (!p) throw new Error(`provedor desconhecido: ${o.provedor}`);
    const id = this.proximo++;
    const rotulo = this.novoRotulo(p.id);
    const conexao = this.o.conexao(rotulo);
    if (p.via === 'claude-cli') {
      const r = this.claude.abrir({cwd: o.cwd, sessao: o.sessao, arquivoMcp: conexao.arquivo});
      this.doInterno.set(r.id, id);
      this.itens.set(id, {via: 'claude-cli', provedor: p, interno: r.id, sessao: r.sessao});
      return {id, sessao: r.sessao, provedor: p.id, rotulo};
    }
    if (p.via === 'openai') {
      const cfg = this.o.config?.(p.id) ?? {};
      const base = o.base ?? cfg.base ?? p.base;
      const modelo = o.modelo ?? cfg.modelo ?? p.modelo;
      if (!base) throw new Error('falta o endereço deste provedor (Configurações › IA)');
      if (!modelo) throw new Error('falta escolher o modelo deste provedor (Configurações › IA)');
      const {chave} = acharChave(this.o.cofre, p.id);
      if (p.chave === 'exigida' && !chave) throw new Error(`falta a chave do ${p.nome} (Configurações › IA)`);
      const laco = new LacoOpenAI({conexao: {base, chave, modelo, cabecalhos: p.cabecalhos}, mcp: {url: conexao.url, headers: conexao.headers},
        sistema: this.o.sistema(o.cwd), evento: (e) => this.doLaco(id, e), fetch: this.o.fetch});
      const sessao = o.sessao ?? `${p.id}-${Date.now().toString(36)}-${id}`;
      this.itens.set(id, {via: 'openai', provedor: p, laco, sessao, modelo, pronto: false});
      return {id, sessao, provedor: p.id, rotulo};
    }
    const acharExe: NonNullable<OpcoesSessoes['acharExe']> = this.o.acharExe ?? ((n: string) => acharExecutavel(n, this.o.ambiente()));
    // o agente é o da pessoa, com o login e a configuração dela: o app não injeta chave nem troca o modelo dele
    const acp = new SessaoAcp({
      cwd: o.cwd,
      mcp: {url: conexao.url, headers: conexao.headers},
      ambiente: this.o.ambiente(),
      evento: (e) => {
        if (e.tipo === 'uso' && e.custo_usd) this.o.aoUso?.(p.id, '', {entrada: 0, entrada_cache: 0, saida: 0}, e.custo_usd);
        this.o.evento(id, e);
      },
      comando: async () => {
        const exe = await acharExe(p.exe!);
        return exe ? {arquivo: exe.arquivo, args: [...(exe.prefixo ?? []), ...(p.args ?? [])], shell: exe.shell} : null;
      },
    });
    this.itens.set(id, {via: 'acp', provedor: p, acp, sessao: acp.sessao});
    return {id, sessao: acp.sessao, provedor: p.id, rotulo};
  }

  /** Eventos do laço próprio: o uso de tokens ganha o custo estimado pela tabela e vai para a soma do mês. */
  private doLaco(id: number, e: EventoConversa) {
    const i = this.itens.get(id);
    if (e.tipo === 'uso' && i?.via === 'openai') {
      const c = custoEstimado(i.provedor.id, i.laco.modelo, e);
      this.o.aoUso?.(i.provedor.id, i.laco.modelo, e, c?.usd);
      this.o.evento(id, c ? {...e, custo_usd: c.usd} : e);
      return;
    }
    this.o.evento(id, e);
  }

  /** Seletor de modelo da conversa: vale na próxima mensagem. Agente ACP usa o modelo da configuração dele. */
  definirModelo(id: number, modelo?: string) {
    const i = this.item(id);
    if (i.via === 'claude-cli') return this.claude.definirModelo(i.interno, modelo);
    if (i.via === 'acp') throw new Error('este agente usa o modelo da configuração dele');
    if (!modelo) return;
    i.laco.definirModelo(modelo);
    i.modelo = modelo;
    if (i.pronto) this.o.evento(id, {tipo: 'pronto', sessao: i.sessao, modelo});
  }

  private item(id: number) {
    const i = this.itens.get(id);
    if (!i) throw new Error('conversa encerrada');
    return i;
  }

  enviar(id: number, texto: string, limite: number) {
    const i = this.item(id);
    if (i.via === 'claude-cli') return this.claude.enviar(i.interno, texto, limite);
    if (i.via === 'openai') {
      if (!i.pronto) {
        i.pronto = true;
        this.o.evento(id, {tipo: 'pronto', sessao: i.sessao, modelo: i.modelo});
      }
      void i.laco.enviar(texto);
      return;
    }
    if (!i.acp.vivo() && this.vivas() + this.o.vivasTerminal() >= limite) throw new Error(`limite de ${limite} agentes abertos neste PC; hiberne um para continuar`);
    void i.acp.enviar(texto);
  }

  permitir(id: number, pedido: string, decisao: 'permitir' | 'negar', sempre = false) {
    const i = this.itens.get(id);
    if (i?.via === 'claude-cli') this.claude.permitir(i.interno, pedido, decisao, sempre);
    else if (i?.via === 'acp') i.acp.permitir(pedido, decisao, sempre);
  }

  parar(id: number) {
    const i = this.itens.get(id);
    if (i?.via === 'claude-cli') this.claude.parar(i.interno);
    else if (i?.via === 'openai') i.laco.parar();
    else if (i?.via === 'acp') i.acp.parar();
  }

  hibernar(id: number) {
    const i = this.itens.get(id);
    if (!i) return null;
    if (i.via === 'claude-cli') return this.claude.hibernar(i.interno);
    if (i.via === 'acp') return i.acp.hibernar();
    return i.sessao; // o laço não tem processo: guarda o histórico em memória
  }

  fechar(id: number) {
    const i = this.itens.get(id);
    if (!i) return;
    this.itens.delete(id);
    if (i.via === 'claude-cli') {
      this.claude.fechar(i.interno);
      this.doInterno.delete(i.interno);
    } else if (i.via === 'openai') void i.laco.fechar();
    else i.acp.fechar();
  }

  fecharTodas() {
    for (const id of [...this.itens.keys()]) this.fechar(id);
    this.contagem.clear();
  }
}
