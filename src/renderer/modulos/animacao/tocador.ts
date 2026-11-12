// Tocador e controle de tempo para o módulo Animação (Remotion Player)
import type {PlayerRef} from "@remotion/player";
import {loja} from "../../estado/loja";
import {fatoDoEditor} from "../../estado/primeiros-passos";

export let FPS = 30;
export const definirFps = (fps: number) => {
  if (Number.isFinite(fps) && fps > 0) FPS = fps;
};

let player: PlayerRef | null = null;
const ouvintes = new Set<(ms: number) => void>();

export type ControleAnimacao = {
  tocando: boolean;
  repetir: boolean;
};

let controle: ControleAnimacao = {tocando: false, repetir: true};
const ouvintesControle = new Set<(c: ControleAnimacao) => void>();
const avisarControle = () => ouvintesControle.forEach((f) => f(controle));

export const assinarControle = (f: (c: ControleAnimacao) => void) => {
  ouvintesControle.add(f);
  f(controle);
  return () => {
    ouvintesControle.delete(f);
  };
};

export const registrarPlayer = (p: PlayerRef | null) => {
  player = p;
  if (!p) return;
  const onFrame = (e: {detail: {frame: number}}) => {
    const ms = (e.detail.frame / FPS) * 1000;
    ouvintes.forEach((f) => f(ms));
  };
  p.addEventListener("frameupdate", onFrame);
  p.addEventListener("play", () => {
    fatoDoEditor("tocou"); // primeiros passos: "tocar a prévia"
    controle = {...controle, tocando: true};
    avisarControle();
  });
  p.addEventListener("pause", () => {
    controle = {...controle, tocando: false};
    avisarControle();
    loja.definir({tempo_ms: Math.round(((p.getCurrentFrame() ?? 0) / FPS) * 1000)});
  });
  p.addEventListener("seeked", (e: {detail: {frame: number}}) => {
    loja.definir({tempo_ms: Math.round((e.detail.frame / FPS) * 1000)});
  });
};

export const aoQuadro = (f: (ms: number) => void) => {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
};

export const msAtual = (): number => {
  if (!player) return loja.get().tempo_ms ?? 0;
  return Math.round(((player.getCurrentFrame() ?? 0) / FPS) * 1000);
};

export const tocando = () => Boolean(player?.isPlaying());

export const parar = () => player?.pause();
export const tocar = () => player?.play();
export const alternar = () => (player?.isPlaying() ? parar() : tocar());
export const alternarRepetir = () => {
  controle = {...controle, repetir: !controle.repetir};
  avisarControle();
};

export const irPara = (ms: number) => {
  const frame = Math.max(0, Math.round((ms / 1000) * FPS));
  if (player) {
    player.seekTo(frame);
  }
  loja.definir({tempo_ms: Math.round(ms)});
};

export const formatarTempo = (ms: number): string => {
  const totSeg = Math.max(0, ms / 1000);
  const m = Math.floor(totSeg / 60);
  const s = Math.floor(totSeg % 60);
  const f = Math.floor((totSeg % 1) * FPS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(m)}:${pad(s)}:${pad(f)}`;
};
