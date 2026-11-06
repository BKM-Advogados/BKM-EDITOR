// Opções de exportação e as contas que a interface e o processo principal partilham: destinos (proporções), qualidade em
// bitrate, escala, trecho, o nome de cada arquivo e a estimativa de tamanho (bitrate × duração). Nada aqui toca disco nem
// o Remotion: `argumentosDoRender` só traduz as opções para o que o renderMedia recebe.
import {FORMATOS_VIDEO, proporcaoDe, type Formato} from './formatos';

export type CodecVideo = 'h264' | 'h265' | 'webm';
export type QualidadeVideo = 'alta' | 'media' | 'leve';
export type Destino = {id: string; largura: number; altura: number};
export type Trecho = {de_ms: number; ate_ms: number};

export type OpcoesExportarVideo = {
  destinos: Destino[]; // um ou mais; cada um vira um arquivo (vazio: o formato do documento)
  codec: CodecVideo;
  qualidade: QualidadeVideo;
  escala: number; // 1, 0,75 ou 0,5
  trecho?: Trecho | null; // sem trecho, o vídeo inteiro
  nome?: string; // base do nome do arquivo; sem ela, o título do documento
};

export type FormatoImagem = 'png' | 'jpg' | 'webp';
export type OpcoesExportarImagem = {formato?: FormatoImagem; nome?: string; sufixo?: string};

export const ESCALAS_VIDEO = [1, 0.75, 0.5];
export const ESCALAS_IMAGEM = [0.5, 1, 2];

export const CODECS: {id: CodecVideo; nome: string; ext: string; remotion: 'h264' | 'h265' | 'vp9'; nota: string}[] = [
  {id: 'h264', nome: 'MP4 · H.264', ext: 'mp4', remotion: 'h264', nota: 'toca em todo lugar; é o que as redes pedem'},
  {id: 'h265', nome: 'MP4 · H.265', ext: 'mp4', remotion: 'h265', nota: 'menor na mesma qualidade; player antigo pode não abrir'},
  {id: 'webm', nome: 'WebM · VP9', ext: 'webm', remotion: 'vp9', nota: 'para site e navegador'},
];

export const QUALIDADES: {id: QualidadeVideo; nome: string; nota: string}[] = [
  {id: 'alta', nome: 'Alta', nota: 'para publicar (a rede recomprime)'},
  {id: 'media', nome: 'Média', nota: 'WhatsApp e revisão'},
  {id: 'leve', nome: 'Leve', nota: 'arquivo pequeno, para mandar rápido'},
];

export const FORMATOS_IMAGEM_SAIDA: {id: FormatoImagem; nome: string; ext: string; mime: string; comQualidade: boolean; nota: string}[] = [
  {id: 'png', nome: 'PNG', ext: 'png', mime: 'image/png', comQualidade: false, nota: 'sem perda, com transparência'},
  {id: 'jpg', nome: 'JPG', ext: 'jpg', mime: 'image/jpeg', comQualidade: true, nota: 'menor; sem transparência'},
  {id: 'webp', nome: 'WebP', ext: 'webp', mime: 'image/webp', comQualidade: true, nota: 'menor ainda, para site'},
];

// bitrate de vídeo em kbps para 1080p a 30 qps (o YouTube recomenda 8 Mbps para 1080p30 em SDR e 12 para 1080p60; o
// Instagram pede no mínimo 3,5 Mbps); o áudio AAC do Remotion sai a 128 kbps
const KBPS_1080P: Record<QualidadeVideo, number> = {alta: 12000, media: 6000, leve: 2500};
const PIXELS_1080P = 1920 * 1080;
export const KBPS_AUDIO = 128;

/** Bitrate de vídeo (kbps) para o tamanho e os quadros por segundo de saída: proporcional aos pixels, metade a mais acima
 *  de 40 qps; H.265 e VP9 chegam à mesma qualidade com cerca de 35% menos. Nunca abaixo de 300 kbps. */
export const bitrateKbps = (q: QualidadeVideo, largura: number, altura: number, fps: number, codec: CodecVideo = 'h264') => {
  const base = KBPS_1080P[q] * ((largura * altura) / PIXELS_1080P) * (fps > 40 ? 1.5 : 1) * (codec === 'h264' ? 1 : 0.65);
  return Math.max(300, Math.round(base / 50) * 50);
};

/** Tamanho estimado em bytes: (vídeo + áudio) × duração. */
export const estimarBytes = (kbps: number, duracaoMs: number, comAudio: boolean) =>
  Math.round((((kbps + (comAudio ? KBPS_AUDIO : 0)) * 1000) / 8) * (duracaoMs / 1000));

