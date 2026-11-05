// Ponte entre o Player da prévia e o resto da interface (linha do tempo, comentários, atalhos): um Player por vez.
import type {PlayerRef} from '@remotion/player';
import {loja} from '../../estado/loja';

export const FPS = 30;
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
  // o estado global só guarda o tempo quando a pessoa para (tocando, 30 atualizações por segundo seriam desperdício)
  p.addEventListener('pause', () => loja.definir({tempo_ms: Math.round(((p.getCurrentFrame() ?? 0) / FPS) * 1000)}));
  p.addEventListener('seeked', (e: {detail: {frame: number}}) => loja.definir({tempo_ms: Math.round((e.detail.frame / FPS) * 1000)}));
};

export const aoQuadro = (f: (ms: number) => void) => {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
};

export const irPara = (ms: number) => {
  player?.pause();
  player?.seekTo(Math.max(0, Math.round((ms / 1000) * FPS)));
  loja.definir({tempo_ms: Math.max(0, Math.round(ms))});
};

export const alternar = () => player?.toggle();
export const tocando = () => player?.isPlaying() ?? false;
export const quadroAtual = () => player?.getCurrentFrame() ?? 0;
export const andar = (quadros: number) => irPara(((quadroAtual() + quadros) / FPS) * 1000);
export const tocar = () => player?.play();
export const pausar = () => player?.pause();

export const formatarTempo = (ms: number) => {
  const q = Math.round((ms / 1000) * FPS);
  const s = Math.floor(q / FPS);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(q % FPS).padStart(2, '0')}`;
};
