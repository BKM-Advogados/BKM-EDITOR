// Edição das legendas do vídeo de cenas como JSON Patch: juntar, dividir, excluir, criar, substituir em lote e trocar a
// predefinição. A tela (video/acoes-legendas.ts) e o MCP (editar_legendas, mcp-edicao-fina.ts) usam as mesmas contas,
// então um botão e uma chamada do agente gravam o mesmo patch e viram uma entrada só no diário. Os tempos aqui são os
// guardados no documento (os de quando a legenda nasceu); quem tem o tempo da tela converte antes (deslocamentoDaLegenda).
import {idLivre, type DocCenas} from './cenas';
import type {OperacaoPatch} from './documentos';
import {formatoDoVideo} from './formatos';
import {
  dividirSegmento, juntarSegmentos, requebrar, substituirEmLote, type EntradaDicionario, type EstiloLegenda, type LegendasCenas, type OpcoesBusca,
  type SegmentoLegenda,
} from './legendas';

/** A edição não deu (legenda que não existe, uma palavra só…): o texto diz por quê, para a tela avisar e o MCP devolver. */
export type RecusaLegenda = {erro: string};
export const recusouLegenda = (x: unknown): x is RecusaLegenda => typeof (x as RecusaLegenda | null)?.erro === 'string';

const caminhoSeg = (i: number) => `/legendas/segmentos/${i}`;
const segmentosDe = (doc: Pick<DocCenas, 'legendas'>): SegmentoLegenda[] => (Array.isArray(doc.legendas?.segmentos) ? doc.legendas.segmentos : []);
const indiceDe = (doc: Pick<DocCenas, 'legendas'>, id: string) => segmentosDe(doc).findIndex((s) => s?.id === id);
const naoAchada = (id: string): RecusaLegenda => ({erro: `legenda não achada: ${id}`});

/** Junta a legenda `id` com a seguinte (texto, palavras e tempo). */
export const patchJuntarLegendas = (doc: Pick<DocCenas, 'legendas'>, id: string): {patch: OperacaoPatch[]; junta: SegmentoLegenda; removida: string} | RecusaLegenda => {
  const segs = segmentosDe(doc);
  const i = indiceDe(doc, id);
  if (i < 0) return naoAchada(id);
  if (i >= segs.length - 1) return {erro: 'não há legenda depois desta para juntar'};
  const junta = juntarSegmentos(segs[i], segs[i + 1]);
  return {junta, removida: segs[i + 1].id, patch: [
    {op: 'test', path: `${caminhoSeg(i)}/id`, value: id},
    {op: 'test', path: `${caminhoSeg(i + 1)}/id`, value: segs[i + 1].id},
    {op: 'remove', path: caminhoSeg(i + 1)},
    {op: 'replace', path: caminhoSeg(i), value: junta},
  ]};
};

/** Divide a legenda `id` antes da primeira palavra que começa em `ms` ou depois (tempo guardado); sem `ms`, ou fora da
 *  legenda, no meio do texto. O segundo pedaço ganha um id `leg` livre. */
export const patchDividirLegenda = (doc: DocCenas, id: string, ms?: number): {patch: OperacaoPatch[]; partes: [SegmentoLegenda, SegmentoLegenda]} | RecusaLegenda => {
  const segs = segmentosDe(doc);
  const i = indiceDe(doc, id);
  if (i < 0) return naoAchada(id);
  const s = segs[i];
  let indice: number | undefined;
  if (ms !== undefined && Array.isArray(s.palavras) && ms > s.em && ms < s.sai) {
    const k = s.palavras.findIndex((p) => p.s >= ms);
    if (k > 0) indice = k;
  }
  const r = dividirSegmento(s, idLivre(doc, 'leg'), indice);
  if (!r) return {erro: 'uma palavra só não se divide'};
  return {partes: r, patch: [{op: 'test', path: `${caminhoSeg(i)}/id`, value: id}, {op: 'replace', path: caminhoSeg(i), value: r[0]}, {op: 'add', path: caminhoSeg(i + 1), value: r[1]}]};
};

