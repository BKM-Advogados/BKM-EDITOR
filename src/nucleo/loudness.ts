// Medidor de loudness da ITU-R BS.1770-4 (o que a EBU R128 e as redes usam), puro: integrado em LUFS (portas de −70 LUFS e
// de 10 LU abaixo), curto prazo (janela de 3 s, um valor a cada 100 ms), momentâneo (400 ms) e pico verdadeiro em dBTP
// (sobreamostragem 4×). As amostras entram aos pedaços (`alimentar`), então a mistura de um vídeo longo não precisa
// existir inteira na memória. `medirMistura` refaz a mistura do render do Remotion: cada clipe no quadro dele, o volume
// por quadro (faixa × clipe × fades × ducking, volumeDoClipe) trocado a cada pacote do arquivo, mono aberto em estéreo a
// −3 dB por lado e tudo somado sem normalizar (o amix do Remotion usa normalize=0). A ponderação K é a do envelope (audio.ts).
import {coeficientesK, mediana, SILENCIO_DB, volumeDoClipe, type AudioP, type Biquad, type ClipeAudioP, type FaixaAudioP} from './audio';

export const PASSO_MS = 100;
const PASSOS_MOMENTANEO = 4; // 400 ms
const PASSOS_CURTO = 30; // 3 s
const PORTA_ABSOLUTA = -70;
const PORTA_RELATIVA = 10;
const TAPS_POR_FASE = 12; // filtro de 48 coeficientes na sobreamostragem 4×, como o anexo 2 do BS.1770-4

export type MedidaLoudness = {
  integrado_lufs: number | null; // null: só silêncio (nada passou da porta de −70)
  curto_prazo: number[]; // um valor a cada 100 ms: o índice k é a janela de 3 s que termina em (k + 1) × 100 ms
  curto_max_lufs: number | null;
  momentaneo_max_lufs: number | null;
  pico_dbtp: number | null; // null também quando o medidor foi criado sem pico
  duracao_ms: number;
};

const lufs = (potencia: number) => (potencia > 0 ? -0.691 + 10 * Math.log10(potencia) : SILENCIO_DB);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Filtro de interpolação (seno janelado, Blackman) com `fator` fases; cada fase soma 1, para o sinal não ganhar nível. */
const interpolador = (fator: number) => {
  const n = fator * TAPS_POR_FASE;
  const h = new Float64Array(n);
  const meio = (n - 1) / 2;
  for (let k = 0; k < n; k++) {
    const x = (k - meio) / fator;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const janela = 0.42 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * k) / (n - 1));
    h[k] = sinc * janela;
  }
  // fase p usa h[p], h[p + fator], ...: guarda por fase, normalizada
  const fases: Float64Array[] = [];
  let ganhoMax = 1; // o maior Σ|h| de uma fase: nenhum ponto interpolado passa de ganhoMax × a maior amostra da janela
  for (let p = 0; p < fator; p++) {
    const f = new Float64Array(TAPS_POR_FASE);
    let s = 0;
    for (let t = 0; t < TAPS_POR_FASE; t++) s += (f[t] = h[p + t * fator]);
    let abs = 0;
    for (let t = 0; t < TAPS_POR_FASE; t++) abs += Math.abs((f[t] /= s));
    ganhoMax = Math.max(ganhoMax, abs);
    fases.push(f);
  }
  return {fases, ganhoMax};
};

type EstadoBiquad = {f: Biquad; x1: number; x2: number; y1: number; y2: number};

/** Medidor de um sinal de `canais` canais à taxa `taxa`, alimentado aos pedaços. */
export class Medidor {
  private readonly k: EstadoBiquad[][];
  private readonly porPasso: number;
  private passoAtual = 0; // amostras já somadas no passo de 100 ms em curso
  private somaAtual = 0;
  private readonly passos: number[] = []; // potência média de cada passo de 100 ms, somada entre canais
  private amostras = 0;
  private pico = 0;
  private readonly fases: Float64Array[] | null;
  private readonly ganhoMax: number;
  private readonly historico: Float64Array[]; // as últimas TAPS_POR_FASE amostras de cada canal, para o interpolador
  private readonly desdeAlta: number[]; // por canal: amostras desde a última que podia levar a um pico novo
  private quad = new Float64Array(0);

