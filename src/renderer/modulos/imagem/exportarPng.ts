// Exportação da imagem em resolução cheia (ou na escala pedida): fundo e camadas visíveis num canvas do tamanho do
// documento, depois a pilha de efeitos (filtro CSS no ctx.filter ao copiar para um segundo canvas; vinheta, granulado e
// tom por cima) e a imagem vai ao processo principal, que grava em saidas/. Uma camada por vez: cada imagem é carregada,
// desenhada e solta antes da próxima. Cada camada (com sombra, contorno, degradê e máscara) passa por pintura.ts, o
// mesmo código que a prévia usa nas camadas com acabamento; as regras de texto e encaixe são as de comum.ts. Sem opções
// sai o PNG de sempre; o diálogo de exportar passa formato (PNG, JPG, WebP), qualidade, escala e nome.
import type {DocImagem} from '../../../nucleo/documentos';
import {itensDePintura, type ItemPintura} from '../../../nucleo/acabamento';
import {resolverMarcaNoDoc} from '../../../nucleo/cor-marca';
import {camadas as camadasDeEfeito, filtroCss, sementeDoGranulado, svgDoGranulado, TOM_PADRAO, type Efeito} from '../../../nucleo/efeitos';
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

/** O granulado é o mesmo SVG da prévia (feTurbulence, mesma frequência, oitavas e semente), desenhado no tamanho do arquivo com o
 *  grão em unidades do documento; a escala da exportação aumenta o grão junto com a imagem (tres-efeitos-D6). */
const desenharGranulado = async (ctx: CanvasRenderingContext2D, e: Efeito, doc: DocImagem, W: number, H: number) => {
  const svg = svgDoGranulado(doc.largura, doc.altura, W, H, sementeDoGranulado(0));
  const ruido = await imagemDoBlob(new Blob([svg], {type: 'image/svg+xml'}));
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = Math.min(1, Math.max(0, e.valor));
  ctx.drawImage(ruido, 0, 0, W, H);
  ctx.restore();
  ruido.removeAttribute('src');
};

const desenharTom = (ctx: CanvasRenderingContext2D, e: Efeito, W: number, H: number) => {
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = Math.min(1, Math.max(0, e.valor));
  ctx.fillStyle = e.cor ?? TOM_PADRAO;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
};

/** Documento inteiro em resolução cheia vezes `escala` (as camadas desenham em px do documento, o canvas é escalado);
 *  devolve o canvas e as camadas cuja imagem não carregou. */
export const desenharDocumento = async (documento: DocImagem, escala = 1) => {
  const doc = resolverMarcaNoDoc(documento); // cor "@destaque" vira a cor do kit da imagem antes de pintar
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
    else if (e.tipo === 'granulado') await desenharGranulado(f, e, doc, W, H);
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
