// Exportação do vídeo com o Remotion, no processo principal (guia de Electron da Remotion). O pacote da composição é
// feito uma vez por sessão no desenvolvimento e vem pronto no app empacotado. A concorrência fica em metade dos núcleos
// para a interface seguir responsiva em máquina modesta.
import os from 'node:os';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {rm} from 'node:fs/promises';
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

export const exportarVideo = async (o: {
  raizApp: string;
  empacotado: boolean;
  props: Record<string, unknown>;
  arquivo: string;
  aviso: (p: Progresso) => void;
}) => {
  const {ensureBrowser, renderMedia, selectComposition} = await import('@remotion/renderer');
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
  const composition = await selectComposition({serveUrl, id: 'CarrosselTema', inputProps: o.props, binariesDirectory, browserExecutable});
  o.aviso({tipo: 'status', mensagem: `Renderizando ${composition.durationInFrames} quadros…`});
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: o.arquivo,
    inputProps: o.props,
    binariesDirectory,
    browserExecutable,
    concurrency: Math.max(1, Math.floor(os.cpus().length / 2)),
    onProgress: ({progress}) => o.aviso({tipo: 'progresso', etapa: 'renderizando', progresso: progress * 100}),
  });
  return o.arquivo;
};
