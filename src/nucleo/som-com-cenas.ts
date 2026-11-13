// A narração presa às cenas (video-D3, melhoria 5 da primeira pesquisa): inserir, duplicar, excluir ou mudar a duração de uma
// cena empurra os clipes de áudio que vêm depois, e as legendas que seguem esses clipes vão junto. Sem isto, a cena 3 ficava
// 2 s mais longa e a narração do resto do vídeo continuava no tempo velho, 2 s adiantada em relação à imagem.
//
// É um ajuste que o Projeto aplica na mesma gravação do patch da pessoa ou da IA (projeto.ts: `ajustes`), então o diário tem uma
// entrada só e o Ctrl+Z desfaz o conjunto. Regras:
//  - cena que ficou mais longa (ou nova, ou duplicada) abre um vazio no fim dela: o clipe que a atravessa é dividido ali (dividirClipe,
//    com as legendas) e o que vem depois anda para a frente;
//  - cena que ficou mais curta (ou excluída) tira o trecho do fim dela do som: os clipes dentro dele saem (com as legendas),
//    os que o atravessam são cortados, e o que vem depois anda para trás;
//  - cena dividida (mesmo total de tempo) não mexe no som, nem a divisão desfeita (a cena de antes cresce o que a seguinte, que
//    sai, tinha: o Ctrl+Z da lâmina); o patch que já mexe em /audio ou /legendas, também não (quem o fez
//    cuida do som); trocar a ordem das cenas, ou trocar todas por cenas de ids novos, também não (não há como saber para onde o
//    som vai); `audio.acompanha_cenas: false` desliga.
import jsonpatch, {type Operation} from 'fast-json-patch';
import type {ClipeAudio} from './audio';
import {ehDocCenas, type DocCenas} from './cenas';
import {dividirClipe, recusou} from './clipes-audio';
import type {OperacaoPatch} from './documentos';

const DURACAO_PADRAO_MS = 4000; // DURACAO_CENA_PADRAO
const DURACAO_MIN_MS = 300;
const DURACAO_MAX_MS = 10 * 60 * 1000;
const PEDACO_MIN_MS = 100; // o que dividirClipe aceita de cada lado do corte

const duracaoDe = (c: unknown) => {
  const d = (c as {duracao_ms?: unknown} | null)?.duracao_ms;
  return Math.min(DURACAO_MAX_MS, Math.max(DURACAO_MIN_MS, typeof d === 'number' && Number.isFinite(d) ? d : DURACAO_PADRAO_MS));
};

type Edicao = {tipo: 'abrir'; t: number; ms: number} | {tipo: 'tirar'; de: number; ate: number};

/** O que mudou no tempo das cenas, em tempo ANTIGO (de antes do patch): vazios a abrir e trechos a tirar. null: não dá para saber
 *  (ordem trocada, ou nenhuma cena de antes sobrou). A cena nova que vem logo depois de uma antiga conta como parte dela: dividir
 *  uma cena (a primeira metade fica com o id, a segunda é nova) soma o mesmo total e não muda nada. */
export const edicoesDeTempo = (antes: DocCenas, depois: DocCenas): Edicao[] | null => {
  const velhas = (Array.isArray(antes.cenas) ? antes.cenas : []);
  const novas = (Array.isArray(depois.cenas) ? depois.cenas : []);
  const idsVelhos = new Set(velhas.map((c) => c?.id));
  const sobreviventes = novas.filter((c) => idsVelhos.has(c?.id)).map((c) => c.id);
  if (velhas.length && !sobreviventes.length) return null;
  if (sobreviventes.join('\u0000') !== velhas.filter((c) => sobreviventes.includes(c.id)).map((c) => c.id).join('\u0000')) return null; // ordem trocada
  // quanto cada cena de antes (e as novas logo depois dela) ocupa agora
  const agora = new Map<string, number>();
  let dona: string | null = null; // a cena antiga a que as novas seguintes se somam; null: antes da primeira
  let inicio = 0; // novas antes da primeira cena antiga
  for (const c of novas) {
    if (idsVelhos.has(c?.id)) {
      dona = c.id;
      agora.set(c.id, duracaoDe(c));
    } else if (dona) agora.set(dona, (agora.get(dona) ?? 0) + duracaoDe(c));
    else inicio += duracaoDe(c);
  }
  const out: Edicao[] = [];
  if (inicio > 0) out.push({tipo: 'abrir', t: 0, ms: inicio});
  let t = 0;
  for (const c of velhas) {
    const d = duracaoDe(c);
    const fim = t + d;
    const n = agora.get(c.id);
    const ultima = out[out.length - 1];
    // a cena de antes cresceu exatamente o que esta tinha, e esta sumiu: é a divisão desfeita (juntar de volta), e o som fica
    if (n === undefined && ultima?.tipo === 'abrir' && Math.abs(ultima.t - t) < 0.5 && Math.abs(ultima.ms - d) < 0.5) out.pop();
    else if (n === undefined) out.push({tipo: 'tirar', de: t, ate: fim});
    else if (n > d + 0.5) out.push({tipo: 'abrir', t: fim, ms: n - d});
    else if (n < d - 0.5) out.push({tipo: 'tirar', de: t + n, ate: fim});
    t = fim;
  }
  return out;
};

