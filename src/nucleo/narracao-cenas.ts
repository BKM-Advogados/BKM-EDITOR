// A narração por IA dentro do vídeo de cenas (docs/narracao.md): o estado de cada cena (sem texto, a gerar, gerada,
// desatualizada), o patch que põe a fala gerada na faixa de voz e a ação "ajustar a duração das cenas à fala". Puro como
// clipes-audio.ts: a interface, o processo principal e o MCP fazem a mesma conta, e tudo vai ao documento por JSON Patch
// (diário, Ctrl+Z, Reverter).
//
// A fala da cena entra numa faixa de voz no começo da cena mais a folga (padrão 300 ms). A faixa é a que já tem falas
// geradas; sem ela, a primeira faixa de voz vazia; sem nenhuma, uma faixa nova "Narração IA" (a narração gravada pela
// pessoa fica onde está). A música, que já nasce com ducking, cai sob essa voz como cai sob qualquer outra: o envelope do
// WAV gerado é medido na hora em que ele é gravado (narracao-servico.ts).
import {novaFaixaAudio, novoAudioCenas, papelDe, type AudioCenas, type ClipeAudio, type FaixaAudio} from './audio';
import {idLivre, resolverCenas, type DocCenas} from './cenas';
import type {OperacaoPatch} from './documentos';
import {arquivoDaNarracao, configDaNarracao, hashDaFala, medirFala, textoFalado, type ConfigNarracaoN, type MarcaNarracaoIA, type MedidaFala} from './narracao';
import {edicoesDeTempo, somComEdicoes} from './som-com-cenas';

export type EstadoFala = 'sem_texto' | 'pendente' | 'gerada' | 'desatualizada';
export const ROTULO_ESTADO: Record<EstadoFala, string> = {sem_texto: 'sem texto', pendente: 'a gerar', gerada: 'gerada', desatualizada: 'desatualizada'};

export type ClipeDaFala = {faixa: number; indice: number; caminho: string; clipe: ClipeAudio & {narracao_ia: MarcaNarracaoIA}};

/** O que se sabe da fala de uma cena agora. `hash` e `arquivo`: o pedido que o texto e a configuração de hoje fariam. */
export type ItemNarracao = {
  cena: string;
  n: number;
  nome?: string;
  estado: EstadoFala;
  texto: string;
  texto_final: string;
  hash?: string;
  arquivo?: string;
  medida?: MedidaFala;
  t_in: number;
  t_out: number;
  clipe?: {id: string; caminho: string; em: number; duracao_ms: number; hash: string; arquivo: string};
  motivo?: string; // por que está desatualizada
};

const ehMarca = (m: unknown): m is MarcaNarracaoIA => Boolean(m) && typeof (m as MarcaNarracaoIA).cena === 'string' && typeof (m as MarcaNarracaoIA).hash === 'string';
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const seg = (ms: number) => (ms / 1000).toLocaleString('pt-BR', {maximumFractionDigits: 1});

/** Os clipes de fala gerada do documento, por cena (o primeiro de cada cena; os outros, se a pessoa dividiu, vêm em `extras`). */
export const clipesDaNarracao = (doc: Pick<DocCenas, 'audio'>): {porCena: Map<string, ClipeDaFala>; extras: ClipeDaFala[]} => {
  const porCena = new Map<string, ClipeDaFala>();
  const extras: ClipeDaFala[] = [];
  (Array.isArray(doc.audio?.faixas) ? doc.audio!.faixas : []).forEach((f, i) => {
    (Array.isArray(f?.clipes) ? f.clipes : []).forEach((c, j) => {
      if (!ehMarca(c?.narracao_ia)) return;
      const achado: ClipeDaFala = {faixa: i, indice: j, caminho: `/audio/faixas/${i}/clipes/${j}`, clipe: c as ClipeDaFala['clipe']};
      if (porCena.has(c.narracao_ia.cena)) extras.push(achado);
      else porCena.set(c.narracao_ia.cena, achado);
    });
  });
  return {porCena, extras};
};

/** Início e fim de cada cena no vídeo (ms), como o resolvedor conta. */
export const temposDasCenas = (doc: DocCenas) => resolverCenas(doc).props.cenas.map((c) => ({id: c.id, n: c.n, nome: c.nome, t_in: c.t_in, t_out: c.t_out}));