  constructor(readonly taxa: number, readonly canais: number, o: {pico?: boolean} = {}) {
    this.k = Array.from({length: canais}, () => coeficientesK(taxa).map((f) => ({f, x1: 0, x2: 0, y1: 0, y2: 0})));
    this.porPasso = Math.max(1, Math.round((taxa * PASSO_MS) / 1000));
    const fator = taxa < 96000 ? 4 : taxa < 192000 ? 2 : 1;
    const interp = o.pico === false ? null : interpolador(fator);
    this.fases = interp?.fases ?? null;
    this.ganhoMax = interp?.ganhoMax ?? 1;
    this.historico = Array.from({length: canais}, () => new Float64Array(TAPS_POR_FASE * 2));
    this.desdeAlta = new Array(canais).fill(0);
  }

  /** Mais `n` amostras de cada canal (os canais além dos que o medidor tem são ignorados). */
  alimentar(blocos: Float32Array[], n = blocos[0]?.length ?? 0) {
    if (this.quad.length < n) this.quad = new Float64Array(n);
    const quad = this.quad;
    quad.fill(0, 0, n);
    for (let c = 0; c < this.canais; c++) {
      const x = blocos[c] ?? blocos[0];
      // ponderação K: dois biquads em série, com o estado guardado entre pedaços
      const [a, b] = this.k[c];
      let ax1 = a.x1, ax2 = a.x2, ay1 = a.y1, ay2 = a.y2, bx1 = b.x1, bx2 = b.x2, by1 = b.y1, by2 = b.y2;
      const fa = a.f, fb = b.f;
      for (let i = 0; i < n; i++) {
        const x0 = x[i];
        const y0 = fa.b0 * x0 + fa.b1 * ax1 + fa.b2 * ax2 - fa.a1 * ay1 - fa.a2 * ay2;
        ax2 = ax1; ax1 = x0; ay2 = ay1; ay1 = y0;
        const z0 = fb.b0 * y0 + fb.b1 * bx1 + fb.b2 * bx2 - fb.a1 * by1 - fb.a2 * by2;
        bx2 = bx1; bx1 = y0; by2 = by1; by1 = z0;
        quad[i] += z0 * z0;
      }
      Object.assign(a, {x1: ax1, x2: ax2, y1: ay1, y2: ay2});
      Object.assign(b, {x1: bx1, x2: bx2, y1: by1, y2: by2});
      if (this.fases) this.picoDe(c, x, n);
    }
    for (let i = 0; i < n; i++) {
      this.somaAtual += quad[i];
      if (++this.passoAtual === this.porPasso) {
        this.passos.push(this.somaAtual / this.porPasso);
        this.somaAtual = 0;
        this.passoAtual = 0;
      }
    }
    this.amostras += n;
  }

  // pico verdadeiro: o maior módulo entre as amostras e os pontos interpolados entre elas. Só interpola quando alguma
  // das 12 amostras da janela passa de pico/ganhoMax: abaixo disso nenhum ponto interpolado bate o pico que já se tem.
  private picoDe(c: number, x: Float32Array, n: number) {
    const fases = this.fases!;
    const h = this.historico[c]; // janela dupla: h[t] e h[t + TAPS] guardam a mesma amostra, sem módulo no laço
    let pico = this.pico;
    let desde = this.desdeAlta[c];
    // a escrita anda para trás (h[pos + t] é a amostra de t passos atrás); continua de onde o pedaço anterior parou
    let pos = (TAPS_POR_FASE - (this.amostras % TAPS_POR_FASE)) % TAPS_POR_FASE;
    for (let i = 0; i < n; i++) {
      const v = x[i];
      const av = v < 0 ? -v : v;
      if (av > pico) pico = av;
      pos = pos === 0 ? TAPS_POR_FASE - 1 : pos - 1;
      h[pos] = v;
      h[pos + TAPS_POR_FASE] = v;
      desde = av * this.ganhoMax >= pico ? 0 : desde + 1;
      if (desde >= TAPS_POR_FASE) continue;
      // as fases caem entre as amostras (1/8, 3/8, 5/8 e 7/8 do intervalo); a amostra em si já entrou acima
      for (let p = 0; p < fases.length; p++) {
        const f = fases[p];
        let s = 0;
        for (let t = 0; t < TAPS_POR_FASE; t++) s += f[t] * h[pos + t];
        const as = s < 0 ? -s : s;
        if (as > pico) pico = as;
      }
    }
    this.pico = pico;
    this.desdeAlta[c] = desde;
  }

