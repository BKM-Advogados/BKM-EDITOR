import {interpolate, spring, useCurrentFrame, useVideoConfig, Easing} from 'remotion';

export const FPS = 30;
export const quadros = (ms: number) => Math.round((ms / 1000) * FPS);

/** Mola de entrada (0→1) a partir de `atraso` quadros. */
export const useMola = (atraso = 0, rigidez = 170, amortecimento = 16) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({frame: frame - atraso, fps, config: {stiffness: rigidez, damping: amortecimento, mass: 0.8}});
};

/** Saída suave nos últimos `n` quadros da sequência (1→0). */
export const useSaida = (duracao: number, n = 8) => {
  const frame = useCurrentFrame();
  return interpolate(frame, [duracao - n, duracao], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.in(Easing.cubic)});
};

/** Progresso linear 0→1 entre dois quadros. */
export const progresso = (frame: number, a: number, b: number, easing = Easing.out(Easing.cubic)) =>
  // b > a sempre (texto vazio dava [9, 9] e derrubava o render)
  interpolate(frame, [a, Math.max(b, a + 1)], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing});
