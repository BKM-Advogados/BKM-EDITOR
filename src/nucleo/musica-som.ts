// O som da música, em TypeScript puro: o kit eletrônico sintetizado (sem arquivo nem licença de terceiros), os clipes
// de áudio com corte, ganho e fades, e o mixer (EQ de três bandas, compressor, volume, pan, envio ao reverb) até o
// master. É a mesma conta na prévia da janela (Web Audio só toca o resultado), no render que vai para o vídeo
// (src/main/musica-render.ts) e no MCP por stdio, então a prévia e o render saem iguais amostra por amostra. Nada de
// Math.random: o ruído vem da semente do documento. Ver docs/musica.md.
import type {FonteAudio} from './loudness';
import {resolverMusica, type CanalMusicaP, type ClipeMusicaP, type DocMusica, type FaixaMixerP, type MacrosSintetizador, type MusicaP, type NotaMusica, type PecaBateria,
  type PresetSintetizador} from './musica';

export const TAXA_MUSICA = 48000; // a do render do vídeo
const MONO_EM_ESTEREO = Math.SQRT1_2; // como o ffmpeg abre o mono em estéreo (−3 dB por lado)
const DUAS_PI = 2 * Math.PI;

// ---------- ruído com semente ----------
/** mulberry32: o mesmo número de saída para a mesma semente, em qualquer máquina. */
export const geradorDe = (semente: number) => {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
};
const sementeDe = (texto: string, base: number) => {
  let h = 0x811c9dc5 ^ (base >>> 0);
  for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 0x01000193) >>> 0;
  return h;
};

// ---------- filtros (RBJ, Audio EQ Cookbook) ----------
export type Biquad = {b0: number; b1: number; b2: number; a1: number; a2: number};
const normalizar = (b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Biquad => ({b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0});
export const passaBaixas = (f: number, q: number, taxa: number) => {
  const w = (DUAS_PI * f) / taxa, c = Math.cos(w), al = Math.sin(w) / (2 * q);
  return normalizar((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al);
};
export const passaAltas = (f: number, q: number, taxa: number) => {
  const w = (DUAS_PI * f) / taxa, c = Math.cos(w), al = Math.sin(w) / (2 * q);
  return normalizar((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
};
export const passaFaixa = (f: number, q: number, taxa: number) => {
  const w = (DUAS_PI * f) / taxa, al = Math.sin(w) / (2 * q);
  return normalizar(al, 0, -al, 1 + al, -2 * Math.cos(w), 1 - al);
};
export const sino = (f: number, q: number, ganhoDb: number, taxa: number) => {
  const A = Math.pow(10, ganhoDb / 40), w = (DUAS_PI * f) / taxa, c = Math.cos(w), al = Math.sin(w) / (2 * q);
  return normalizar(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A);
};
export const prateleiraGraves = (f: number, ganhoDb: number, taxa: number) => {
  const A = Math.pow(10, ganhoDb / 40), w = (DUAS_PI * f) / taxa, c = Math.cos(w), al = (Math.sin(w) / 2) * Math.SQRT2, r = 2 * Math.sqrt(A) * al;
  return normalizar(A * ((A + 1) - (A - 1) * c + r), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - r), (A + 1) + (A - 1) * c + r, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - r);
};
export const prateleiraAgudos = (f: number, ganhoDb: number, taxa: number) => {
  const A = Math.pow(10, ganhoDb / 40), w = (DUAS_PI * f) / taxa, c = Math.cos(w), al = (Math.sin(w) / 2) * Math.SQRT2, r = 2 * Math.sqrt(A) * al;
  return normalizar(A * ((A + 1) + (A - 1) * c + r), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - r), (A + 1) - (A - 1) * c + r, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - r);
};
/** Filtra no lugar. */
export const filtrarNoLugar = (x: Float32Array, f: Biquad) => {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = f.b0 * x0 + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    x[i] = y0;
  }
  return x;
};

// ---------- kit eletrônico sintetizado ----------
// Cada peça é uma receita curta: seno com queda de afinação (bumbo, tons), ruído filtrado (caixa, palma, chimbais,
// shaker) e soma de quadradas desafinadas (prato e chimbais, o som "metálico"). A afinação muda em semitons.

const envExp = (t: number, decai: number) => Math.exp(-t / decai);

export type SomPeca = {amostras: Float32Array; grupo: number};

/** Grupo de corte de fábrica: os dois chimbais se calam um ao outro. */
export const GRUPO_PADRAO: Partial<Record<PecaBateria, number>> = {chimbal_fechado: 1, chimbal_aberto: 1};

const metalico = (n: number, taxa: number, ruido: () => number, base: number) => {
  // seis quadradas em razões inarmônicas (como a TR-808), mais um pouco de ruído
  const razoes = [2, 3, 4.16, 5.43, 6.79, 8.21];
  const fases = razoes.map(() => 0);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < razoes.length; k++) {
      fases[k] += (base * razoes[k]) / taxa;
      s += fases[k] % 1 < 0.5 ? 1 : -1;
    }
    out[i] = s / razoes.length + ruido() * 0.3;
  }
  return out;
};