/** O estado da fala de cada cena. `existe` (o disco): sem ele, o arquivo do clipe conta como presente. */
export const itensDaNarracao = (doc: DocCenas, existe?: (rel: string) => boolean): ItemNarracao[] => {
  const cfg = configDaNarracao(doc.narracao);
  const {porCena} = clipesDaNarracao(doc);
  const tempos = temposDasCenas(doc);
  return (Array.isArray(doc.cenas) ? doc.cenas : []).map((c, i): ItemNarracao => {
    const t = tempos[i] ?? {t_in: 0, t_out: 0};
    const texto = typeof c?.narracao?.texto === 'string' ? c.narracao.texto : '';
    const achado = porCena.get(c.id);
    const clipe = achado ? {id: achado.clipe.id, caminho: achado.caminho, em: achado.clipe.em, duracao_ms: achado.clipe.duracao_ms, hash: achado.clipe.narracao_ia.hash,
      arquivo: achado.clipe.arquivo} : undefined;
    const base = {cena: c.id, n: i + 1, ...(c.nome ? {nome: c.nome} : {}), texto, t_in: t.t_in, t_out: t.t_out, ...(clipe ? {clipe} : {})};
    if (!texto.trim()) return {...base, estado: 'sem_texto', texto_final: ''};
    const texto_final = textoFalado(texto, cfg);
    const hash = hashDaFala(texto_final, cfg);
    const pedido = {...base, texto_final, hash, arquivo: arquivoDaNarracao(hash), medida: medirFala(texto_final, cfg)};
    if (!clipe) return {...pedido, estado: 'pendente'};
    if (clipe.hash !== hash) return {...pedido, estado: 'desatualizada', motivo: 'o texto, as pronúncias, a voz ou o estilo mudaram depois de gerar'};
    if (existe && !existe(clipe.arquivo)) return {...pedido, estado: 'desatualizada', motivo: `o arquivo ${clipe.arquivo} não está mais no projeto`};
    return {...pedido, estado: 'gerada'};
  });
};

/** As cenas pedidas pelo id ou pelo número ("2"); vazio = todas. Devolve as achadas e as que não existem. */
export const escolherCenas = (doc: DocCenas, pedidas?: string[]): {ids: string[]; nao_achadas: string[]} => {
  const cenas = Array.isArray(doc.cenas) ? doc.cenas : [];
  if (!pedidas?.length) return {ids: cenas.map((c) => c.id), nao_achadas: []};
  const ids: string[] = [];
  const nao: string[] = [];
  for (const p of pedidas) {
    const porId = cenas.find((c) => c.id === p);
    const porNumero = /^\d+$/.test(String(p).trim()) ? cenas[Number(p) - 1] : undefined;
    const c = porId ?? porNumero;
    if (c && !ids.includes(c.id)) ids.push(c.id);
    else if (!c) nao.push(String(p));
  }
  return {ids, nao_achadas: nao};
};

// ---------- pôr a fala gerada na faixa de voz ----------

export type FalaGerada = {cena: string; arquivo: string; duracao_ms: number; hash: string};
export type ResultadoPatchFala = {patch: OperacaoPatch[]; clipes: {cena: string; id: string; em: number; duracao_ms: number; novo: boolean}[]; faixa: string; avisos: string[]};

/** A faixa de voz que recebe as falas geradas: a que já tem falas geradas, ou a primeira faixa de voz vazia, ou uma nova. */
const faixaDasFalas = (doc: DocCenas): {indice: number; faixa: FaixaAudio; criar?: 'audio' | 'faixa'} => {
  const faixas = Array.isArray(doc.audio?.faixas) ? doc.audio!.faixas : null;
  if (!faixas) {
    const audio = novoAudioCenas();
    const indice = audio.faixas.findIndex((f) => f.papel === 'voz');
    return {indice, faixa: audio.faixas[indice], criar: 'audio'};
  }
  const comFala = faixas.findIndex((f) => papelDe(f) === 'voz' && (f.clipes ?? []).some((c) => ehMarca(c?.narracao_ia)));
  if (comFala >= 0) return {indice: comFala, faixa: faixas[comFala]};
  const vazia = faixas.findIndex((f) => papelDe(f) === 'voz' && !(f.clipes ?? []).length);
  if (vazia >= 0) return {indice: vazia, faixa: faixas[vazia]};
  const nova = {...novaFaixaAudio('voz', idLivre(doc, 'narracao-ia')), nome: 'Narração IA'};
  return {indice: faixas.length, faixa: nova, criar: 'faixa'};
};

