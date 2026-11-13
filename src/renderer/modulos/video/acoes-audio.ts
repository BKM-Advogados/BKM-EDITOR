// Ações de som do vídeo de cenas pela interface, como JSON Patch (o mesmo caminho das outras edições: diário, desfazer,
// o Claude vê): adicionar clipe (do computador ou da biblioteca de trilhas), trocar o arquivo, duplicar, excluir, mover
// e aparar na linha do tempo, limpar a voz e voltar ao original. O documento sem `audio` ganha as três faixas (narração,
// música, efeitos) no primeiro clipe. Cada patch confere o id do que vai mexer, para não pisar no que o agente mudou por baixo.
import {Mic, Music, Volume2, type LucideIcon} from 'lucide-react';
import {ehDocCenas, idLivre, type DocCenas} from '../../../nucleo/cenas';
import {DURACAO_CLIPE_MIN, nivelDeReferencia, nomeDoClipe, novaFaixaAudio, novoAudioCenas, PAPEIS, papelDe, type AudioP, type ClipeAudio, type Envelope, type FaixaAudio, type IntensidadeLimpeza,
  type PapelFaixa} from '../../../nucleo/audio';
import {copiarClipe, crossfadeEntre, dividirClipe, nivelDaVoz, recusou, volumeDoEfeito} from '../../../nucleo/clipes-audio';
import type {OperacaoPatch} from '../../../nucleo/documentos';
import {origemDaLimpeza, patchLimpezaDoClipe, patchVoltarAoOriginalDoClipe} from '../../../nucleo/medidas-som'; // frente 3 do MCP: a mesma conta do limpar_voz
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
const propsAudioDe = (documento: string): AudioP | undefined => {
  const m = loja.get().props[documento];
  return m && 'props' in m ? (m.props as {audio?: AudioP}).audio : undefined;
};
const testeId = (caminho: string, id: unknown): OperacaoPatch[] => (typeof id === 'string' ? [{op: 'test', path: `${caminho}/id`, value: id}] : []);
const r50 = (v: number) => Math.round(v / 50) * 50;
const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

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

/** Clipe novo: narração e efeito entram no tempo atual com o arquivo inteiro; a música entra onde a faixa acaba (no
 *  zero, se vazia) e vai até o fim do vídeo, saindo em fade. */
const clipeNovo = (d: DocCenas, faixa: FaixaAudio, papel: PapelFaixa, arquivo: string, env: Envelope, duracaoVideo: number): ClipeAudio => {
  const fimDaFaixa = (faixa.clipes ?? []).reduce((m, c) => Math.max(m, numero(c.em) + numero(c.duracao_ms)), 0);
  const em = papel === 'musica' ? (fimDaFaixa < duracaoVideo - DURACAO_CLIPE_MIN ? fimDaFaixa : 0) : Math.max(0, Math.min(Math.max(0, duracaoVideo - DURACAO_CLIPE_MIN), r50(msAtual())));
  const inteira = Math.max(DURACAO_CLIPE_MIN, env.duracao_ms);
  const duracao_ms = papel === 'musica' && duracaoVideo > 0 ? Math.max(DURACAO_CLIPE_MIN, Math.min(inteira, duracaoVideo - em)) : inteira;
  const c: ClipeAudio = {id: idNovo(d, 'clipe'), arquivo, em, duracao_ms};
  if (papel === 'musica' && duracao_ms > FADE_MUSICA_MS * 2) c.fade_out_ms = FADE_MUSICA_MS;
  return c;
};

/** Música que entra numa faixa de música já cheia (som-D7): na cabeça, com crossfade com a que toca ali; a cabeça no começo ou
 *  no fim do vídeo não dá lugar para isso, e a música nova vai para uma faixa de música nova. */
const musicaSobreMusica = (d: DocCenas, documento: string, indice: number, faixa: FaixaAudio, arquivo: string, env: Envelope, dv: number): OperacaoPatch[] | null => {
  const t = r50(msAtual());
  const tocando = (faixa.clipes ?? []).find((c) => c.em <= t && c.em + c.duracao_ms > t);
  if (!tocando || t < 500 || t > dv - 1000) return null;
  const j = faixa.clipes.length;
  const novo: ClipeAudio = {id: idNovo(d, 'clipe'), arquivo, em: t, duracao_ms: Math.max(DURACAO_CLIPE_MIN, Math.min(Math.max(DURACAO_CLIPE_MIN, env.duracao_ms), dv - t))};
  if (novo.duracao_ms > FADE_MUSICA_MS * 2) novo.fade_out_ms = FADE_MUSICA_MS;
  const virtual = structuredClone(d);
  virtual.audio!.faixas[indice].clipes.push(novo);
  const r = crossfadeEntre(virtual, {de: tocando.id, para: novo.id, duracao_ms: FADE_MUSICA_MS}, duracoesMedidas(documento));
  if (recusou(r)) return null;
  const antes = `/audio/faixas/${indice}/clipes/${faixa.clipes.findIndex((c) => c.id === tocando.id)}`;
  return [...testeId(antes, tocando.id), {op: 'add', path: `/audio/faixas/${indice}/clipes/${j}`, value: r.para}, {op: 'replace', path: antes, value: r.de}];
};

