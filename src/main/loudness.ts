// Loudness no processo principal: o arquivo exportado sai no alvo do documento (audio.alvo_lufs, padrão −14 LUFS, pico
// até audio.pico_dbtp, padrão −1 dBTP) e o medidor da tela recebe a mistura medida como o render vai soar.
// Exportação: depois do renderMedia, o loudnorm do ffmpeg do Remotion mede o arquivo (1ª passada), corrige com as medidas
// (2ª passada, linear quando o pico deixa; senão o limitador dele segura o pico) e o arquivo corrigido é medido de novo;
// se ainda estiver fora (mais de 0,5 LU do alvo ou pico acima), refaz a partir do original compensando o erro, até três
// vezes. O vídeo é copiado sem recodificar; só o áudio é regravado (AAC 320 kb/s no MP4, Opus no WebM, como o Remotion).
// A mistura de música e voz não muda: o ganho é o mesmo para tudo, então o ducking e os LU entre faixas ficam iguais.
// Medidor: decodifica cada arquivo dos clipes a 48 kHz em estéreo (como o render) e passa a src/nucleo/loudness.ts.
import {renameSync, rmSync, statSync} from 'node:fs';
import path from 'node:path';
import type {CancelSignal} from '@remotion/renderer';
import {CANAL, type Progresso, type PropsVideo} from '../compartilhado/api';
import {ALVO_LUFS_PADRAO, PICO_DBTP_PADRAO, type AudioP} from '../nucleo/audio';
import {medirMistura, type FonteAudio, type MedidasLoudness} from '../nucleo/loudness';
import type {Projeto} from '../nucleo/projeto';
import {decodificarAudio, rodarFfmpeg, type Parar} from './ffmpeg-som';

const TAXA = 48000; // a do render do Remotion
const TOLERANCIA_LU = 0.5;
const TENTATIVAS = 3;

/** O que o loudnorm mede (print_format=json): integrado, pico verdadeiro, faixa de loudness, porta e o desvio. */
export type MedidaLoudnorm = {i: number; tp: number; lra: number; thresh: number; offset: number; tipo?: string};

/** Lê o último JSON do loudnorm na saída de erro do ffmpeg; null se não houver (ou se o arquivo for só silêncio). */
export const lerLoudnorm = (texto: string): MedidaLoudnorm | null => {
  const blocos = texto.match(/\{[^{}]*"input_i"[^{}]*\}/g);
  if (!blocos?.length) return null;
  const j = JSON.parse(blocos[blocos.length - 1]) as Record<string, string>;
  const n = (k: string) => Number(j[k]);
  const m = {i: n('input_i'), tp: n('input_tp'), lra: n('input_lra'), thresh: n('input_thresh'), offset: n('target_offset'), tipo: j.normalization_type};
  return Number.isFinite(m.i) && Number.isFinite(m.tp) ? m : null;
};

const lra = (m: MedidaLoudnorm) => Math.min(50, Math.max(7, Math.ceil((Number.isFinite(m.lra) ? m.lra : 7) + 1))); // nunca comprime a dinâmica

/** Mede o som de um arquivo com o loudnorm (só leitura). */
export const medirArquivo = async (arquivo: string, o: Parar & {binarios?: string | null} = {}) => {
  const {erro} = await rodarFfmpeg(['-i', arquivo, '-vn', '-map', '0:a:0', '-af', `loudnorm=I=${ALVO_LUFS_PADRAO}:TP=${PICO_DBTP_PADRAO}:LRA=11:print_format=json`, '-f', 'null', '-'], o);
  return lerLoudnorm(erro);
};

const formatoDe = (arquivo: string) => {
  const ext = path.extname(arquivo).toLowerCase();
  if (ext === '.webm') return {f: 'webm', audio: ['-c:a', 'libopus', '-b:a', '256k']};
  if (ext === '.mov') return {f: 'mov', audio: ['-c:a', 'libfdk_aac', '-b:a', '320k']};
  return {f: 'mp4', audio: ['-c:a', 'libfdk_aac', '-b:a', '320k', '-movflags', '+faststart']};
};

