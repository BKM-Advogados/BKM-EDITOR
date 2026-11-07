// Limpeza de voz, pura (sem disco e sem modelo): corte de graves (passa-altas Butterworth, ida e volta), redução de ruído
// por porta espectral, de-esser leve e corte de chiado (passa-baixas). A porta espectral é a técnica clássica dos
// redutores de ruído estacionário: a STFT (janela de ~43 ms, 75 % de sobreposição) mede o espectro do ruído nas pausas
// (os 10 % de quadros mais quietos) e, quadro a quadro, cada faixa de frequência que não passa de `margem_db` acima do
// ruído cai até `reducao_db`, com a máscara suavizada na frequência e soltura de 80 ms no tempo (menos "ruído musical" e
// sem cortar o fim das palavras). O de-esser olha a fração de energia de 4,5 a 10 kHz em cada quadro e baixa só essa
// faixa quando ela domina (o "s" e o "ch"), até `deesser_db`. O tamanho e o alinhamento do arquivo não mudam: o clipe
// limpo continua com o mesmo corte e a mesma duração. O processo principal (src/main/limpeza-voz.ts) decodifica com o
// ffmpeg do Remotion, chama `limparVoz` e grava midia/<arquivo>.limpo.wav.
import {envelopeDeAmostras, referenciaDeJanelas, SILENCIO_DB, type Biquad, type Envelope, type IntensidadeLimpeza, type LimpezaClipe} from './audio';

export type ParametrosLimpeza = {nome: string; reducao_db: number; margem_db: number; deesser_db: number; graves_hz: number; chiado_hz: number};

export const INTENSIDADES: Record<IntensidadeLimpeza, ParametrosLimpeza> = {
  leve: {nome: 'Leve', reducao_db: 10, margem_db: 4, deesser_db: 3, graves_hz: 70, chiado_hz: 14000},
  media: {nome: 'Média', reducao_db: 16, margem_db: 6, deesser_db: 5, graves_hz: 80, chiado_hz: 12000},
  forte: {nome: 'Forte', reducao_db: 24, margem_db: 8, deesser_db: 6, graves_hz: 100, chiado_hz: 10000},
};
export const INTENSIDADE_PADRAO: IntensidadeLimpeza = 'media';

const FRACAO_PAUSAS = 0.1; // os 10 % de quadros (ou janelas) mais quietos são o ruído de fundo
const MIN_QUADROS_RUIDO = 12;
const SOLTURA_MS = 80;
const JOELHO_DB = 6; // a máscara vai de 0 a 1 em 6 dB em volta da margem
const SUAVIZAR_BINS = 2; // ±2 faixas de frequência
const SIBILO_HZ: [number, number] = [4500, 10000];
const SIBILO_INICIO = 0.35; // fração de energia do quadro na faixa do sibilo a partir da qual o de-esser começa a agir
const SIBILO_CHEIO = 0.75; // ... e onde ele chega a deesser_db
const DIGITAL_SILENCIO_DB = -90; // janela abaixo disto é zero digital, não ruído de sala

