// Contraste da marca d'água medido num quadro de verdade (rodada 3, frente C). Para cada quadro escolhido, renderiza o destino
// duas vezes com a mesma composição do MP4 (renderStill): sem a marca e com ela. Na caixa da marca, a média do primeiro é o
// fundo e os pixels em que o segundo difere são a marca, já com a opacidade e a sombra que ela leva. Com placa, o "sem" é a
// placa vazia, e a medida é da marca contra a placa. As contas ficam em src/nucleo/contraste.ts; sem Electron aqui, o script
// scripts/medir-contraste-teste.mjs e o IPC usam a mesma função.
import {mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CANAL} from '../compartilhado/api';
import type {Progresso, PropsVideo} from '../compartilhado/api';
import {avaliarContraste, medirNaCaixa, quadrosParaMedir, razaoDeContraste, type AvaliacaoContraste, type MedidaContraste} from '../nucleo/contraste';
import {fontesDaMarcaDagua, legendasDasProps, marcaDaguaDoDestino, type ConfigMarcaDagua, type Destino, type MarcaDaguaP, type OpcoesExportarVideo} from '../nucleo/exportacao';
import type {Projeto} from '../nucleo/projeto';
import {rodarFfmpeg} from './ffmpeg-som';
import type {Preparado} from './exportar';

export type PedidoContraste = {
  props: Record<string, unknown>; // as props do destino (com largura e altura dele), sem a marca
  marca: MarcaDaguaP;
  quadros_ms: number[];
  fps: number;
  escala?: number; // do quadro medido; 0,4 basta para a caixa da marca (padrão)
};