/** "850 KB", "12,4 MB", "1,20 GB". */
export const formatarBytes = (b: number) => {
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1).replace('.', ',')} MB`;
  return `${(b / 1024 ** 3).toFixed(2).replace('.', ',')} GB`;
};

/** Lado de saída: aplica a escala e arredonda para par (o H.264 em yuv420p exige lados pares). */
export const ladoDeSaida = (px: number, escala: number) => Math.max(2, 2 * Math.round((px * escala) / 2));

/** Destino que corresponde ao formato do documento: o preset de mesmo tamanho ou um personalizado. */
export const destinoDoFormato = (f: {largura: number; altura: number}): Destino => {
  const p = FORMATOS_VIDEO.find((x) => x.largura === f.largura && x.altura === f.altura);
  return p ? {id: p.id, largura: p.largura, altura: p.altura} : {id: 'personalizado', largura: f.largura, altura: f.altura};
};

/** Sufixo do arquivo por destino: "-9x16" nos presets; no personalizado, a medida ("-1000x500"). */
export const sufixoDestino = (d: {largura: number; altura: number}) =>
  FORMATOS_VIDEO.some((f) => f.largura === d.largura && f.altura === d.altura) ? `-${proporcaoDe(d.largura, d.altura).replace(':', 'x')}` : `-${d.largura}x${d.altura}`;

/** Base do nome de cada arquivo (sem extensão): só leva o sufixo quando há mais de um destino ou quando o destino difere
 *  do formato do documento, para a exportação simples continuar saindo como "Título.mp4". */
export const nomesDosArquivos = (base: string, destinos: Destino[], formatoDoc: {largura: number; altura: number}) =>
  destinos.map((destino) => ({
    destino,
    nome: `${base}${destinos.length > 1 || destino.largura !== formatoDoc.largura || destino.altura !== formatoDoc.altura ? sufixoDestino(destino) : ''}`,
  }));

export type ArgumentosRender = {
  codec: 'h264' | 'h265' | 'vp9';
  ext: string;
  videoBitrate: `${number}k`;
  escala: number; // para a composição de tamanho fixo (o carrossel): o `scale` do renderMedia
  largura: number; // saída, já com a escala e par: a composição de cenas recebe nas props
  altura: number;
  frameRange: [number, number] | null; // quadros inclusivos nas duas pontas, como no Remotion; null = tudo
  quadros: number; // quantos quadros saem
  duracaoMs: number; // do trecho que sai
};

/** Trecho dentro do vídeo e com pelo menos um décimo de segundo. */
export const trechoValido = (t: Trecho | null | undefined, duracaoMs: number) =>
  Boolean(t && Number.isFinite(t.de_ms) && Number.isFinite(t.ate_ms) && t.de_ms >= 0 && t.ate_ms <= duracaoMs && t.ate_ms - t.de_ms >= 100);

/** O que o renderMedia recebe para um destino. O trecho vira quadros: do quadro em que começa ao último antes do fim. */
export const argumentosDoRender = (o: OpcoesExportarVideo, destino: Destino, formato: Formato, duracaoMs: number): ArgumentosRender => {
  const codec = CODECS.find((c) => c.id === o.codec) ?? CODECS[0];
  const escala = ESCALAS_VIDEO.includes(o.escala) ? o.escala : 1;
  const largura = ladoDeSaida(destino.largura, escala);
  const altura = ladoDeSaida(destino.altura, escala);
  const total = Math.max(1, Math.ceil((duracaoMs / 1000) * formato.fps));
  let frameRange: [number, number] | null = null;
  if (trechoValido(o.trecho, duracaoMs)) {
    const de = Math.max(0, Math.min(total - 1, Math.floor((o.trecho!.de_ms / 1000) * formato.fps)));
    const ate = Math.max(de, Math.min(total - 1, Math.ceil((o.trecho!.ate_ms / 1000) * formato.fps) - 1));
    if (de > 0 || ate < total - 1) frameRange = [de, ate];
  }
  const quadros = frameRange ? frameRange[1] - frameRange[0] + 1 : total;
  return {
    codec: codec.remotion, ext: codec.ext, videoBitrate: `${bitrateKbps(o.qualidade, largura, altura, formato.fps, codec.id)}k`, escala, largura, altura, frameRange, quadros,
    duracaoMs: Math.round((quadros / formato.fps) * 1000),
  };
};

/** Estimativa por destino e total, em bytes. `comAudio`: o carrossel tem narração; o vídeo de cenas só se tiver trilha. */
export const estimarExportacao = (o: OpcoesExportarVideo, formato: Formato, duracaoMs: number, comAudio: boolean) => {
  const porDestino = o.destinos.map((d) => {
    const a = argumentosDoRender(o, d, formato, duracaoMs);
    return {destino: d, largura: a.largura, altura: a.altura, bytes: estimarBytes(Number.parseInt(a.videoBitrate, 10), a.duracaoMs, comAudio)};
  });
  return {porDestino, total: porDestino.reduce((s, x) => s + x.bytes, 0)};
};
