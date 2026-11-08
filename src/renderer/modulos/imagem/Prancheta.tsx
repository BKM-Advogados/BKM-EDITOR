// Uma camada em DOM (imagem, texto ou forma), as camadas de uma página e a miniatura dela: o mesmo desenho do monitor,
// em escala pequena, para a barra de páginas do carrossel. Camada com acabamento (sombra, contorno, degradê) e foto
// recortada por máscara saem num canvas pintado por pintura.ts, o mesmo código do PNG exportado, por baixo de uma
// caixa invisível que é a camada para o clique; o fundo em degradê também. As regras de texto e encaixe são as de
// comum.ts, para a miniatura, a prévia e o PNG darem o mesmo pixel.
import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {CamadaImagem, Degrade, MarcaDoDocumento, PaginaImagem} from '../../../nucleo/documentos';
import {intersecao, itensDePintura, temAcabamento, type ItemPintura} from '../../../nucleo/acabamento';
import {resolverCamadas, resolverCor, resolverDegrade} from '../../../nucleo/cor-marca';
import {BitmapTrabalho, usarImagem} from './BitmapTrabalho';
import {ENTRELINHA, PADRAO, alinhamentoCss, esperarFontes, familiaCss} from './comum';
import {caixaDoItem, fonteCss, pintarFundoDegrade, pintarItem} from './pintura';

const LADO_MAX_PREVIA = 4096; // px do canvas por lado na prévia; acima disso a pintura perde resolução, não memória

export const Camada = React.memo(function Camada({c, caminho, escala}: {c: CamadaImagem; caminho?: string; escala: number}) {
  const base: React.CSSProperties = {position: 'absolute', left: c.x, top: c.y, width: c.largura, height: c.altura,
    opacity: c.opacidade ?? 1, transform: c.rotacao ? `rotate(${c.rotacao}deg)` : undefined};
  if (c.tipo === 'imagem') {
    return (
      <div data-caminho={caminho} style={{...base, overflow: 'hidden'}}>
        {c.src && <BitmapTrabalho src={c.src} largura={c.largura} altura={c.altura} ajuste={c.ajuste} escala={escala} />}
      </div>
    );
  }
  if (c.tipo === 'texto') {
    return (
      <div data-caminho={caminho} style={{...base, fontFamily: familiaCss(c.fonte), fontSize: c.tamanho ?? PADRAO.tamanho, fontWeight: c.peso ?? PADRAO.peso,
        fontStyle: 'normal', letterSpacing: 'normal', color: c.cor ?? PADRAO.cor, textAlign: alinhamentoCss(c.alinhar), lineHeight: ENTRELINHA,
        whiteSpace: 'pre-wrap', overflowWrap: 'break-word', fontVariantNumeric: 'normal'}}>
        {c.texto ?? ''}
      </div>
    );
  }
  return <div data-caminho={caminho} style={{...base, background: c.preenchimento ?? PADRAO.preenchimento,
    borderRadius: c.forma === 'elipse' ? '50%' : Math.max(0, c.raio ?? PADRAO.raio)}} />;
});

/** Conta as vezes que as fontes dos textos acabaram de carregar: a pintura mede e desenha de novo com a fonte certa. */
const usarFontesProntas = (textos: CamadaImagem[]) => {
  const chave = textos.map((t) => fonteCss(t)).join('|');
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    if (!chave) return;
    let vivo = true;
    void Promise.all([esperarFontes(textos.map((t) => t.fonte || PADRAO.fonte)), ...textos.map((t) => document.fonts.load(fonteCss(t), t.texto || 'a').catch(() => []))])
      .then(() => vivo && setVersao((v) => v + 1));
    return () => {
      vivo = false;
    };
  }, [chave]); // eslint-disable-line react-hooks/exhaustive-deps
  return versao;
};

type PropsPintada = {item: ItemPintura; base?: string; escala: number; largura: number; altura: number};

