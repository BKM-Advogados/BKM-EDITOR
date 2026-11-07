// Exportação da imagem em resolução cheia (ou na escala pedida): fundo e camadas visíveis num canvas do tamanho do
// documento, depois a pilha de efeitos (filtro CSS no ctx.filter ao copiar para um segundo canvas; vinheta, granulado e
// tom por cima) e a imagem vai ao processo principal, que grava em saidas/. Uma camada por vez: cada imagem é carregada,
// desenhada e solta antes da próxima. Cada camada (com sombra, contorno, degradê e máscara) passa por pintura.ts, o
// mesmo código que a prévia usa nas camadas com acabamento; as regras de texto e encaixe são as de comum.ts. Sem opções
// sai o PNG de sempre; o diálogo de exportar passa formato (PNG, JPG, WebP), qualidade, escala e nome.
import type {DocImagem} from '../../../nucleo/documentos';
import {itensDePintura, type ItemPintura} from '../../../nucleo/acabamento';
import {camadas as camadasDeEfeito, filtroCss, type Efeito} from '../../../nucleo/efeitos';
import {FORMATOS_IMAGEM_SAIDA, type FormatoImagem} from '../../../nucleo/exportacao';
import {avisar, loja} from '../../estado/loja';
import {PADRAO, esperarFontes, familiaCss, imagemDoBlob, rotuloCamada, urlMidia, visivel} from './comum';
import {contexto, novoCanvas, pintarFundoDegrade, pintarItem, soltar} from './pintura';

const LADO_MAX = 32767;
const AREA_MAX = 268_435_456; // teto do canvas no Chromium

// por fetch, como a prévia (BitmapTrabalho): o mesmo arquivo do servidor de mídia, e a prévia web consegue servir o
// PNG sem fundo que ela guarda em memória
const carregarImagem = async (caminho: string) => {
  const r = await fetch(urlMidia(caminho));
  if (!r.ok) throw new Error(`não achei ${caminho}`);
  return imagemDoBlob(await r.blob());
};

/** Desenha o item (camada, ou imagem com a máscara) no lugar dele; devolve false se a imagem não carregou. */
const desenharItem = async (ctx: CanvasRenderingContext2D, item: ItemPintura) => {
  const {c} = item;
  const img = c.tipo === 'imagem' ? (c.src ? await carregarImagem(c.src).catch(() => null) : null) : undefined;
  if (img === null) return false;
  pintarItem(ctx, item, img ? {fonte: img, iw: img.naturalWidth || 1, ih: img.naturalHeight || 1} : undefined);
  img?.removeAttribute('src');
  return true;
};

/** Gerador pseudoaleatório com semente (mulberry32): o mesmo documento dá sempre o mesmo granulado. */
const aleatorio = (semente: number) => () => {
  semente = (semente + 0x6d2b79f5) | 0;
  let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const sementeDe = (texto: string) => [...texto].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7);