/** O patch que põe cada fala gerada no começo da sua cena (+ folga): troca o clipe que a cena já tinha (o id fica, e as
 *  legendas dele passam a ser "de outra tomada") ou cria um novo. Cópias extras da fala da mesma cena (clipe dividido à mão)
 *  saem. Avisa quando a fala passa do fim da cena. */
export const patchDasFalas = (doc: DocCenas, geradas: FalaGerada[]): ResultadoPatchFala => {
  const cfg = configDaNarracao(doc.narracao);
  const tempos = new Map(temposDasCenas(doc).map((t) => [t.id, t]));
  const {porCena, extras} = clipesDaNarracao(doc);
  const alvo = faixaDasFalas(doc);
  const usados: unknown[] = [doc];
  const novoId = () => {
    const id = idLivre(usados, 'fala');
    usados.push({id});
    return id;
  };
  const patch: OperacaoPatch[] = [];
  const novos: ClipeAudio[] = [];
  const clipes: ResultadoPatchFala['clipes'] = [];
  const avisos: string[] = [];
  const remover: ClipeDaFala[] = [];
  for (const g of geradas) {
    const t = tempos.get(g.cena);
    if (!t) {
      avisos.push(`a cena ${g.cena} não existe mais: a fala dela ficou em ${g.arquivo}, fora do vídeo`);
      continue;
    }
    const em = r3(t.t_in + cfg.folga_ms);
    const marca: MarcaNarracaoIA = {cena: g.cena, hash: g.hash};
    const nome = `Fala da cena ${t.n}${t.nome ? ` · ${t.nome}` : ''}`;
    if (em + g.duracao_ms > t.t_out + 1) {
      avisos.push(`a fala da cena ${t.n} (${seg(g.duracao_ms)} s, mais ${seg(cfg.folga_ms)} s de folga) passa do fim da cena (${seg(t.t_out - t.t_in)} s): use "ajustar a duração das cenas à fala"`);
    }
    const velho = porCena.get(g.cena);
    if (velho) {
      const {corte_ms: _c, cortes_fala: _f, original: _o, limpeza: _l, ...resto} = velho.clipe;
      const c: ClipeAudio = {...resto, arquivo: g.arquivo, em, duracao_ms: g.duracao_ms, nome, narracao_ia: marca};
      patch.push({op: 'test', path: `${velho.caminho}/id`, value: velho.clipe.id}, {op: 'replace', path: velho.caminho, value: c});
      clipes.push({cena: g.cena, id: c.id, em, duracao_ms: g.duracao_ms, novo: false});
      remover.push(...extras.filter((x) => x.clipe.narracao_ia.cena === g.cena));
    } else {
      const c: ClipeAudio = {id: novoId(), arquivo: g.arquivo, em, duracao_ms: g.duracao_ms, nome, narracao_ia: marca};
      novos.push(c);
      clipes.push({cena: g.cena, id: c.id, em, duracao_ms: g.duracao_ms, novo: true});
    }
  }
  if (novos.length) {
    if (alvo.criar === 'audio') {
      const audio: AudioCenas = novoAudioCenas();
      audio.faixas[alvo.indice].clipes.push(...novos);
      patch.push({op: 'add', path: '/audio', value: audio});
    } else if (alvo.criar === 'faixa') {
      patch.push({op: 'add', path: '/audio/faixas/-', value: {...alvo.faixa, clipes: novos}});
    } else {
      const base = `/audio/faixas/${alvo.indice}`;
      patch.push({op: 'test', path: `${base}/id`, value: alvo.faixa.id});
      if (Array.isArray(alvo.faixa.clipes)) for (const c of novos) patch.push({op: 'add', path: `${base}/clipes/-`, value: c});
      else patch.push({op: 'add', path: `${base}/clipes`, value: novos});
    }
  }
  // cópias da fala da mesma cena: saem do fim para o começo, para os índices de antes continuarem valendo
  for (const x of remover.sort((a, b) => b.faixa - a.faixa || b.indice - a.indice)) {
    patch.push({op: 'test', path: `${x.caminho}/id`, value: x.clipe.id}, {op: 'remove', path: x.caminho});
  }
  return {patch, clipes, faixa: alvo.faixa.id, avisos};
};

// ---------- ajustar a duração das cenas à fala ----------

export type MudancaDeCena = {cena: string; n: number; antes_ms: number; depois_ms: number; fala_ms: number};
export type AjusteAFala = {patch: OperacaoPatch[]; mudancas: MudancaDeCena[]; avisos: string[]};

const DURACAO_MIN = 300;
const DURACAO_MAX = 10 * 60 * 1000;