/** Uma batida de uma peça, mono, a 0 dBFS de pico mais ou menos (o volume vem da força, do kit e do mixer). */
export const sintetizarPeca = (peca: PecaBateria, taxa: number, afinacao = 0, semente = 1): Float32Array => {
  const fator = Math.pow(2, afinacao / 12);
  const ruido = geradorDe(sementeDe(peca, semente));
  const amostras = (s: number) => Math.max(1, Math.round(s * taxa));
  const seno = (dur: number, f0: number, f1: number, quedaF: number, decai: number, clique = 0) => {
    const n = amostras(dur);
    const out = new Float32Array(n);
    let fase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / taxa;
      const f = (f1 + (f0 - f1) * Math.exp(-t / quedaF)) * fator;
      fase += f / taxa;
      out[i] = Math.sin(DUAS_PI * fase) * envExp(t, decai) + (clique && t < 0.004 ? ruido() * clique * (1 - t / 0.004) : 0);
    }
    return out;
  };
  const ruidoFiltrado = (dur: number, decai: number, filtros: Biquad[], ataque = 0.0005) => {
    const n = amostras(dur);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = ruido();
    for (const f of filtros) filtrarNoLugar(out, f);
    for (let i = 0; i < n; i++) {
      const t = i / taxa;
      out[i] *= Math.min(1, t / ataque) * envExp(t, decai);
    }
    return out;
  };
  const somar = (a: Float32Array, b: Float32Array, gb = 1) => {
    const out = new Float32Array(Math.max(a.length, b.length));
    out.set(a);
    for (let i = 0; i < b.length; i++) out[i] += b[i] * gb;
    return out;
  };
  let som: Float32Array;
  switch (peca) {
    case 'bumbo':
      som = seno(0.6, 150, 48, 0.035, 0.17, 0.35);
      break;
    case 'caixa':
      som = somar(seno(0.25, 240, 180, 0.02, 0.07), ruidoFiltrado(0.3, 0.075, [passaAltas(1200 * fator, 0.7, taxa), passaBaixas(9000, 0.7, taxa)]), 1.4);
      break;
    case 'palma': {
      const base = ruidoFiltrado(0.4, 0.11, [passaFaixa(1200 * fator, 1.6, taxa)]);
      // três estalos rápidos antes da cauda, como mãos que não batem juntas
      for (let i = 0; i < base.length; i++) {
        const t = i / taxa;
        const estalo = t < 0.03 ? 0.6 + 0.4 * Math.cos((DUAS_PI * t) / 0.01) : 1;
        base[i] *= estalo * 2.2;
      }
      som = base;
      break;
    }
    case 'aro':
      som = somar(seno(0.08, 1700, 1700, 1, 0.012), ruidoFiltrado(0.05, 0.01, [passaFaixa(3500 * fator, 2, taxa)]), 0.6);
      break;
    case 'chimbal_fechado': {
      const m = metalico(amostras(0.12), taxa, ruido, 310 * fator);
      filtrarNoLugar(m, passaAltas(7000, 0.7, taxa));
      for (let i = 0; i < m.length; i++) m[i] *= envExp(i / taxa, 0.022) * 2.4;
      som = m;
      break;
    }
    case 'chimbal_aberto': {
      const m = metalico(amostras(0.6), taxa, ruido, 310 * fator);
      filtrarNoLugar(m, passaAltas(6500, 0.7, taxa));
      for (let i = 0; i < m.length; i++) m[i] *= envExp(i / taxa, 0.16) * 2;
      som = m;
      break;
    }
    case 'prato': {
      const m = metalico(amostras(1.8), taxa, ruido, 260 * fator);
      filtrarNoLugar(m, passaAltas(4500, 0.7, taxa));
      for (let i = 0; i < m.length; i++) m[i] *= envExp(i / taxa, 0.55) * 1.8;
      som = m;
      break;
    }
    case 'tom_grave':
      som = seno(0.5, 140, 95, 0.05, 0.16, 0.15);
      break;
    case 'tom_agudo':
      som = seno(0.4, 240, 170, 0.04, 0.12, 0.15);
      break;
    case 'shaker':
    default:
      som = ruidoFiltrado(0.12, 0.03, [passaFaixa(6000 * fator, 1.2, taxa)], 0.012);
      for (let i = 0; i < som.length; i++) som[i] *= 1.8;
      break;
  }
  // pico em 0,9: as peças ficam comparáveis entre si, e a força e o mixer dão o resto
  let pico = 0;
  for (let i = 0; i < som.length; i++) pico = Math.max(pico, Math.abs(som[i]));
  if (pico > 0) for (let i = 0; i < som.length; i++) som[i] *= 0.9 / pico;
  return som;
};

