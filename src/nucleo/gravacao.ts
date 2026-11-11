// Gravar a narração (rodada 3, frente Som): o que a interface e o processo principal dividem. A interface captura o
// microfone sem nenhum processamento do navegador (sem cancelamento de eco, supressão de ruído nem controle automático de
// ganho: a limpeza de voz vem depois, e com o original à mão), junta as amostras em 48 kHz e as codifica aqui em WAV PCM;
// o processo principal confere o cabeçalho e grava em midia/. O teleprompter é só uma conta de tempo: quando cada palavra
// do texto deve estar na linha de leitura, para a velocidade pedida. Puro, sem disco nem microfone.

export const TAXA_GRAVACAO = 48000;
export type BitsWav = 16 | 24;

/** O que a captura pede ao navegador: tudo o que "melhora" a voz desligado, mono, 48 kHz. */
export const RESTRICOES_MICROFONE = {echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1, sampleRate: TAXA_GRAVACAO} as const;

const escrever = (v: DataView, pos: number, texto: string) => {
  for (let i = 0; i < texto.length; i++) v.setUint8(pos + i, texto.charCodeAt(i));
};

/** WAV PCM de inteiros (16 ou 24 bits) com os canais intercalados; amostra fora de −1…1 é cortada. */
export const codificarWavPcm = (canais: Float32Array[], taxa: number, bits: BitsWav = 24): Uint8Array => {
  const n = canais[0]?.length ?? 0;
  const nc = Math.max(1, canais.length);
  const bytes = bits / 8;
  const dados = n * nc * bytes;
  const out = new Uint8Array(44 + dados);
  const v = new DataView(out.buffer);
  escrever(v, 0, 'RIFF');
  v.setUint32(4, 36 + dados, true);
  escrever(v, 8, 'WAVE');
  escrever(v, 12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, nc, true);
  v.setUint32(24, taxa, true);
  v.setUint32(28, taxa * nc * bytes, true);
  v.setUint16(32, nc * bytes, true);
  v.setUint16(34, bits, true);
  escrever(v, 36, 'data');
  v.setUint32(40, dados, true);
  const maximo = 2 ** (bits - 1) - 1;
  let pos = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nc; c++) {
      const x = Math.max(-1, Math.min(1, canais[c]?.[i] ?? 0));
      const q = Math.round(x * maximo);
      if (bits === 16) v.setInt16(pos, q, true);
      else {
        v.setUint8(pos, q & 0xff);
        v.setUint8(pos + 1, (q >> 8) & 0xff);
        v.setUint8(pos + 2, (q >> 16) & 0xff);
      }
      pos += bytes;
    }
  }
  return out;
};

export type CabecalhoWav = {canais: number; taxa: number; bits: number; amostras: number};

/** O cabeçalho de um WAV PCM (formato 1) com o bloco `data`, ou o motivo de não servir. */
export const lerCabecalhoWav = (b: Uint8Array): CabecalhoWav | {erro: string} => {
  if (b.length < 44) return {erro: 'o arquivo é curto demais para ser um WAV'};
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (pos: number) => String.fromCharCode(v.getUint8(pos), v.getUint8(pos + 1), v.getUint8(pos + 2), v.getUint8(pos + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return {erro: 'não é um WAV (falta RIFF/WAVE)'};
  let fmt: {formato: number; canais: number; taxa: number; bits: number} | null = null;
  for (let pos = 12; pos + 8 <= b.length;) {
    const id = tag(pos);
    const tam = v.getUint32(pos + 4, true);
    if (id === 'fmt ' && pos + 8 + 16 <= b.length) fmt = {formato: v.getUint16(pos + 8, true), canais: v.getUint16(pos + 10, true), taxa: v.getUint32(pos + 12, true), bits: v.getUint16(pos + 22, true)};
    if (id === 'data') {
      if (!fmt) return {erro: 'o WAV não traz o bloco fmt antes dos dados'};
      if (fmt.formato !== 1) return {erro: `o WAV não é PCM de inteiros (formato ${fmt.formato})`};
      if (![16, 24].includes(fmt.bits)) return {erro: `o WAV tem ${fmt.bits} bits; vale 16 ou 24`};
      const util = Math.min(tam, b.length - (pos + 8));
      return {canais: fmt.canais, taxa: fmt.taxa, bits: fmt.bits, amostras: Math.floor(util / (fmt.canais * (fmt.bits / 8)))};
    }
    pos += 8 + tam + (tam % 2);
  }
  return {erro: 'o WAV não traz o bloco data'};
};

/** Pico (dBFS) e RMS (dBFS) de um pedaço de amostras: o medidor de nível do gravador. −100 é silêncio. */
export const niveisDoPedaco = (x: Float32Array): {pico_db: number; rms_db: number} => {
  let pico = 0;
  let soma = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > pico) pico = a;
    soma += x[i] * x[i];
  }
  const db = (v: number) => (v > 1e-5 ? 20 * Math.log10(v) : -100);
  return {pico_db: db(pico), rms_db: db(Math.sqrt(soma / Math.max(1, x.length)))};
};
export const PICO_CORTADO_DB = -0.5; // acima disto a tomada provavelmente cortou (clipping)