/** Cada cena que tem fala gerada passa a durar folga + fala + margem (padrão: a margem da configuração). As falas vão para o
 *  começo das cenas no tempo novo (com o mesmo deslocamento que tinham), e o resto do som anda com as cenas como em qualquer
 *  mudança de duração (som-com-cenas.ts). `apenas_alongar`: só cresce cena curta demais. Tudo num patch só: Reverter desfaz. */
export const ajustarCenasAFala = (doc: DocCenas, o: {margem_ms?: number; cenas?: string[]; apenas_alongar?: boolean} = {}): AjusteAFala => {
  const cfg: ConfigNarracaoN = configDaNarracao(doc.narracao);
  const margem = Math.max(0, Math.round(o.margem_ms ?? cfg.margem_ms));
  const {porCena, extras} = clipesDaNarracao(doc);
  const escolhidas = new Set(escolherCenas(doc, o.cenas).ids);
  const antes = temposDasCenas(doc);
  const cenas = Array.isArray(doc.cenas) ? doc.cenas : [];
  const mudancas: MudancaDeCena[] = [];
  const avisos: string[] = [];
  const depoisDoc: DocCenas = structuredClone(doc);
  cenas.forEach((c, i) => {
    const fala = porCena.get(c.id);
    if (!fala || !escolhidas.has(c.id)) return;
    const atual = antes[i].t_out - antes[i].t_in;
    const deslocamento = Math.max(0, fala.clipe.em - antes[i].t_in);
    const alvo = Math.round(Math.min(DURACAO_MAX, Math.max(DURACAO_MIN, deslocamento + fala.clipe.duracao_ms + margem)));
    if (Math.abs(alvo - atual) < 1 || (o.apenas_alongar && alvo < atual)) return;
    depoisDoc.cenas[i].duracao_ms = alvo;
    mudancas.push({cena: c.id, n: i + 1, antes_ms: atual, depois_ms: alvo, fala_ms: fala.clipe.duracao_ms});
  });
  if (!mudancas.length) return {patch: [], mudancas, avisos};
  const patch: OperacaoPatch[] = [];
  for (const m of mudancas) {
    const i = m.n - 1;
    patch.push({op: 'test', path: `/cenas/${i}/id`, value: m.cena}, {op: typeof cenas[i].duracao_ms === 'number' ? 'replace' : 'add', path: `/cenas/${i}/duracao_ms`, value: m.depois_ms});
  }
  if (doc.audio?.acompanha_cenas === false) {
    avisos.push('o som não acompanha as cenas neste vídeo (audio.acompanha_cenas: false): as falas ficaram onde estavam');
    return {patch, mudancas, avisos};
  }
  // o resto do som anda com as cenas (a mesma conta de quando a pessoa muda a duração); as falas vão para o começo da cena nova
  const ehFala = (c: ClipeAudio) => ehMarca(c?.narracao_ia);
  const semFalas: DocCenas = structuredClone(doc);
  for (const f of semFalas.audio?.faixas ?? []) if (Array.isArray(f.clipes)) f.clipes = f.clipes.filter((c) => !ehFala(c));
  const edicoes = edicoesDeTempo(doc, depoisDoc) ?? [];
  const movido = edicoes.length ? somComEdicoes(semFalas, edicoes) : semFalas;
  const novos = new Map(temposDasCenas(depoisDoc).map((t) => [t.id, t]));
  const velhos = new Map(antes.map((t) => [t.id, t]));
  const audio = structuredClone(movido.audio!) as AudioCenas;
  (doc.audio?.faixas ?? []).forEach((f, i) => {
    const falas = (Array.isArray(f.clipes) ? f.clipes : []).filter(ehFala).map((c) => {
      const cena = c.narracao_ia!.cena;
      const v = velhos.get(cena);
      const n = novos.get(cena);
      return v && n ? {...c, em: r3(n.t_in + (c.em - v.t_in))} : c;
    });
    if (!falas.length || !audio.faixas[i]) return;
    audio.faixas[i].clipes = [...(audio.faixas[i].clipes ?? []), ...falas].sort((a, b) => a.em - b.em);
  });
  if (extras.length) avisos.push('há falas divididas à mão: cada pedaço foi para a cena dele no tempo novo');
  patch.push({op: 'replace', path: '/audio', value: audio});
  if (JSON.stringify(movido.legendas) !== JSON.stringify(doc.legendas)) patch.push({op: doc.legendas ? 'replace' : 'add', path: '/legendas', value: movido.legendas});
  return {patch, mudancas, avisos};
};
