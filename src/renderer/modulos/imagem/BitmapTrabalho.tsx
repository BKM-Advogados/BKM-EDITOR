// Imagem de uma camada na resolução de trabalho (desempenho.md, 4.5): o arquivo é baixado uma vez e decodificado num
// único bitmap do tamanho em que aparece na tela, com folga de 1,5× e nunca acima do original. Mudou o zoom além da
// folga, decodifica de novo (com espera, não a cada movimento). O canvas bitmaprenderer fica dono do bitmap; ao trocar
// de arquivo ou desmontar, a memória é devolvida. O usarImagem dá o mesmo bitmap de trabalho à pintura em canvas das
// camadas com acabamento (Prancheta.tsx), que desenha com ele em vez de transferir.
import React, {useEffect, useRef, useState} from 'react';
import type {CamadaImagem} from '../../../nucleo/documentos';
import {encaixe, imagemDoBlob, urlMidia} from './comum';
import type {FonteImagem} from './pintura';

const FOLGA = 1.5;

type Fonte = {blob: Blob; iw: number; ih: number};

const decodificar = async (f: Fonte, w: number, h: number) => {
  const opcoes: ImageBitmapOptions = {resizeWidth: w, resizeHeight: h, resizeQuality: 'high'};
  try {
    return await createImageBitmap(f.blob, opcoes);
  } catch {
    // SVG: o Chromium não decodifica o blob direto, só o elemento <img>
    return createImageBitmap(await imagemDoBlob(f.blob), opcoes);
  }
};

export const BitmapTrabalho: React.FC<{src: string; largura: number; altura: number; ajuste?: CamadaImagem['ajuste']; escala: number}> = ({src, largura, altura, ajuste, escala}) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dono = useRef<ImageBitmapRenderingContext | null>(null);
  const larguraAtual = useRef(0);
  const [fonte, setFonte] = useState<Fonte | null>(null);
  const [erro, setErro] = useState(false);
  const url = urlMidia(src);

  useEffect(() => {
    let vivo = true;
    setFonte(null);
    setErro(false);
    void (async () => {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(String(r.status));
        const blob = await r.blob();
        const img = await imagemDoBlob(blob);
        if (vivo) setFonte({blob, iw: img.naturalWidth || 1, ih: img.naturalHeight || 1});
      } catch {
        if (vivo) setErro(true);
      }
    })();
    return () => {
      vivo = false;
      dono.current?.transferFromImageBitmap(null);
      dono.current = null;
      larguraAtual.current = 0;
    };
  }, [url]);

  const caixa = fonte ? encaixe(fonte.iw, fonte.ih, largura, altura, ajuste) : null;
  const necessario = fonte && caixa ? Math.max(1, Math.min(fonte.iw, Math.ceil(caixa.w * escala * window.devicePixelRatio))) : 0;

  useEffect(() => {
    if (!fonte || !necessario) return;
    const tem = larguraAtual.current;
    if (tem && !(necessario > tem && tem < fonte.iw) && tem <= necessario * 2) return;
    let vivo = true;
    const espera = setTimeout(async () => {
      const w = Math.max(1, Math.min(fonte.iw, Math.round(necessario * FOLGA)));
      const h = Math.max(1, Math.round((w * fonte.ih) / fonte.iw));
      try {
        const bmp = await decodificar(fonte, w, h);
        const el = canvas.current;
        if (!vivo || !el) return bmp.close();
        dono.current ??= el.getContext('bitmaprenderer');
        if (!dono.current) return bmp.close();
        dono.current.transferFromImageBitmap(bmp);
        larguraAtual.current = w;
      } catch {
        if (vivo) setErro(true);
      }
    }, tem ? 250 : 0);
    return () => {
      vivo = false;
      clearTimeout(espera);
    };
  }, [fonte, necessario]);

  if (erro) {
    return (
      <div style={{position: 'absolute', inset: 0, border: '3px dashed var(--erro)', color: 'var(--erro)', font: '600 24px system-ui, sans-serif',
        display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 12, overflow: 'hidden'}}>
        imagem não encontrada<br />{src}
      </div>
    );
  }
  return <canvas ref={canvas} style={caixa ? {position: 'absolute', left: caixa.x, top: caixa.y, width: caixa.w, height: caixa.h} : {display: 'none'}} />;
};

/** Bitmap de trabalho para pintar em canvas: o arquivo baixado uma vez, decodificado na largura em que aparece
 *  (`escala` = px do canvas por px do documento) com a folga de sempre; null enquanto carrega, 'erro' se não achou.
 *  O bitmap anterior é fechado quando chega o novo. */
export const usarImagem = (src: string | undefined, largura: number, altura: number, ajuste: CamadaImagem['ajuste'], escala: number): FonteImagem | null | 'erro' => {
  const [fonte, setFonte] = useState<Fonte | null>(null);
  const [erro, setErro] = useState(false);
  const [bmp, setBmp] = useState<{img: ImageBitmap; w: number} | null>(null);
  const atual = useRef<ImageBitmap | null>(null);
  const url = src ? urlMidia(src) : '';

  useEffect(() => {
    let vivo = true;
    setFonte(null);
    setErro(false);
    // arquivo novo: o bitmap do anterior não serve mais
    atual.current?.close();
    atual.current = null;
    setBmp(null);
    if (!url) return;
    void (async () => {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(String(r.status));
        const blob = await r.blob();
        const img = await imagemDoBlob(blob);
        if (vivo) setFonte({blob, iw: img.naturalWidth || 1, ih: img.naturalHeight || 1});
      } catch {
        if (vivo) setErro(true);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [url]);

  useEffect(() => () => {
    atual.current?.close();
    atual.current = null;
  }, []);

  const caixa = fonte ? encaixe(fonte.iw, fonte.ih, largura, altura, ajuste) : null;
  const necessario = fonte && caixa ? Math.max(1, Math.min(fonte.iw, Math.ceil(caixa.w * escala))) : 0;
  const tem = bmp?.w ?? 0;

  useEffect(() => {
    if (!fonte || !necessario) return;
    if (tem && !(necessario > tem && tem < fonte.iw) && tem <= necessario * 2) return;
    let vivo = true;
    const espera = setTimeout(async () => {
      const w = Math.max(1, Math.min(fonte.iw, Math.round(necessario * FOLGA)));
      const h = Math.max(1, Math.round((w * fonte.ih) / fonte.iw));
      try {
        const img = await decodificar(fonte, w, h);
        if (!vivo) return img.close();
        const antes = atual.current;
        atual.current = img;
        setBmp({img, w});
        // o anterior só fecha depois que a pintura nova já usou o novo
        if (antes) setTimeout(() => antes.close(), 0);
      } catch {
        if (vivo) setErro(true);
      }
    }, tem ? 250 : 0);
    return () => {
      vivo = false;
      clearTimeout(espera);
    };
  }, [fonte, necessario, tem]);

  if (erro) return 'erro';
  return fonte && bmp && url ? {fonte: bmp.img, iw: fonte.iw, ih: fonte.ih} : null;
};
