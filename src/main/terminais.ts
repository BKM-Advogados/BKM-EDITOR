// Terminais embutidos: um pseudo-terminal (node-pty) por aba, na pasta do projeto. A aba "claude" roda o Claude Code
// instalado da própria pessoa direto no PTY (sem shell no meio, que custaria memória à toa), com o MCP do projeto e um
// id de sessão dado pelo app: a aba pode hibernar (encerra o processo) e voltar com --resume. O login é o dela, pelo
// fluxo da Anthropic. Os dados vão à interface por IPC em lotes curtos, para não inundar o renderer.
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import type {IPty} from '@lydell/node-pty';
import {caminhoDeBusca, comPath, shellPadrao} from './plataforma';

type Saida = {dados: (id: number, d: string) => void; saiu: (id: number, codigo: number) => void};
type Aba = {pty: IPty; buffer: string; timer: NodeJS.Timeout | null; claude: boolean};

/** O PATH da pessoa com as pastas onde o Claude Code e o Homebrew costumam ficar (plataforma.ts): aberto pelo Finder,
 *  pelo menu Iniciar ou pelo lançador, o app recebe um PATH curto, sem ~/.local/bin nem /opt/homebrew/bin. */
export const PATH_COM_LOCAL = () => caminhoDeBusca({plataforma: process.platform, PATH: process.env.PATH, home: os.homedir(), env: process.env});

/** O shell da conta (o de login no Mac e no Linux), quando o SHELL não vem no ambiente. */
const shellDaConta = () => {
  try {
    return os.userInfo().shell;
  } catch {
    return null;
  }
};

// O app pode ter sido aberto de dentro de outra sessão do Claude Code (app desktop, terminal do VS Code). As marcas
// daquela sessão não podem vazar para a aba: o Claude dela tem login e sessão próprios (com elas, ele tenta renovar o
// login pelo "host" e acusa login expirado). CLAUDE_CONFIG_DIR e ANTHROPIC_API_KEY são da pessoa e ficam.
export const ambienteLimpo = (base: NodeJS.ProcessEnv = process.env): Record<string, string> => {
  const herdado = base.CLAUDECODE === '1';
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    if (/^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PID$|CLAUDE_EFFORT$|CLAUDE_PREVIEW_)/.test(k)) continue;
    if (herdado && /^(MCP_SERVER_CONNECTION_BATCH_SIZE|MCP_CONNECTION_NONBLOCKING|ANTHROPIC_BASE_URL)$/.test(k)) continue;
    e[k] = v;
  }
  return e;
};

/** Caminho do executável do Claude Code, ou null se não estiver instalado. No Windows, prefere o .exe do instalador
 *  oficial e aceita o claude.cmd que o npm cria (transversal-D22). */
export const acharClaude = (): Promise<string | null> =>
  new Promise((ok) => {
    execFile(process.platform === 'win32' ? 'where' : 'which', ['claude'], {windowsHide: true, env: {...process.env, PATH: PATH_COM_LOCAL()}}, (e, saida) => {
      if (e) return ok(null);
      const linhas = saida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (process.platform !== 'win32') return ok(linhas[0] ?? null);
      ok(linhas.find((l) => /\.exe$/i.test(l)) ?? linhas.find((l) => /\.cmd$/i.test(l)) ?? null);
    });
  });

