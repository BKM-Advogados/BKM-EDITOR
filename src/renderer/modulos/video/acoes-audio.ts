// Ações de som do vídeo de cenas pela interface, como JSON Patch (o mesmo caminho das outras edições: diário, desfazer,
// o Claude vê): adicionar clipe (do computador ou da biblioteca de trilhas), trocar o arquivo, duplicar, excluir, mover
// e aparar na linha do tempo. O documento sem `audio` ganha as três faixas (narração, música, efeitos) no primeiro
// clipe. Cada patch confere o id do que vai mexer, para não pisar no que o agente mudou por baixo.
import {Mic, Music, Volume2, type LucideIcon} from 'lucide-react';
import {ehDocCenas, idLivre, type DocCenas} from '../../../nucleo/cenas';
import {DURACAO_CLIPE_MIN, nomeDoClipe, novaFaixaAudio, novoAudioCenas, PAPEIS, papelDe, type ClipeAudio, type Envelope, type FaixaAudio, type PapelFaixa} from '../../../nucleo/audio';
import type {OperacaoPatch} from '../../../nucleo/documentos';
import {aplicar, avisar, loja, mensagemDe, patchTrocar, selecionar, valorEm} from '../../estado/loja';
import {msAtual} from './tocador';
import {garantirEnvelope} from './envelope';

export const ICONES_PAPEL: Record<PapelFaixa, LucideIcon> = {voz: Mic, musica: Music, efeitos: Volume2};
const FADE_MUSICA_MS = 1500; // a música nova sai em fade no fim do vídeo

const docDe = (documento: string) => loja.get().docs[documento]?.doc as DocCenas | undefined;
const duracaoDoVideo = (documento: string) => {
  const m = loja.get().props[documento];
  return m && 'props' in m ? m.props.duracao_ms : 0;
};
const testeId = (caminho: string, id: unknown): OperacaoPatch[] => (typeof id === 'string' ? [{op: 'test', path: `${caminho}/id`, value: id}] : []);
const r50 = (v: number) => Math.round(v / 50) * 50;

export const partesAudio = (caminho: string) => {
  const m = /^\/audio\/faixas\/(\d+)(?:\/clipes\/(\d+))?$/.exec(caminho);
  return m ? {faixa: Number(m[1]), clipe: m[2] !== undefined ? Number(m[2]) : null} : null;
};

export const ehSelecaoAudio = (documento: string) => {
  const s = loja.get().selecao;
  return Boolean(s && s.documento === documento && partesAudio(s.caminho));
};

const idNovo = (d: unknown, base: string) => {
  const usados = new Set<string>();
  const coletar = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(coletar);
    else if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      if (typeof o.id === 'string') usados.add(o.id);
      Object.values(o).forEach(coletar);
    }
  };
  coletar(d);
  return usados.has(base) ? idLivre(d, base) : base;
};

/** Onde um clipe deste papel entra: a faixa selecionada se for do papel, senão a primeira do papel; sem nenhuma, uma
 *  nova no fim; e, no documento ainda sem som, o `audio` inteiro com as três faixas. */
const faixaPara = (d: DocCenas, documento: string, papel: PapelFaixa): {indice: number; faixa: FaixaAudio; criar?: 'audio' | 'faixa'} => {
  const faixas = d.audio?.faixas;
  if (!Array.isArray(faixas)) {
    const audio = novoAudioCenas();
    const indice = audio.faixas.findIndex((f) => f.papel === papel);
    return {indice, faixa: audio.faixas[indice], criar: 'audio'};
  }
  const sel = loja.get().selecao;
  const p = sel?.documento === documento ? partesAudio(sel.caminho) : null;
  if (p && faixas[p.faixa] && papelDe(faixas[p.faixa]) === papel) return {indice: p.faixa, faixa: faixas[p.faixa]};
  const i = faixas.findIndex((f) => papelDe(f) === papel);
  if (i >= 0) return {indice: i, faixa: faixas[i]};
  return {indice: faixas.length, faixa: novaFaixaAudio(papel, idNovo(d, PAPEIS[papel].id)), criar: 'faixa'};
};

/** Clipe novo: narração e efeito entram no tempo atual com o arquivo inteiro; a música entra no zero, até o fim do
 *  vídeo, saindo em fade. */
