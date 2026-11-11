// Ícones com um sentido só: o agente tem o dele (Sparkle, sempre em violeta) e Efeitos usa Blend, para não
// confundir os dois. A marca do Estúdio são dois quadros sobrepostos: a pessoa (azul) e o agente (violeta) no mesmo
// projeto. A casca e o painel do Claude podem importar daqui.
import React from 'react';
import {Blend, Sparkle} from 'lucide-react';

export const IconeAgente: React.FC<{className?: string}> = ({className}) => <Sparkle className={className} color="var(--agente)" aria-hidden />;

export const IconeEfeitos: React.FC<{className?: string}> = ({className}) => <Blend className={className} aria-hidden />;

export const IconeEstudio: React.FC<{tamanho?: number}> = ({tamanho = 16}) => (
  // a marca do app é neutra (um quadrado na cor do texto com o E): o azul é seleção e o violeta é o agente
  <svg width={tamanho} height={tamanho} viewBox="0 0 16 16" aria-hidden style={{flex: 'none'}}>
    <rect x="1" y="1" width="14" height="14" rx="4" fill="var(--texto)" />
    <path d="M5.5 4.5h5M5.5 8h4M5.5 11.5h5M5.5 4.5v7" fill="none" stroke="var(--fundo-0)" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
