// Tempo de saída ↔ palavra da narração. Arrastar um bloco na linha do tempo dá um ms de saída; a âncora gravada no
// roteiro é a palavra mais próxima naquele ponto ("palavra@ms" com o início exato dela), para continuar presa à fala
// mesmo que pausas e cortes mudem.
import type {Palavra, TrechoNarracao} from '../../../nucleo/roteiro/resolver';
import {norm} from '../../../nucleo/roteiro/resolver';

/** ms de saída → ms do vídeo-fonte (null se cair numa pausa ou fora da narração). */
export const saidaParaFonte = (ms: number, trechos: TrechoNarracao[]): number | null => {
  for (const t of trechos) if (ms >= t.em && ms < t.em + (t.ate - t.de)) return t.de + (ms - t.em);
  return null;
};

/** ms do vídeo-fonte → ms de saída. */
export const fonteParaSaida = (ms: number, trechos: TrechoNarracao[]): number | null => {
  for (const t of trechos) if (ms >= t.de && ms < t.ate) return t.em + (ms - t.de);
  return null;
};

/** Âncora da palavra que começa mais perto do ms de saída dado. */
export const ancoraPerto = (msSaida: number, palavras: Palavra[], trechos: TrechoNarracao[]): {ancora: string; palavra: Palavra} | null => {
  let melhor: {d: number; p: Palavra} | null = null;
  for (const p of palavras) {
    const s = fonteParaSaida(p.s, trechos);
    if (s === null) continue;
    const d = Math.abs(s - msSaida);
    if (!melhor || d < melhor.d) melhor = {d, p};
  }
  if (!melhor) return null;
  const w = norm(melhor.p.w);
  return w ? {ancora: `${w}@${melhor.p.s}`, palavra: melhor.p} : null;
};
