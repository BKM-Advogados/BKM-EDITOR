// Opções de exportação e as contas que a interface e o processo principal partilham: destinos (proporções), qualidade em
// bitrate, escala, trecho, o nome de cada arquivo e a estimativa de tamanho (bitrate × duração). Nada aqui toca disco nem
// o Remotion: `argumentosDoRender` só traduz as opções para o que o renderMedia recebe. No fim, a marca d'água por
// destino: o que o diálogo guarda (ConfigMarcaDagua) e o que a composição desenha (MarcaDaguaP, já posicionada).
import {FORMATOS_VIDEO, proporcaoDe, type Formato} from './formatos';
import {MARCA_CLIENTE} from './marca';
import {areaDaLegenda, type LegendasP} from './legendas';
import {CANTO_PADRAO, posicaoSegura, zonasDaMarca, zonaSugerida, type CantoMarca, type Ret} from './zonas-seguras';

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
  marca_dagua?: Record<string, ConfigMarcaDagua>; // por id de destino; ausente ou desligada, sai sem marca
  proporcao_logo?: number; // largura ÷ altura do logo, medida pela interface (sem ela, 3)
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

// ---------- marca d'água por destino ----------
// O logo ou a assinatura do kit de marca (tema.logo e tema.assinatura no vídeo de cenas; logo e marca.insta no carrossel
// da Cliente), por cima da composição, só na exportação. Cada destino tem a sua escolha, lembrada por projeto em
// .estudio/exportacao.json; o canto padrão e a posição fina saem das zonas seguras da rede (posicaoSegura).
export type ConteudoMarca = 'logo' | 'assinatura';
/** `tamanho`: altura da marca, fração do lado menor do quadro; `opacidade` de 0,2 a 1. */
export type ConfigMarcaDagua = {ligada: boolean; conteudo: ConteudoMarca; canto: CantoMarca; tamanho: number; opacidade: number};
/** O que a composição recebe em `props.marca_dagua`: o arquivo (caminho de mídia, como o tema) ou o texto e a caixa em
 *  frações do quadro, encostada do lado do canto (`alinhar`). `segura: false` quando nenhuma posição livre coube. */
export type MarcaDaguaP = {logo?: string; texto?: string; fonte?: string; x: number; y: number; largura: number; altura: number; alinhar: 'esquerda' | 'direita';
  opacidade: number; segura: boolean};
/** Preferências de exportação do projeto (.estudio/exportacao.json). */
export type PrefsExportacao = {marca_dagua?: Record<string, ConfigMarcaDagua>};
export type FontesMarcaDagua = {logo?: string; assinatura?: string; fonte?: string};

export const TAMANHO_MARCA = {min: 0.03, max: 0.15, padrao: 0.06};
export const OPACIDADE_MARCA = {min: 0.2, max: 1, padrao: 0.85};
const MARGEM_MARCA = 0.035; // da borda e das zonas, fração do lado menor
const PROPORCAO_LOGO_PADRAO = 3;
export const CANTOS_MARCA: {id: CantoMarca; nome: string}[] = [
  {id: 'sup-esq', nome: 'Em cima, à esquerda'}, {id: 'sup-dir', nome: 'Em cima, à direita'},
  {id: 'inf-esq', nome: 'Embaixo, à esquerda'}, {id: 'inf-dir', nome: 'Embaixo, à direita'},
];

const limitar = (v: unknown, faixa: {min: number; max: number; padrao: number}) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(faixa.max, Math.max(faixa.min, v)) : faixa.padrao;
const textoDe = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Logo, assinatura e fonte que as props do vídeo oferecem; o carrossel da Cliente escreve na IBM Plex Sans do manual. */
export const fontesDaMarcaDagua = (props: Record<string, unknown> | null | undefined): FontesMarcaDagua => {
  const tema = (props?.tema ?? {}) as Record<string, unknown>;
  const marca = (props?.marca ?? {}) as Record<string, unknown>;
  const fonte = textoDe(tema.fonte) ?? (props && props.composicao !== 'VideoCenas' ? MARCA_CLIENTE.fontes.texto : undefined);
  return {logo: textoDe(tema.logo) ?? textoDe(props?.logo), assinatura: textoDe(tema.assinatura) ?? textoDe(marca.insta) ?? textoDe(marca.site), ...(fonte ? {fonte} : {})};
};

