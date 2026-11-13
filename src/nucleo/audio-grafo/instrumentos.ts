// Os instrumentos e as curvas da música renderizados por trecho (M-04): o som seco de um canal (bateria, sintetizador,
// áudio), o ganho do sidechain por notas e a automação de volume, para qualquer intervalo [de, ate) da música sem fazer o
// resto. Com isso o render canônico não guarda nenhum som da música inteira por canal: o executor lê cada canal por
// trecho (fontePorTrechos) e cada curva por bloco.
//
// Cada amostra sai igual à da função de buffer inteiro de musica-som.ts (renderBateria, renderSintetizador, renderAudio,
// ganhoDoSidechain, ganhoDaAutomacao), que continuam lá, sem mudar, para o motor antigo (o oráculo): as vozes, as notas e
// os clipes somam na mesma ordem e com o mesmo arredondamento, só que restritos ao trecho. A preparação (lista de vozes,
// receita, reamostragem) é feita uma vez; o trecho só soma. Ver docs/audio-grafo.md, "Memória".
import type {FonteAudio} from '../loudness';
import type {CanalMusicaP, MusicaP} from '../musica';
import {GRUPO_PADRAO, MONO_EM_ESTEREO, ganhoDaForca, naTaxa, notaDoSintetizador, notasDoClipe, receitaDe, somDaPeca, type CacheSom} from '../musica-som';
import {ganhoDeDb, panLei} from './processadores';
import type {CurvaParam} from './tipos';

/** Faz as amostras [de, ate) de um som estéreo (0 ≤ de < ate ≤ n). */
export type RenderTrecho = (de: number, ate: number) => Float32Array[];

/** Canal de bateria por trecho (renderBateria). */
export const bateriaPorTrecho = (m: MusicaP, canal: CanalMusicaP, n: number, taxa: number, cache: CacheSom): RenderTrecho => {
  const eventos = m.clipes.filter((c) => c.canal === canal.id && !c.mudo).flatMap((c) => notasDoClipe(m, c)).sort((a, b) => a.s - b.s);
  const vozes = eventos.filter((e) => e.nota.peca).map((e) => {
    const peca = e.nota.peca!;
    const aj = canal.pecas[peca] ?? {};
    const som = somDaPeca(cache, peca, aj.afinacao ?? 0, m.semente, taxa);
    return {ini: Math.round(e.s * taxa), som, peca, grupo: aj.grupo ?? GRUPO_PADRAO[peca] ?? 0, ganho: ganhoDaForca(e.nota.forca) * ganhoDeDb(aj.volume_db ?? 0), pan: aj.pan ?? 0, fim: 0,
      gl: 0, gr: 0};
  });
  for (let i = 0; i < vozes.length; i++) {
    const v = vozes[i];
    v.fim = v.ini + v.som.length;
    if (v.grupo) {
      const prox = vozes.slice(i + 1).find((w) => w.grupo === v.grupo && w.ini > v.ini);
      if (prox) v.fim = Math.min(v.fim, prox.ini);
    }
    [v.gl, v.gr] = panLei(v.pan);
  }
  const corte = Math.round(0.005 * taxa);
  return (de, ate) => {
    const L = new Float32Array(ate - de), R = new Float32Array(ate - de);
    for (const v of vozes) {
      if (v.ini >= ate) break; // as vozes vêm em ordem de início
      const fimNatural = v.ini + v.som.length;
      const fim = Math.min(n, v.fim, ate);
      for (let i = Math.max(0, v.ini, de); i < fim; i++) {
        let a = v.som[i - v.ini] * v.ganho;
        if (v.fim < fimNatural && v.fim - i < corte) a *= (v.fim - i) / corte;
        L[i - de] += a * v.gl;
        R[i - de] += a * v.gr;
      }
    }
    return [L, R];
  };
};

/** Canal de sintetizador por trecho (renderSintetizador). Uma nota que atravessa a borda do trecho é feita uma vez e
 *  guardada até acabar. */
