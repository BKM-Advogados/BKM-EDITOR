// Narração gravada inteira (Onda B, docs/narracao.md): quem grava a fala do vídeo de uma vez, num áudio só, divide essa
// gravação nas cenas pela transcrição (as palavras com tempo, [{w, s, e}] em ms do arquivo, do `transcrever`).
//
// A proposta (`proporDivisao`) acha onde cada cena começa e termina na gravação:
//  - com o texto falado das cenas (`cenas[i].narracao.texto`), alinha o texto de todas, em ordem, às palavras transcritas
//    (sem diferença de acento, caixa e pontuação, e tolerante a palavra trocada, a mais e a menos: Needleman-Wunsch
//    semiglobal, com a palavra parecida valendo como a mesma). O corte entre duas cenas cai na maior pausa perto da
//    fronteira que o alinhamento achou;
//  - sem texto, corta nas pausas mais longas (a pausa depois de ponto final vale mais), até o número de cenas. Pausa
//    curta demais (menos de 250 ms) não vira corte: cena que sobra fica sem fala, com aviso;
//  - com `cortes` (ms do arquivo, de quem revisou a prévia), cada corte vai para a pausa mais perto.
// O corte cai sempre numa pausa entre palavras, nunca no meio de uma: o trecho de cada cena vai de um pouco antes da
// primeira palavra dela a um pouco depois da última (`margem_ms`, padrão 200 ms), sem passar do meio da pausa vizinha.
//
// A aplicação (`patchDaDivisao`) não corta o arquivo: cada cena ganha um clipe de voz que toca o trecho dela da MESMA
// gravação (`corte_ms` e `duracao_ms`, como os clipes divididos à mão), marcado com `narracao_gravada` {cena}. A duração das
// cenas se ajusta à fala pela mesma conta do "Ajustar as cenas à fala" (folga + trecho + margem; o resto do som anda
// junto), e as legendas de cada clipe são geradas da transcrição, para a âncora de palavra (`em_palavra`) achar a fala de
// cada cena. Tudo num patch só: o diário tem uma entrada e o Reverter desfaz.
import jsonpatch, {type Operation} from 'fast-json-patch';
import {norm} from './ancora-palavra';
import {novaFaixaAudio, novoAudioCenas, papelDe, type AudioCenas, type ClipeAudio} from './audio';
import {idLivre, type DocCenas} from './cenas';
import type {OperacaoPatch} from './documentos';
import {formatoDoVideo} from './formatos';
import {aplicarDicionario, arquivoDaFala, DICIONARIO_CASA, legendasDaFala, type LegendasCenas, type PalavraLegenda} from './legendas';
import {configDaNarracao} from './narracao';
import {ajustarCenasAFala, ehMarcaGravada, temposDasCenas} from './narracao-cenas';

export const MARGEM_CORTE_MS = 200; // antes da primeira e depois da última palavra do trecho de cada cena
export const PAUSA_MIN_MS = 250; // sem texto, pausa menor que isto não vira corte
const BONUS_PONTO_MS = 300; // a pausa depois de ".", "!", "?" e "…" vale mais
const BONUS_VIRGULA_MS = 100; // depois de ",", ";" e ":"
const MULTA_PALAVRA_MS = 400; // levar uma palavra alinhada a uma cena para a vizinha (a fronteira anda até 2 palavras)
const ALCANCE_FRONTEIRA = 2;
const PARECIDA = 0.7; // semelhança (1 − Levenshtein / maior) a partir da qual a palavra transcrita vale a do texto
const PALAVRA_A_MAIS = 0.5; // falar uma palavra fora do texto custa menos que pular uma do texto: quem grava improvisa
const MAX_CELULAS = 40_000_000; // texto × transcrição; acima disto, a divisão pede para ir por partes

