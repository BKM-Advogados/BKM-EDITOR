// Imagem de uma camada na resolução de trabalho (desempenho.md, 4.5): o arquivo é baixado uma vez e decodificado num
// único bitmap do tamanho em que aparece na tela, com folga de 1,5× e nunca acima do original. Mudou o zoom além da
// folga, decodifica de novo (com espera, não a cada movimento). O canvas bitmaprenderer fica dono do bitmap; ao trocar
// de arquivo ou desmontar, a memória é devolvida.
import React, {useEffect, useRef, useState} from 'react';
import type {CamadaImagem} from '../../../nucleo/documentos';
import {encaixe, imagemDoBlob, urlMidia} from './comum';

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