  /** Blocos de 400 ms com 75 % de sobreposição (a média de 4 passos de 100 ms), em potência. */
  blocos(): number[] {
    const p = this.passos;
    const blocos: number[] = [];
    for (let j = 0; j + PASSOS_MOMENTANEO <= p.length; j++) blocos.push((p[j] + p[j + 1] + p[j + 2] + p[j + 3]) / 4);
    return blocos;
  }

  resultado(): MedidaLoudness {
    const p = this.passos;
    const blocos = this.blocos();
    const acima = blocos.filter((z) => lufs(z) > PORTA_ABSOLUTA);
    let integrado: number | null = null;
    if (acima.length) {
      const porta = lufs(acima.reduce((s, z) => s + z, 0) / acima.length) - PORTA_RELATIVA;
      const passam = acima.filter((z) => lufs(z) > porta);
      integrado = passam.length ? r1(lufs(passam.reduce((s, z) => s + z, 0) / passam.length)) : null;
    }
    // curto prazo a cada 100 ms; nos 3 primeiros segundos, a janela é o que já passou
    const curto: number[] = [];
    let soma = 0;
    let maxCheio = -Infinity;
    let maxParcial = -Infinity;
    for (let k = 0; k < p.length; k++) {
      soma += p[k];
      if (k >= PASSOS_CURTO) soma -= p[k - PASSOS_CURTO];
      const cheio = k + 1 >= PASSOS_CURTO;
      const v = Math.max(SILENCIO_DB, lufs(Math.max(0, soma) / Math.min(k + 1, PASSOS_CURTO)));
      curto.push(r1(v));
      if (cheio) maxCheio = Math.max(maxCheio, v);
      else maxParcial = Math.max(maxParcial, v);
    }
    const curtoMax = Number.isFinite(maxCheio) ? maxCheio : maxParcial;
    const momentaneo = blocos.length ? Math.max(...blocos.map(lufs)) : -Infinity;
    const comSom = (v: number) => (Number.isFinite(v) && v > PORTA_ABSOLUTA ? r1(v) : null);
    return {
      integrado_lufs: integrado,
      curto_prazo: curto,
      curto_max_lufs: comSom(curtoMax),
      momentaneo_max_lufs: comSom(momentaneo),
      pico_dbtp: this.fases ? (this.pico > 0 ? r1(20 * Math.log10(this.pico)) : SILENCIO_DB) : null,
      duracao_ms: Math.round((this.amostras / this.taxa) * 1000),
    };
  }
}

/** Mede um sinal inteiro de uma vez. */
export const medirAmostras = (canais: Float32Array[], taxa: number, o: {pico?: boolean} = {}) => {
  const m = new Medidor(taxa, canais.length, o);
  m.alimentar(canais);
  return m.resultado();
};

/** Curto prazo no tempo `ms` do vídeo (a janela de 3 s que termina ali); null antes do primeiro passo. */
export const curtoPrazoEm = (m: MedidaLoudness, ms: number) => {
  const k = Math.min(m.curto_prazo.length - 1, Math.floor(ms / PASSO_MS) - 1);
  return k >= 0 ? m.curto_prazo[k] : null;
};

// ---------- a mistura do vídeo ----------
/** Um arquivo decodificado (todos à mesma taxa: o processo principal pede 48 kHz ao ffmpeg). `pacote` é quantas amostras
 *  (já nessa taxa) o arquivo tem por pacote: o render do Remotion passa o volume ao filtro `volume` do ffmpeg, que o
 *  avalia uma vez por pacote de áudio (eval=frame), e não a cada amostra; num WAV mono de 22 kHz são 93 ms, e é aí que
 *  a música demora a cair no começo da fala. Sem `pacote`, o volume muda a cada quadro do vídeo. */