/** O .cmd do npm só roda pelo cmd.exe. */
export const ehCmd = (exe: string) => process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe);
/** Argumento para a linha do cmd.exe: entre aspas quando tem espaço ou caractere especial (caminho com espaço). */
export const citarCmd = (a: string) => (/[\s&|<>^()"]/.test(a) ? `"${a.replace(/"/g, '')}"` : a);

export class Terminais {
  private abas = new Map<number, Aba>();
  private proximo = 1;
  private claude: string | null = null;

  constructor(private readonly saida: Saida) {}

  async preparar() {
    this.claude = await acharClaude();
    return this.claude !== null;
  }

  /** Executável do Claude Code achado em preparar(), ou null. */
  get caminhoClaude() {
    return this.claude;
  }

  /** Abas do Claude com processo vivo. */
  vivas() {
    return [...this.abas.values()].filter((a) => a.claude).length;
  }

  // outrasVivas: conversas do Claude abertas fora do terminal, que contam no mesmo limite do perfil de RAM
  async criar(o: {tipo: 'claude' | 'shell'; colunas: number; linhas: number; cwd: string; arquivoMcp?: string; sessao?: string; limiteClaude: number; outrasVivas?: number}) {
    const pty = await import('@lydell/node-pty');
    let arquivo: string;
    let args: string[];
    let sessao: string | undefined;
    if (o.tipo === 'claude') {
      if (!this.claude) throw new Error('o Claude Code não está instalado nesta máquina (claude.ai/install)');
      if (this.vivas() + (o.outrasVivas ?? 0) >= o.limiteClaude) throw new Error(`limite de ${o.limiteClaude} sessões do Claude abertas neste PC; hiberne uma aba para abrir outra`);
      sessao = o.sessao ?? randomUUID();
      arquivo = this.claude;
      // as ferramentas do projeto (MCP estudio) ficam liberadas: só mexem nos JSON do projeto, com diário e desfazer
      args = [...(o.sessao ? ['--resume', sessao] : ['--session-id', sessao]), ...(o.arquivoMcp ? ['--mcp-config', o.arquivoMcp, '--allowedTools', 'mcp__estudio'] : [])];
    } else {
      // PowerShell no Windows; o shell da pessoa no Mac (zsh) e no Linux, como shell de login (plataforma.ts)
      ({arquivo, args} = shellPadrao(process.platform, process.env, shellDaConta()));
    }
    // claude.cmd do npm (transversal-D22): pelo cmd.exe, com a linha montada à mão (no Windows o node-pty aceita a linha pronta)
    const viaCmd = o.tipo === 'claude' && ehCmd(arquivo);
    const p = pty.spawn(viaCmd ? 'cmd.exe' : arquivo, viaCmd ? `/d /s /c ""${arquivo}" ${args.map(citarCmd).join(' ')}"` : args, {
      name: 'xterm-256color',
      cols: Math.max(20, o.colunas),
      rows: Math.max(5, o.linhas),
      cwd: o.cwd,
      // comPath: no Windows a chave é "Path", e um "PATH" ao lado dela deixava o PowerShell com o PATH antigo
      env: {...comPath(ambienteLimpo(), PATH_COM_LOCAL(), process.platform), TERM: 'xterm-256color', COLORTERM: 'truecolor', ESTUDIO_PROJETO: o.cwd},
    });
    const id = this.proximo++;
    const aba: Aba = {pty: p, buffer: '', timer: null, claude: o.tipo === 'claude'};
    this.abas.set(id, aba);
    p.onData((d) => {
      aba.buffer += d;
      aba.timer ??= setTimeout(() => {
        aba.timer = null;
        const b = aba.buffer;
        aba.buffer = '';
        this.saida.dados(id, b);
      }, 8);
    });
    p.onExit(({exitCode}) => {
      this.abas.delete(id);
      this.saida.saiu(id, exitCode);
    });
    return {id, sessao};
  }

  escrever(id: number, dados: string) {
    this.abas.get(id)?.pty.write(dados);
  }

  tamanho(id: number, colunas: number, linhas: number) {
    try {
      this.abas.get(id)?.pty.resize(Math.max(20, colunas), Math.max(5, linhas));
    } catch {
      /* a aba pode ter acabado de fechar */
    }
  }

  fechar(id: number) {
    const a = this.abas.get(id);
    if (!a) return;
    this.abas.delete(id);
    try {
      a.pty.kill();
    } catch {
      /* já saiu */
    }
  }

  fecharTodos() {
    for (const id of [...this.abas.keys()]) this.fechar(id);
  }
}