export const patchExcluirLegenda = (doc: Pick<DocCenas, 'legendas'>, id: string): {patch: OperacaoPatch[]} | RecusaLegenda => {
  const i = indiceDe(doc, id);
  if (i < 0) return naoAchada(id);
  return {patch: [{op: 'test', path: `${caminhoSeg(i)}/id`, value: id}, {op: 'remove', path: caminhoSeg(i)}]};
};

/** Legenda nova em `ms` (tempo do vídeo; ela não é de clipe nenhum, então não anda com a voz): `duracao_ms` (padrão 2 s,
 *  ou o que couber até a próxima, nunca menos de 500 ms). Sem legendas no vídeo, nasce a lista com a predefinição clássica. */
export const patchNovaLegenda = (doc: DocCenas, ms: number, o: {texto?: string; duracao_ms?: number} = {}): {patch: OperacaoPatch[]; indice: number; legenda: SegmentoLegenda} => {
  const segs = segmentosDe(doc);
  const em = Math.max(0, Math.round(ms));
  const prox = segs.filter((s) => s.em > em).reduce((m, s) => Math.min(m, s.em), Infinity);
  const sai = o.duracao_ms !== undefined ? em + Math.max(200, Math.round(o.duracao_ms)) : Math.max(em + 500, Math.min(em + 2000, prox));
  const legenda: SegmentoLegenda = {id: idLivre(doc, 'leg'), em, sai, texto: o.texto?.trim() || 'Nova legenda'};
  const indice = segs.filter((s) => s.em <= em).length;
  const patch: OperacaoPatch[] = doc.legendas
    ? [{op: 'add', path: caminhoSeg(indice), value: legenda}]
    : [{op: 'add', path: '/legendas', value: {estilo: {predefinicao: 'classica'}, segmentos: [legenda]} satisfies LegendasCenas}];
  return {patch, indice, legenda};
};

/** As legendas com `procurar` trocado por `troca` em todas; com `guardar`, a troca entra no dicionário do vídeo e volta a
 *  valer quando as legendas forem geradas de novo. */
export const legendasComSubstituicao = (leg: LegendasCenas, procurar: string, troca: string, o: OpcoesBusca & {guardar?: boolean} = {}): {legendas: LegendasCenas; trocas: number} => {
  const r = substituirEmLote(leg.segmentos, procurar, troca, o);
  const entrada: EntradaDicionario = {de: procurar, para: troca, ...(o.palavra_inteira ? {} : {palavra_inteira: false}), ...(o.caixa ? {caixa: true} : {})};
  const dicionario = o.guardar ? [...(leg.dicionario ?? []).filter((e) => e.de !== procurar), entrada] : leg.dicionario;
  return {trocas: r.trocas, legendas: {...leg, segmentos: r.segmentos, ...(dicionario ? {dicionario} : {})}};
};

/** As legendas com a predefinição nova, quebradas de novo para a largura e as palavras por vez dela. */
export const legendasComPredefinicao = (doc: DocCenas, estilo: EstiloLegenda): LegendasCenas | null => {
  if (!doc.legendas) return null;
  const f = formatoDoVideo(doc);
  return requebrar(doc.legendas, estilo, f.largura, f.altura, doc.tema?.fonte);
};

/** O estilo ao trocar de predefinição: o que a pessoa escolheu de cor, fundo, falante e quadrado continua. */
export const estiloComPredefinicao = (atual: EstiloLegenda | undefined, predefinicao: EstiloLegenda['predefinicao']): EstiloLegenda => ({
  predefinicao,
  ...(atual?.falante ? {falante: true} : {}), ...(atual?.cor ? {cor: atual.cor} : {}), ...(atual?.cor_destaque ? {cor_destaque: atual.cor_destaque} : {}),
  ...(atual?.fundo ? {fundo: atual.fundo} : {}), ...(atual?.no_quadrado === false ? {no_quadrado: false} : {}),
});

/** Grava as legendas inteiras: um replace (ou add, se o vídeo ainda não tinha) em /legendas. */
export const patchDasLegendas = (doc: Pick<DocCenas, 'legendas'>, legendas: LegendasCenas): OperacaoPatch[] =>
  [{op: doc.legendas === undefined ? 'add' : 'replace', path: '/legendas', value: legendas}];
