// As abas de terminal vivem fora do React: trocar de área remonta os painéis, mas o xterm de cada aba (e o que já saiu
// nele) continua; o painel só pendura o elemento da aba ativa. Renderizador DOM: o WebGL do xterm embaralha o TUI do
// Claude em algumas GPUs (o próprio /terminal-setup do Claude Code desliga a GPU no VS Code) e gastaria um contexto.
import {FitAddon} from '@xterm/addon-fit';
import {Terminal} from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import {avisar} from '../estado/loja';
import {preencher} from './conversas';

export type Aba = {id: number; tipo: 'claude' | 'shell'; titulo: string; estado: 'viva' | 'hibernada' | 'saiu'; sessao?: string; el: HTMLDivElement; term: Terminal; fit: FitAddon};

// as 16 cores saem dos mesmos tokens da interface (grafite e sinal): azul = seleção, magenta = agente, amarelo = comentário.
// O Claude Code só usa essa paleta no tema dark-ansi dele; nos outros temas ele pinta com as próprias cores.
const TEMA = {
  background: '#1a1a1a', foreground: '#eeeeee', cursor: '#70b8ff', cursorAccent: '#1a1a1a', selectionBackground: 'rgba(112,184,255,0.28)',
  black: '#1a1a1a', red: '#ff9592', green: '#3dd68c', yellow: '#ffca16', blue: '#70b8ff', magenta: '#baa7ff', cyan: '#7ce2fe', white: '#b4b4b4',
  brightBlack: '#8a8a8a', brightRed: '#ffb4b1', brightGreen: '#74e3ac', brightYellow: '#ffdc5c', brightBlue: '#9ccdff', brightMagenta: '#d2c6ff',
  brightCyan: '#a6ecff', brightWhite: '#eeeeee',
};
const FONTE = '"JetBrains Mono", "Cascadia Mono", Consolas, monospace';
const tamanhoFonte = () => (window.innerWidth < 1600 || window.innerHeight < 800 ? 12 : 13);
// a grade do xterm é medida com a fonte: carregar antes de abrir, senão mede com a de reserva e desalinha
const fonteCarregada = Promise.all([document.fonts.load(`13px ${FONTE}`), document.fonts.load(`600 13px ${FONTE}`)]).catch(() => undefined);

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
  const term = new Terminal({fontFamily: FONTE, fontSize: tamanhoFonte(), lineHeight: 1.2, fontWeightBold: 600, minimumContrastRatio: 4.5, theme: TEMA,
    scrollback: 2000, cursorBlink: true, cursorInactiveStyle: 'outline', allowTransparency: false, macOptionIsMeta: true});
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

export const abrirAba = async (tipo: 'claude' | 'shell', colunas = 100, linhas = 24, sessao?: string, titulo?: string) => {
  ligar();
  try {
    await fonteCarregada;
    const r = await window.estudio.terminal.criar({tipo, colunas, linhas, sessao});
    contagem[tipo] += 1;
    const {term, fit, el} = novoXterm();
    const a: Aba = {id: r.id, tipo, titulo: titulo ?? (tipo === 'claude' ? `Claude ${contagem.claude} · terminal` : `Terminal ${contagem.shell}`), estado: 'viva', sessao: r.sessao, el, term, fit};
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

/** Abre no terminal uma conversa que já existe (claude --resume): o "Ver no terminal" da conversa. */
export const abrirClaudeNaSessao = (sessao: string, titulo: string) => abrirAba('claude', 100, 24, sessao, titulo);

/** Fecha o terminal que estiver com esta sessão aberta: a conversa vai continuar dela e não pode haver dois escrevendo. */
export const fecharClaudeDaSessao = (sessao: string) => {
  for (const a of abas.filter((x) => x.tipo === 'claude' && x.sessao === sessao && x.estado === 'viva')) fecharAba(a.id);
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

/** Ajusta o xterm ativo ao tamanho do painel (e a fonte à faixa de tela) e avisa o PTY. */
export const ajustar = () => {
  const a = abas.find((x) => x.id === ativa);
  if (!a || !a.el.isConnected) return;
  if (a.term.options.fontSize !== tamanhoFonte()) a.term.options.fontSize = tamanhoFonte();
  try {
    a.fit.fit();
  } catch {
    return;
  }
  if (a.estado === 'viva') window.estudio.terminal.tamanho(a.id, a.term.cols, a.term.rows);
};

/** Manda um texto para a aba ativa (ex.: "resolva o comentário cmt_0003"), como se fosse colado. */
export const enviarParaAtiva = (texto: string) => {
  if (preencher(texto)) return true; // com uma conversa na frente, o pedido vai para a caixa dela
  const a = abas.find((x) => x.id === ativa && x.estado === 'viva');
  if (!a) return false;
  window.estudio.terminal.escrever(a.id, `\x1b[200~${texto}\x1b[201~`);
  a.term.focus();
  return true;
};
