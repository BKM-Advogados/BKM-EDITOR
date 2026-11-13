// Análise sonora automática de um render (F-13, parte automática): o que dá para medir sem ouvir. Espectro médio em bandas
// de 1/3 de oitava (Welch sobre src/nucleo/fft.ts), crest factor, LUFS e pico verdadeiro pelo medidor da BS.1770, pico de
// amostra e correlação estéreo. Tudo em dB arredondado, para gravar em JSON e comparar com tolerância.
import {criarFftReal, janelaHann} from '../../src/nucleo/fft';
import {medirAmostras} from '../../src/nucleo/loudness';

export const CENTROS_HZ = Array.from({length: 28}, (_, i) => Math.round(1000 * 2 ** ((i - 15) / 3) * 10) / 10); // 31,3 Hz a 16 kHz
const N_FFT = 16384; // 2,9 Hz por faixa a 48 kHz: até a banda de 31 Hz tem 2 ou 3 faixas
const PISO_DB = -120;

export type AnaliseSom = {
  duracao_s: number;
  canais: number;
  /** Nível de cada banda de 1/3 de oitava em dB, relativo à banda mais forte (0 dB = a maior). */
  bandas_db: number[];
  /** Pico de amostra em dBFS. */
  pico_amostra_db: number;
  /** Pico verdadeiro (sobreamostragem 4×) em dBTP, do medidor existente. */
  pico_dbtp: number | null;
  /** Loudness integrado em LUFS (BS.1770-4), do medidor existente. */
  lufs: number | null;
  rms_db: number;
  /** Pico de amostra menos RMS, em dB (RMS sobre todos os canais). */
  crest_db: number;
  /** Correlação de Pearson entre L e R (1 = mono, 0 = descorrelacionado, −1 = fases opostas); null se mono ou silêncio. */
  correlacao: number | null;
  /** Energia do lado (L−R) contra a do meio (L+R), em dB; null se mono. */
  lado_meio_db: number | null;
};

const db = (v: number) => (v > 0 ? Math.max(PISO_DB, 10 * Math.log10(v)) : PISO_DB);
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Espectro médio (potência por banda, Welch com Hann, média dos canais), em dB relativo à banda mais forte. */
export const espectroEmBandas = (canais: Float32Array[], taxa: number): number[] => {
  const fft = criarFftReal(N_FFT);
  const janela = janelaHann(N_FFT);
  const hop = N_FFT / 2;
  const bins = N_FFT / 2 + 1;
  const media = new Float64Array(bins);
  const quadro = new Float64Array(N_FFT);
  let quadros = 0;
  for (const x of canais) {
    for (let ini = 0; ini + N_FFT <= x.length; ini += hop) {
      let silencio = true;
      for (let i = 0; i < N_FFT; i++) {
        const v = x[ini + i];
        if (v !== 0) silencio = false;
        quadro[i] = v * janela[i];
      }
      if (silencio) continue;
      const {re, im} = fft.direta(quadro);
      for (let k = 0; k < bins; k++) media[k] += re[k] * re[k] + im[k] * im[k];
      quadros++;
    }
  }
  const porBanda = CENTROS_HZ.map((fc) => {
    const lo = fc * 2 ** (-1 / 6), hi = fc * 2 ** (1 / 6);
    let s = 0;
    for (let k = 0; k < bins; k++) {
      const f = (k * taxa) / N_FFT;
      if (f >= lo && f < hi) s += media[k];
    }
    return quadros ? s / quadros : 0;
  });
  const maior = Math.max(...porBanda);
  return porBanda.map((p) => (maior > 0 ? r1(db(p / maior)) : PISO_DB));
};

export const analisarSom = (canais: Float32Array[], taxa: number): AnaliseSom => {
  const n = canais[0].length;
  let pico = 0, soma2 = 0;
  for (const x of canais) for (let i = 0; i < n; i++) { const v = Math.abs(x[i]); if (v > pico) pico = v; soma2 += x[i] * x[i]; }
  const rms = Math.sqrt(soma2 / (n * canais.length));
  const medida = medirAmostras(canais, taxa, {pico: true});
  let correlacao: number | null = null, ladoMeio: number | null = null;
  if (canais.length >= 2) {
    const [l, r] = canais;
    let sl = 0, sr = 0, slr = 0, meio = 0, lado = 0;
    for (let i = 0; i < n; i++) {
      sl += l[i] * l[i]; sr += r[i] * r[i]; slr += l[i] * r[i];
      meio += (l[i] + r[i]) ** 2; lado += (l[i] - r[i]) ** 2;
    }
    if (sl > 0 && sr > 0) correlacao = r2(slr / Math.sqrt(sl * sr));
    if (meio > 0 || lado > 0) ladoMeio = r1(db(lado) - db(meio));
  }
  return {
    duracao_s: r2(n / taxa),
    canais: canais.length,
    bandas_db: espectroEmBandas(canais, taxa),
    pico_amostra_db: r1(db(pico * pico)),
    pico_dbtp: medida.pico_dbtp,
    lufs: medida.integrado_lufs === null ? null : r1(medida.integrado_lufs),
    rms_db: r1(db(rms * rms)),
    crest_db: r1(db(pico * pico) - db(rms * rms)),
    correlacao,
    lado_meio_db: ladoMeio,
  };
};