/** Kits que o motor sabe tocar. Só o sintetizado por enquanto; os de amostra (CC0 e MIT, conferidos dentro do pacote)
 *  entram na onda 2 com o mesmo formato (peça → som). */
export const KITS: {id: string; nome: string; licenca: string}[] = [{id: 'eletronico', nome: 'Eletrônico (sintetizado)', licenca: 'feito pelo Estúdio, sem arquivo'}];

// ---------- notas no tempo ----------
/** Ganho da força (1 a 127): curva suave, 100 fica perto de −3 dB e 127 em 0 dB. */
export const ganhoDaForca = (forca: number | undefined) => Math.pow(Math.min(127, Math.max(1, forca ?? 100)) / 127, 1.5);

/** Batida em que a nota toca, com o swing: as semicolcheias do contratempo atrasam até 1/12 de batida (tercina). */
export const comSwing = (em: number, swing: number) => {
  const p = em * 4;
  const r = Math.round(p);
  return Math.abs(p - r) < 1e-6 && r % 2 !== 0 ? em + swing / 12 : em;
};

export type EventoNota = {s: number; nota: NotaMusica; clipe: string};

/** As notas que um clipe de padrão toca, em segundos da música, até o fim do clipe (o padrão se repete). */
export const notasDoClipe = (m: MusicaP, c: ClipeMusicaP): EventoNota[] => {
  const p = c.padrao ? m.padroes[c.padrao] : undefined;
  if (!p || c.mudo) return [];
  const out: EventoNota[] = [];
  // o clipe começa `inicio` batidas dentro do padrão (um clipe dividido continua no compasso de onde parou)
  const inicio = c.inicio % p.dur;
  const voltas = Math.ceil((inicio + c.dur) / p.dur - 1e-9);
  for (let k = 0; k < voltas; k++) {
    for (const nota of p.notas) {
      if (typeof nota?.em !== 'number' || nota.em < 0 || nota.em >= p.dur) continue;
      const rel = k * p.dur + nota.em - inicio;
      if (rel < -1e-9 || rel >= c.dur - 1e-9) continue;
      // o swing vale pela posição no padrão, não no arranjo
      out.push({s: (c.em + rel + (comSwing(nota.em, m.swing) - nota.em)) * m.seg_por_batida, nota, clipe: c.id});
    }
  }
  return out.sort((a, b) => a.s - b.s);
};

// ---------- render de um canal (seco, antes do mixer) ----------
/** Sons das peças guardados por (peça, afinação, semente, taxa): a mesma batida não se sintetiza duas vezes. */
export type CacheSom = Map<string, Float32Array | Float32Array[]>;

const somDaPeca = (cache: CacheSom, peca: PecaBateria, afinacao: number, semente: number, taxa: number) => {
  const chave = `peca:${peca}:${afinacao}:${semente}:${taxa}`;
  let s = cache.get(chave) as Float32Array | undefined;
  if (!s) cache.set(chave, (s = sintetizarPeca(peca, taxa, afinacao, semente)));
  return s;
};

// balanço de potência igual: no centro os dois lados ficam inteiros; todo de um lado, o outro cala (0 exato)
const ladoDoPan = (p: number) => (p >= 1 ? 0 : Math.cos((p * Math.PI) / 2));
const panLei = (p: number): [number, number] => [p > 0 ? ladoDoPan(p) : 1, p < 0 ? ladoDoPan(-p) : 1];
const ganhoDeDb = (db: number) => Math.pow(10, db / 20);

