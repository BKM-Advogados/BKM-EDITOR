// Código de tempo que acompanha a reprodução sem re-renderizar ninguém: assina o quadro e escreve no DOM pelo ref
// (desempenho.md §4.2). Clicar alterna entre código de tempo, quadros e segundos.
import React, {useEffect, useRef} from 'react';
import {loja} from '../../estado/loja';
import {aoQuadro, FPS, formatarTempo, msAtual} from './tocador';

type Formato = 'tc' | 'quadros' | 'segundos';
let formato: Formato = 'tc';
const ouvintes = new Set<() => void>();

const escrever = (ms: number) => {
  if (formato === 'quadros') return `${Math.round((ms / 1000) * FPS)} q`;
  if (formato === 'segundos') return `${(ms / 1000).toFixed(2).replace('.', ',')} s`;
  return formatarTempo(ms);
};

export const Tempo: React.FC<{className?: string}> = ({className}) => {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let ultimo = loja.get().tempo_ms;
    const pintar = (ms: number) => {
      if (ref.current) ref.current.textContent = escrever(ms);
    };
    pintar(msAtual());
    const sairQuadro = aoQuadro(pintar);
    const sairLoja = loja.assinar(() => {
      const t = loja.get().tempo_ms;
      if (t !== ultimo) pintar((ultimo = t));
    });
    const repintar = () => pintar(msAtual());
    ouvintes.add(repintar);
    return () => {
      sairQuadro();
      sairLoja();
      ouvintes.delete(repintar);
    };
  }, []);
  return (
    <span ref={ref} className={className} title="Clique para alternar: código de tempo, quadros, segundos"
      onClick={() => {
        formato = formato === 'tc' ? 'quadros' : formato === 'quadros' ? 'segundos' : 'tc';
        ouvintes.forEach((f) => f());
      }} />
  );
};