export type CenaParaDividir = {id: string; texto?: string};
export type MetodoTrecho = 'texto' | 'pausas' | 'cortes';
export type TrechoDaCena = {
  cena: string;
  n: number;
  /** o trecho da gravação (ms do arquivo); null quando a cena ficou sem fala */
  de_ms: number | null;
  ate_ms: number | null;
  /** índices da primeira e da última palavra (na lista em ordem) */
  palavras: [number, number] | null;
  texto: string;
  metodo: MetodoTrecho;
  /** com texto: a fração das palavras do texto da cena achadas na fala */
  acerto?: number;
};
export type CorteProposto = {ms: number; pausa_ms: number; antes: string; depois: string; entre: [number, number]};
export type PropostaDivisao = {trechos: TrechoDaCena[]; cortes: CorteProposto[]; metodo: 'texto' | 'pausas' | 'misto' | 'cortes'; avisos: string[]; palavras: number};
export type OpcoesDivisao = {margem_ms?: number; duracao_ms?: number; cortes?: number[]; pausa_min_ms?: number};

// ---------- as palavras ----------

/** As palavras em ordem, sem sobreposição (o fim de uma não passa do começo da seguinte) e sem as vazias. */
export const palavrasEmOrdem = (palavras: readonly PalavraLegenda[]): PalavraLegenda[] => {
  const ps = palavras.filter((p) => p && typeof p.w === 'string' && p.w.trim() && Number.isFinite(p.s) && Number.isFinite(p.e))
    .map((p) => ({...p, e: Math.max(p.s, p.e)}))
    .sort((a, b) => a.s - b.s);
  for (let i = 0; i + 1 < ps.length; i++) if (ps[i].e > ps[i + 1].s) ps[i] = {...ps[i], e: Math.max(ps[i].s, ps[i + 1].s)};
  return ps;
};

/** O texto falado como a comparação vê: sem as pausas ([pausa], <short pause>) e o destaque (**), em palavras. */
export const palavrasDoTexto = (texto: string | undefined): string[] =>
  (texto ?? '').replace(/\[[^\]]*\]/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\*\*/g, '').split(/\s+/).map(norm).filter(Boolean);