/** Canal de bateria: cada nota é a peça do kit com força, volume e pan da peça; o grupo de corte cala a anterior. */
const renderBateria = (m: MusicaP, canal: CanalMusicaP, n: number, taxa: number, cache: CacheSom): Float32Array[] => {
  const L = new Float32Array(n), R = new Float32Array(n);
  const eventos = m.clipes.filter((c) => c.canal === canal.id && !c.mudo).flatMap((c) => notasDoClipe(m, c)).sort((a, b) => a.s - b.s);
  // fim de cada voz: o natural ou a próxima peça do mesmo grupo
  const vozes = eventos.filter((e) => e.nota.peca).map((e) => {
    const peca = e.nota.peca!;
    const aj = canal.pecas[peca] ?? {};
    const som = somDaPeca(cache, peca, aj.afinacao ?? 0, m.semente, taxa);
    return {ini: Math.round(e.s * taxa), som, peca, grupo: aj.grupo ?? GRUPO_PADRAO[peca] ?? 0, ganho: ganhoDaForca(e.nota.forca) * ganhoDeDb(aj.volume_db ?? 0), pan: aj.pan ?? 0, fim: 0};
  });
  for (let i = 0; i < vozes.length; i++) {
    const v = vozes[i];
    v.fim = v.ini + v.som.length;
    if (v.grupo) {
      const prox = vozes.slice(i + 1).find((w) => w.grupo === v.grupo && w.ini > v.ini);
      if (prox) v.fim = Math.min(v.fim, prox.ini);
    }
  }
  const corte = Math.round(0.005 * taxa); // 5 ms de queda quando o grupo corta, sem estalo
  for (const v of vozes) {
    const [gl, gr] = panLei(v.pan);
    const fimNatural = v.ini + v.som.length;
    const ate = Math.min(n, v.fim);
    for (let i = Math.max(0, v.ini); i < ate; i++) {
      let a = v.som[i - v.ini] * v.ganho;
      if (v.fim < fimNatural && v.fim - i < corte) a *= (v.fim - i) / corte;
      L[i] += a * gl;
      R[i] += a * gr;
    }
  }
  return [L, R];
};

/** Fonte no ritmo da música: se a taxa for outra, reamostra por interpolação linear (a janela pede 48 kHz ao
 *  navegador e o processo principal ao ffmpeg, então isto só vale para o que vier de fora). */
export const naTaxa = (f: FonteAudio, taxa: number): Float32Array[] => {
  if (f.taxa === taxa) return f.canais;
  const razao = f.taxa / taxa;
  return f.canais.map((c) => {
    const n = Math.floor(c.length / razao);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i * razao, i0 = Math.floor(x), fr = x - i0;
      out[i] = c[i0] * (1 - fr) + (c[i0 + 1] ?? c[i0]) * fr;
    }
    return out;
  });
};

/** Canal de áudio: cada clipe é o arquivo a partir do corte, com o ganho e os fades (lineares, como no vídeo). */
const renderAudio = (m: MusicaP, canal: CanalMusicaP, n: number, taxa: number, fontes: Record<string, FonteAudio | undefined>, faltando: Set<string>): Float32Array[] => {
  const L = new Float32Array(n), R = new Float32Array(n);
  for (const c of m.clipes) {
    if (c.canal !== canal.id || c.mudo || !c.audio) continue;
    const f = fontes[c.audio];
    if (!f) {
      faltando.add(c.audio);
      continue;
    }
    const src = naTaxa(f, taxa);
    const ini = Math.round(c.em_s * taxa);
    const dur = Math.round(c.dur_s * taxa);
    const corte = Math.round(c.corte_s * taxa);
    const g = ganhoDeDb(c.ganho_db);
    const fi = c.fade_in_s * taxa, fo = c.fade_out_s * taxa;
    const mono = src.length === 1;
    const sl = src[0], sr = src[1] ?? src[0];
    const ate = Math.min(n, ini + dur, ini + Math.max(0, sl.length - corte));
    for (let i = Math.max(0, ini); i < ate; i++) {
      const k = i - ini;
      let a = g;
      if (fi > 0 && k < fi) a *= k / fi;
      if (fo > 0 && dur - k < fo) a *= (dur - k) / fo;
      const j = corte + k;
      L[i] += sl[j] * a * (mono ? MONO_EM_ESTEREO : 1);
      R[i] += sr[j] * a * (mono ? MONO_EM_ESTEREO : 1);
    }
  }
  return [L, R];
};

// ---------- mixer ----------
/** Compressor de alimentação direta, com detector de pico ligado nos dois lados (não mexe na imagem estéreo). */
const comprimir = (canais: Float32Array[], c: FaixaMixerP['compressor'], taxa: number) => {
  const at = Math.exp(-1 / ((c.ataque_ms / 1000) * taxa));
  const so = Math.exp(-1 / ((c.soltura_ms / 1000) * taxa));
  const [L, R] = canais;
  const makeup = ganhoDeDb(c.ganho_db);
  let env = 0;
  for (let i = 0; i < L.length; i++) {
    const x = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    env = x > env ? at * env + (1 - at) * x : so * env + (1 - so) * x;
    const nivel = env > 1e-6 ? 20 * Math.log10(env) : -120;
    const acima = nivel - c.limiar_db;
    const g = (acima > 0 ? ganhoDeDb(-acima * (1 - 1 / c.razao)) : 1) * makeup;
    L[i] *= g;
    R[i] *= g;
  }
};