export const sintetizadorPorTrecho = (m: MusicaP, canal: CanalMusicaP, n: number, taxa: number): RenderTrecho => {
  const r = receitaDe(canal.preset, canal.macros);
  const notas: {ini: number; tam: number; midi: number; dur_s: number; forca?: number}[] = [];
  for (const c of m.clipes) {
    if (c.canal !== canal.id || c.mudo || !c.padrao) continue;
    const p = m.padroes[c.padrao];
    if (!p) continue;
    const fimClipe = (c.em + c.dur) * m.seg_por_batida;
    for (const e of notasDoClipe(m, c)) {
      if (typeof e.nota.nota !== 'number') continue;
      const dur_s = Math.max(0.01, Math.min((e.nota.dur ?? p.dur / p.passos) * m.seg_por_batida, fimClipe - e.s));
      // o mesmo tamanho que notaDoSintetizador vai dar, sem fazer a nota
      notas.push({ini: Math.round(e.s * taxa), tam: Math.max(1, Math.round((dur_s + r.soltura_s) * taxa)), midi: e.nota.nota, dur_s, forca: e.nota.forca});
    }
  }
  const vivas = new Map<number, Float32Array>();
  return (de, ate) => {
    const L = new Float32Array(ate - de), R = new Float32Array(ate - de);
    for (const [k] of vivas) if (notas[k].ini + notas[k].tam <= de) vivas.delete(k);
    for (let k = 0; k < notas.length; k++) {
      const x = notas[k];
      const a = Math.max(0, x.ini, de), b = Math.min(n, ate, x.ini + x.tam);
      if (a >= b) continue;
      let som = vivas.get(k);
      if (!som) {
        som = notaDoSintetizador(x.midi, x.dur_s, r, taxa, x.forca);
        if (x.ini + x.tam > ate) vivas.set(k, som);
      }
      for (let i = a; i < b; i++) {
        const v = som[i - x.ini];
        L[i - de] += v * MONO_EM_ESTEREO;
        R[i - de] += v * MONO_EM_ESTEREO;
      }
    }
    return [L, R];
  };
};

/** Canal de áudio por trecho (renderAudio). Os áudios que faltam entram em `faltando` já na preparação. */
export const audioPorTrecho = (m: MusicaP, canal: CanalMusicaP, n: number, taxa: number, fontes: Record<string, FonteAudio | undefined>, faltando: Set<string>): RenderTrecho => {
  const clipes: {ini: number; dur: number; corte: number; g: number; fi: number; fo: number; f: FonteAudio; src?: Float32Array[]}[] = [];
  for (const c of m.clipes) {
    if (c.canal !== canal.id || c.mudo || !c.audio) continue;
    const f = fontes[c.audio];
    if (!f) {
      faltando.add(c.audio);
      continue;
    }
    clipes.push({ini: Math.round(c.em_s * taxa), dur: Math.round(c.dur_s * taxa), corte: Math.round(c.corte_s * taxa), g: ganhoDeDb(c.ganho_db), fi: c.fade_in_s * taxa,
      fo: c.fade_out_s * taxa, f});
  }
  return (de, ate) => {
    const L = new Float32Array(ate - de), R = new Float32Array(ate - de);
    for (const c of clipes) {
      const {ini, dur, corte, g, fi, fo} = c;
      if (ini >= ate || ini + dur <= de) continue;
      const src = (c.src ??= naTaxa(c.f, taxa));
      const mono = src.length === 1;
      const sl = src[0], sr = src[1] ?? src[0];
      const fim = Math.min(n, ini + dur, ini + Math.max(0, sl.length - corte), ate);
      for (let i = Math.max(0, ini, de); i < fim; i++) {
        const k = i - ini;
        let a = g;
        if (fi > 0 && k < fi) a *= k / fi;
        if (fo > 0 && dur - k < fo) a *= (dur - k) / fo;
        const j = corte + k;
        L[i - de] += sl[j] * a * (mono ? MONO_EM_ESTEREO : 1);
        R[i - de] += sr[j] * a * (mono ? MONO_EM_ESTEREO : 1);
      }
    }
    return [L, R];
  };
};