/** `modo` é o que o loudnorm usou na correção: "linear" (só ganho) ou "dynamic" (o pico pedia limitador). */
export type ResultadoLoudness = {antes: MedidaLoudnorm; depois: MedidaLoudnorm; alvo_lufs: number; pico_dbtp: number; ajustado: boolean; tentativas: number; no_alvo: boolean;
  modo?: string};

const noAlvo = (m: MedidaLoudnorm, alvo: number, pico: number) => Math.abs(m.i - alvo) <= TOLERANCIA_LU && m.tp <= pico;

/** Corrige o loudness de um arquivo já exportado até o alvo, no lugar. Devolve null quando o vídeo não tem som. */
export const corrigirArquivo = async (arquivo: string, o: Parar & {binarios?: string | null; alvo_lufs?: number; pico_dbtp?: number; aviso?: (p: Progresso) => void}): Promise<ResultadoLoudness | null> => {
  const alvo = o.alvo_lufs ?? ALVO_LUFS_PADRAO;
  const pico = o.pico_dbtp ?? PICO_DBTP_PADRAO;
  const antes = await medirArquivo(arquivo, o).catch(() => null);
  if (!antes) return null;
  if (noAlvo(antes, alvo, pico)) return {antes, depois: antes, alvo_lufs: alvo, pico_dbtp: pico, ajustado: false, tentativas: 0, no_alvo: true};
  const {f, audio} = formatoDe(arquivo);
  const tmp = `${arquivo}.${process.pid}.tmp`;
  let melhor: {m: MedidaLoudnorm; arquivo: string; modo?: string} | null = null;
  let iAlvo = alvo;
  let tpAlvo = pico - 0.5; // folga para o codificador, que sobe um pouco o pico verdadeiro
  let tentativas = 0;
  try {
    for (; tentativas < TENTATIVAS; ) {
      tentativas++;
      o.aviso?.({tipo: 'status', mensagem: `Igualando o loudness a ${alvo} LUFS (de ${antes.i.toFixed(1)})…`});
      const filtro = `loudnorm=I=${iAlvo.toFixed(2)}:TP=${tpAlvo.toFixed(2)}:LRA=${lra(antes)}:measured_I=${antes.i}:measured_TP=${antes.tp}`
        + `:measured_LRA=${antes.lra}:measured_thresh=${antes.thresh}:offset=${antes.offset}:linear=true:print_format=json,aresample=${TAXA}`;
      const saida = `${tmp}.${tentativas}`;
      // -shortest: no modo dinâmico o loudnorm completa o último pedaço de 100 ms, e o som passaria do fim do vídeo
      const passada = await rodarFfmpeg(['-y', '-i', arquivo, '-map', '0:v?', '-map', '0:a:0', '-c:v', 'copy', '-af', filtro, '-ar', String(TAXA), ...audio, '-shortest',
        '-f', f, saida], o);
      const m = await medirArquivo(saida, o);
      if (!m) throw new Error('o arquivo corrigido saiu sem som');
      const erro = (x: MedidaLoudnorm) => Math.abs(x.i - alvo) + Math.max(0, x.tp - pico) * 2;
      if (!melhor || erro(m) < erro(melhor.m)) {
        if (melhor) rmSync(melhor.arquivo, {force: true});
        melhor = {m, arquivo: saida, modo: lerLoudnorm(passada.erro)?.tipo};
      } else rmSync(saida, {force: true});
      if (noAlvo(m, alvo, pico)) break;
      // compensa o que faltou e tenta de novo a partir do original
      iAlvo += alvo - m.i;
      if (m.tp > pico) tpAlvo -= m.tp - pico + 0.3;
    }
    renameSync(melhor!.arquivo, arquivo);
    const depois = melhor!.m;
    o.aviso?.({tipo: 'status', mensagem: `Loudness: ${depois.i.toFixed(1)} LUFS, pico ${depois.tp.toFixed(1)} dBTP (alvo ${alvo} LUFS, pico até ${pico})`});
    return {antes, depois, alvo_lufs: alvo, pico_dbtp: pico, ajustado: true, tentativas, no_alvo: noAlvo(depois, alvo, pico), modo: melhor!.modo};
  } finally {
    for (let k = 1; k <= TENTATIVAS; k++) rmSync(`${tmp}.${k}`, {force: true});
  }
};

