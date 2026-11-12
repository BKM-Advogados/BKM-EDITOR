// O serviço das medidas do som (src/nucleo/medidas-som.ts) com o ffmpeg do Remotion: envelope, loudness da mistura e
// limpeza de voz, as mesmas funções que a tela usa pelo IPC (ipc-audio.ts, loudness.ts, limpeza-voz.ts). Sem Electron:
// o app liga no main.ts e o MCP por stdio (mcp/nucleo.ts, mcp/desktop.ts) liga com a pasta do ffmpeg achada pela raiz
// do app (node_modules no repositório, app.asar.unpacked no instalado), para rodar também com o app fechado.
import path from 'node:path';
import type {ServicoMedidas} from '../nucleo/medidas-som';
import {medirEnvelopeDoArquivo} from './ipc-audio';
import {limparArquivo} from './limpeza-voz';
import {criarMedidorDeLoudness} from './loudness';
import {propsDoVideo} from './sessao-projeto';
import {caminhoFfmpeg} from './transcricao';

// o MCP guarda menos áudio decodificado que a tela (que mede a cada mudança): ~16 MB
const LIMITE_CACHE_MCP = 4_000_000;

/** A pasta do ffmpeg para quem roda fora do app (MCP por stdio): a do repositório ou a do app instalado; undefined deixa
 *  o ffmpeg-som procurar sozinho (no app, ele acha pelo resourcesPath). */
export const pastaDoFfmpegDoApp = (raizApp: string): string | undefined => {
  const exe = caminhoFfmpeg({raizApp});
  return exe ? path.dirname(exe) : undefined;
};

export const servicoDeMedidas = (o: {binarios?: () => string | null | undefined} = {}): ServicoMedidas => {
  const loudness = criarMedidorDeLoudness({limite: LIMITE_CACHE_MCP, binarios: o.binarios});
  return {
    envelope: (p, arquivo) => medirEnvelopeDoArquivo(p, arquivo, {binarios: o.binarios?.()}),
    // o som só precisa dos caminhos dos clipes no projeto, não do servidor de mídia: base vazia
    loudness: (p, documento) => loudness(p, propsDoVideo(p, documento, '')),
    limparVoz: (p, arquivo, intensidade, aoProgresso) => limparArquivo(p, arquivo, intensidade, {
      binarios: o.binarios?.(),
      pausar: () => new Promise((ok) => setImmediate(ok)), // a janela e o resto do processo seguem respondendo
      aoProgresso,
    }),
  };
};
