// Limpeza de voz no processo principal: decodifica o arquivo do clipe com o ffmpeg do Remotion, limpa com
// src/nucleo/limpeza-voz.ts e grava midia/<arquivo>.limpo.wav, com o envelope dele ao lado (a linha do tempo e o ducking
// já veem o arquivo limpo, sem medir de novo). O arquivo da pessoa nunca é tocado; limpar de novo parte sempre do
// original e regrava o .limpo.wav. Uma limpeza por vez, com andamento na interface e Cancelar. Registrado no main.ts com
// uma linha (registrarIpcLimpeza).
import {mkdirSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {CANAL, type ResultadoLimpezaVoz} from '../compartilhado/api';
import type {IntensidadeLimpeza} from '../nucleo/audio';
import {INTENSIDADES, LimpezaCancelada, limparVoz, type ControleLimpeza} from '../nucleo/limpeza-voz';
import {ErroProjeto, type Projeto} from '../nucleo/projeto';
import {decodificarAudio, gravarWav} from './ffmpeg-som';
import {arquivoDoEnvelope} from './ipc-audio';

/** midia/narracao.wav → midia/narracao.wav.limpo.wav (média, o padrão); leve e forte levam o nome no fim, para cada
 *  intensidade ser um arquivo seu e a prévia nunca tocar a versão de antes com o mesmo endereço. */
export const arquivoLimpo = (arquivo: string, intensidade: IntensidadeLimpeza = 'media') => `${arquivo}.limpo${intensidade === 'media' ? '' : `-${intensidade}`}.wav`;

/** Limpa `arquivo` (caminho no projeto) e grava o .limpo.wav e o envelope dele; devolve o caminho no projeto. */
export const limparArquivo = async (p: Projeto, arquivo: string, intensidade: IntensidadeLimpeza, ctrl: ControleLimpeza & {binarios?: string | null} = {}) => {
  if (typeof arquivo !== 'string' || !p.existe(arquivo)) throw new ErroProjeto(`o arquivo de áudio não está no projeto: ${String(arquivo)}`, 'nao_achado');
  if (!(intensidade in INTENSIDADES)) throw new ErroProjeto(`intensidade de limpeza desconhecida: ${String(intensidade)} (vale leve, media ou forte)`);
  const fonte = await decodificarAudio(p.caminho(arquivo), {binarios: ctrl.binarios, cancelado: ctrl.cancelado});
  if (!fonte.canais[0]?.length) throw new ErroProjeto(`${arquivo} não tem som para limpar`);
  const r = await limparVoz(fonte.canais, fonte.taxa, intensidade, ctrl);
  const destino = arquivoLimpo(arquivo, intensidade);
  const abs = p.caminho(destino);
  mkdirSync(path.dirname(abs), {recursive: true});
  const tmp = `${abs}.${process.pid}.tmp`; // o observador da pasta ignora .tmp: a interface só vê o arquivo inteiro
  writeFileSync(tmp, gravarWav(r.canais, fonte.taxa));
  renameSync(tmp, abs);
  p.gravarTexto(arquivoDoEnvelope(destino), `${JSON.stringify(r.envelope)}\n`);
  return {arquivo: destino, medidas: r.medidas, duracao_ms: r.envelope.duracao_ms};
};

type Lidar = <A extends unknown[], R>(canal: string, f: (...a: A) => R | Promise<R>) => void;

export const registrarIpcLimpeza = (lidar: Lidar, projeto: () => Projeto, enviar: (canal: string, ...a: unknown[]) => void) => {
  let cancelar: (() => void) | null = null;
  lidar(CANAL.audioLimparVoz, async (arquivo: string, intensidade: IntensidadeLimpeza): Promise<ResultadoLimpezaVoz> => {
    if (cancelar) throw new ErroProjeto('já há uma limpeza de voz em andamento');
    let parar = false;
    cancelar = () => (parar = true);
    let ultimo = -1;
    try {
      return await limparArquivo(projeto(), arquivo, intensidade, {
        cancelado: () => parar,
        // devolve a vez ao laço de eventos entre pedaços: a janela e o resto do IPC seguem respondendo
        pausar: () => new Promise((ok) => setImmediate(ok)),
        aoProgresso: (f) => {
          const pct = Math.round(f * 100);
          if (pct !== ultimo) enviar(CANAL.audioLimpezaProgresso, {arquivo, progresso: (ultimo = pct)});
        },
      });
    } catch (e) {
      if (parar || e instanceof LimpezaCancelada) return {cancelado: true};
      throw e;
    } finally {
      cancelar = null;
    }
  });
  lidar(CANAL.audioLimpezaCancelar, () => {
    cancelar?.();
    return Boolean(cancelar);
  });
};
