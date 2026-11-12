// Ponte entre o Player da prévia e o resto da interface (linha do tempo, comentários, atalhos): um Player por vez.
// O tempo que muda a cada quadro não passa pelo React (desempenho.md §4.2): quem precisa dele assina aoQuadro e
// escreve no DOM por ref. A taxa (shuttle J/K/L) e o repetir são estado pequeno, com assinatura própria.
import type {PlayerRef} from '@remotion/player';
import {avisar, loja} from '../../estado/loja';
import {fatoDoEditor} from '../../estado/primeiros-passos';

// quadros por segundo do vídeo aberto (o monitor troca ao abrir um vídeo de outro formato); o carrossel é 30
export let FPS = 30;
export const definirFps = (fps: number) => {
  if (Number.isFinite(fps) && fps > 0) FPS = fps;
};
let player: PlayerRef | null = null;
const ouvintes = new Set<(ms: number) => void>();

export const registrarPlayer = (p: PlayerRef | null) => {
  player = p;
  if (!p) return;
  const aoQuadro = (e: {detail: {frame: number}}) => {
    const ms = (e.detail.frame / FPS) * 1000;
    ouvintes.forEach((f) => f(ms));
  };
  p.addEventListener('frameupdate', aoQuadro);
  p.addEventListener('play', () => fatoDoEditor('tocou')); // primeiros passos: "tocar a prévia"
  // o estado global só guarda o tempo quando a pessoa para (tocando, 30 atualizações por segundo seriam desperdício)
  p.addEventListener('pause', () => {
    loja.definir({tempo_ms: Math.round(((p.getCurrentFrame() ?? 0) / FPS) * 1000)});
    if (taxaAtual !== 1) mudarControle({taxa: 1});
  });
  p.addEventListener('seeked', (e: {detail: {frame: number}}) => loja.definir({tempo_ms: Math.round((e.detail.frame / FPS) * 1000)}));
};

export const aoQuadro = (f: (ms: number) => void) => {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
};

/** Tempo atual em ms (o do quadro na tela, não o guardado na loja). */
export const msAtual = () => (player ? ((player.getCurrentFrame() ?? 0) / FPS) * 1000 : loja.get().tempo_ms);

export const irPara = (ms: number) => {
  player?.pause();
  player?.seekTo(Math.max(0, Math.round((ms / 1000) * FPS)));
  loja.definir({tempo_ms: Math.max(0, Math.round(ms))});
};

export const tocando = () => player?.isPlaying() ?? false;
export const quadroAtual = () => player?.getCurrentFrame() ?? 0;
export const andar = (quadros: number) => irPara(((quadroAtual() + quadros) / FPS) * 1000);
export const pausar = () => player?.pause();

// ---------- taxa (shuttle) e repetir ----------
let taxaAtual = 1;
let repetirAtual = false;
let controle = {taxa: 1, repetir: false};
const ouvintesControle = new Set<() => void>();
const mudarControle = (p: Partial<typeof controle>) => {
  taxaAtual = p.taxa ?? taxaAtual;
  repetirAtual = p.repetir ?? repetirAtual;
  controle = {taxa: taxaAtual, repetir: repetirAtual};
  ouvintesControle.forEach((f) => f());
};
export const assinarControle = (f: () => void) => {
  ouvintesControle.add(f);
  return () => {
    ouvintesControle.delete(f);
  };
};
export const lerControle = () => controle;

/** Espaço: toca a 1× ou pausa. */
export const alternar = () => {
  if (tocando()) return void player?.pause();
  if (taxaAtual !== 1) mudarControle({taxa: 1});
  void player?.play();
};
export const tocar = () => {
  if (taxaAtual !== 1) mudarControle({taxa: 1});
  void player?.play();
};

let avisouTras = false;
/** J/L: toca para trás ou para frente; tocar de novo no mesmo sentido acelera (1×, 2×, 4×). */
export const shuttle = (sentido: 1 | -1) => {
  const mesmo = tocando() && Math.sign(taxaAtual) === sentido;
  const taxa = mesmo ? Math.max(-4, Math.min(4, taxaAtual * 2)) : sentido;
  if (sentido < 0 && !avisouTras) {
    avisouTras = true;
    avisar('Tocando para trás: sem som. K para.', 'info');
  }
  mudarControle({taxa});
  // a taxa nova chega ao Player pelo prop no próximo render; o play espera esse quadro
  requestAnimationFrame(() => void player?.play());
};
/** K: para e volta a 1×. */
export const parar = () => {
  player?.pause();
  if (taxaAtual !== 1) mudarControle({taxa: 1});
};
export const alternarRepetir = () => mudarControle({repetir: !repetirAtual});

/** HH:MM:SS:QQ (quadro no fps do vídeo), como no Premiere e no Resolve. */
export const formatarTempo = (ms: number) => {
  const q = Math.round((Math.max(0, ms) / 1000) * FPS);
  const s = Math.floor(q / FPS);
  const d = (n: number) => String(n).padStart(2, '0');
  return `${d(Math.floor(s / 3600))}:${d(Math.floor(s / 60) % 60)}:${d(s % 60)}:${d(q % FPS)}`;
};
/** Duração curta: "1:20". */
export const formatarCurto = (ms: number) => {
  const s = Math.round(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