export type FonteAudio = {canais: Float32Array[]; taxa: number; pacote?: number};

/** O que o inspetor mostra: a mistura, a soma das faixas de voz (null sem voz tocando) e cada faixa, por `origem`. Nas
 *  faixas que não são de voz, enquanto a narração fala (os blocos de 400 ms em que a voz passa da porta de 10 LU abaixo do
 *  integrado dela): `sob_voz_lufs` é a mediana do loudness da faixa e `abaixo_da_voz_lu`, a mediana de voz − faixa, bloco a
 *  bloco. É a conta da regra da casa (música de 18 a 23 LU abaixo da voz, em medianas), que o integrado da música não faz:
 *  ele vem das pausas, onde o ducking solta. null: a faixa fica calada enquanto a voz fala. */
export type MedidaFaixa = MedidaLoudness & {sob_voz_lufs?: number | null; abaixo_da_voz_lu?: number | null};
export type MedidasLoudness = {mistura: MedidaLoudness; voz: MedidaLoudness | null; faixas: Record<string, MedidaFaixa>; alvo_lufs: number; pico_dbtp: number; faltando: string[]};

const CANAIS_SAIDA = 2; // o render do Remotion sai em estéreo
const MONO_EM_ESTEREO = Math.SQRT1_2; // o ffmpeg abre o mono em estéreo a −3 dB por lado (a potência fica a mesma)

type ClipeNaMistura = {f: FaixaAudioP; c: ClipeAudioP; fonte: FonteAudio; ini: number; fim: number; corte: number};

/** Mede a mistura como o render vai soar: `fontes` por arquivo (os que faltarem ficam de fora e voltam em `faltando`).
 *  `pausar` é chamado a cada ~2 s de áudio (o processo principal devolve a vez ao laço de eventos); `cancelado` para. */