const processarFaixa = (canais: Float32Array[], f: FaixaMixerP, taxa: number) => {
  const {graves_db, medios_db, agudos_db} = f.eq;
  for (const x of canais) {
    if (graves_db) filtrarNoLugar(x, prateleiraGraves(200, graves_db, taxa));
    if (medios_db) filtrarNoLugar(x, sino(1000, 0.9, medios_db, taxa));
    if (agudos_db) filtrarNoLugar(x, prateleiraAgudos(5000, agudos_db, taxa));
  }
  if (f.compressor.ativo) comprimir(canais, f.compressor, taxa);
  const g = ganhoDeDb(f.volume_db);
  const [gl, gr] = panLei(f.pan);
  const [L, R] = canais;
  for (let i = 0; i < L.length; i++) {
    L[i] *= g * gl;
    R[i] *= g * gr;
  }
};

// Freeverb (Jezar at Dreampoint, domínio público): oito pentes com amortecimento e quatro passa-tudo por lado, com o
// lado direito 23 amostras mais largo. Os tamanhos são os do original a 44,1 kHz, escalados para a taxa.
const PENTES = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const PASSA_TUDO = [556, 441, 341, 225];
const ESPALHAR = 23;
export const reverberar = (entrada: Float32Array[], tamanho: number, amortecimento: number, taxa: number): Float32Array[] => {
  const escala = taxa / 44100;
  const n = entrada[0].length;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = (entrada[0][i] + entrada[1][i]) * 0.015; // o ganho fixo do Freeverb
  const realimentar = 0.7 + 0.28 * tamanho;
  const amort = amortecimento * 0.4;
  return [0, ESPALHAR].map((desvio) => {
    const out = new Float32Array(n);
    for (const p of PENTES) {
      const tam = Math.max(1, Math.round((p + desvio) * escala));
      const buf = new Float32Array(tam);
      let k = 0, filtro = 0;
      for (let i = 0; i < n; i++) {
        const y = buf[k];
        filtro = y * (1 - amort) + filtro * amort;
        buf[k] = mono[i] + filtro * realimentar;
        out[i] += y;
        if (++k >= tam) k = 0;
      }
    }
    for (const p of PASSA_TUDO) {
      const tam = Math.max(1, Math.round((p + desvio) * escala));
      const buf = new Float32Array(tam);
      let k = 0;
      for (let i = 0; i < n; i++) {
        const b = buf[k];
        const y = -out[i] + b;
        buf[k] = out[i] + b * 0.5;
        out[i] = y;
        if (++k >= tam) k = 0;
      }
    }
    return out;
  });
};

// ---------- sintetizadores da casa (item 14) ----------
// Quatro sons de partida, todos da mesma receita: dois osciladores com PolyBLEP (serra e quadrada sem o serrilhado do
// ingênuo), um sub em seno no baixo, filtro passa-baixas de dois polos com envelope próprio e o envelope de volume
// (ataque, queda, sustentação, soltura). As macros mexem nos números da receita; nada é aleatório.
type ReceitaSint = {onda: 'serra' | 'quadrada'; mistura: number; desafina_cents: number; sub: number; corte_hz: number; corte_brilho_hz: number; env_filtro_oitavas: number;
  queda_filtro_s: number; ataque_s: number; queda_s: number; sustenta: number; soltura_s: number; ganho: number; vibrato: boolean};

export const receitaDe = (preset: PresetSintetizador, m: Required<MacrosSintetizador>): ReceitaSint => {
  const ataque = (base: number, max: number) => base + m.ataque * max;
  const soltura = (base: number, max: number) => base + m.soltura * max;
  switch (preset) {
    case 'baixo':
      return {onda: 'serra', mistura: 0.3 * m.cor, desafina_cents: 4 * m.cor, sub: 0.6, corte_hz: 160, corte_brilho_hz: 2400 * m.brilho, env_filtro_oitavas: 1.4,
        queda_filtro_s: 0.18, ataque_s: ataque(0.003, 0.2), queda_s: 0.3, sustenta: 0.65, soltura_s: soltura(0.04, 0.5), ganho: 0.55, vibrato: false};
    case 'pad':
      return {onda: 'serra', mistura: 0.5, desafina_cents: 5 + 16 * m.cor, sub: 0, corte_hz: 500, corte_brilho_hz: 5000 * m.brilho, env_filtro_oitavas: 0.5,
        queda_filtro_s: 1.2, ataque_s: ataque(0.35, 1.8), queda_s: 1, sustenta: 0.8, soltura_s: soltura(0.5, 2.8), ganho: 0.22, vibrato: false};
    case 'lead':
      return {onda: 'quadrada', mistura: 0.2 + 0.6 * m.cor, desafina_cents: 6 * m.cor, sub: 0, corte_hz: 900, corte_brilho_hz: 7000 * m.brilho, env_filtro_oitavas: 1,
        queda_filtro_s: 0.3, ataque_s: ataque(0.005, 0.4), queda_s: 0.25, sustenta: 0.75, soltura_s: soltura(0.06, 0.9), ganho: 0.28, vibrato: true};
    case 'pluck':
    default:
      return {onda: 'serra', mistura: 0.4 * m.cor, desafina_cents: 7 * m.cor, sub: 0, corte_hz: 250, corte_brilho_hz: 6000 * m.brilho, env_filtro_oitavas: 3,
        queda_filtro_s: 0.14, ataque_s: ataque(0.001, 0.15), queda_s: 0.4, sustenta: 0, soltura_s: soltura(0.08, 0.7), ganho: 0.4, vibrato: false};
  }
};