const clipes = (d: DocCenas): ClipeAudio[] => (Array.isArray(d.audio?.faixas) ? d.audio!.faixas : []).flatMap((f) => (Array.isArray(f?.clipes) ? f.clipes : []));
// sem mutar: o documento de antes é do chamador (o Projeto compara com ele para montar o inverso)
const aplicarOps = (d: DocCenas, ops: OperacaoPatch[]) => jsonpatch.applyPatch(d, ops as Operation[], true, false).newDocument as DocCenas;

/** Divide, em `t`, os clipes que a atravessam (com as legendas) e devolve o tempo real do corte de cada um. Clipe com menos de
 *  PEDACO_MIN_MS de um dos lados não é dividido: conta como inteiro do lado onde está a maior parte. */
const dividirEm = (d: DocCenas, t: number): DocCenas => {
  for (const c of [...clipes(d)]) {
    const em = c.em ?? 0;
    const fim = em + (c.duracao_ms ?? 0);
    if (!(em + PEDACO_MIN_MS < t && t < fim - PEDACO_MIN_MS)) continue;
    const r = dividirClipe(d, c.id, t);
    if (!recusou(r)) d = aplicarOps(d, r.patch);
  }
  return d;
};

const tirarClipes = (d: DocCenas, ids: Set<string>): DocCenas => {
  if (!ids.size) return d;
  const w = structuredClone(d);
  for (const f of w.audio?.faixas ?? []) if (Array.isArray(f.clipes)) f.clipes = f.clipes.filter((c) => !ids.has(c.id));
  if (w.legendas) {
    w.legendas.segmentos = (w.legendas.segmentos ?? []).filter((s) => !(s.clipe && ids.has(s.clipe)));
    if (Array.isArray(w.legendas.origens)) w.legendas.origens = w.legendas.origens.filter((o) => !ids.has(o.clipe));
  }
  return w;
};

const mover = (d: DocCenas, quais: (c: ClipeAudio) => boolean, ms: number): DocCenas => {
  const w = structuredClone(d);
  for (const f of w.audio?.faixas ?? []) for (const c of f.clipes ?? []) if (quais(c)) c.em = Math.max(0, Math.round(((c.em ?? 0) + ms) * 1000) / 1000);
  return w;
};

/** Aplica ao som e às legendas as edições de tempo, da última para a primeira (o tempo antigo das anteriores continua valendo). */
export const somComEdicoes = (doc: DocCenas, edicoes: Edicao[]): DocCenas => {
  let d = doc;
  for (const e of [...edicoes].sort((a, b) => (b.tipo === 'abrir' ? b.t : b.de) - (a.tipo === 'abrir' ? a.t : a.de))) {
    if (e.tipo === 'abrir') {
      d = dividirEm(d, e.t);
      d = mover(d, (c) => (c.em ?? 0) >= e.t - PEDACO_MIN_MS, e.ms); // o que começa a menos de 100 ms antes do corte é do lado de depois
    } else {
      d = dividirEm(d, e.ate);
      d = dividirEm(d, e.de);
      const dentro = new Set(clipes(d).filter((c) => (c.em ?? 0) >= e.de - PEDACO_MIN_MS && (c.em ?? 0) + (c.duracao_ms ?? 0) <= e.ate + PEDACO_MIN_MS).map((c) => c.id));
      d = tirarClipes(d, dentro);
      d = mover(d, (c) => (c.em ?? 0) >= e.ate - PEDACO_MIN_MS && !dentro.has(c.id), -(e.ate - e.de));
    }
  }
  return d;
};

/** O ajuste do Projeto: as operações a somar ao patch para o som acompanhar as cenas, ou [] quando não há o que fazer. */
export const somAcompanhaCenas = (antes: unknown, patch: OperacaoPatch[]): OperacaoPatch[] => {
  if (!ehDocCenas(antes)) return [];
  if (antes.audio?.acompanha_cenas === false) return [];
  if (!clipes(antes).length) return [];
  if (patch.some((o) => /^\/(audio|legendas)(\/|$)/.test(o.path) || (o.from && /^\/(audio|legendas)(\/|$)/.test(o.from)))) return [];
  if (!patch.some((o) => o.path === '/cenas' || o.path.startsWith('/cenas/'))) return [];
  let depois: DocCenas;
  try {
    depois = jsonpatch.applyPatch(structuredClone(antes), patch as Operation[], true, false).newDocument as DocCenas;
  } catch {
    return []; // o patch é inválido: quem grava recusa
  }
  const edicoes = edicoesDeTempo(antes, depois);
  if (!edicoes?.length) return [];
  const novo = somComEdicoes(antes, edicoes);
  const ops: OperacaoPatch[] = [];
  if (JSON.stringify(novo.audio) !== JSON.stringify(antes.audio)) ops.push({op: 'replace', path: '/audio', value: novo.audio});
  if (JSON.stringify(novo.legendas) !== JSON.stringify(antes.legendas)) ops.push({op: antes.legendas ? 'replace' : 'add', path: '/legendas', value: novo.legendas});
  return ops;
};