/** A escolha de partida de um destino: desligada, o logo se houver, o canto livre da rede, 6% do lado menor, 85%. */
export const configPadraoMarca = (destino: {largura: number; altura: number}, fontes: FontesMarcaDagua = {}): ConfigMarcaDagua => ({
  ligada: false,
  conteudo: fontes.logo || !fontes.assinatura ? 'logo' : 'assinatura',
  canto: CANTO_PADRAO[zonaSugerida(destino.largura, destino.altura)],
  tamanho: TAMANHO_MARCA.padrao,
  opacidade: OPACIDADE_MARCA.padrao,
});

/** Lê uma escolha guardada com calma: campo fora do lugar volta ao `padrao`. */
export const normalizarConfigMarca = (x: unknown, padrao: ConfigMarcaDagua): ConfigMarcaDagua => {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  return {
    ligada: typeof o.ligada === 'boolean' ? o.ligada : padrao.ligada,
    conteudo: o.conteudo === 'logo' || o.conteudo === 'assinatura' ? o.conteudo : padrao.conteudo,
    canto: CANTOS_MARCA.some((c) => c.id === o.canto) ? (o.canto as CantoMarca) : padrao.canto,
    tamanho: limitar(o.tamanho ?? padrao.tamanho, TAMANHO_MARCA),
    opacidade: limitar(o.opacidade ?? padrao.opacidade, OPACIDADE_MARCA),
  };
};

/** O arquivo de preferências inteiro: só os destinos com nome de id e escolha legível. */
export const normalizarPrefsExportacao = (x: unknown): PrefsExportacao => {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const md = (o.marca_dagua && typeof o.marca_dagua === 'object' ? o.marca_dagua : {}) as Record<string, unknown>;
  const marca_dagua = Object.fromEntries(Object.entries(md).filter(([id, v]) => /^[a-z0-9-]{1,40}$/.test(id) && v && typeof v === 'object')
    .map(([id, v]) => [id, normalizarConfigMarca(v, configPadraoMarca(FORMATOS_VIDEO.find((f) => f.id === id) ?? FORMATOS_VIDEO[0]))]));
  return Object.keys(marca_dagua).length ? {marca_dagua} : {};
};

/** Largura aproximada de uma linha de texto (px): 0,6 da letra por caractere, a média larga de uma sem serifa. */
const larguraDoTexto = (texto: string, letra: number) => Math.ceil(texto.length * letra * 0.6);

// ---------- a marca d'água não cobre a legenda (video-N2, som-N5, imagem-N4, transversal-N3) ----------

const finito = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** As legendas que vão ao render (`legendas_cenas` das props), se tiverem a área e o estilo no formato do resolvedor
 *  (legendas.ts). Sem legenda, oculta ou sem segmentos: null. */
export const legendasDasProps = (props: Record<string, unknown> | null | undefined): LegendasP | null => {
  const l = props?.legendas_cenas as Partial<LegendasP> | undefined;
  const a = l?.area;
  if (!l || l.oculto || !Array.isArray(l.segmentos) || !l.segmentos.length || !l.estilo || typeof l.estilo !== 'object') return null;
  if (!a || ![a.topo, a.base, a.esq, a.dir].every(finito)) return null;
  return l as LegendasP;
};

/** As legendas com a área livre de outro tamanho de quadro: a mesma conta que o resolvedor faz (areaDaLegenda), para a
 *  miniatura do diálogo mostrar a legenda e a marca de cada destino onde a exportação vai pôr. */
export const legendasNoDestino = (l: LegendasP | null, quadro: {largura: number; altura: number}): LegendasP | null =>
  l ? {...l, area: areaDaLegenda(quadro.largura, quadro.altura)} : null;

/** Onde a legenda pode aparecer (frações do quadro), pelo pior caso, com a mesma geometria do Legendas.tsx: da margem
 *  esquerda à direita da área (a faixa da marca vai de borda a borda), na posição do estilo (embaixo encostada na base
 *  da área, em cima no topo, no meio a 62% entre os dois), com todas as linhas do estilo na letra dele, o nome do
 *  falante quando ligado e a faixa com o respiro dela. Uma folga de 0,3 da letra cobre a entrada (o texto sobe 0,25 da
 *  letra) e a caixa atrás da linha, que passa um pouco do texto. */
