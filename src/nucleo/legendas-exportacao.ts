// As legendas na exportação do vídeo (frente Fala, rodada 3; docs/legendas.md, "Na exportação"): por destino, queimar a
// legenda no vídeo, gravar só o SRT ao lado ou os dois. O SRT sai com o nome do vídeo (o mesmo sufixo do destino),
// também como <nome>.pt_BR.srt, o nome que o Facebook pede, e em <nome>.vtt (o YouTube aceita, e o VTT leva o falante);
// com trecho, as legendas começam no zero do trecho; nada grava
// por cima do que já está em saidas/. No 16:9 com o SRT junto, a legenda queimada sobe acima da faixa onde o YouTube
// mostra as legendas automáticas. Puro: o laço da exportação (main.ts) e o diálogo chamam.
import {nomeLivreDaLegenda, paraSrt, paraVtt} from './legendas';

export type LegendaNaExportacao = 'video' | 'srt' | 'ambos';
export const OPCOES_LEGENDA_EXPORTACAO: {valor: LegendaNaExportacao; nome: string; nota: string}[] = [
  {valor: 'video', nome: 'No vídeo', nota: 'a legenda sai queimada no vídeo'},
  {valor: 'srt', nome: 'Só o SRT', nota: 'o vídeo sai sem legenda e o SRT (e o VTT) vai ao lado (YouTube, LinkedIn, Facebook)'},
  {valor: 'ambos', nome: 'Os dois', nota: 'queimada e o SRT ao lado; no 16:9, acima da faixa das legendas automáticas do YouTube'},
];

/** O que fazer com a legenda num destino: queimar, gravar o SRT e se a área sobe acima das legendas do YouTube. */
export const planoDasLegendas = (escolha: LegendaNaExportacao | undefined, destino: {largura: number; altura: number}) => {
  const e = escolha === 'srt' || escolha === 'ambos' ? escolha : 'video';
  const srt = e !== 'video';
  const queimar = e !== 'srt';
  return {queimar, srt, legendas_youtube: srt && queimar && destino.largura > destino.altura};
};

/** As legendas no tempo do arquivo exportado: com trecho, só as que tocam nele, cortadas nas pontas e contadas do zero. */
export const legendasNoTrecho = <S extends {em: number; sai: number}>(segs: S[], trecho?: {de_ms: number; ate_ms: number} | null): S[] => {
  if (!trecho) return segs;
  return segs.filter((s) => s.sai > trecho.de_ms && s.em < trecho.ate_ms)
    .map((s) => ({...s, em: Math.max(0, s.em - trecho.de_ms), sai: Math.min(trecho.ate_ms, s.sai) - trecho.de_ms}));
};

/** Os arquivos de legenda que vão ao lado do vídeo exportado (`base`: o nome dele sem a extensão): <base>.srt,
 *  <base>.pt_BR.srt e <base>.vtt, no tempo do arquivo, com o nome livre quando já existe um igual em saidas/. */
export const arquivosDeLegendaDoVideo = (base: string, segs: {em: number; sai: number; texto: string; falante?: string}[], trecho: {de_ms: number; ate_ms: number} | null | undefined,
  existe: (nome: string) => boolean): {nome: string; pedido: string; texto: string}[] => {
  const t = legendasNoTrecho(segs, trecho);
  if (!t.length) return [];
  const srt = paraSrt(t);
  return [`${base}.srt`, `${base}.pt_BR.srt`, `${base}.vtt`].map((pedido) => ({nome: nomeLivreDaLegenda(pedido, existe), pedido,
    texto: pedido.endsWith('.vtt') ? paraVtt(t) : srt}));
};