/** Correção PolyBLEP de uma descontinuidade em `t` (fase de 0 a 1, `dt` = passo de fase). */
const polyBlep = (t: number, dt: number) => {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
};
const serra = (fase: number, dt: number) => 2 * fase - 1 - polyBlep(fase, dt);
const quadrada = (fase: number, dt: number) => (fase < 0.5 ? 1 : -1) + polyBlep(fase, dt) - polyBlep((fase + 0.5) % 1, dt);

/** Uma nota do sintetizador, mono, com a soltura depois de `dur_s`. */
export const notaDoSintetizador = (midi: number, dur_s: number, r: ReceitaSint, taxa: number, forca = 100): Float32Array => {
  const n = Math.max(1, Math.round((dur_s + r.soltura_s) * taxa));
  const out = new Float32Array(n);
  const f0 = 440 * Math.pow(2, (midi - 69) / 12);
  const fatores = [Math.pow(2, -r.desafina_cents / 1200), Math.pow(2, r.desafina_cents / 1200)];
  const fases = [0, 0.25];
  let faseSub = 0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  let filtro: Biquad = passaBaixas(1000, 0.9, taxa);
  const g = ganhoDaForca(forca) * r.ganho;
  const fimNota = dur_s * taxa;
  let nivelNaSoltura = 0;
  for (let i = 0; i < n; i++) {
    const t = i / taxa;
    // envelope de volume: ataque linear, queda exponencial até a sustentação, soltura exponencial a partir do nível
    let amp: number;
    if (i < fimNota) {
      amp = t < r.ataque_s ? t / r.ataque_s : r.sustenta + (1 - r.sustenta) * Math.exp(-(t - r.ataque_s) / Math.max(0.001, r.queda_s / 3));
      nivelNaSoltura = amp;
    } else {
      amp = nivelNaSoltura * Math.exp(-((i - fimNota) / taxa) / Math.max(0.001, r.soltura_s / 4));
    }
    if (i % 32 === 0) {
      const env = Math.exp(-t / Math.max(0.001, r.queda_filtro_s));
      const corte = Math.min(taxa * 0.45, (r.corte_hz + r.corte_brilho_hz) * Math.pow(2, r.env_filtro_oitavas * env));
      filtro = passaBaixas(corte, 0.9, taxa);
    }
    const vib = r.vibrato && t > 0.3 ? Math.pow(2, (15 * Math.sin(2 * Math.PI * 5.5 * t)) / 1200) : 1;
    let x = 0;
    for (let k = 0; k < 2; k++) {
      const dt = (f0 * fatores[k] * vib) / taxa;
      const principal = r.onda === 'serra' ? serra(fases[k], dt) : quadrada(fases[k], dt);
      const outra = r.onda === 'serra' ? quadrada(fases[k], dt) : serra(fases[k], dt);
      x += (principal * (1 - r.mistura) + outra * r.mistura) * 0.5;
      fases[k] = (fases[k] + dt) % 1;
    }
    if (r.sub) {
      x += Math.sin(2 * Math.PI * faseSub) * r.sub;
      faseSub = (faseSub + f0 / 2 / taxa) % 1;
    }
    const y = filtro.b0 * x + filtro.b1 * x1 + filtro.b2 * x2 - filtro.a1 * y1 - filtro.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y * amp * g;
  }
  return out;
};

