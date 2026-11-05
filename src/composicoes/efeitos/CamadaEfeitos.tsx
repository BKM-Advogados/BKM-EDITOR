// Aplica a pilha de efeitos a um conteúdo: filtro CSS no conteúdo e camadas (vinheta, granulado, tom) por cima.
// Serve à composição do Remotion e à prévia da imagem; `quadro` dá a semente do granulado.
import React from 'react';
import {camadas, filtroCss, type Efeito} from '../../nucleo/efeitos';

const Granulado: React.FC<{forca: number; quadro: number}> = ({forca, quadro}) => {
  const id = `grao-${quadro % 997}`;
  return (
    <svg width="100%" height="100%" style={{position: 'absolute', inset: 0, opacity: forca, mixBlendMode: 'overlay', pointerEvents: 'none'}}>
      <filter id={id}>
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={quadro % 997} stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter={`url(#${id})`} />
    </svg>
  );
};

export const CamadaEfeitos: React.FC<{efeitos?: Efeito[]; quadro: number; children: React.ReactNode}> = ({efeitos, quadro, children}) => {
  const filtro = filtroCss(efeitos);
  const extras = camadas(efeitos);
  if (!filtro && !extras.length) return <>{children}</>;
  return (
    <div style={{position: 'absolute', inset: 0}}>
      <div style={{position: 'absolute', inset: 0, filter: filtro || undefined}}>{children}</div>
      {extras.map((e) => {
        if (e.tipo === 'vinheta') {
          return <div key={e.id} style={{position: 'absolute', inset: 0, pointerEvents: 'none',
            background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${Math.min(1, e.valor)}) 100%)`}} />;
        }
        if (e.tipo === 'granulado') return <Granulado key={e.id} forca={e.valor} quadro={quadro} />;
        return <div key={e.id} style={{position: 'absolute', inset: 0, pointerEvents: 'none', background: e.cor ?? '#C88155',
          mixBlendMode: 'soft-light', opacity: e.valor}} />;
      })}
    </div>
  );
};
