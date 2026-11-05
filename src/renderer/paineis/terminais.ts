// As abas de terminal vivem fora do React: trocar de área remonta os painéis, mas o xterm de cada aba (e o que já saiu
// nele) continua; o painel só pendura o elemento da aba ativa. Renderizador DOM: o WebGL do xterm embaralha o TUI do
// Claude em algumas GPUs (o próprio /terminal-setup do Claude Code desliga a GPU no VS Code) e gastaria um contexto.
import {FitAddon} from '@xterm/addon-fit';
import {Terminal} from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import {avisar} from '../estado/loja';

export type Aba = {id: number; tipo: 'claude' | 'shell'; titulo: string; estado: 'viva' | 'hibernada' | 'saiu'; sessao?: string; el: HTMLDivElement; term: Terminal; fit: FitAddon};

const TEMA = {
  background: '#101113', foreground: '#e3e5e8', cursor: '#4f8cff', cursorAccent: '#101113', selectionBackground: 'rgba(79,140,255,0.35)',
  black: '#1f2124', red: '#ff6b6b', green: '#5fc39b', yellow: '#f2c14e', blue: '#4f8cff', magenta: '#b28cff', cyan: '#5cc8d6', white: '#d6d9dd',
  brightBlack: '#5c6370', brightRed: '#ff8787', brightGreen: '#7fd8b3', brightYellow: '#f7d47a', brightBlue: '#7aa8ff', brightMagenta: '#c8adff',
  brightCyan: '#86dbe6', brightWhite: '#ffffff',
};

let abas: Aba[] = [];
let ativa: number | null = null;
let contagem = {claude: 0, shell: 0};
const ouvintes = new Set<() => void>();
const avisarMudanca = () => {
  abas = [...abas];
  ouvintes.forEach((f) => f());
};

export const terminais = {
  abas: () => abas,
  ativa: () => ativa,
  assinar(f: () => void) {
    ouvintes.add(f);
    return () => {
      ouvintes.delete(f);
    };
  },
};

let ligado = false;
const ligar = () => {
  if (ligado) return;
  ligado = true;
  window.estudio.terminal.aoReceber((id, dados) => abas.find((a) => a.id === id)?.term.write(dados));
  window.estudio.terminal.aoSair((id, codigo) => {
    const a = abas.find((x) => x.id === id);
    if (!a) return;
    if (a.estado !== 'hibernada') {
      a.estado = 'saiu';
      a.term.write(`\r\n\x1b[90m[processo encerrado (${codigo})]\x1b[0m\r\n`);
    }
    avisarMudanca();
  });
};

const novoXterm = () => {
  const term = new Terminal({fontFamily: '"Cascadia Mono", Consolas, "SF Mono", monospace', fontSize: 13, lineHeight: 1.15, theme: TEMA, scrollback: 2000,
    cursorBlink: true, allowTransparency: false, macOptionIsMeta: true});
  const fit = new FitAddon();
  term.loadAddon(fit);
  const el = document.createElement('div');
  el.className = 'xterm-host';
  term.open(el);
  return {term, fit, el};
};

const ligarEntrada = (a: Aba) => {
  a.term.onData((d) => a.estado === 'viva' && window.estudio.terminal.escrever(a.id, d));
};

export const abrirAba = async (tipo: 'claude' | 'shell', colunas = 100, linhas = 24) => {
  ligar();
  try {
    const r = await window.estudio.terminal.criar({tipo, colunas, linhas});
    contagem[tipo] += 1;
    const {term, fit, el} = novoXterm();
    const a: Aba = {id: r.id, tipo, titulo: tipo === 'claude' ? `Claude ${contagem.claude}` : `Terminal ${contagem.shell}`, estado: 'viva', sessao: r.sessao, el, term, fit};
    ligarEntrada(a);
    abas.push(a);
    ativa = a.id;
    avisarMudanca();
    return a;
  } catch (e) {
    avisar(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'erro');
    return null;
  }
};

/** Encerra o processo do Claude e guarda a sessão; retomar abre de novo com --resume. */
export const hibernar = (id: number) => {
  const a = abas.find((x) => x.id === id);
  if (!a || a.tipo !== 'claude' || a.estado !== 'viva') return;
  a.estado = 'hibernada';
  window.estudio.terminal.fechar(id);
  a.term.write('\r\n\x1b[90m[hibernada: a memória foi liberada; clique em Retomar para voltar à mesma conversa]\x1b[0m\r\n');
  avisarMudanca();
};

export const retomar = async (id: number) => {
  const a = abas.find((x) => x.id === id);
  if (!a?.sessao) return;
  try {
    const r = await window.estudio.terminal.criar({tipo: 'claude', colunas: a.term.cols, linhas: a.term.rows, sessao: a.sessao});
    a.id = r.id;
    a.estado = 'viva';
    ativa = r.id;
    a.term.reset();
    avisarMudanca();
  } catch (e) {
    avisar(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'erro');
  }
};

export const fecharAba = (id: number) => {
  const a = abas.find((x) => x.id === id);
  if (!a) return;
  if (a.estado === 'viva') window.estudio.terminal.fechar(id);
  a.term.dispose();
  abas = abas.filter((x) => x !== a);
  if (ativa === id) ativa = abas[abas.length - 1]?.id ?? null;
  avisarMudanca();
};

export const ativar = (id: number) => {
  ativa = id;
  avisarMudanca();
};

/** Ajusta o xterm ativo ao tamanho do painel e avisa o PTY. */
export const ajustar = () => {
  const a = abas.find((x) => x.id === ativa);
  if (!a || !a.el.isConnected) return;
  try {
    a.fit.fit();
  } catch {
    return;
  }
  if (a.estado === 'viva') window.estudio.terminal.tamanho(a.id, a.term.cols, a.term.rows);
};

/** Manda um texto para a aba ativa (ex.: "resolva o comentário cmt_0003"), como se fosse colado. */
export const enviarParaAtiva = (texto: string) => {
  const a = abas.find((x) => x.id === ativa && x.estado === 'viva');
  if (!a) return false;
  window.estudio.terminal.escrever(a.id, `\x1b[200~${texto}\x1b[201~`);
  a.term.focus();
  return true;
};