/** Canal de sintetizador: cada nota do padrão (MIDI), com a duração dela (padrão: um passo da grade), até o fim do clipe. */
const renderSintetizador = (m: MusicaP, canal: CanalMusicaP, n: number, taxa: number): Float32Array[] => {
  const L = new Float32Array(n), R = new Float32Array(n);
  const r = receitaDe(canal.preset, canal.macros);
  for (const c of m.clipes) {
    if (c.canal !== canal.id || c.mudo || !c.padrao) continue;
    const p = m.padroes[c.padrao];
    if (!p) continue;
    const fimClipe = (c.em + c.dur) * m.seg_por_batida;
    for (const e of notasDoClipe(m, c)) {
      if (typeof e.nota.nota !== 'number') continue;
      const dur_s = Math.max(0.01, Math.min((e.nota.dur ?? p.dur / p.passos) * m.seg_por_batida, fimClipe - e.s));
      const som = notaDoSintetizador(e.nota.nota, dur_s, r, taxa, e.nota.forca);
      const ini = Math.round(e.s * taxa);
      for (let i = Math.max(0, ini), k = i - ini; i < n && k < som.length; i++, k++) {
        L[i] += som[k] * MONO_EM_ESTEREO;
        R[i] += som[k] * MONO_EM_ESTEREO;
      }
    }
  }
  return [L, R];
};

// ---------- a música inteira ----------
export type ResultadoSom = {canais: Float32Array[]; taxa: number; duracao_s: number; avisos: string[]; faltando: string[]; faixas?: Record<string, Float32Array[]>};

/** Chave do som seco de um canal: o que muda o que ele toca (não o mixer). */
const chaveDoCanal = (m: MusicaP, canal: CanalMusicaP, n: number, taxa: number, fontes: Record<string, FonteAudio | undefined>) => {
  const clipes = m.clipes.filter((c) => c.canal === canal.id);
  const padroes = canal.tipo !== 'audio' ? [...new Set(clipes.map((c) => c.padrao))].map((p) => (p ? m.padroes[p] : null)) : [];
  const audios = canal.tipo === 'audio' ? clipes.map((c) => (c.audio ? `${c.audio}:${fontes[c.audio]?.canais[0]?.length ?? 'falta'}:${fontes[c.audio]?.taxa ?? 0}` : '')) : [];
  return `canal:${JSON.stringify({c: {...canal, mudo: false, solo: false}, clipes, padroes, audios, bpm: m.bpm, swing: m.swing, semente: m.semente, n, taxa})}`;
};

/** A música inteira, em estéreo: cada canal seco (guardado em `cache` pela chave, para a prévia só refazer o que mudou),
 *  as faixas do mixer e o master. Mudo e solo valem por canal e por faixa: havendo solo, só toca o que tem solo.
 *  `fontes` vem por arquivo (o que faltar fica calado e volta em `faltando`). */