export const caixaDaLegenda = (l: LegendasP | null | undefined, quadro: {largura: number; altura: number}): Ret | null => {
  if (!l || !(quadro.largura > 0 && quadro.altura > 0)) return null;
  const {area: a, estilo: e} = l;
  const W = quadro.largura;
  const H = quadro.altura;
  const tam = (finito(e.tam) && e.tam > 0 ? e.tam : 0.042) * Math.min(W, H);
  const entrelinha = e.caixa === 'linha' ? 1.42 : 1.18;
  let h = (e.linhas === 1 ? 1 : 2) * entrelinha * tam;
  if (e.falante) h += tam * 0.62 * entrelinha + tam * 0.12;
  const faixa = e.caixa === 'faixa';
  if (faixa) h += tam * 0.8;
  const topo = e.posicao === 'cima' ? a.topo * H : e.posicao === 'meio' ? (a.topo + (a.base - a.topo) * 0.62) * H - h / 2 : a.base * H - h;
  const folga = tam * 0.3;
  const x0 = faixa ? 0 : Math.max(0, a.esq * W - folga);
  const x1 = faixa ? W : Math.min(W, (1 - a.dir) * W + folga);
  const y0 = Math.max(0, topo - folga);
  const y1 = Math.min(H, topo + h + folga);
  return {x: x0 / W, y: y0 / H, largura: (x1 - x0) / W, altura: (y1 - y0) / H};
};

/** A marca de um destino, pronta para a composição, ou null (desligada ou sem logo nem assinatura no kit). Se o conteúdo
 *  pedido faltar, vai o outro. A caixa tem a altura do `tamanho` e a largura do logo (pela proporção) ou do texto, até
 *  60% do quadro; a posição é a livre mais perto do canto, fora das zonas da rede e da legenda (`legendas`: as que vão
 *  ao render deste destino, legendasDasProps). */
export const marcaDaguaDoDestino = (c: ConfigMarcaDagua | null | undefined, destino: {largura: number; altura: number}, fontes: FontesMarcaDagua,
  proporcaoLogo?: number, legendas?: LegendasP | null): MarcaDaguaP | null => {
  if (!c?.ligada || !(destino.largura > 0 && destino.altura > 0)) return null;
  const logo = (c.conteudo === 'logo' || !fontes.assinatura) && fontes.logo ? fontes.logo : undefined;
  const texto = logo ? undefined : fontes.assinatura;
  if (!logo && !texto) return null;
  const menor = Math.min(destino.largura, destino.altura);
  const altura = limitar(c.tamanho, TAMANHO_MARCA) * menor;
  const proporcao = proporcaoLogo && Number.isFinite(proporcaoLogo) && proporcaoLogo > 0 ? Math.min(8, Math.max(0.2, proporcaoLogo)) : PROPORCAO_LOGO_PADRAO;
  const largura = Math.min(0.6 * destino.largura, logo ? altura * proporcao : larguraDoTexto(texto!, altura * 0.8));
  const canto = CANTOS_MARCA.some((x) => x.id === c.canto) ? c.canto : CANTO_PADRAO[zonaSugerida(destino.largura, destino.altura)];
  const legenda = caixaDaLegenda(legendas, destino);
  const pos = posicaoSegura(zonasDaMarca(destino.largura, destino.altura), canto, destino, {largura, altura}, MARGEM_MARCA * menor, legenda ? [legenda] : []);
  const n = (v: number) => Math.round(v * 1e5) / 1e5;
  return {...(logo ? {logo} : {texto}), ...(texto && fontes.fonte ? {fonte: fontes.fonte} : {}), x: n(pos.x), y: n(pos.y), largura: n(largura / destino.largura),
    altura: n(altura / destino.altura), alinhar: canto.endsWith('dir') ? 'direita' : 'esquerda', opacidade: limitar(c.opacidade, OPACIDADE_MARCA), segura: pos.segura};
};
