// Exportação do vídeo com o Remotion, no processo principal (guia de Electron da Remotion). O pacote da composição é
// feito uma vez por sessão no desenvolvimento e vem pronto no app empacotado. A concorrência fica em metade dos núcleos
// para a interface seguir responsiva em máquina modesta. `prepararRender` (navegador e pacote) roda uma vez por
// exportação e `renderizarVideo` uma vez por arquivo: o diálogo pede vários destinos de uma tacada, com codec, bitrate,
// escala, trecho e o sinal de cancelar do Remotion (makeCancelSignal).
import os from 'node:os';
import path from 'node:path';
import {existsSync, statSync} from 'node:fs';
import {rm, statfs} from 'node:fs/promises';
import type {CancelSignal} from '@remotion/renderer';
import type {Progresso} from '../compartilhado/api';
import {espacoNecessario, formatarBytes} from '../nucleo/exportacao';
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
  avisos?: string[]; // recebe o que saiu diferente do pedido sem impedir o arquivo (o loudness fora do alvo ou não corrigido)
};

/** Falta espaço para a exportação? Devolve a mensagem para a pessoa, ou null. Sem como medir (statfs falhou), segue. */
export const faltaEspaco = async (pasta: string, bytes: number[], comAudio: boolean, tmp = os.tmpdir()) => {
  try {
    const mesmoDisco = statSync(pasta).dev === statSync(tmp).dev;
    const precisa = espacoNecessario(bytes, comAudio, mesmoDisco);
    for (const [dir, n] of [[pasta, precisa.saidas], [tmp, precisa.temporarios]] as const) {
      if (n <= 0) continue;
      const {bavail, bsize} = await statfs(dir);
      const livre = bavail * bsize;
      if (livre < n) return `pouco espaço em disco em ${dir}: há ${formatarBytes(livre)} livres e a exportação precisa de cerca de ${formatarBytes(n)}`;
    }
  } catch {
    /* statfs indisponível (unidade de rede, por exemplo): não bloqueia */
  }
  return null;
};
/** O erro é de disco cheio? (Node: ENOSPC; ffmpeg: "No space left on device", saída 228 no Linux e no Mac) */
export const discoCheio = (mensagem: string) => /ENOSPC|No space left|\((228|-28|4294967268)\)/i.test(mensagem);

/** Um arquivo: escolhe a composição pelas props, mede e renderiza. O andamento sai em `aviso` (etapa "renderizando"). */
export const renderizarVideo = async (p: Preparado, r: RenderVideo, aviso: (x: Progresso) => void) => {
  const {renderMedia, selectComposition} = await import('@remotion/renderer');
  const id = r.props.composicao === 'VideoCenas' ? 'VideoCenas' : r.props.composicao === 'Animacao' ? 'Animacao' : 'CarrosselTema';
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
  // frente Som. O render já está pronto: se a correção do loudness falhar, o vídeo fica como saiu do render e a pessoa é avisada
  try {
    const l = await (await import('./loudness')).igualarLoudness({arquivo: r.arquivo, props: r.props, binarios: p.binariesDirectory, cancelSignal: r.cancelSignal,
      duracao_s: quadros / composition.fps, aviso});
    if (l && !l.no_alvo) r.avisos?.push(`${path.basename(r.arquivo)}: o som ficou em ${l.depois.i.toFixed(1)} LUFS e pico ${l.depois.tp.toFixed(1)} dBTP (alvo ${l.alvo_lufs} LUFS, pico até ${l.pico_dbtp})`);
  } catch (e) {
    if ((e as Error).message === 'cancelado') throw e;
    r.avisos?.push(`${path.basename(r.arquivo)}: saiu sem a correção de loudness (${discoCheio((e as Error).message) ? 'o disco encheu' : (e as Error).message})`);
  }
  return r.arquivo;
};

/** Um vídeo só, do começo ao fim (preparar e renderizar): o padrão de antes, H.264 no formato do documento. */
export const exportarVideo = async (o: {raizApp: string; empacotado: boolean; props: Record<string, unknown>; arquivo: string; aviso: (p: Progresso) => void;
  render?: Omit<RenderVideo, 'props' | 'arquivo'>}) => renderizarVideo(await prepararRender(o), {props: o.props, arquivo: o.arquivo, ...o.render}, o.aviso);