export const renderizarMusica = (doc: DocMusica, fontes: Record<string, FonteAudio | undefined>,
  o: {taxa?: number; cache?: CacheSom; porFaixa?: boolean; duracao_s?: number} = {}): ResultadoSom => {
  const taxa = o.taxa ?? TAXA_MUSICA;
  const cache = o.cache ?? new Map();
  const {musica: m, avisos} = resolverMusica(doc);
  const duracao_s = o.duracao_s ?? m.duracao_s;
  const n = Math.max(1, Math.ceil(duracao_s * taxa));
  const faltando = new Set<string>();
  const algumSoloCanal = m.canais.some((c) => c.solo);
  const algumSoloFaixa = m.faixas.some((f) => f.solo);
  // o cache guarda três camadas: o som seco de cada canal, cada faixa já processada (EQ, compressor, volume e pan) e o
  // retorno do reverb; mexer num volume refaz só aquela faixa (e o reverb, se ela manda para ele). No fim, sai do cache o
  // que este render não usou (as batidas de cada peça ficam: são pequenas)
  const usadas = new Set<string>();
  const doCache = <T,>(chave: string, fazer: () => T): T => {
    usadas.add(chave);
    let v = cache.get(chave) as T | undefined;
    if (v === undefined) {
      v = fazer();
      cache.set(chave, v as never);
    }
    return v;
  };
  const secos = new Map<string, {chave: string; som: Float32Array[]}[]>();
  for (const canal of m.canais) {
    if (canal.mudo || (algumSoloCanal && !canal.solo)) continue;
    const chave = chaveDoCanal(m, canal, n, taxa, fontes);
    const faltavam = faltando.size;
    let som: Float32Array[];
    if (canal.tipo === 'bateria') som = doCache(chave, () => renderBateria(m, canal, n, taxa, cache));
    else if (canal.tipo === 'sintetizador') som = doCache(chave, () => renderSintetizador(m, canal, n, taxa));
    else {
      const antes = cache.get(chave) as Float32Array[] | undefined;
      som = antes ?? renderAudio(m, canal, n, taxa, fontes, faltando);
      if (!antes && faltando.size === faltavam) cache.set(chave, som);
      if (cache.has(chave)) usadas.add(chave);
      for (const c of m.clipes) if (c.canal === canal.id && c.audio && !fontes[c.audio]) faltando.add(c.audio);
    }
    secos.set(canal.faixa_mixer, [...(secos.get(canal.faixa_mixer) ?? []), {chave, som}]);
  }
  const L = new Float32Array(n), R = new Float32Array(n);
  const envios: {chave: string; som: Float32Array[]; quanto: number}[] = [];
  const faixas: Record<string, Float32Array[]> = {};
  for (const f of m.faixas) {
    const entram = secos.get(f.id);
    if (!entram || f.mudo || (algumSoloFaixa && !f.solo)) continue;
    const chave = `faixa:${JSON.stringify({f: {...f, mudo: false, solo: false, reverb: 0}, de: entram.map((e) => e.chave)})}`;
    const bus = doCache(chave, () => {
      const b = [Float32Array.from(entram[0].som[0]), Float32Array.from(entram[0].som[1])];
      for (const e of entram.slice(1)) for (let k = 0; k < 2; k++) for (let i = 0; i < n; i++) b[k][i] += e.som[k][i];
      processarFaixa(b, f, taxa);
      return b;
    });
    for (let i = 0; i < n; i++) {
      L[i] += bus[0][i];
      R[i] += bus[1][i];
    }
    if (f.reverb > 0) envios.push({chave, som: bus, quanto: f.reverb});
    if (o.porFaixa) faixas[f.id] = bus;
  }
  if (envios.length) {
    const r = m.master.reverb;
    const volta = doCache(`reverb:${JSON.stringify({r: [r.tamanho, r.amortecimento], e: envios.map((e) => [e.chave, e.quanto]), taxa})}`, () => {
      const envio = [new Float32Array(n), new Float32Array(n)];
      for (const e of envios) for (let k = 0; k < 2; k++) for (let i = 0; i < n; i++) envio[k][i] += e.som[k][i] * e.quanto;
      return reverberar(envio, r.tamanho, r.amortecimento, taxa);
    });
    const g = ganhoDeDb(r.volume_db);
    for (let i = 0; i < n; i++) {
      L[i] += volta[0][i] * g;
      R[i] += volta[1][i] * g;
    }
  }
  for (const k of [...cache.keys()]) if (!usadas.has(k) && !k.startsWith('peca:')) cache.delete(k);
  const gm = ganhoDeDb(m.master.volume_db);
  if (gm !== 1) for (let i = 0; i < n; i++) {
    L[i] *= gm;
    R[i] *= gm;
  }
  for (const a of faltando) avisos.push(`o áudio ${a} não foi lido; o clipe fica calado`);
  return {canais: [L, R], taxa, duracao_s: n / taxa, avisos, faltando: [...faltando], ...(o.porFaixa ? {faixas} : {})};
};

/** Uma batida só, para o pad e a prévia de som: a peça com o ajuste do canal, em estéreo. */
export const somDeUmaBatida = (peca: PecaBateria, aj: {volume_db?: number; pan?: number; afinacao?: number} = {}, forca = 100, semente = 1, taxa = TAXA_MUSICA) => {
  const s = sintetizarPeca(peca, taxa, aj.afinacao ?? 0, semente);
  const g = ganhoDaForca(forca) * ganhoDeDb(aj.volume_db ?? 0);
  const [gl, gr] = panLei(aj.pan ?? 0);
  return [s.map((x) => x * g * gl), s.map((x) => x * g * gr)];
};

/** WAV PCM de 16 bits, sem Node (o worker da janela grava o render que vai para o vídeo com isto; o processo principal
 *  usa gravarWav do ffmpeg-som.ts, que dá os mesmos bytes). */
export const codificarWav16 = (canais: Float32Array[], taxa: number): Uint8Array<ArrayBuffer> => {
  const nc = canais.length;
  const n = canais[0]?.length ?? 0;
  const buf = new ArrayBuffer(44 + n * nc * 2);
  const v = new DataView(buf);
  const texto = (p: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i));
  };
  texto(0, 'RIFF');
  v.setUint32(4, buf.byteLength - 8, true);
  texto(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nc, true);
  v.setUint32(24, taxa, true);
  v.setUint32(28, taxa * nc * 2, true);
  v.setUint16(32, nc * 2, true);
  v.setUint16(34, 16, true);
  texto(36, 'data');
  v.setUint32(40, n * nc * 2, true);
  let p = 44;
  for (let i = 0; i < n; i++) {
    for (const c of canais) {
      v.setInt16(p, Math.round(Math.max(-1, Math.min(1, c[i])) * 32767), true);
      p += 2;
    }
  }
  return new Uint8Array(buf);
};
