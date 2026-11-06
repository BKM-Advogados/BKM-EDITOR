// Uma camada em DOM (imagem, texto ou forma) e a miniatura de uma página: o mesmo desenho do monitor, em escala
// pequena, para a barra de páginas do carrossel. As regras de texto e encaixe são as de comum.ts, para a miniatura, a
// prévia e o PNG darem o mesmo pixel.
import React from 'react';
import type {CamadaImagem, PaginaImagem} from '../../../nucleo/documentos';
import {BitmapTrabalho} from './BitmapTrabalho';
import {ENTRELINHA, PADRAO, alinhamentoCss, familiaCss, visivel} from './comum';

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

/** A página inteira numa caixa de `altura` px (sem a pilha de efeitos: é para achar a página, não para conferir cor). */
export const Miniatura: React.FC<{pagina: PaginaImagem; largura: number; altura: number; fundo: string; alturaCaixa: number}> = ({pagina, largura, altura, fundo, alturaCaixa}) => {
  const escala = alturaCaixa / Math.max(1, altura);
  const camadas = Array.isArray(pagina.camadas) ? pagina.camadas : [];
  return (
    <div className="mini-pagina" style={{width: Math.round(largura * escala), height: alturaCaixa, background: fundo}}>
      <div style={{position: 'absolute', left: 0, top: 0, width: largura, height: altura, transform: `scale(${escala})`, transformOrigin: '0 0', overflow: 'hidden'}}>
        {camadas.map((c, i) => visivel(c) && <Camada key={c.id || i} c={c} escala={escala} />)}
      </div>
    </div>
  );
};
