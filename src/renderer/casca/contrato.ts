// O que cada módulo entrega à casca. As posições são as mesmas em todas as áreas (lista à esquerda, monitor no centro,
// inspector à direita, linha do tempo embaixo quando houver), para a mão não ter de reaprender o lugar das coisas.
import type React from 'react';

export type PaineisDoModulo = {
  tituloLista: string;
  Lista: React.FC;
  Monitor: React.FC;
  Inspector: React.FC;
  Linha?: React.FC; // linha do tempo; sem ela, o terminal ocupa a faixa de baixo
};