const clipeNovo = (d: DocCenas, papel: PapelFaixa, arquivo: string, env: Envelope, duracaoVideo: number): ClipeAudio => {
  const em = papel === 'musica' ? 0 : Math.max(0, Math.min(Math.max(0, duracaoVideo - DURACAO_CLIPE_MIN), r50(msAtual())));
  const inteira = Math.max(DURACAO_CLIPE_MIN, env.duracao_ms);
  const duracao_ms = papel === 'musica' && duracaoVideo > 0 ? Math.max(DURACAO_CLIPE_MIN, Math.min(inteira, duracaoVideo)) : inteira;
  const c: ClipeAudio = {id: idNovo(d, 'clipe'), arquivo, em, duracao_ms};
  if (papel === 'musica' && duracao_ms > FADE_MUSICA_MS * 2) c.fade_out_ms = FADE_MUSICA_MS;
  return c;
};

/** Adiciona um clipe: sem `arquivo`, abre o diálogo (copia para midia/). Mede o envelope antes, para já saber a duração. */
export const adicionarClipeAudio = async (documento: string, papel: PapelFaixa, arquivo?: string) => {
  if (!ehDocCenas(docDe(documento))) return avisar('Só o vídeo de cenas tem faixas de áudio.', 'info');
  try {
    const arq = arquivo ?? (await window.estudio.escolherMidia('audio'));
    if (!arq) return;
    avisar(`Medindo ${arq.split('/').pop()}…`, 'info');
    const env = await garantirEnvelope(arq);
    const d = docDe(documento); // o documento pode ter mudado enquanto media
    if (!ehDocCenas(d)) return;
    const {indice, faixa, criar} = faixaPara(d, documento, papel);
    const clipe = clipeNovo(d, papel, arq, env, duracaoDoVideo(documento));
    let ops: OperacaoPatch[];
    let j = 0;
    if (criar === 'audio') {
      const audio = novoAudioCenas();
      audio.faixas[indice].clipes.push(clipe);
      ops = [{op: 'add', path: '/audio', value: audio}];
    } else if (criar === 'faixa') ops = [{op: 'add', path: `/audio/faixas/${indice}`, value: {...faixa, clipes: [clipe]}}];
    else {
      j = Array.isArray(faixa.clipes) ? faixa.clipes.length : 0;
      ops = [...testeId(`/audio/faixas/${indice}`, faixa.id),
        Array.isArray(faixa.clipes) ? {op: 'add', path: `/audio/faixas/${indice}/clipes/${j}`, value: clipe} : {op: 'add', path: `/audio/faixas/${indice}/clipes`, value: [clipe]}];
    }
    if (await aplicar(documento, ops, `${PAPEIS[papel].nome.toLowerCase()}: ${nomeDoClipe(clipe)}`)) selecionar({documento, caminho: `/audio/faixas/${indice}/clipes/${j}`});
  } catch (e) {
    avisar(mensagemDe(e), 'erro');
  }
};

/** Música da biblioteca (pasta de trilhas das preferências): copia para midia/ e entra na faixa de música. */
export const adicionarDaBiblioteca = async (documento: string, caminho: string) => {
  try {
    const arquivo = await window.estudio.audio.importarTrilha(caminho);
    await adicionarClipeAudio(documento, 'musica', arquivo);
  } catch (e) {
    avisar(mensagemDe(e), 'erro');
  }
};

/** Troca o arquivo do clipe selecionado (o corte volta ao zero; a duração só muda se o arquivo novo for mais curto). */
export const trocarArquivoDoClipe = async (documento: string, caminho: string) => {
  try {
    const arq = await window.estudio.escolherMidia('audio');
    if (!arq) return;
    const env = await garantirEnvelope(arq);
    const d = docDe(documento);
    const c = valorEm(d, caminho) as ClipeAudio | undefined;
    if (!c) return;
    const patch = [...testeId(caminho, c.id), ...patchTrocar(d, `${caminho}/arquivo`, arq), ...patchTrocar(d, `${caminho}/corte_ms`, undefined),
      ...(c.duracao_ms > env.duracao_ms ? patchTrocar(d, `${caminho}/duracao_ms`, Math.max(DURACAO_CLIPE_MIN, env.duracao_ms)) : [])];
    await aplicar(documento, patch, `arquivo do clipe: ${arq.split('/').pop()}`);
  } catch (e) {
    avisar(mensagemDe(e), 'erro');
  }
};