const fimDaFaixaDe = (faixa: FaixaAudio) => (faixa.clipes ?? []).reduce((m, c) => Math.max(m, numero(c.em) + numero(c.duracao_ms)), 0);

/** Adiciona um clipe: sem `arquivo`, abre o diálogo (copia para midia/). Mede o envelope antes, para já saber a duração.
 *  Efeito sonoro entra com o volume na medida da casa (20 LU abaixo da voz, som-D4); a segunda música não entra por cima da
 *  primeira (som-D7). */
export const adicionarClipeAudio = async (documento: string, papel: PapelFaixa, arquivo?: string) => {
  if (!ehDocCenas(docDe(documento))) return avisar('Só o vídeo de cenas tem faixas de áudio.', 'info');
  try {
    const arq = arquivo ?? (await window.estudio.escolherMidia('audio'));
    if (!arq) return;
    avisar(`Medindo ${arq.split('/').pop()}…`, 'info');
    const env = await garantirEnvelope(arq);
    const d = docDe(documento); // o documento pode ter mudado enquanto media
    if (!ehDocCenas(d)) return;
    const dv = duracaoDoVideo(documento);
    let {indice, faixa, criar} = faixaPara(d, documento, papel);
    const cheia = papel === 'musica' && !criar && dv > 0 && (faixa.clipes ?? []).length > 0 && fimDaFaixaDe(faixa) >= dv - DURACAO_CLIPE_MIN;
    let aviso = '';
    let ops: OperacaoPatch[] | null = null;
    let j = 0;
    if (cheia) {
      ops = musicaSobreMusica(d, documento, indice, faixa, arq, env, dv);
      if (ops) {
        j = faixa.clipes.length;
        aviso = 'A música nova entra na cabeça e a de antes desce em crossfade.';
      } else {
        // sem lugar na cabeça: faixa de música nova, para as duas não se atropelarem sem a pessoa ver
        const n = d.audio!.faixas.filter((f) => papelDe(f) === 'musica').length;
        indice = d.audio!.faixas.length;
        faixa = {...novaFaixaAudio('musica', idNovo(d, PAPEIS.musica.id)), nome: `${PAPEIS.musica.nome_faixa} ${n + 1}`};
        criar = 'faixa';
        aviso = `A faixa de música já está cheia: a nova foi para "${faixa.nome}". Silencie uma das duas para ouvir só uma.`;
      }
    }
    if (!ops) {
      const clipe = clipeNovo(d, faixa, papel, arq, env, dv);
      if (papel === 'efeitos') {
        // som-D4: o efeito normalizado a 0 dBFS entrava a 100 % e passava a voz; entra 20 LU abaixo dela
        const v = volumeDoEfeito(nivelDeReferencia(env), nivelDaVoz(propsAudioDe(documento)));
        if (v < 1) clipe.volume = v;
        aviso = v < 1 ? `Efeito a ${Math.round(v * 100)} %: fica 20 LU abaixo da voz, a regra da casa. Ajuste o volume do clipe se quiser.` : '';
      }
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
      const entrou = await aplicar(documento, ops, `${PAPEIS[papel].nome.toLowerCase()}: ${nomeDoClipe(clipe)}`);
      if (entrou) {
        selecionar({documento, caminho: `/audio/faixas/${indice}/clipes/${j}`});
        if (aviso) avisar(aviso, 'info');
      }
      return entrou; // o painel Mídia ("Usar em…") avisa só quando entrou
    }
    const entrou = await aplicar(documento, ops, `${PAPEIS[papel].nome.toLowerCase()}: ${arq.split('/').pop()}`);
    if (entrou) {
      selecionar({documento, caminho: `/audio/faixas/${indice}/clipes/${j}`});
      if (aviso) avisar(aviso, 'info');
    }
    return entrou;
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
    // arquivo novo não é mais a voz limpa de antes: some o original e o que a limpeza mediu
    const patch = [...testeId(caminho, c.id), ...patchTrocar(d, `${caminho}/arquivo`, arq), ...patchTrocar(d, `${caminho}/corte_ms`, undefined),
      ...patchTrocar(d, `${caminho}/original`, undefined), ...patchTrocar(d, `${caminho}/limpeza`, undefined),
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
  if (novo.em !== undefined && novo.corte_ms !== undefined) {
    // aparar o começo: o começo anda em passos de 50 ms e o corte anda o mesmo tanto, o fim fica no lugar. Arredondar os
    // dois à parte (clipe de uma divisão, que não cai em múltiplos de 50) deslocaria o som no tempo (som-D1)
    const emNovo = Math.max(0, r50(novo.em));
    const passo = emNovo - c.em;
    const corteNovo = Math.max(0, (c.corte_ms ?? 0) + passo);
    if (passo !== 0) {
      patch.push(...patchTrocar(d, `${caminho}/em`, emNovo));
      patch.push(...patchTrocar(d, `${caminho}/corte_ms`, corteNovo > 0 ? corteNovo : undefined));
      patch.push(...patchTrocar(d, `${caminho}/duracao_ms`, Math.max(DURACAO_CLIPE_MIN, c.duracao_ms - passo)));
    }
  } else {
    if (novo.em !== undefined && r50(novo.em) !== c.em) patch.push(...patchTrocar(d, `${caminho}/em`, Math.max(0, r50(novo.em))));
    if (novo.corte_ms !== undefined && r50(novo.corte_ms) !== (c.corte_ms ?? 0)) patch.push(...patchTrocar(d, `${caminho}/corte_ms`, r50(novo.corte_ms) > 0 ? r50(novo.corte_ms) : undefined));
    if (novo.duracao_ms !== undefined && r50(novo.duracao_ms) !== c.duracao_ms) patch.push(...patchTrocar(d, `${caminho}/duracao_ms`, Math.max(DURACAO_CLIPE_MIN, r50(novo.duracao_ms))));
  }
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
  // a cópia entra logo depois do original, na mesma faixa, com as legendas dele (clipes-audio.ts)
  const r = copiarClipe(d, c.id);
  if (recusou(r)) return avisar(r.erro, 'info');
  if (await aplicar(documento, r.patch, `duplicar clipe ${nomeDoClipe(c)}`)) selecionar({documento, caminho: r.caminho_copia});
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

// ---------- limpeza de voz (src/main/limpeza-voz.ts): uma por vez, com andamento e Cancelar ----------
export type AndamentoLimpeza = {arquivo: string; progresso: number; documento: string; caminho: string} | null;
let andamento: AndamentoLimpeza = null;
const ouvintesLimpeza = new Set<() => void>();
const mudouLimpeza = (a: AndamentoLimpeza) => {
  andamento = a;
  ouvintesLimpeza.forEach((f) => f());
};
let ligado = false;
const ouvirProgresso = () => {
  if (ligado) return;
  ligado = true;
  window.estudio.audio.aoProgressoLimpeza((p) => {
    if (andamento?.arquivo === p.arquivo) mudouLimpeza({...andamento, progresso: p.progresso});
  });
};
export const assinarLimpeza = (f: () => void) => {
  ouvirProgresso();
  ouvintesLimpeza.add(f);
  return () => {
    ouvintesLimpeza.delete(f);
  };
};
export const andamentoLimpeza = () => andamento;
export const cancelarLimpeza = () => void window.estudio.audio.cancelarLimpeza();

const db1 = (v: number | null) => (v === null ? '—' : v.toFixed(1).replace('.', ',').replace('-', '−'));

/** Limpa a voz do clipe: o processo principal grava midia/<arquivo>.limpo.wav a partir do original (nunca do já limpo)
 *  e o clipe passa a apontar para ele, guardando o original e as medidas. Corte e duração ficam: o tamanho é o mesmo. */
export const limparVozDoClipe = async (documento: string, caminho: string, intensidade: IntensidadeLimpeza) => {
  const c = valorEm(docDe(documento), caminho) as ClipeAudio | undefined;
  if (!c) return;
  if (andamento) return avisar('Já há uma limpeza de voz em andamento; espere ou cancele.', 'info');
  const origem = origemDaLimpeza(c);
  ouvirProgresso();
  mudouLimpeza({arquivo: origem, progresso: 0, documento, caminho});
  try {
    const r = await window.estudio.audio.limparVoz(origem, intensidade);
    if ('cancelado' in r) return avisar('Limpeza cancelada; o clipe continua como estava.', 'info');
    const d = docDe(documento); // o documento pode ter mudado enquanto limpava
    const agora = valorEm(d, caminho) as ClipeAudio | undefined;
    if (!agora || agora.id !== c.id) return avisar(`A voz limpa ficou em ${r.arquivo}, mas o clipe mudou de lugar; troque o arquivo dele à mão.`, 'info');
    // o mesmo patch do limpar_voz do MCP (src/nucleo/medidas-som.ts)
    const patch = patchLimpezaDoClipe(d, caminho, c, r);
    if (await aplicar(documento, patch, `limpar voz (${intensidade}): ${nomeDoClipe(c)}`)) {
      avisar(`Voz limpa: ruído nas pausas de ${db1(r.medidas.ruido_antes_db)} para ${db1(r.medidas.ruido_depois_db)} dB. "Voltar ao original" desfaz.`, 'ok');
    }
  } catch (e) {
    avisar(mensagemDe(e), 'erro');
  } finally {
    mudouLimpeza(null);
  }
};

/** O clipe volta a tocar o arquivo da pessoa; o .limpo.wav fica em midia/ e é regravado se ela limpar de novo. */
export const voltarAoOriginal = async (documento: string, caminho: string) => {
  const d = docDe(documento);
  const c = valorEm(d, caminho) as ClipeAudio | undefined;
  if (!c?.original) return;
  const patch = patchVoltarAoOriginalDoClipe(d, caminho, c);
  if (await aplicar(documento, patch, `voltar ao original: ${nomeDoClipe(c)}`)) avisar('O clipe voltou ao arquivo original. Ctrl+Z desfaz.', 'ok');
};

// ---------- dividir e crossfade (frente Som, rodada 3): a conta é a de src/nucleo/clipes-audio.ts, a mesma do MCP ----------
const segTxt = (ms: number) => (ms / 1000).toLocaleString('pt-BR', {maximumFractionDigits: 2});

/** Divide o clipe selecionado na cabeça (Ctrl+K): as duas metades tocam o mesmo som, e as legendas e a voz limpa vão junto. */
export const dividirSelecaoAudio = async (documento: string) => {
  const sel = loja.get().selecao;
  const d = docDe(documento);
  const p = sel?.documento === documento ? partesAudio(sel.caminho) : null;
  const c = p && p.clipe !== null && ehDocCenas(d) ? d.audio?.faixas?.[p.faixa]?.clipes?.[p.clipe] : undefined;
  if (!p || !c || !ehDocCenas(d)) return avisar('Selecione um clipe de áudio para dividir.', 'info');
  const r = dividirClipe(d, c.id, msAtual());
  if (recusou(r)) return avisar(r.erro, 'info');
  if (await aplicar(documento, r.patch, `dividir ${nomeDoClipe(c)} em ${segTxt(r.corte_ms)} s`)) {
    selecionar({documento, caminho: r.caminho_segundo});
    avisar(r.avisos.length ? `Clipe dividido. ${r.avisos.join('; ')}.` : 'Clipe dividido na cabeça. Ctrl+Z desfaz.', 'ok');
  }
};

/** Duração (ms) de cada arquivo de áudio já medido, para o crossfade saber o som que sobra além do corte. */
const duracoesMedidas = (documento: string) => {
  const m = loja.get().props[documento];
  const out: Record<string, number | undefined> = {};
  if (m && 'props' in m) for (const f of (m.props as {audio?: AudioP}).audio?.faixas ?? []) for (const c of f.clipes) out[c.arquivo] = c.envelope?.duracao_ms;
  return out;
};

/** Crossfade do clipe selecionado com o seguinte da faixa. Se os dois já se sobrepõem, a sobreposição vira o crossfade;
 *  senão, 1 s. A curva é a da faixa (potência igual na música e nos efeitos, linear na voz). */
export const crossfadeComSeguinte = async (documento: string, duracao_ms?: number) => {
  const sel = loja.get().selecao;
  const d = docDe(documento);
  const p = sel?.documento === documento ? partesAudio(sel.caminho) : null;
  const faixa = p && ehDocCenas(d) ? d.audio?.faixas?.[p.faixa] : undefined;
  const c = faixa && p && p.clipe !== null ? faixa.clipes?.[p.clipe] : undefined;
  if (!faixa || !c || !ehDocCenas(d)) return avisar('Selecione um clipe de áudio para fazer o crossfade.', 'info');
  const seguinte = faixa.clipes.filter((x) => x.id !== c.id && x.em >= c.em).sort((a, b) => a.em - b.em)[0];
  if (!seguinte) return avisar('Não há clipe depois deste na faixa.', 'info');
  const sobreposto = c.em + c.duracao_ms - seguinte.em;
  const r = crossfadeEntre(d, {de: c.id, para: seguinte.id, duracao_ms: duracao_ms ?? (sobreposto >= 100 ? sobreposto : 1000)}, duracoesMedidas(documento));
  if (recusou(r)) return avisar(r.erro, 'info');
  if (await aplicar(documento, r.patch, `crossfade de ${segTxt(r.duracao_ms)} s: ${nomeDoClipe(c)} → ${nomeDoClipe(seguinte)}`)) {
    avisar(`Crossfade de ${segTxt(r.duracao_ms)} s (${r.curva === 'potencia' ? 'potência igual' : r.curva}).${r.mudancas.length ? ` ${r.mudancas.join('; ')}.` : ''} Ctrl+Z desfaz.`, 'ok');
  }
};