// ---------- filtros e FFT ----------
const butterworth = (tipo: 'altas' | 'baixas', fc: number, taxa: number, q: number): Biquad => {
  const w0 = (2 * Math.PI * fc) / taxa;
  const cos = Math.cos(w0);
  const alfa = Math.sin(w0) / (2 * q);
  const a0 = 1 + alfa;
  const b = tipo === 'altas' ? [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2] : [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
  return {b0: b[0] / a0, b1: b[1] / a0, b2: b[2] / a0, a1: (-2 * cos) / a0, a2: (1 - alfa) / a0};
};
const passar = (x: Float32Array, f: Biquad) => {
  const out = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = f.b0 * x0 + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    out[i] = y0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return out;
};
// Butterworth de 2ª ordem passado na ida e na volta: fase zero (a voz não muda de forma nem atrasa, o que um filtro de
// uma passada faria com o fundamental perto do corte) e queda de 4ª ordem, −6 dB no corte. Dá porque o arquivo está inteiro.
const filtrarIdaEVolta = (x: Float32Array, tipo: 'altas' | 'baixas', fc: number, taxa: number) => {
  const f = butterworth(tipo, fc, taxa, Math.SQRT1_2);
  return passar(passar(x, f).reverse(), f).reverse();
};

/** FFT complexa de raiz 2, no lugar, de tamanho `n` (potência de 2). */
const fftDe = (n: number) => {
  const bits = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / n);
    sin[k] = Math.sin((2 * Math.PI * k) / n);
  }
  return (re: Float64Array, im: Float64Array, inversa: boolean) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    const sinal = inversa ? 1 : -1;
    for (let tam = 2; tam <= n; tam <<= 1) {
      const meio = tam >> 1;
      const passo = n / tam;
      for (let i = 0; i < n; i += tam) {
        for (let j = 0, k = 0; j < meio; j++, k += passo) {
          const wr = cos[k], wi = sinal * sin[k];
          const a = i + j, b = a + meio;
          const tr = wr * re[b] - wi * im[b];
          const ti = wr * im[b] + wi * re[b];
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
    if (inversa) for (let i = 0; i < n; i++) (re[i] /= n), (im[i] /= n);
  };
};

const tamanhoDoQuadro = (taxa: number) => {
  let n = 256;
  while (n < taxa * 0.042) n <<= 1; // ~43 ms: 2048 a 44,1 e 48 kHz
  return n;
};

export type ControleLimpeza = {aoProgresso?: (p: number) => void; pausar?: () => Promise<void>; cancelado?: () => boolean};

export class LimpezaCancelada extends Error {
  constructor() {
    super('limpeza cancelada');
  }
}

/** Um canal pela STFT: porta espectral com o perfil de ruído das pausas e de-esser. `progresso` vai de 0 a 1. */
const portaEspectral = async (x: Float32Array, taxa: number, p: ParametrosLimpeza, ctrl: ControleLimpeza, progresso: (f: number) => void) => {
  const n = tamanhoDoQuadro(taxa);
  const hop = n / 4;
  const bins = n / 2 + 1;
  const fft = fftDe(n);
  // janela de Hann periódica na análise e na síntese (raiz quadrada de cada lado): soma constante 2 com 75 %
  const janela = new Float64Array(n);
  for (let i = 0; i < n; i++) janela[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  const total = x.length;
  const quadros = Math.ceil((total + n) / hop) + 1;
  const inicio = (q: number) => q * hop - n; // amostra onde o quadro q começa (os primeiros caem antes do zero)
  const amostra = (i: number) => (i >= 0 && i < total ? x[i] : 0);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const espectro = (q: number) => {
    const s0 = inicio(q);
    for (let i = 0; i < n; i++) {
      re[i] = amostra(s0 + i) * janela[i];
      im[i] = 0;
    }
    fft(re, im, false);
  };

  // 1. ruído de fundo: os quadros mais quietos (sem contar zero digital) dão a potência média de cada faixa
  const energia = new Float64Array(quadros);
  for (let q = 0; q < quadros; q++) {
    const s0 = inicio(q);
    let e = 0;
    for (let i = 0; i < n; i += 4) {
      const v = amostra(s0 + i);
      e += v * v;
    }
    energia[q] = e;
  }
  const comSom = [...energia.keys()].filter((q) => energia[q] > 1e-12 && inicio(q) >= 0 && inicio(q) + n <= total);
  comSom.sort((a, b) => energia[a] - energia[b]);
  const quietos = comSom.slice(0, Math.max(MIN_QUADROS_RUIDO, Math.round(comSom.length * FRACAO_PAUSAS)));
  if (!quietos.length) return x.slice(); // só silêncio: nada a limpar
  const ruido = new Float64Array(bins);
  for (const q of quietos) {
    espectro(q);
    for (let k = 0; k < bins; k++) ruido[k] += re[k] * re[k] + im[k] * im[k];
  }
  for (let k = 0; k < bins; k++) ruido[k] = Math.max(1e-20, ruido[k] / quietos.length);

  // 2. quadro a quadro: máscara, de-esser e soma das sobreposições
  const piso = -p.reducao_db;
  const kSib = SIBILO_HZ.map((hz) => Math.min(bins - 1, Math.round((hz * n) / taxa)));
  const caiPorQuadro = (p.reducao_db * (hop / taxa) * 1000) / SOLTURA_MS; // soltura em dB por quadro
  const potencia = new Float64Array(bins); // potência suavizada no tempo
  const ganhoDb = new Float64Array(bins).fill(piso);
  const mascara = new Float64Array(bins);
  let deessDb = 0;
  const [sibDe, sibAte] = [kSib[0] - 8, kSib[1] + 8]; // rampas de ~190 Hz nas duas bordas da faixa do sibilo
  const saida = new Float64Array(quadros * hop + n);
  for (let q = 0; q < quadros; q++) {
    if (q % 64 === 0) {
      if (ctrl.cancelado?.()) throw new LimpezaCancelada();
      progresso(q / quadros);
      await ctrl.pausar?.();
    }
    espectro(q);
    let eTotal = 0;
    let eSib = 0;
    for (let k = 0; k < bins; k++) {
      const pk = re[k] * re[k] + im[k] * im[k];
      potencia[k] = 0.5 * potencia[k] + 0.5 * pk;
      // o que passa de margem_db acima do ruído abre a porta, com joelho de 6 dB
      const d = 10 * Math.log10(potencia[k] / ruido[k] + 1e-20) - p.margem_db;
      mascara[k] = Math.min(1, Math.max(0, d / JOELHO_DB + 0.5));
      const util = Math.max(0, pk - ruido[k]); // energia acima do ruído, para o de-esser
      eTotal += util;
      if (k >= kSib[0] && k <= kSib[1]) eSib += util;
    }
    // sibilo: fração da energia útil na faixa de 4,5 a 10 kHz; ataque imediato, soltura de 80 ms
    const fracao = eTotal > 0 ? eSib / eTotal : 0;
    const alvoDeess = p.deesser_db * Math.min(1, Math.max(0, (fracao - SIBILO_INICIO) / (SIBILO_CHEIO - SIBILO_INICIO)));
    deessDb = Math.max(alvoDeess, deessDb - (p.deesser_db * (hop / taxa) * 1000) / SOLTURA_MS);
    for (let k = 0; k < bins; k++) {
      let m = 0;
      let c = 0;
      for (let j = Math.max(0, k - SUAVIZAR_BINS); j <= Math.min(bins - 1, k + SUAVIZAR_BINS); j++) (m += mascara[j]), c++;
      const alvo = piso * (1 - m / c); // 0 dB com a porta aberta, piso com ela fechada
      ganhoDb[k] = Math.max(alvo, ganhoDb[k] - caiPorQuadro);
      let g = ganhoDb[k];
      if (deessDb > 0 && k > sibDe && k < sibAte) g -= deessDb * Math.min(1, (k - sibDe) / 8, (sibAte - k) / 8);
      const lin = Math.pow(10, g / 20);
      re[k] *= lin;
      im[k] *= lin;
      if (k > 0 && k < n / 2) {
        re[n - k] *= lin;
        im[n - k] *= lin;
      }
    }
    fft(re, im, true);
    const s0 = inicio(q) + n; // a saída tem n amostras de folga na frente
    for (let i = 0; i < n; i++) saida[s0 + i] += re[i] * janela[i] * 0.5;
  }
  progresso(1);
  const out = new Float32Array(total);
  for (let i = 0; i < total; i++) out[i] = saida[i + n];
  return out;
};

/** Ruído de fundo (média de potência das 10 % janelas mais quietas, sem zero digital) e nível da voz (a mediana com as
 *  portas do BS.1770, a mesma referência do ducking), em dB com ponderação K. `pausas` são as janelas usadas: o depois
 *  se mede nas mesmas janelas do antes. */
export const medirRuido = (env: Envelope, pausas?: number[]) => {
  const janelas = pausas ?? (() => {
    const idx = env.db.map((v, i) => [v, i] as const).filter(([v]) => v > DIGITAL_SILENCIO_DB).sort((a, b) => a[0] - b[0]);
    return idx.slice(0, Math.max(1, Math.round(idx.length * FRACAO_PAUSAS))).map(([, i]) => i);
  })();
  const valores = janelas.map((i) => env.db[i]).filter((v) => v !== undefined);
  const media = valores.length ? 10 * Math.log10(valores.reduce((s, v) => s + Math.pow(10, v / 10), 0) / valores.length) : SILENCIO_DB;
  return {ruido_db: Math.round(Math.max(SILENCIO_DB, media) * 10) / 10, voz_db: referenciaDeJanelas(env.db), pausas: janelas};
};

export type ResultadoLimpeza = {canais: Float32Array[]; envelope: Envelope; medidas: LimpezaClipe};

/** Limpa a voz de um áudio decodificado. Assíncrono para quem chama devolver a vez entre pedaços (`pausar`) e poder
 *  cancelar (lança LimpezaCancelada). */
export const limparVoz = async (canais: Float32Array[], taxa: number, intensidade: IntensidadeLimpeza = INTENSIDADE_PADRAO, ctrl: ControleLimpeza = {}): Promise<ResultadoLimpeza> => {
  const p = INTENSIDADES[intensidade] ?? INTENSIDADES[INTENSIDADE_PADRAO];
  const antes = medirRuido(envelopeDeAmostras(canais, taxa));
  const limpos: Float32Array[] = [];
  for (const [c, x] of canais.entries()) {
    const parte = (f: number) => ctrl.aoProgresso?.((c + f) / canais.length);
    let y = filtrarIdaEVolta(x, 'altas', p.graves_hz, taxa);
    y = await portaEspectral(y, taxa, p, ctrl, parte);
    if (p.chiado_hz < taxa * 0.45) y = filtrarIdaEVolta(y, 'baixas', p.chiado_hz, taxa);
    for (let i = 0; i < y.length; i++) y[i] = Math.max(-1, Math.min(1, y[i]));
    limpos.push(y);
  }
  const envelope = envelopeDeAmostras(limpos, taxa);
  const depois = medirRuido(envelope, antes.pausas);
  return {
    canais: limpos,
    envelope,
    medidas: {intensidade, ruido_antes_db: antes.ruido_db, ruido_depois_db: depois.ruido_db, voz_antes_db: antes.voz_db, voz_depois_db: depois.voz_db},
  };
};