/** Move ou apara um clipe (a linha do tempo chama ao soltar): só grava o que mudou, em passos de 50 ms. */
export const moverClipe = async (documento: string, caminho: string, novo: {em?: number; corte_ms?: number; duracao_ms?: number}, rotulo: string) => {
  const d = docDe(documento);
  const c = valorEm(d, caminho) as ClipeAudio | undefined;
  if (!c) return false;
  const patch: OperacaoPatch[] = [...testeId(caminho, c.id)];
  if (novo.em !== undefined && r50(novo.em) !== c.em) patch.push(...patchTrocar(d, `${caminho}/em`, Math.max(0, r50(novo.em))));
  if (novo.corte_ms !== undefined && r50(novo.corte_ms) !== (c.corte_ms ?? 0)) patch.push(...patchTrocar(d, `${caminho}/corte_ms`, r50(novo.corte_ms) > 0 ? r50(novo.corte_ms) : undefined));
  if (novo.duracao_ms !== undefined && r50(novo.duracao_ms) !== c.duracao_ms) patch.push(...patchTrocar(d, `${caminho}/duracao_ms`, Math.max(DURACAO_CLIPE_MIN, r50(novo.duracao_ms))));
  if (patch.length <= (c.id ? 1 : 0)) return false;
  return aplicar(documento, patch, rotulo);
};

export const duplicarSelecaoAudio = async (documento: string) => {
  const sel = loja.get().selecao;
  const d = docDe(documento);
  const p = sel?.documento === documento ? partesAudio(sel.caminho) : null;
  if (!p || !d?.audio?.faixas?.[p.faixa]) return avisar('Selecione um clipe ou uma faixa de áudio para duplicar.', 'info');
  const faixa = d.audio.faixas[p.faixa];
  if (p.clipe === null) {
    const copia: FaixaAudio = {...structuredClone(faixa), id: idNovo(d, faixa.id), nome: `${faixa.nome} (cópia)`};
    copia.clipes = (copia.clipes ?? []).map((c, i) => ({...c, id: idNovo({...d, extra: copia.clipes.slice(0, i)}, c.id)}));
    const destino = `/audio/faixas/${p.faixa + 1}`;
    if (await aplicar(documento, [...testeId(sel!.caminho, faixa.id), {op: 'add', path: destino, value: copia}], `duplicar faixa ${faixa.nome}`)) selecionar({documento, caminho: destino});
    return;
  }
  const c = faixa.clipes[p.clipe];
  if (!c) return;
  // a cópia entra logo depois do original, na mesma faixa
  const copia: ClipeAudio = {...structuredClone(c), id: idNovo(d, c.id), em: c.em + c.duracao_ms};
  const destino = `/audio/faixas/${p.faixa}/clipes/${p.clipe + 1}`;
  if (await aplicar(documento, [...testeId(sel!.caminho, c.id), {op: 'add', path: destino, value: copia}], `duplicar clipe ${nomeDoClipe(c)}`)) selecionar({documento, caminho: destino});
};

export const excluirSelecaoAudio = async (documento: string) => {
  const sel = loja.get().selecao;
  const d = docDe(documento);
  const p = sel?.documento === documento ? partesAudio(sel.caminho) : null;
  if (!p || !d?.audio?.faixas?.[p.faixa]) return avisar('Selecione um clipe ou uma faixa de áudio para excluir.', 'info');
  const alvo = valorEm(d, sel!.caminho) as {id?: string} | undefined;
  if (!alvo) return;
  const faixa = d.audio.faixas[p.faixa];
  const rotulo = p.clipe === null ? `excluir faixa ${faixa.nome}` : `excluir clipe ${nomeDoClipe(faixa.clipes[p.clipe])}`;
  if (await aplicar(documento, [...testeId(sel!.caminho, alvo.id), {op: 'remove', path: sel!.caminho}], rotulo)) {
    selecionar(p.clipe === null ? null : {documento, caminho: `/audio/faixas/${p.faixa}`});
    avisar(`${p.clipe === null ? 'Faixa excluída' : 'Clipe excluído'}. Ctrl+Z desfaz.`, 'ok');
  }
};