/** Camada com acabamento (ou foto com máscara) na prévia: canvas na resolução da tela, pintado por pintura.ts. */
const CamadaPintada = React.memo(function CamadaPintada({item, base, escala, largura, altura}: PropsPintada) {
  const {c, mascara} = item;
  const forma = mascara?.c ?? c;
  const canvas = useRef<HTMLCanvasElement>(null);
  const fontes = usarFontesProntas([c, forma].filter((x, k, l) => x.tipo === 'texto' && l.indexOf(x) === k));
  const area = useMemo(() => intersecao(caixaDoItem(item), {x: 0, y: 0, w: largura, h: altura}),
    [c, mascara?.c, largura, altura, fontes]); // eslint-disable-line react-hooks/exhaustive-deps
  const dpr = window.devicePixelRatio || 1;
  const k = area ? Math.min(escala * dpr, LADO_MAX_PREVIA / area.w, LADO_MAX_PREVIA / area.h) : escala * dpr;
  const img = usarImagem(c.tipo === 'imagem' ? c.src : undefined, c.largura, c.altura, c.ajuste, k);
  const px = area && {x0: Math.floor(area.x * k), y0: Math.floor(area.y * k), x1: Math.ceil((area.x + area.w) * k), y1: Math.ceil((area.y + area.h) * k)};

  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el || !px) return;
    el.width = Math.max(1, px.x1 - px.x0);
    el.height = Math.max(1, px.y1 - px.y0);
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(k, 0, 0, k, -px.x0, -px.y0);
    pintarItem(ctx, item, img && img !== 'erro' ? img : undefined);
  }, [c, mascara?.c, img, k, px?.x0, px?.y0, px?.x1, px?.y1, fontes]); // eslint-disable-line react-hooks/exhaustive-deps

  // arquivo que não existe: o aviso de sempre, em DOM
  if (img === 'erro' && !mascara) return <Camada c={c} caminho={base ? `${base}/${item.i}` : undefined} escala={escala} />;
  const caminho = base ? `${base}/${mascara ? mascara.j : item.i}` : undefined;
  return (
    <>
      {px && <canvas ref={canvas} style={{position: 'absolute', left: px.x0 / k, top: px.y0 / k, width: (px.x1 - px.x0) / k, height: (px.y1 - px.y0) / k, pointerEvents: 'none'}} />}
      {/* a caixa do clique: na foto recortada, é a máscara (a foto se escolhe com duplo clique) */}
      <div data-caminho={caminho} data-foto={mascara && base ? `${base}/${item.i}` : undefined}
        style={{position: 'absolute', left: forma.x, top: forma.y, width: forma.largura, height: forma.altura, transform: forma.rotacao ? `rotate(${forma.rotacao}deg)` : undefined}} />
    </>
  );
}, (a, b) => a.item.c === b.item.c && a.item.mascara?.c === b.item.mascara?.c && a.item.i === b.item.i && a.item.mascara?.j === b.item.mascara?.j
  && a.base === b.base && a.escala === b.escala && a.largura === b.largura && a.altura === b.altura);

/** As camadas visíveis da página, de baixo para cima: em DOM as simples, em canvas as com acabamento e as recortadas. */
export const CamadasDaPagina: React.FC<{camadas: CamadaImagem[]; base?: string; escala: number; largura: number; altura: number}> = ({camadas, base, escala, largura, altura}) => {
  const itens = useMemo(() => itensDePintura(camadas), [camadas]);
  return (
    <>
      {itens.map((it) => (it.mascara || temAcabamento(it.c)
        ? <CamadaPintada key={it.c.id || it.i} item={it} base={base} escala={escala} largura={largura} altura={altura} />
        : <Camada key={it.c.id || it.i} c={it.c} caminho={base ? `${base}/${it.i}` : undefined} escala={escala} />))}
    </>
  );
};

/** Degradê do fundo da prancheta, pintado como no PNG (um degradê não precisa da resolução cheia da tela). */
export const FundoPintado: React.FC<{degrade: unknown; largura: number; altura: number; escala: number}> = ({degrade, largura, altura, escala}) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const k = Math.min(escala * (window.devicePixelRatio || 1), 2048 / Math.max(1, largura), 2048 / Math.max(1, altura));
  useLayoutEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    el.width = Math.max(1, Math.round(largura * k));
    el.height = Math.max(1, Math.round(altura * k));
    ctx.setTransform(el.width / largura, 0, 0, el.height / altura, 0, 0);
    pintarFundoDegrade(ctx, degrade, largura, altura);
  }, [degrade, largura, altura, k]);
  return <canvas ref={canvas} style={{position: 'absolute', left: 0, top: 0, width: largura, height: altura, pointerEvents: 'none'}} />;
};

/** A página inteira numa caixa de `altura` px (sem a pilha de efeitos: é para achar a página, não para conferir cor). */
export const Miniatura: React.FC<{pagina: PaginaImagem; largura: number; altura: number; fundo: string; fundoDegrade?: unknown; alturaCaixa: number; marca?: MarcaDoDocumento}> = ({pagina, largura, altura, fundo, fundoDegrade, alturaCaixa, marca}) => {
  const escala = alturaCaixa / Math.max(1, altura);
  // marca: a cor "@destaque" lida do kit da imagem, como no monitor
  const camadas = useMemo(() => resolverCamadas(Array.isArray(pagina.camadas) ? pagina.camadas : [], marca), [pagina.camadas, marca]);
  const degrade = useMemo(() => resolverDegrade(fundoDegrade as Degrade | undefined, marca), [fundoDegrade, marca]);
  return (
    <div className="mini-pagina" style={{width: Math.round(largura * escala), height: alturaCaixa, background: resolverCor(fundo, marca)}}>
      <div style={{position: 'absolute', left: 0, top: 0, width: largura, height: altura, transform: `scale(${escala})`, transformOrigin: '0 0', overflow: 'hidden'}}>
        {degrade !== undefined && <FundoPintado degrade={degrade} largura={largura} altura={altura} escala={escala} />}
        <CamadasDaPagina camadas={camadas} escala={escala} largura={largura} altura={altura} />
      </div>
    </div>
  );
};