/** Uma curva por amostra em [0, n), calculada por trecho; antes do começo vale a amostra 0 e depois do fim a n − 1 (como
 *  a curva inteira no executor). `fazer(de, ate, out)` escreve as amostras [de, ate) em out[0..). */
const curvaPorTrecho = (n: number, fazer: (de: number, ate: number, out: Float32Array) => void): CurvaParam => {
  const ponta = new Float32Array(1);
  return (inicio, qtd, out) => {
    const a = Math.min(qtd, Math.max(0, -inicio)), b = Math.max(a, Math.min(qtd, n - inicio));
    if (a > 0) {
      fazer(0, 1, ponta);
      out.fill(ponta[0], 0, a);
    }
    if (b > a) fazer(inicio + a, inicio + b, a ? out.subarray(a) : out);
    if (b < qtd) {
      fazer(n - 1, n, ponta);
      out.fill(ponta[0], b, qtd);
    }
  };
};

/** O ganho do sidechain por notas (ganhoDoSidechain), por trecho. `disparos` em ordem crescente. */
export const curvaDoSidechain = (disparos: number[], sc: {quanto_db: number; ataque_ms: number; soltura_ms: number}, n: number, taxa: number,
  deslocamento = 0): CurvaParam => {
  const at = Math.round((sc.ataque_ms / 1000) * taxa);
  const so = Math.max(1, Math.round((sc.soltura_ms / 1000) * taxa));
  const centros = disparos.map((t) => Math.round(t * taxa) + deslocamento); // o atraso manual de quem dispara (M-07)
  let red = new Float32Array(0);
  return curvaPorTrecho(n, (de, ate, out) => {
    const tam = ate - de;
    if (red.length < tam) red = new Float32Array(tam);
    red.fill(0, 0, tam);
    // só os disparos que alcançam o trecho: i0 − at < ate e i0 + so > de (busca binária pelo primeiro)
    let lo = 0, hi = centros.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (centros[mid] + so <= de) lo = mid + 1;
      else hi = mid;
    }
    for (let k = lo; k < centros.length; k++) {
      const i0 = centros[k];
      if (i0 - at >= ate) break;
      if (i0 + so <= de) continue;
      for (let i = Math.max(0, i0 - at, de); i < Math.min(n, i0, ate); i++) {
        const v = (i - (i0 - at)) / at;
        if (v > red[i - de]) red[i - de] = v;
      }
      for (let i = Math.max(0, i0, de); i < Math.min(n, i0 + so, ate); i++) {
        const x = 1 - (i - i0) / so;
        if (x * x > red[i - de]) red[i - de] = x * x;
      }
    }
    for (let i = 0; i < tam; i++) out[i] = red[i] > 0 ? Math.pow(10, (-sc.quanto_db * red[i]) / 20) : 1;
  });
};

/** A automação de volume por pontos em ganho linear (ganhoDaAutomacao), por trecho. */
export const curvaDaAutomacao = (pontos: {s: number; db: number}[], n: number, taxa: number): CurvaParam => {
  let k = 0, ultimo = -1;
  return curvaPorTrecho(n, (de, ate, out) => {
    if (!pontos.length) {
      out.fill(1, 0, ate - de);
      return;
    }
    if (de < ultimo) k = 0; // a busca só anda para a frente; voltar no tempo recomeça
    for (let i = de; i < ate; i++) {
      const s = i / taxa;
      while (k < pontos.length - 1 && pontos[k + 1].s <= s) k++;
      const a = pontos[k], b = pontos[k + 1];
      const db = s <= pontos[0].s ? pontos[0].db : !b ? a.db : a.db + ((b.db - a.db) * (s - a.s)) / Math.max(1e-9, b.s - a.s);
      out[i - de] = Math.pow(10, db / 20);
    }
    ultimo = ate;
  });
};