/** Junta os pedaços que a captura foi entregando num vetor só. */
export const juntarPedacos = (pedacos: Float32Array[]): Float32Array => {
  const out = new Float32Array(pedacos.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of pedacos) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
};

/** Nome da tomada que ainda não existe em midia/: narracao-gravada.wav, narracao-gravada-2.wav… */
export const nomeDaTomada = (existe: (caminho: string) => boolean, base = 'narracao-gravada') => {
  let c = `midia/${base}.wav`;
  for (let n = 2; existe(c); n++) c = `midia/${base}-${n}.wav`;
  return c;
};

// ---------- teleprompter ----------

export type Teleprompter = {texto: string; palavras_por_minuto?: number; tamanho?: number; espelhar?: boolean};
export const PPM_PADRAO = 150; // narração de vídeo explicativo em português: de 140 a 160 palavras por minuto
export const PPM_MIN = 60;
export const PPM_MAX = 260;
export const TAMANHO_TELEPROMPTER_PADRAO = 0.045; // altura da letra, fração da altura do painel (campo opcional do documento)

const PAUSA_VIRGULA_MS = 250;
const PAUSA_PONTO_MS = 500;
const PAUSA_PARAGRAFO_MS = 600;

export const palavrasDoTeleprompter = (texto: string) => texto.split(/\s+/).filter(Boolean);

export const ppmValida = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(PPM_MAX, Math.max(PPM_MIN, Math.round(v))) : PPM_PADRAO);

/** Quando cada palavra começa, em ms desde o começo da leitura, para `ppm` palavras por minuto: o tempo da palavra é o
 *  mesmo para todas, e a pontuação acrescenta a pausa de quem lê (vírgula 250 ms, ponto 500 ms, parágrafo 600 ms). */
export const temposDoTeleprompter = (texto: string, ppm: number = PPM_PADRAO): number[] => {
  const base = 60000 / ppmValida(ppm);
  const tempos: number[] = [];
  let t = 0;
  const paragrafos = texto.split(/\n\s*\n/);
  for (const par of paragrafos) {
    const palavras = palavrasDoTeleprompter(par);
    for (const p of palavras) {
      tempos.push(Math.round(t));
      t += base;
      if (/[.?!…]["')»]*$/.test(p)) t += PAUSA_PONTO_MS;
      else if (/[,;:–—]["')»]*$/.test(p)) t += PAUSA_VIRGULA_MS;
    }
    if (palavras.length) t += PAUSA_PARAGRAFO_MS;
  }
  return tempos;
};

/** Duração total da leitura (ms): o começo da última palavra mais o tempo dela. */
export const duracaoDoTeleprompter = (texto: string, ppm: number = PPM_PADRAO) => {
  const tempos = temposDoTeleprompter(texto, ppm);
  return tempos.length ? tempos[tempos.length - 1] + Math.round(60000 / ppmValida(ppm)) : 0;
};

/** A palavra que se lê em `t_ms` (índice em `palavrasDoTeleprompter`); −1 antes da primeira, e a última depois do fim. */
export const palavraEm = (tempos: number[], t_ms: number): number => {
  if (!tempos.length || t_ms < tempos[0]) return -1;
  let a = 0;
  let b = tempos.length - 1;
  while (a < b) {
    const m = (a + b + 1) >> 1;
    if (tempos[m] <= t_ms) a = m;
    else b = m - 1;
  }
  return a;
};

/** O teleprompter do documento, normalizado, ou null se não houver texto. */
export const teleprompterDe = (x: unknown): Required<Teleprompter> | null => {
  const o = x as Partial<Teleprompter> | null | undefined;
  if (!o || typeof o.texto !== 'string' || !o.texto.trim()) return null;
  const tam = typeof o.tamanho === 'number' && Number.isFinite(o.tamanho) ? Math.min(0.12, Math.max(0.02, o.tamanho)) : TAMANHO_TELEPROMPTER_PADRAO;
  return {texto: o.texto, palavras_por_minuto: ppmValida(o.palavras_por_minuto), tamanho: tam, espelhar: Boolean(o.espelhar)};
};

/** O texto das cenas como roteiro para ler: títulos, textos e itens de lista, uma cena por parágrafo (o `**destaque**` perde os asteriscos). */
export const textoDasCenas = (doc: {cenas?: {blocos?: {tipo?: string; texto?: string; itens?: string[]}[]}[]}): string =>
  (Array.isArray(doc.cenas) ? doc.cenas : [])
    .map((c) => (Array.isArray(c.blocos) ? c.blocos : [])
      .flatMap((b) => (b.tipo === 'lista' && Array.isArray(b.itens) ? b.itens : b.tipo === 'titulo' || b.tipo === 'texto' ? [b.texto ?? ''] : []))
      .map((t) => t.replace(/\*\*/g, '').trim()).filter(Boolean).join('\n'))
    .filter(Boolean).join('\n\n');