export const medirMistura = async (audio: AudioP, fontes: Record<string, FonteAudio | undefined>,
  o: {duracao_ms: number; fps: number; taxa: number; pausar?: () => Promise<void>; cancelado?: () => boolean; aoProgresso?: (p: number) => void}): Promise<MedidasLoudness> => {
  const {taxa, fps} = o;
  const q = (ms: number) => Math.round((ms / 1000) * fps); // em quadros, como o VideoCenas
  const total = Math.max(0, Math.round((q(o.duracao_ms) / fps) * taxa));
  const faltando = new Set<string>();
  const clipes: ClipeNaMistura[] = [];
  for (const f of audio.faixas) {
    if (f.mudo) continue;
    for (const c of f.clipes) {
      if (c.mudo || c.fora || c.em >= o.duracao_ms) continue;
      const fonte = fontes[c.arquivo];
      if (!fonte) {
        faltando.add(c.arquivo);
        continue;
      }
      if (fonte.taxa !== taxa) throw new Error(`a fonte ${c.arquivo} está a ${fonte.taxa} Hz e a mistura a ${taxa} Hz`);
      const de = q(c.em);
      const dur = Math.max(1, q(c.em + c.duracao_ms) - de);
      const ini = Math.round((de / fps) * taxa);
      const corte = Math.round((q(c.corte_ms) / fps) * taxa);
      const fim = Math.min(total, Math.round(((de + dur) / fps) * taxa), ini + Math.max(0, (fonte.canais[0]?.length ?? 0) - corte));
      if (fim > ini) clipes.push({f, c, fonte, ini, fim, corte});
    }
  }
  const tocam = audio.faixas.filter((f) => !f.mudo);
  const medidores = new Map(tocam.map((f) => [f.origem, new Medidor(taxa, CANAIS_SAIDA, {pico: false})]));
  const mistura = new Medidor(taxa, CANAIS_SAIDA);
  const temVoz = clipes.some((x) => x.f.papel === 'voz');
  const voz = temVoz ? new Medidor(taxa, CANAIS_SAIDA) : null;

  const bloco = Math.max(1, Math.round((taxa * PASSO_MS) / 1000));
  const porFaixa = new Map(tocam.map((f) => [f.origem, [new Float32Array(bloco), new Float32Array(bloco)]]));
  const mix = [new Float32Array(bloco), new Float32Array(bloco)];
  const somaVoz = [new Float32Array(bloco), new Float32Array(bloco)];
  const somar = (dst: Float32Array[], src: Float32Array[], n: number) => {
    for (let i = 0; i < n; i++) {
      dst[0][i] += src[0][i];
      dst[1][i] += src[1][i];
    }
  };
  let desde = 0;
  for (let s0 = 0; s0 < total; s0 += bloco) {
    if (o.cancelado?.()) throw new Error('medição cancelada');
    const n = Math.min(bloco, total - s0);
    for (const b of porFaixa.values()) {
      b[0].fill(0, 0, n);
      b[1].fill(0, 0, n);
    }
    for (const x of clipes) {
      const a = Math.max(s0, x.ini);
      const z = Math.min(s0 + n, x.fim);
      if (z <= a) continue;
      const [l, r] = porFaixa.get(x.f.origem)!;
      const ch = x.fonte.canais;
      const mono = ch.length === 1;
      const e = ch[0];
      const d = mono ? ch[0] : ch[1];
      const k = mono ? MONO_EM_ESTEREO : 1;
      // o volume de cada quadro do vídeo (centrado nele), lido no começo de cada pacote do arquivo, como o ffmpeg do render
      const pacote = x.fonte.pacote && x.fonte.pacote > 1 ? x.fonte.pacote : 0;
      let quadro = -1;
      let g = 0;
      for (let s = a; s < z; s++) {
        const j = x.corte + (s - x.ini);
        const t = pacote ? Math.max(x.corte, Math.floor(j / pacote) * pacote) - x.corte : s - x.ini;
        const qd = Math.round((t / taxa) * fps);
        if (qd !== quadro) {
          quadro = qd;
          g = volumeDoClipe(x.f, x.c, (qd / fps) * 1000) * k;
        }
        l[s - s0] += e[j] * g;
        r[s - s0] += d[j] * g;
      }
    }
    mix[0].fill(0, 0, n);
    mix[1].fill(0, 0, n);
    somaVoz[0].fill(0, 0, n);
    somaVoz[1].fill(0, 0, n);
    for (const f of tocam) {
      const b = porFaixa.get(f.origem)!;
      medidores.get(f.origem)!.alimentar(b, n);
      somar(mix, b, n);
      if (f.papel === 'voz') somar(somaVoz, b, n);
    }
    mistura.alimentar(mix, n);
    voz?.alimentar(somaVoz, n);
    if (s0 - desde >= taxa * 2) {
      desde = s0;
      o.aoProgresso?.(s0 / total);
      await o.pausar?.();
    }
  }
  const rVoz = voz?.resultado() ?? null;
  // onde a narração fala: os blocos dela acima da porta relativa (10 LU abaixo do integrado)
  const blocosVoz = voz?.blocos() ?? [];
  const comVoz = rVoz?.integrado_lufs !== null && rVoz?.integrado_lufs !== undefined
    ? blocosVoz.map((z, j) => (lufs(z) > Math.max(PORTA_ABSOLUTA, rVoz.integrado_lufs! - PORTA_RELATIVA) ? j : -1)).filter((j) => j >= 0) : [];
  const faixas: Record<string, MedidaFaixa> = {};
  for (const [origem, m] of medidores) {
    const r: MedidaFaixa = m.resultado();
    if (comVoz.length && tocam.find((f) => f.origem === origem)?.papel !== 'voz') {
      const b = m.blocos();
      const sob = mediana(comVoz.map((j) => lufs(b[j] ?? 0)))!;
      r.sob_voz_lufs = sob > PORTA_ABSOLUTA ? r1(sob) : null;
      r.abaixo_da_voz_lu = r.sob_voz_lufs === null ? null : r1(mediana(comVoz.map((j) => lufs(blocosVoz[j]) - lufs(b[j] ?? 0)))!);
    }
    faixas[origem] = r;
  }
  return {mistura: mistura.resultado(), voz: rVoz, faixas, alvo_lufs: audio.alvo_lufs, pico_dbtp: audio.pico_dbtp, faltando: [...faltando]};
};