/** A chamada do exportar.ts depois do render: só o vídeo de cenas com som tem alvo (o carrossel da Cliente fica como sai). */
export const igualarLoudness = async (o: {arquivo: string; props: Record<string, unknown>; binarios?: string | null; cancelSignal?: CancelSignal; aviso?: (p: Progresso) => void}) => {
  const audio = o.props.audio as AudioP | undefined;
  if (o.props.composicao !== 'VideoCenas' || !audio?.faixas?.some((f) => !f.mudo && f.clipes.some((c) => !c.mudo && !c.fora))) return null;
  return corrigirArquivo(o.arquivo, {binarios: o.binarios, cancelSignal: o.cancelSignal, aviso: o.aviso, alvo_lufs: audio.alvo_lufs, pico_dbtp: audio.pico_dbtp});
};

// ---------- medidor da tela ----------
const LIMITE_CACHE = 16_000_000; // amostras decodificadas guardadas entre medições (~64 MB): cabe na máquina de 8 GB

type Lidar = <A extends unknown[], R>(canal: string, f: (...a: A) => R | Promise<R>) => void;

export const registrarIpcLoudness = (lidar: Lidar, projeto: () => Projeto, propsDe: (documento: string) => PropsVideo) => {
  const fontes = new Map<string, FonteAudio>(); // por arquivo + data + tamanho, o mais recente no fim
  let ultima: {chave: string; r: MedidasLoudness} | null = null;
  let geracao = 0;
  const fonte = async (p: Projeto, arquivo: string, cancelado: () => boolean) => {
    const abs = p.caminho(arquivo);
    const st = statSync(abs);
    const chave = `${abs}|${st.mtimeMs}|${st.size}`;
    let f = fontes.get(chave);
    if (f) fontes.delete(chave);
    else f = await decodificarAudio(abs, {taxa: TAXA, canais: 2, cancelado});
    fontes.set(chave, f);
    let total = [...fontes.values()].reduce((s, x) => s + x.canais.length * (x.canais[0]?.length ?? 0), 0);
    for (const [k, x] of fontes) {
      if (total <= LIMITE_CACHE || k === chave) break;
      total -= x.canais.length * (x.canais[0]?.length ?? 0);
      fontes.delete(k);
    }
    return {f, chave};
  };
  lidar(CANAL.audioMedirLoudness, async (documento: string): Promise<MedidasLoudness | {erro: string}> => {
    const p = projeto();
    const montado = propsDe(documento);
    if ('erro' in montado) return {erro: montado.erro};
    const audio = montado.props.audio as AudioP | undefined;
    if (!audio?.faixas?.length) return {erro: 'este vídeo não tem som'};
    const minha = ++geracao;
    const cancelado = () => minha !== geracao; // um pedido novo (o vídeo mudou) passa na frente
    const usados: Record<string, FonteAudio | undefined> = {};
    const carimbos: string[] = [];
    for (const f of audio.faixas) {
      for (const c of f.clipes) {
        if (c.arquivo in usados || c.mudo || c.fora) continue;
        try {
          const {f: x, chave} = await fonte(p, c.arquivo, cancelado);
          usados[c.arquivo] = x;
          carimbos.push(chave);
        } catch {
          if (cancelado()) return {erro: 'medição substituída por uma mais nova'};
          usados[c.arquivo] = undefined; // arquivo que não abre: fica de fora e volta em `faltando`
        }
      }
    }
    const chave = JSON.stringify([audio, montado.props.duracao_ms, montado.props.fps, carimbos], (k, v) => (k === 'envelope' ? undefined : v));
    if (ultima?.chave === chave) return ultima.r;
    try {
      const r = await medirMistura(audio, usados, {duracao_ms: Number(montado.props.duracao_ms) || 0, fps: Number(montado.props.fps) || 30, taxa: TAXA,
        cancelado, pausar: () => new Promise((ok) => setImmediate(ok))});
      ultima = {chave, r};
      return r;
    } catch (e) {
      if (cancelado()) return {erro: 'medição substituída por uma mais nova'};
      throw e;
    }
  });
};
