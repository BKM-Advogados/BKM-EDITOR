// Exportação do vídeo com o Remotion, no processo principal (guia de Electron da Remotion). O pacote da composição é
// feito uma vez por sessão no desenvolvimento e vem pronto no app empacotado. A concorrência fica em metade dos núcleos
// para a interface seguir responsiva em máquina modesta. `prepararRender` (navegador e pacote) roda uma vez por
// exportação e `renderizarVideo` uma vez por arquivo: o diálogo pede vários destinos de uma tacada, com codec, bitrate,
// escala, trecho e o sinal de cancelar do Remotion (makeCancelSignal).
import os from 'node:os';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import type {CancelSignal} from '@remotion/renderer';
import type {Progresso} from '../compartilhado/api';
import {getCompositorPackage} from './compositor-package';
import {getPackagedBrowserPaths} from './packaged-browser';

export const PASTA_PACOTE = 'remotion-bundle';
let pacoteDev: Promise<string> | null = null;

export const empacotarComposicoes = async (raizApp: string, saida?: string, aviso?: (p: Progresso) => void) => {
  const {bundle} = await import('@remotion/bundler');
  if (saida) await rm(saida, {recursive: true, force: true});
  return bundle({
    entryPoint: path.join(raizApp, 'src', 'composicoes', 'index.ts'),
    outDir: saida,
    onProgress: (p: number) => aviso?.({tipo: 'progresso', etapa: 'empacotando', progresso: p}),
  });
};

const servirDe = async (raizApp: string, empacotado: boolean, aviso: (p: Progresso) => void) => {
  if (empacotado) {
    const pronto = path.join(raizApp, PASTA_PACOTE);
    if (!existsSync(pronto)) throw new Error('o app empacotado está sem o pacote das composições; refaça o pacote');
    return pronto;
  }
  pacoteDev ??= empacotarComposicoes(raizApp, undefined, aviso);
  return pacoteDev;
};

export type Preparado = {serveUrl: string; browserExecutable: string | null; binariesDirectory: string | null};

/** Navegador de render pronto e composições empacotadas: a parte que não depende do arquivo que vai sair. */
export const prepararRender = async (o: {raizApp: string; empacotado: boolean; aviso: (p: Progresso) => void}): Promise<Preparado> => {
  const {ensureBrowser} = await import('@remotion/renderer');
  o.aviso({tipo: 'status', mensagem: 'Preparando o navegador de render…'});
  // no app instalado o navegador vem empacotado (forge.config); sem ele, baixa na primeira exportação
  const empacotado = o.empacotado ? getPackagedBrowserPaths({arch: process.arch, platform: process.platform, projectRoot: o.raizApp})?.packagedBrowserExecutablePath : undefined;
  const browserExecutable = empacotado && existsSync(empacotado) ? empacotado : null;
  await ensureBrowser({browserExecutable, onBrowserDownload: () => ({version: null, onProgress: ({percent}) => o.aviso({tipo: 'progresso', etapa: 'baixando navegador', progresso: percent * 100})})});
  o.aviso({tipo: 'status', mensagem: 'Empacotando as composições…'});
  const serveUrl = await servirDe(o.raizApp, o.empacotado, o.aviso);
  const binariesDirectory = o.empacotado
    ? path.join(path.dirname(o.raizApp), 'app.asar.unpacked', 'node_modules', getCompositorPackage({arch: process.arch, platform: process.platform}))
    : null;
  return {serveUrl, browserExecutable, binariesDirectory};
};

export type RenderVideo = {
  props: Record<string, unknown>;
  arquivo: string;
  codec?: 'h264' | 'h265' | 'vp9';
  videoBitrate?: `${number}k`; // sem ele, o CRF padrão do Remotion
  escala?: number; // `scale` do renderMedia: para a composição de tamanho fixo (o vídeo de cenas recebe largura e altura nas props)
  quadros?: [number, number] | null; // trecho em quadros, inclusivo nas duas pontas
  cancelSignal?: CancelSignal;
};

/** Um arquivo: escolhe a composição pelas props, mede e renderiza. O andamento sai em `aviso` (etapa "renderizando"). */
export const renderizarVideo = async (p: Preparado, r: RenderVideo, aviso: (x: Progresso) => void) => {
  const {renderMedia, selectComposition} = await import('@remotion/renderer');
  const id = r.props.composicao === 'VideoCenas' ? 'VideoCenas' : 'CarrosselTema';
  const composition = await selectComposition({serveUrl: p.serveUrl, id, inputProps: r.props, binariesDirectory: p.binariesDirectory, browserExecutable: p.browserExecutable});
  const quadros = r.quadros ? r.quadros[1] - r.quadros[0] + 1 : composition.durationInFrames;
  aviso({tipo: 'status', mensagem: `Renderizando ${quadros} quadros…`});
  await renderMedia({
    composition,
    serveUrl: p.serveUrl,
    codec: r.codec ?? 'h264',
    videoBitrate: r.videoBitrate ?? null,
    scale: r.escala ?? 1,
    frameRange: r.quadros ?? null,
    outputLocation: r.arquivo,
    inputProps: r.props,
    binariesDirectory: p.binariesDirectory,
    browserExecutable: p.browserExecutable,
    cancelSignal: r.cancelSignal,
    concurrency: Math.max(1, Math.floor(os.cpus().length / 2)),
    onProgress: ({progress}) => aviso({tipo: 'progresso', etapa: 'renderizando', progresso: progress * 100}),
  });
  await (await import('./loudness')).igualarLoudness({arquivo: r.arquivo, props: r.props, binarios: p.binariesDirectory, cancelSignal: r.cancelSignal, aviso}); // frente Som
  return r.arquivo;
};

/** Um vídeo só, do começo ao fim (preparar e renderizar): o padrão de antes, H.264 no formato do documento. */
export const exportarVideo = async (o: {raizApp: string; empacotado: boolean; props: Record<string, unknown>; arquivo: string; aviso: (p: Progresso) => void;
  render?: Omit<RenderVideo, 'props' | 'arquivo'>}) => renderizarVideo(await prepararRender(o), {props: o.props, arquivo: o.arquivo, ...o.render}, o.aviso);
