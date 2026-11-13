// Reamostragem de áudio (M-11): Hermite cúbico para a prévia e sinc com janela Kaiser para o render canônico.
// Determinística: só aritmética de double sobre a entrada, sem Math.random nem relógio, então a mesma entrada dá o
// mesmo PCM em toda máquina. Sem atraso de grupo: a amostra de saída i cai no instante i/taxaDestino da entrada
// (fase zero), então um clipe reamostrado não anda no tempo. Quando as taxas são iguais devolve a própria entrada
// (o caminho antigo, que não muda hash). Ver docs/musica.md.

export type QualidadeReamostragem = 'hermite' | 'sinc';

export type OpcoesReamostragem = {
  /** Meia-largura do filtro sinc em amostras da entrada (na taxa mais baixa). Padrão 24. */
  meia_largura?: number;
  /** Parâmetro beta da janela Kaiser. Padrão 9 (cerca de 90 dB de rejeição). */
  beta?: number;
  /** Fração da banda (Nyquist da taxa mais baixa) que passa limpa. Padrão 0.95. */
  corte?: number;
};

const SUBPASSOS = 512; // pontos da tabela do núcleo por amostra de entrada (interpolação linear entre eles)

/** Bessel modificada de ordem 0, por série (converge rápido para os argumentos da janela). */
const besselI0 = (x: number): number => {
  let soma = 1, termo = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 60; k++) {
    termo *= q / (k * k);
    soma += termo;
    if (termo < soma * 1e-17) break;
  }
  return soma;
};

const sinc = (x: number): number => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

/** Hermite cúbico de 4 pontos (Catmull-Rom) sobre os vizinhos de x. Fora do sinal, zero. */
const hermite = (c: Float32Array, taxaO: number, taxaD: number): Float32Array => {
  const n = c.length;
  const saida = Math.floor((n * taxaD) / taxaO);
  const out = new Float32Array(saida);
  const passo = taxaO / taxaD;
  const em = (k: number) => (k < 0 || k >= n ? 0 : c[k]);
  for (let i = 0; i < saida; i++) {
    const x = i * passo;
    const i0 = Math.floor(x), t = x - i0;
    if (t === 0) {
      out[i] = em(i0);
      continue;
    }
    const y0 = em(i0 - 1), y1 = em(i0), y2 = em(i0 + 1), y3 = em(i0 + 2);
    const a = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
    const b = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const cc = -0.5 * y0 + 0.5 * y2;
    out[i] = ((a * t + b) * t + cc) * t + y1;
  }
  return out;
};

/** Sinc com janela Kaiser. Ao baixar a taxa o corte desce junto (antialiasing); ao subir, mantém o Nyquist da entrada. */
const sincKaiser = (c: Float32Array, taxaO: number, taxaD: number, o: OpcoesReamostragem): Float32Array => {
  const n = c.length;
  const saida = Math.floor((n * taxaD) / taxaO);
  const out = new Float32Array(saida);
  const passo = taxaO / taxaD;
  const fc = Math.min(1, taxaD / taxaO) * (o.corte ?? 0.95); // corte em fração do Nyquist da entrada
  const meia = o.meia_largura ?? 24;
  const beta = o.beta ?? 9;
  const alcance = meia / Math.min(1, taxaD / taxaO); // em amostras da entrada
  const tam = Math.ceil(alcance) + 1;
  const i0Beta = besselI0(beta);
  // Tabela do núcleo h(d) para d de 0 a alcance, simétrica.
  const pts = tam * SUBPASSOS + 2;
  const tabela = new Float64Array(pts);
  for (let k = 0; k < pts; k++) {
    const d = k / SUBPASSOS;
    const r = d / alcance;
    tabela[k] = r >= 1 ? 0 : fc * sinc(fc * d) * (besselI0(beta * Math.sqrt(1 - r * r)) / i0Beta);
  }
  const nucleo = (d: number): number => {
    const p = Math.abs(d) * SUBPASSOS;
    const k = Math.floor(p);
    const f = p - k;
    return tabela[k] * (1 - f) + tabela[k + 1] * f;
  };
  for (let i = 0; i < saida; i++) {
    const x = i * passo;
    const j0 = Math.max(0, Math.ceil(x - alcance)), j1 = Math.min(n - 1, Math.floor(x + alcance));
    let acc = 0, pesos = 0;
    for (let j = j0; j <= j1; j++) {
      const w = nucleo(x - j);
      acc += c[j] * w;
      pesos += w;
    }
    // Normaliza pelo ganho em DC onde o filtro cabe inteiro; nas bordas usa o mesmo divisor do interior.
    out[i] = acc / (j0 === Math.ceil(x - alcance) && j1 === Math.floor(x + alcance) ? pesos : 1);
  }
  return out;
};

/** Reamostra um canal de taxaOrigem para taxaDestino. Taxas iguais devolvem o mesmo vetor, sem copiar. */
export const reamostrar = (canal: Float32Array, taxaOrigem: number, taxaDestino: number, qualidade: QualidadeReamostragem = 'sinc', opcoes: OpcoesReamostragem = {}): Float32Array => {
  if (!(taxaOrigem > 0) || !(taxaDestino > 0)) throw new Error('taxa de reamostragem inválida');
  if (taxaOrigem === taxaDestino) return canal;
  return qualidade === 'hermite' ? hermite(canal, taxaOrigem, taxaDestino) : sincKaiser(canal, taxaOrigem, taxaDestino, opcoes);
};