/** Os pixels (rgb24) da caixa da marca num PNG, pelo ffmpeg do compositor. */
const pixelsDaCaixa = async (png: string, caixa: {x: number; y: number; w: number; h: number}, binarios?: string | null) => {
  const {saida} = await rodarFfmpeg(['-i', png, '-vf', `crop=${caixa.w}:${caixa.h}:${caixa.x}:${caixa.y}`, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {binarios});
  return new Uint8Array(saida.buffer, saida.byteOffset, saida.byteLength);
};

export const medirContrasteDaMarca = async (p: Preparado, pedido: PedidoContraste): Promise<AvaliacaoContraste> => {
  const {openBrowser, renderStill, selectComposition} = await import('@remotion/renderer');
  const id = pedido.props.composicao === 'VideoCenas' ? 'VideoCenas' : 'CarrosselTema';
  const escala = pedido.escala ?? 0.4;
  const escolher = (props: Record<string, unknown>) =>
    selectComposition({serveUrl: p.serveUrl, id, inputProps: props, binariesDirectory: p.binariesDirectory, browserExecutable: p.browserExecutable});
  const m = pedido.marca;
  // com placa, o "sem" é a placa sem nada dentro (um espaço no lugar do logo ou do texto)
  const semConteudo: MarcaDaguaP = m.placa ? {...m, logo: undefined, texto: ' '} : {...m, opacidade: 0};
  // a composição leva as props que a escolheram (o renderStill usa as resolvidas, não só as do inputProps): uma escolha por variante
  const variantes = [{props: {...pedido.props, marca_dagua: semConteudo}, nome: 'sem'}, {props: {...pedido.props, marca_dagua: m}, nome: 'com'}];
  const compostos = await Promise.all(variantes.map((v) => escolher(v.props)));
  const w = Math.round(compostos[0].width * escala);
  const h = Math.round(compostos[0].height * escala);
  const caixa = {x: Math.max(0, Math.floor(m.x * w)), y: Math.max(0, Math.floor(m.y * h)), w: 0, h: 0};
  caixa.w = Math.max(2, Math.min(w - caixa.x, Math.ceil(m.largura * w)));
  caixa.h = Math.max(2, Math.min(h - caixa.y, Math.ceil(m.altura * h)));
  const pasta = mkdtempSync(path.join(os.tmpdir(), 'estudio-contraste-'));
  // um navegador só para todos os quadros (abrir um por quadro leva segundos a mais cada vez)
  const navegador = await openBrowser('chrome', {browserExecutable: p.browserExecutable});
  try {
    const medidas: MedidaContraste[] = [];
    for (const [i, ms] of pedido.quadros_ms.entries()) {
      const frame = Math.max(0, Math.min(compostos[0].durationInFrames - 1, Math.round((ms / 1000) * pedido.fps)));
      const [sem, com] = [path.join(pasta, `sem-${i}.png`), path.join(pasta, `com-${i}.png`)];
      for (const [k, arquivo] of [sem, com].entries()) {
        await renderStill({composition: compostos[k], serveUrl: p.serveUrl, output: arquivo, frame, inputProps: variantes[k].props, imageFormat: 'png', scale: escala,
          binariesDirectory: p.binariesDirectory, browserExecutable: p.browserExecutable, puppeteerInstance: navegador});
      }
      const [pSem, pCom] = [await pixelsDaCaixa(sem, caixa, p.binariesDirectory), await pixelsDaCaixa(com, caixa, p.binariesDirectory)];
      const {fundo, marca} = medirNaCaixa(pSem, pCom);
      medidas.push({quadro_ms: ms, fundo, marca, contraste: marca ? razaoDeContraste(fundo, marca) : null});
    }
    return avaliarContraste(medidas);
  } finally {
    await navegador.close({silent: true}).catch(() => undefined);
    rmSync(pasta, {recursive: true, force: true});
  }
};

// ---------- IPC: o diálogo de exportar pede a medida de um destino ----------
export type PedidoContrasteDestino = {
  destino: Destino;
  config: ConfigMarcaDagua;
  proporcao_logo?: number;
  proporcao_texto?: number;
  trecho?: OpcoesExportarVideo['trecho'];
};
export type ResultadoContraste = {ok: true; avaliacao: AvaliacaoContraste} | {ok: false; mensagem: string};

type Lidar = <A extends unknown[], R>(canal: string, f: (...a: A) => R | Promise<R>) => void;

/** Uma linha no main.ts: o canal `medirContrasteMarca`. `preparar` devolve o navegador e as composições (o mesmo da exportação). */
export const registrarContrasteMarca = (lidar: Lidar, projeto: () => Projeto, propsDe: (documento: string) => PropsVideo, preparar: (aviso: (p: Progresso) => void) => Promise<Preparado>) => {
  lidar(CANAL.medirContrasteMarca, async (documento: string, pedido: PedidoContrasteDestino): Promise<ResultadoContraste> => {
    projeto();
    const montado = propsDe(documento);
    if ('erro' in montado) return {ok: false, mensagem: montado.erro};
    const props = montado.props as Record<string, unknown>;
    const fixo = props.composicao !== 'VideoCenas';
    const formato = {largura: Number(props.largura) || 1080, altura: Number(props.altura) || 1920, fps: Number(props.fps) || 30};
    const destino = fixo ? {...pedido.destino, largura: formato.largura, altura: formato.altura} : pedido.destino;
    const duracao = Number(props.duracao_ms) || 0;
    const propsDestino = fixo ? props : {...props, largura: destino.largura, altura: destino.altura};
    const marca = marcaDaguaDoDestino({...pedido.config, ligada: true}, destino, fontesDaMarcaDagua(props), pedido.proporcao_logo, legendasDasProps(propsDestino), pedido.proporcao_texto);
    if (!marca) return {ok: false, mensagem: 'Sem logo nem assinatura no kit: não há marca para medir.'};
    try {
      const preparado = await preparar(() => undefined);
      const avaliacao = await medirContrasteDaMarca(preparado, {props: propsDestino, marca, quadros_ms: quadrosParaMedir(duracao, pedido.trecho), fps: formato.fps});
      return {ok: true, avaliacao};
    } catch (e) {
      return {ok: false, mensagem: (e as Error).message};
    }
  });
};

