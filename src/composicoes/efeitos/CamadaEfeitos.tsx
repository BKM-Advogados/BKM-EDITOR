// Aplica a pilha de efeitos a um conteúdo: filtro CSS no conteúdo e camadas (vinheta, granulado, tom) por cima.
// Serve à composição do Remotion e à prévia da imagem; `quadro` dá a semente do granulado.
import React from 'react';
import {efeitosValidos, filtroCss, type Efeito} from '../../nucleo/efeitos';

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

/** Uma camada (vinheta, granulado ou tom) por cima do que já está montado. */
const Sobreposta: React.FC<{e: Efeito; quadro: number}> = ({e, quadro}) => {
  if (e.tipo === 'vinheta') {
    return <div style={{position: 'absolute', inset: 0, pointerEvents: 'none',
      background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${Math.min(1, e.valor)}) 100%)`}} />;
  }
  if (e.tipo === 'granulado') return <Granulado forca={e.valor} quadro={quadro} />;
  return <div style={{position: 'absolute', inset: 0, pointerEvents: 'none', background: e.cor ?? '#C88155', mixBlendMode: 'soft-light', opacity: e.valor}} />;
};

/** Os efeitos valem na ordem da pilha (tres-efeitos-D5): os filtros seguidos formam um grupo que se aplica a tudo o que já está
 *  montado, e cada camada (vinheta, granulado, tom) entra por cima do que veio antes e leva os filtros que vêm depois dela.
 *  Aplicar Quente e depois Preto e branco sai preto e branco, sem o cobre; a ordem inversa mantém o cobre.
 *  `largura` e `altura` (px do quadro) deixam o desfoque crescer a imagem o bastante para a borda borrada ficar fora do quadro, em
 *  vez de puxar a transparência para dentro e escurecer a moldura (tres-efeitos-D7). */
export const CamadaEfeitos: React.FC<{efeitos?: Efeito[]; quadro: number; children: React.ReactNode; largura?: number; altura?: number}> = ({efeitos, quadro, children, largura, altura}) => {
  const ativos = efeitosValidos(efeitos).filter((e) => e.ativo !== false);
  if (!ativos.some((e) => filtroCss([e]) || ['vinheta', 'granulado', 'tom'].includes(e.tipo))) return <>{children}</>;
  let no: React.ReactNode = children;
  let grupo: Efeito[] = [];
  const fecharGrupo = () => {
    const filtro = filtroCss(grupo);
    if (filtro) {
      // a borda borrada de um filtro de desfoque mostra a transparência que há fora do quadro: cresce a imagem em 4 sigmas
      const sigma = Math.max(0, ...grupo.filter((e) => e.tipo === 'desfoque').map((e) => e.valor));
      const lado = Math.min(largura ?? 0, altura ?? 0);
      const escala = sigma > 0 && lado > 0 ? 1 + (4 * sigma) / lado : 1;
      no = <div style={{position: 'absolute', inset: 0, overflow: 'hidden'}}><div style={{position: 'absolute', inset: 0, filter: filtro, transform: escala > 1 ? `scale(${escala})` : undefined}}>{no}</div></div>;
    }
    grupo = [];
  };
  for (const e of ativos) {
    if (['vinheta', 'granulado', 'tom'].includes(e.tipo)) {
      fecharGrupo();
      no = <div style={{position: 'absolute', inset: 0}}>{no}<Sobreposta e={e} quadro={quadro} /></div>;
    } else grupo.push(e);
  }
  fecharGrupo();
  return <>{no}</>;
};
