// O chip de formato sobre o monitor: o formato do documento ativo pelo destino ("Reels 9:16", "Feed 4:5",
// "Personalizado 1200×800"), com os nomes de formatos.ts, e as opções para trocar quando cabe trocar. Puro: a casca
// só desenha o que vem daqui e grava a troca por patch (diário e Reverter), como o inspetor já fazia.
//
// Onde não cabe trocar, o chip só informa: a animação (o formato vem do modelo, `formato_fixo` em modelos.ts), o
// roteiro antigo do carrossel (sempre 1080×1920) e a cena 3D (não exporta: o quadro acompanha o monitor).
import type {Modulo} from './documentos';
import {ehDocCenas} from './cenas';
import {FORMATOS_IMAGEM, FORMATOS_VIDEO, formatoDoVideo, proporcaoDe, type PresetFormato} from './formatos';
import {MODELOS} from './modelos';

export type OpcaoFormato = {id: string; rotulo: string; nome: string; largura: number; altura: number; atual: boolean};

export type ChipFormato = {
  rotulo: string; // "Reels 9:16"
  dica: string; // nome, destino e medidas; e o motivo, quando não troca
  trocavel: boolean;
  motivo?: string; // por que só informa
  opcoes: OpcaoFormato[]; // vazio quando não troca
};

/** O nome curto do destino: "Reels e Shorts" vira "Reels", "YouTube e apresentação" vira "YouTube", "A4 para imprimir" vira "A4". */
export const nomeCurto = (p: Pick<PresetFormato, 'nome'>): string => p.nome.split(/ (?:e|do|da|de|para) /)[0];

/** "Reels 9:16"; sem proporção de verdade (o A4), só o nome. */
export const rotuloDoPreset = (p: PresetFormato): string => (p.proporcao.includes(':') ? `${nomeCurto(p)} ${p.proporcao}` : nomeCurto(p));

/** O rótulo de um tamanho na lista do módulo ("Feed 4:5") ou "Personalizado 1200×800". */
export const rotuloDoFormato = (lista: PresetFormato[], largura: number, altura: number): string => {
  const p = lista.find((f) => f.largura === largura && f.altura === altura);
  return p ? rotuloDoPreset(p) : `Personalizado ${largura}×${altura}`;
};

/** A lista de formatos de cada módulo: imagem tem a dela; vídeo e animação, a de vídeo. */
export const listaDoModulo = (modulo: Modulo): PresetFormato[] => (modulo === 'imagem' ? FORMATOS_IMAGEM : FORMATOS_VIDEO);

/** O módulo cujo formato vem sempre do modelo (todos os modelos dele têm `formato_fixo`). */
export const formatoFixoNoModulo = (modulo: Modulo): boolean => {
  const ms = MODELOS.filter((m) => m.modulo === modulo);
  return ms.length > 0 && ms.every((m) => Boolean(m.formato_fixo));
};

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined);

/** Largura, altura e fps do documento, como o monitor desenha. */
export const medidasDoDocumento = (modulo: Modulo, doc: unknown): {largura: number; altura: number; fps?: number} | null => {
  if (modulo === 'video') return formatoDoVideo(doc);
  if (modulo === 'imagem' || modulo === 'animacao') {
    const d = doc as {largura?: unknown; altura?: unknown; fps?: unknown} | null;
    const largura = num(d?.largura);
    const altura = num(d?.altura);
    if (!largura || !altura) return null;
    return modulo === 'animacao' && num(d?.fps) ? {largura, altura, fps: num(d?.fps)} : {largura, altura};
  }
  return null;
};

/** O chip do documento ativo; `null` onde não há formato a mostrar (música, documento ainda não lido). */
export const chipDoFormato = (modulo: Modulo, doc: unknown): ChipFormato | null => {
  if (modulo === '3d') {
    const motivo = 'A cena 3D ainda não exporta: o quadro acompanha o tamanho do monitor.';
    return {rotulo: '3D · quadro livre', dica: motivo, trocavel: false, motivo, opcoes: []};
  }
  if (modulo === 'musica' || !doc) return null;
  const m = medidasDoDocumento(modulo, doc);
  if (!m) return null;
  const lista = listaDoModulo(modulo);
  const preset = lista.find((f) => f.largura === m.largura && f.altura === m.altura);
  const rotulo = rotuloDoFormato(lista, m.largura, m.altura);
  const medidas = `${m.largura}×${m.altura}${m.fps ? ` · ${m.fps} qps` : ''}`;
  const descricao = preset ? `${preset.nome} (${preset.destino}) · ${proporcaoDe(m.largura, m.altura)} · ${medidas}` : `Tamanho livre · ${proporcaoDe(m.largura, m.altura)} · ${medidas}`;
  const motivo = modulo === 'animacao' && formatoFixoNoModulo('animacao') ? 'O formato da animação vem do modelo em que ela nasceu.'
    : modulo === 'video' && !ehDocCenas(doc) ? 'O roteiro do carrossel antigo é sempre 1080×1920.'
    : undefined;
  if (motivo) return {rotulo, dica: `${descricao}\n${motivo}`, trocavel: false, motivo, opcoes: []};
  const opcoes = lista.map((f): OpcaoFormato => ({id: f.id, rotulo: rotuloDoPreset(f), nome: f.nome, largura: f.largura, altura: f.altura,
    atual: f.largura === m.largura && f.altura === m.altura}));
  return {rotulo, dica: `${descricao}\nClique para trocar o formato`, trocavel: true, opcoes};
};

/** O que gravar para trocar o formato: os caminhos e valores (a casca faz o patch) e o rótulo do diário. `null` quando
 *  não cabe trocar, o id não existe ou o formato já é esse. O vídeo de cenas guarda `/formato` inteiro (o fps fica); a
 *  imagem guarda `/largura` e `/altura` (todas as páginas do carrossel), como a prancheta do inspetor. */
export const trocaDeFormato = (modulo: Modulo, doc: unknown, id: string): {mudancas: {caminho: string; valor: unknown}[]; rotulo: string} | null => {
  const chip = chipDoFormato(modulo, doc);
  const alvo = chip?.trocavel ? chip.opcoes.find((o) => o.id === id) : undefined;
  if (!alvo || alvo.atual) return null;
  const rotulo = `formato ${alvo.rotulo}`;
  if (modulo === 'video') return {mudancas: [{caminho: '/formato', valor: {...formatoDoVideo(doc), largura: alvo.largura, altura: alvo.altura}}], rotulo};
  const m = medidasDoDocumento(modulo, doc)!;
  return {mudancas: [
    ...(m.largura !== alvo.largura ? [{caminho: '/largura', valor: alvo.largura}] : []),
    ...(m.altura !== alvo.altura ? [{caminho: '/altura', valor: alvo.altura}] : []),
  ], rotulo};
};
