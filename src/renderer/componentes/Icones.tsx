// Ícones com um sentido só: o agente tem o dele (Sparkle, sempre em violeta) e Efeitos usa Blend, para não
// confundir os dois. A marca do Estúdio são dois quadros sobrepostos: a pessoa (azul) e o agente (violeta) no mesmo
// projeto. A casca e o painel do Claude podem importar daqui.
import React from 'react';
import {Blend, Sparkle} from 'lucide-react';

export const IconeAgente: React.FC<{className?: string}> = ({className}) => <Sparkle className={className} color="var(--agente)" aria-hidden />;

export const IconeEfeitos: React.FC<{className?: string}> = ({className}) => <Blend className={className} aria-hidden />;

export const IconeEstudio: React.FC<{tamanho?: number}> = ({tamanho = 16}) => (
  <svg width={tamanho} height={tamanho} viewBox="0 0 16 16" aria-hidden style={{flex: 'none'}}>
    <rect x="1.5" y="1.5" width="9" height="9" rx="2" fill="none" stroke="var(--acento)" strokeWidth="1.5" />
    <rect x="5.5" y="5.5" width="9" height="9" rx="2" fill="none" stroke="var(--agente)" strokeWidth="1.5" />
  </svg>
);