const levenshtein = (a: string, b: string) => {
  if (a === b) return 0;
  let ant = Array.from({length: b.length + 1}, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const at = [i];
    for (let j = 1; j <= b.length; j++) at[j] = Math.min(ant[j] + 1, at[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    ant = at;
  }
  return ant[b.length];
};
const semelhanca = (a: string, b: string) => (a === b ? 1 : 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1));

/** A pausa antes da palavra k (ms), e quanto ela vale como corte (a pontuação da palavra de antes soma). */
const pausaAntes = (ps: readonly PalavraLegenda[], k: number) => Math.max(0, ps[k].s - ps[k - 1].e);
const valorDoCorte = (ps: readonly PalavraLegenda[], k: number) => {
  const antes = ps[k - 1].w.trim();
  return pausaAntes(ps, k) + (/[.!?…]["'”»)]*$/.test(antes) ? BONUS_PONTO_MS : /[,;:]["'”»)]*$/.test(antes) ? BONUS_VIRGULA_MS : 0);
};

/** Os melhores `quantos` cortes entre as posições dadas (corte em k = antes da palavra k), em ordem; com `min`, só as
 *  pausas de pelo menos `min` ms. */
const melhoresCortes = (ps: readonly PalavraLegenda[], posicoes: number[], quantos: number, min?: number): number[] =>
  posicoes.filter((k) => k >= 1 && k < ps.length && (min === undefined || pausaAntes(ps, k) >= min))
    .sort((a, b) => valorDoCorte(ps, b) - valorDoCorte(ps, a) || a - b)
    .slice(0, Math.max(0, quantos))
    .sort((a, b) => a - b);

const intervalo = (de: number, ate: number) => (ate < de ? [] : Array.from({length: ate - de + 1}, (_, i) => de + i));

// ---------- alinhar o texto das cenas à fala ----------

type Ancora = {a: number; b: number; achadas: number; total: number};

/** Para cada cena com texto, a primeira e a última palavra transcrita que casam com o texto dela (null: nada casou).
 *  Alinhamento global: palavra falada fora do texto (antes, no meio ou depois dele) custa metade da palavra do texto que
 *  não foi falada (de graça, o texto inteiro de uma cena "sumiria" pulando a fala de antes); a cena sem texto entra como um
 *  coringa, que engole de graça quantas palavras precisar (a fala dela), para o texto das vizinhas não ser jogado fora. */
const alinhar = (ps: readonly PalavraLegenda[], textos: string[][]): (Ancora | null)[] => {
  const ref: {t: string; cena: number; coringa?: true}[] = textos.flatMap((ws, cena) => (ws.length ? ws.map((t) => ({t, cena})) : [{t: '', cena, coringa: true as const}]));
  const fala = ps.map((p) => norm(p.w));
  const R = ref.length;
  const N = fala.length;
  if ((R + 1) * (N + 1) > MAX_CELULAS) throw new Error(`a gravação e o texto são longos demais para alinhar de uma vez (${N} palavras transcritas, ${R} no texto): divida a gravação em partes`);
  // a semelhança de cada par (texto, fala) uma vez só: os dois lados repetem muita palavra
  const ids = new Map<string, number>();
  const id = (t: string) => ids.get(t) ?? (ids.set(t, ids.size), ids.size - 1);
  const rId = ref.map((r) => id(r.t));
  const fId = fala.map(id);
  const cache = new Map<number, number>();
  const vocab = [...ids.keys()];
  const sim = (x: number, y: number) => {
    const k = x * ids.size + y;
    let v = cache.get(k);
    if (v === undefined) cache.set(k, (v = semelhanca(vocab[x], vocab[y])));
    return v;
  };
  const custoTroca = (x: number, y: number) => {
    const s = sim(x, y);
    return s === 1 ? 0 : s >= PARECIDA ? 0.3 : 1.4; // trocar sai mais barato que tirar uma e pôr outra (1,5)
  };
  const volta = new Uint8Array((R + 1) * (N + 1)); // 1 diagonal, 2 só o texto anda, 3 só a fala anda
  let ant = new Float64Array(N + 1); // linha 0: a fala antes do texto
  for (let j = 1; j <= N; j++) (ant[j] = j * PALAVRA_A_MAIS), (volta[j] = 3);
  for (let i = 1; i <= R; i++) {
    const at = new Float64Array(N + 1);
    const coringa = ref[i - 1].coringa;
    at[0] = ant[0] + (coringa ? 0 : 1);
    volta[i * (N + 1)] = 2;
    if (coringa) {
      for (let j = 1; j <= N; j++) {
        if (ant[j] <= at[j - 1]) (at[j] = ant[j]), (volta[i * (N + 1) + j] = 2);
        else (at[j] = at[j - 1]), (volta[i * (N + 1) + j] = 3);
      }
      ant = at;
      continue;
    }
    for (let j = 1; j <= N; j++) {
      const d = ant[j - 1] + custoTroca(rId[i - 1], fId[j - 1]);
      const c = ant[j] + 1; // palavra do texto que não foi falada
      const e = at[j - 1] + PALAVRA_A_MAIS; // palavra falada que não está no texto
      if (d <= c && d <= e) (at[j] = d), (volta[i * (N + 1) + j] = 1);
      else if (c <= e) (at[j] = c), (volta[i * (N + 1) + j] = 2);
      else (at[j] = e), (volta[i * (N + 1) + j] = 3);
    }
    ant = at;
  }
  let j = N;
  const ancoras: (Ancora | null)[] = textos.map((ws) => (ws.length ? {a: Infinity, b: -1, achadas: 0, total: ws.length} : null));
  let i = R;
  while (i > 0 && j > 0) {
    const v = volta[i * (N + 1) + j];
    if (v === 1) {
      if (sim(rId[i - 1], fId[j - 1]) >= PARECIDA) {
        const x = ancoras[ref[i - 1].cena]!;
        x.a = Math.min(x.a, j - 1);
        x.b = Math.max(x.b, j - 1);
        x.achadas++;
      }
      i--;
      j--;
    } else if (v === 2) i--;
    else j--;
  }
  return ancoras.map((x) => (x && x.achadas ? x : null));
};

// ---------- a proposta ----------

/** Onde cada cena começa (índice da palavra) — null: cena sem fala. Monta pelas âncoras do texto e pelas pausas. */
const iniciosPeloTexto = (ps: readonly PalavraLegenda[], ancoras: (Ancora | null)[], minPausa: number): (number | null)[] => {
  const M = ancoras.length;
  const N = ps.length;
  const inicio: (number | null)[] = Array(M).fill(null);
  const T = ancoras.flatMap((x, i) => (x ? [i] : []));
  const repartir = (cenas: number[], posicoes: number[]) => {
    // os cortes que dá entre as cenas sem texto do grupo: cada corte abre a próxima cena, na ordem
    const cortes = melhoresCortes(ps, posicoes, cenas.length, minPausa);
    cortes.forEach((k, x) => (inicio[cenas[x]] = k));
    return cortes;
  };
  // antes da primeira cena com texto: as cenas sem texto dividem as palavras de antes (a primeira começa no zero)
  const t0 = T[0];
  const antes = intervalo(0, t0 - 1);
  if (antes.length) {
    const cortes = melhoresCortes(ps, intervalo(1, ancoras[t0]!.a), antes.length, minPausa);
    // com k cortes, as k primeiras cenas sem texto têm fala; a cena com texto começa no último corte
    if (cortes.length) {
      inicio[antes[0]] = 0;
      cortes.slice(0, -1).forEach((k, x) => (inicio[antes[x + 1]] = k));
      inicio[t0] = cortes[cortes.length - 1];
    } else inicio[t0] = 0;
  } else inicio[t0] = 0;
  for (let x = 0; x + 1 < T.length; x++) {
    const p = ancoras[T[x]]!;
    const q = ancoras[T[x + 1]]!;
    const piso = (inicio[T[x]] ?? 0) + 1; // a cena de antes fica com pelo menos uma palavra
    const meio = intervalo(T[x] + 1, T[x + 1] - 1);
    if (meio.length) {
      const cortes = melhoresCortes(ps, intervalo(Math.max(piso, p.b + 1), q.a), meio.length + 1, minPausa);
      if (cortes.length) {
        cortes.slice(0, -1).forEach((k, y) => (inicio[meio[y]] = k));
        inicio[T[x + 1]] = cortes[cortes.length - 1];
        continue;
      }
    }
    // a fronteira entre duas cenas com texto: a maior pausa perto dela, pagando por palavra alinhada que muda de cena
    let melhor = -1;
    let valor = -Infinity;
    for (let k = Math.max(piso, p.a + 1, p.b + 1 - ALCANCE_FRONTEIRA); k <= Math.min(q.b, q.a + ALCANCE_FRONTEIRA); k++) {
      const v = valorDoCorte(ps, k) - MULTA_PALAVRA_MS * (Math.max(0, p.b + 1 - k) + Math.max(0, k - q.a));
      if (v > valor) (valor = v), (melhor = k);
    }
    inicio[T[x + 1]] = melhor >= 0 ? melhor : Math.max(piso, q.a);
  }
  const tn = T[T.length - 1];
  const depois = intervalo(tn + 1, M - 1);
  if (depois.length) repartir(depois, intervalo(ancoras[tn]!.b + 1, N - 1));
  return inicio;
};

/** Sem texto: as M − 1 maiores pausas (de pelo menos `minPausa`), na ordem; as cenas que sobram ficam sem fala, no fim. */
const iniciosPelasPausas = (ps: readonly PalavraLegenda[], M: number, minPausa: number): (number | null)[] => {
  const inicio: (number | null)[] = Array(M).fill(null);
  if (!M || !ps.length) return inicio;
  inicio[0] = 0;
  melhoresCortes(ps, intervalo(1, ps.length - 1), M - 1, minPausa).forEach((k, i) => (inicio[i + 1] = k));
  return inicio;
};

/** Com os cortes dados (ms do arquivo): cada um vai para a pausa mais perto (o corte dentro de uma palavra vai para o lado
 *  mais perto dela). */
const iniciosDosCortes = (ps: readonly PalavraLegenda[], M: number, cortes: number[]): (number | null)[] => {
  const inicio: (number | null)[] = Array(M).fill(null);
  if (!M || !ps.length) return inicio;
  const ks = new Set<number>();
  for (const c of cortes) {
    if (!Number.isFinite(c)) continue;
    let k = ps.findIndex((p) => p.s >= c);
    if (k < 0) k = ps.length;
    const dentro = k > 0 && c < ps[k - 1].e ? k - 1 : -1; // c cai dentro da palavra k − 1
    if (dentro >= 0) k = c - ps[dentro].s < ps[dentro].e - c ? dentro : dentro + 1;
    if (k >= 1 && k < ps.length) ks.add(k);
  }
  inicio[0] = 0;
  [...ks].sort((a, b) => a - b).slice(0, M - 1).forEach((k, i) => (inicio[i + 1] = k));
  return inicio;
};

const resumo = (ps: readonly PalavraLegenda[], i0: number, i1: number) => {
  const t = ps.slice(i0, i1 + 1).map((p) => p.w.trim()).join(' ');
  return t.length > 300 ? `${t.slice(0, 299)}…` : t;
};

/** A proposta de divisão da gravação nas cenas (ver o começo do arquivo). `palavras`: a transcrição, ms do arquivo;
 *  `cenas`: as cenas em ordem, com o texto falado quando houver. Nunca grava nada. */
export const proporDivisao = (palavras: readonly PalavraLegenda[], cenas: readonly CenaParaDividir[], o: OpcoesDivisao = {}): PropostaDivisao => {
  const ps = palavrasEmOrdem(palavras);
  const M = cenas.length;
  const margem = Math.max(0, o.margem_ms ?? MARGEM_CORTE_MS);
  const minPausa = Math.max(0, o.pausa_min_ms ?? PAUSA_MIN_MS);
  const avisos: string[] = [];
  if (!ps.length) throw new Error('a transcrição não tem palavras: transcreva a gravação antes (transcrever)');
  if (!M) throw new Error('o vídeo não tem cenas');
  const textos = cenas.map((c) => palavrasDoTexto(c.texto));
  let metodo: PropostaDivisao['metodo'];
  let inicio: (number | null)[];
  let ancoras: (Ancora | null)[] = cenas.map(() => null);
  if (o.cortes?.length) {
    metodo = 'cortes';
    inicio = iniciosDosCortes(ps, M, o.cortes);
    if (o.cortes.length > M - 1) avisos.push(`vieram ${o.cortes.length} cortes para ${M} cenas: valeram os ${M - 1} primeiros`);
  } else if (textos.some((t) => t.length)) {
    ancoras = alinhar(ps, textos);
    textos.forEach((t, i) => {
      if (t.length && !ancoras[i]) avisos.push(`o texto da cena ${i + 1} não foi achado na gravação: ela foi pelas pausas`);
      else if (ancoras[i] && ancoras[i]!.achadas / ancoras[i]!.total < 0.5) {
        avisos.push(`só ${Math.round((100 * ancoras[i]!.achadas) / ancoras[i]!.total)}% do texto da cena ${i + 1} foi achado na gravação: confira o corte dela`);
      }
    });
    const comTexto = ancoras.filter(Boolean).length;
    metodo = comTexto === M ? 'texto' : comTexto ? 'misto' : 'pausas';
    inicio = comTexto ? iniciosPeloTexto(ps, ancoras, minPausa) : iniciosPelasPausas(ps, M, minPausa);
  } else {
    metodo = 'pausas';
    inicio = iniciosPelasPausas(ps, M, minPausa);
  }
  // o fim de cada cena é o começo da próxima que tem fala
  const fins: (number | null)[] = inicio.map((k, i) => {
    if (k === null) return null;
    const prox = inicio.slice(i + 1).find((x): x is number => x !== null);
    return (prox ?? ps.length) - 1;
  });
  const meioDaPausa = (k: number) => (ps[k - 1].e + ps[k].s) / 2;
  const fimDoArquivo = typeof o.duracao_ms === 'number' && Number.isFinite(o.duracao_ms) && o.duracao_ms > 0 ? o.duracao_ms : Infinity;
  const trechos: TrechoDaCena[] = cenas.map((c, i): TrechoDaCena => {
    const i0 = inicio[i];
    const i1 = fins[i];
    const m: MetodoTrecho = metodo === 'cortes' ? 'cortes' : ancoras[i] ? 'texto' : 'pausas';
    const acerto = ancoras[i] ? Math.round((1000 * ancoras[i]!.achadas) / ancoras[i]!.total) / 1000 : undefined;
    if (i0 === null || i1 === null || i1 < i0) return {cena: c.id, n: i + 1, de_ms: null, ate_ms: null, palavras: null, texto: '', metodo: m, ...(acerto !== undefined ? {acerto} : {})};
    // arredonda para fora da fala: o começo para baixo e o fim para cima, sem passar da palavra vizinha
    // a fronteira com a vizinha é o meio da pausa, em ms inteiros: um trecho termina onde o outro pode começar
    const de = Math.max(i0 > 0 ? Math.round(meioDaPausa(i0)) : 0, Math.floor(ps[i0].s - margem));
    const ate = Math.min(i1 + 1 < ps.length ? Math.round(meioDaPausa(i1 + 1)) : fimDoArquivo, Math.ceil(ps[i1].e + margem));
    return {cena: c.id, n: i + 1, de_ms: de, ate_ms: Math.max(de + 1, ate), palavras: [i0, i1], texto: resumo(ps, i0, i1), metodo: m,
      ...(acerto !== undefined ? {acerto} : {})};
  });
  const sem = trechos.filter((t) => !t.palavras).map((t) => t.n);
  if (sem.length) {
    avisos.push(`${sem.length === 1 ? `a cena ${sem[0]} ficou` : `as cenas ${sem.join(', ')} ficaram`} sem fala: a gravação não tem ${metodo === 'cortes' ? 'cortes' : 'pausas'} para tantas cenas`
      + `${metodo === 'cortes' ? '' : ` (pausa de pelo menos ${minPausa} ms)`}`);
  }
  const comFala = trechos.filter((t) => t.palavras);
  const cortes: CorteProposto[] = comFala.slice(1).map((t, x) => {
    const k = t.palavras![0];
    return {ms: Math.round(meioDaPausa(k)), pausa_ms: Math.round(pausaAntes(ps, k)), antes: ps[k - 1].w.trim(), depois: ps[k].w.trim(), entre: [comFala[x].n, t.n]};
  });
  return {trechos, cortes, metodo, avisos, palavras: ps.length};
};

// ---------- aplicar: um clipe da mesma gravação em cada cena ----------

export {ehMarcaGravada};

export type ClipeDaDivisao = {cena: string; n: number; id: string; em: number; duracao_ms: number; corte_ms: number};
export type ResultadoDivisao = {
  patch: OperacaoPatch[];
  clipes: ClipeDaDivisao[];
  mudancas: {cena: string; n: number; antes_ms: number; depois_ms: number}[];
  legendas: number;
  faixa: string;
  avisos: string[];
};

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const todosOsClipes = (audio: AudioCenas | undefined) =>
  (Array.isArray(audio?.faixas) ? audio!.faixas : []).flatMap((f, i) => (Array.isArray(f?.clipes) ? f.clipes : []).map((c, j) => ({f, i, c, j})));

/** O patch que põe a gravação dividida nas cenas (ver o começo do arquivo). `arquivo`: a gravação (a fala, o original da
 *  voz limpa); `clipe`: o clipe dela que já está no vídeo, se houver (sai, e os pedaços herdam a faixa, o volume e a voz
 *  limpa dele). Os pedaços de uma divisão anterior da mesma gravação saem, e a fala por IA das cenas que ganham trecho
 *  também (avisa). `palavras`: a transcrição (ms do arquivo) e o caminho dela, para as legendas. */
export const patchDaDivisao = (doc: DocCenas, o: {arquivo: string; proposta: PropostaDivisao; palavras: readonly PalavraLegenda[]; caminhoPalavras: string; sha256?: string;
  clipe?: string; margem_ms?: number}): ResultadoDivisao => {
  const avisos: string[] = [];
  const trechos = o.proposta.trechos.filter((t) => t.de_ms !== null && t.ate_ms !== null && t.ate_ms > t.de_ms);
  const cenas = Array.isArray(doc.cenas) ? doc.cenas : [];
  const idsCenas = new Set(cenas.map((c) => c.id));
  for (const t of trechos) if (!idsCenas.has(t.cena)) throw new Error(`a cena ${t.cena} não existe mais no vídeo: proponha a divisão de novo`);
  if (!trechos.length) throw new Error('nenhuma cena ficou com fala: nada a dividir');
  const doc1: DocCenas = structuredClone(doc);
  if (!doc1.audio || !Array.isArray(doc1.audio.faixas)) doc1.audio = novoAudioCenas();
  const audio = doc1.audio;
  const cenasComTrecho = new Set(trechos.map((t) => t.cena));
  // o clipe de base: o pedido, ou o primeiro pedaço de uma divisão anterior desta gravação
  const lista = todosOsClipes(audio);
  const base = o.clipe ? lista.find((x) => x.c?.id === o.clipe) : lista.find((x) => ehMarcaGravada(x.c?.narracao_gravada) && arquivoDaFala(x.c) === o.arquivo);
  if (o.clipe && !base) throw new Error(`clipe não achado: ${o.clipe}`);
  const sai = new Set<ClipeAudio>();
  for (const x of lista) {
    if (base && x.c === base.c) sai.add(x.c);
    else if (ehMarcaGravada(x.c?.narracao_gravada) && arquivoDaFala(x.c) === o.arquivo) sai.add(x.c);
    else if (x.c?.narracao_ia && cenasComTrecho.has(x.c.narracao_ia.cena)) sai.add(x.c);
  }
  const iaFora = [...sai].filter((c) => c.narracao_ia).map((c) => cenas.findIndex((x) => x.id === c.narracao_ia!.cena) + 1);
  if (iaFora.length) avisos.push(`a fala por IA ${iaFora.length === 1 ? `da cena ${iaFora[0]} saiu` : `das cenas ${iaFora.sort((a, b) => a - b).join(', ')} saiu`} para entrar a gravação (o WAV fica no cache; Reverter traz de volta)`);
  // a faixa: a do clipe de base; senão a primeira faixa de voz vazia; senão uma faixa nova "Narração"
  let faixa = base?.f;
  if (!faixa) {
    faixa = audio.faixas.find((f) => papelDe(f) === 'voz' && !(Array.isArray(f.clipes) ? f.clipes : []).some((c) => !sai.has(c)));
    if (!faixa) {
      faixa = {...novaFaixaAudio('voz', idLivre(doc, 'narracao')), nome: 'Narração'};
      audio.faixas.push(faixa);
    }
  }
  const idsFora = new Set([...sai].map((c) => c.id));
  for (const f of audio.faixas) if (Array.isArray(f.clipes)) f.clipes = f.clipes.filter((c) => !sai.has(c));
  if (doc1.legendas && Array.isArray(doc1.legendas.segmentos)) {
    doc1.legendas = {...doc1.legendas, segmentos: doc1.legendas.segmentos.filter((s) => !s?.clipe || !idsFora.has(s.clipe)),
      ...(Array.isArray(doc1.legendas.origens) ? {origens: doc1.legendas.origens.filter((x) => !idsFora.has(x.clipe))} : {})};
  }
  // os pedaços: herdam do clipe de base o arquivo (a voz limpa toca o .limpo, com os mesmos tempos), o volume e o mudo
  const molde: Partial<ClipeAudio> = base ? (({arquivo, original, limpeza, volume, mudo}) => ({arquivo, original, limpeza, volume, mudo}))(base.c) : {arquivo: o.arquivo};
  for (const k of Object.keys(molde) as (keyof ClipeAudio)[]) if (molde[k] === undefined) delete molde[k];
  const cfg = configDaNarracao(doc.narracao);
  const tempos = new Map(temposDasCenas(doc1).map((t) => [t.id, t]));
  const usados: unknown[] = [doc];
  const novos: ClipeAudio[] = trechos.map((t) => {
    const id = idLivre(usados, 'fala-gravada');
    usados.push({id});
    const tc = tempos.get(t.cena)!;
    return {...molde, arquivo: molde.arquivo ?? o.arquivo, id, nome: `Fala da cena ${t.n}`, em: r3(tc.t_in + cfg.folga_ms), corte_ms: t.de_ms!, duracao_ms: t.ate_ms! - t.de_ms!,
      narracao_gravada: {cena: t.cena}} as ClipeAudio;
  });
  faixa.clipes = [...(Array.isArray(faixa.clipes) ? faixa.clipes : []), ...novos].sort((a, b) => a.em - b.em);
  // a duração das cenas: a conta do "Ajustar as cenas à fala", só nas cenas que ganharam trecho
  const ajuste = ajustarCenasAFala(doc1, {cenas: [...cenasComTrecho], margem_ms: o.margem_ms});
  if (doc.audio?.acompanha_cenas === false) avisos.push('o som não acompanha as cenas neste vídeo (audio.acompanha_cenas: false): só as falas da gravação foram para o começo das cenas');
  const doc2 = jsonpatch.applyPatch(structuredClone(doc1), ajuste.patch as Operation[], false, false).newDocument as DocCenas;
  // os pedaços no começo da cena (mais a folga) no tempo novo, mesmo com o som que não acompanha as cenas
  const tempos2 = new Map(temposDasCenas(doc2).map((t) => [t.id, t]));
  const nossos = new Map(novos.map((c) => [c.id, c]));
  const clipes: ClipeDaDivisao[] = [];
  for (const f of doc2.audio?.faixas ?? []) {
    for (const c of Array.isArray(f.clipes) ? f.clipes : []) {
      if (!nossos.has(c.id)) continue;
      const tc = tempos2.get(c.narracao_gravada!.cena)!;
      c.em = r3(tc.t_in + cfg.folga_ms);
      clipes.push({cena: tc.id, n: tc.n, id: c.id, em: c.em, duracao_ms: c.duracao_ms, corte_ms: c.corte_ms ?? 0});
    }
    if (Array.isArray(f.clipes)) f.clipes.sort((a, b) => a.em - b.em);
  }
  // as legendas de cada pedaço, da transcrição: a âncora de palavra acha a fala de cada cena
  const faixa2 = doc2.audio!.faixas.find((f) => f.id === faixa!.id) ?? faixa;
  const nomeBase = base?.c.nome;
  const {largura, altura} = formatoDoVideo(doc2);
  const antes = doc2.legendas && Array.isArray(doc2.legendas.segmentos) ? doc2.legendas : undefined;
  const fontes = clipes.map((x) => {
    const c = (faixa2.clipes ?? []).find((y) => y.id === x.id)!;
    return {clipe: {...c, arquivo: o.arquivo, nome: nomeBase}, faixa: {nome: faixa2.nome}, palavras: [...o.palavras], caminhoPalavras: o.caminhoPalavras, sha256: o.sha256};
  });
  const geradas = legendasDaFala(fontes, {estilo: antes?.estilo, largura, altura, fonte: doc2.tema?.fonte});
  const dic = aplicarDicionario(geradas.segmentos, [...DICIONARIO_CASA, ...(Array.isArray(antes?.dicionario) ? antes!.dicionario : [])]);
  const origens = geradas.origens ?? [];
  const legendas: LegendasCenas = antes
    ? {...antes, segmentos: [...antes.segmentos, ...dic.segmentos].sort((a, b) => a.em - b.em).map((s, i) => ({...s, id: `leg-${i + 1}`})),
      origens: [...(antes.origens ?? []), ...origens]}
    : {...(doc2.legendas ?? {}), ...geradas, segmentos: dic.segmentos};
  // o patch final, contra o documento de antes: as durações, o som e as legendas inteiros
  const patch: OperacaoPatch[] = [];
  const mudancas: ResultadoDivisao['mudancas'] = [];
  const antesT = temposDasCenas(doc);
  cenas.forEach((c, i) => {
    const d = doc2.cenas[i]?.duracao_ms;
    if (d === c.duracao_ms) return;
    patch.push({op: 'test', path: `/cenas/${i}/id`, value: c.id}, {op: typeof c.duracao_ms === 'number' ? 'replace' : 'add', path: `/cenas/${i}/duracao_ms`, value: d});
    mudancas.push({cena: c.id, n: i + 1, antes_ms: antesT[i].t_out - antesT[i].t_in, depois_ms: d});
  });
  patch.push({op: doc.audio ? 'replace' : 'add', path: '/audio', value: doc2.audio});
  patch.push({op: doc.legendas ? 'replace' : 'add', path: '/legendas', value: legendas});
  return {patch, clipes, mudancas, legendas: dic.segmentos.length, faixa: faixa.id, avisos};
};