const desenharVinheta = (ctx: CanvasRenderingContext2D, valor: number, W: number, H: number) => {
  // radial-gradient(ellipse at center, …) da prévia: elipse com a proporção do quadro passando pelos cantos
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(1, H / W);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, (W / 2) * Math.SQRT2);
  g.addColorStop(0.45, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${Math.min(1, Math.max(0, valor))})`);
  ctx.fillStyle = g;
  ctx.fillRect(-W / 2, -W / 2, W, W);
  ctx.restore();
};

const desenharGranulado = (ctx: CanvasRenderingContext2D, e: Efeito, W: number, H: number) => {
  const ruido = novoCanvas(W, H);
  const r = contexto(ruido);
  const dados = r.createImageData(W, H);
  const d = dados.data;
  const sorte = aleatorio(sementeDe(e.id));
  // cinza em torno do meio e meio transparente, perto do feTurbulence da prévia
  for (let i = 0; i < d.length; i += 4) {
    const v = 128 + (sorte() + sorte() - 1) * 110;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 128;
  }
  r.putImageData(dados, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = Math.min(1, Math.max(0, e.valor));
  ctx.drawImage(ruido, 0, 0);
  ctx.restore();
  soltar(ruido);
};

const desenharTom = (ctx: CanvasRenderingContext2D, e: Efeito, W: number, H: number) => {
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = Math.min(1, Math.max(0, e.valor));
  ctx.fillStyle = e.cor ?? '#C88155';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
};

/** Documento inteiro em resolução cheia vezes `escala` (as camadas desenham em px do documento, o canvas é escalado);
 *  devolve o canvas e as camadas cuja imagem não carregou. */
export const desenharDocumento = async (doc: DocImagem, escala = 1) => {
  const W = Math.round(doc.largura * escala);
  const H = Math.round(doc.altura * escala);
  if (!(W > 0 && H > 0) || W > LADO_MAX || H > LADO_MAX || W * H > AREA_MAX) throw new Error(`tamanho ${W}×${H} fora do que o canvas aceita`);
  const textos = doc.camadas.filter((c) => visivel(c) && c.tipo === 'texto');
  await esperarFontes(textos.map((c) => c.fonte || PADRAO.fonte));
  await Promise.all(textos.map((c) => document.fonts.load(`${c.peso ?? PADRAO.peso} ${c.tamanho ?? PADRAO.tamanho}px ${familiaCss(c.fonte)}`, c.texto || 'a').catch(() => [])));

  const composicao = novoCanvas(W, H);
  const ctx = contexto(composicao);
  ctx.scale(escala, escala);
  ctx.fillStyle = doc.fundo;
  ctx.fillRect(0, 0, doc.largura, doc.altura);
  pintarFundoDegrade(ctx, doc.fundo_degrade, doc.largura, doc.altura);
  const faltaram: string[] = [];
  for (const item of itensDePintura(doc.camadas)) if (!(await desenharItem(ctx, item))) faltaram.push(rotuloCamada(item.c));

  const efeitos = doc.efeitos ?? [];
  // o desfoque é em px do documento: acompanha a escala
  const filtro = filtroCss(efeitos).replace(/blur\((\d*\.?\d+)px\)/g, (_, n: string) => `blur(${Number(n) * escala}px)`);
  const extras = camadasDeEfeito(efeitos);
  if (!filtro && !extras.length) return {canvas: composicao, faltaram};

  const final = novoCanvas(W, H);
  const f = contexto(final);
  f.fillStyle = doc.fundo; // as bordas do desfoque caem no fundo, como na prévia
  f.fillRect(0, 0, W, H);
  f.filter = filtro || 'none';
  f.drawImage(composicao, 0, 0);
  f.filter = 'none';
  soltar(composicao);
  for (const e of extras) {
    if (e.tipo === 'vinheta') desenharVinheta(f, e.valor, W, H);
    else if (e.tipo === 'granulado') desenharGranulado(f, e, W, H);
    else desenharTom(f, e, W, H);
  }
  return {canvas: final, faltaram};
};

export type OpcoesPng = {formato?: FormatoImagem; qualidade?: number; escala?: number; nome?: string; sufixo?: string; revelar?: boolean};
export type SaidaPng = {ok: boolean; arquivo?: string; pasta?: string; faltaram: string[]; mensagem?: string};

/** Exporta a imagem para saidas/. Sem opções, o PNG em resolução cheia de sempre, mostrado na pasta ao fim (quem chama
 *  em série, como o carrossel de páginas, passa `revelar: false`); o diálogo de exportar passa formato, qualidade (0 a
 *  1, só JPG e WebP), escala e nome, e mostra o arquivo por conta própria. */
export const exportarPng = async (documento: string, opcoes: OpcoesPng = {}): Promise<SaidaPng> => {
  const doc = loja.get().docs[documento]?.doc as DocImagem | undefined;
  if (!doc) {
    avisar('A imagem ainda não carregou.', 'erro');
    return {ok: false, faltaram: [], mensagem: 'a imagem ainda não carregou'};
  }
  const formato = FORMATOS_IMAGEM_SAIDA.find((f) => f.id === opcoes.formato) ?? FORMATOS_IMAGEM_SAIDA[0];
  const escala = opcoes.escala && opcoes.escala > 0 ? opcoes.escala : 1;
  avisar(`Exportando ${formato.nome} em ${Math.round(doc.largura * escala)}×${Math.round(doc.altura * escala)}…`);
  try {
    const {canvas, faltaram} = await desenharDocumento(doc, escala);
    const dados = canvas.toDataURL(formato.mime, formato.comQualidade ? Math.min(1, Math.max(0.05, opcoes.qualidade ?? 0.9)) : undefined);
    soltar(canvas);
    const r = await window.estudio.exportarImagem(documento, dados, {formato: formato.id, nome: opcoes.nome, sufixo: opcoes.sufixo});
    const falta = faltaram.length ? ` (sem imagem: ${faltaram.join(', ')})` : '';
    if (r.ok) {
      avisar(`${formato.nome} exportado: ${r.arquivo}${falta}`, faltaram.length ? 'erro' : 'ok');
      if (opcoes.revelar !== false && r.arquivo) window.estudio.mostrarArquivo(r.arquivo);
    } else avisar('Exportação cancelada.', 'info');
    return {...r, faltaram};
  } catch (e) {
    avisar(`Exportação da imagem falhou: ${(e as Error).message}`, 'erro');
    return {ok: false, faltaram: [], mensagem: (e as Error).message};
  }
};
