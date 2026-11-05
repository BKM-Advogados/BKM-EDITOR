// Módulo de imagem: lista de camadas, monitor com a prévia em DOM (e a exportação em PNG) e o inspector da camada ou
// do documento. Sem linha do tempo: o terminal ocupa a faixa de baixo.
import type {PaineisDoModulo} from '../../casca/contrato';
import {CamadasImagem} from './CamadasImagem';
import {InspectorImagem} from './InspectorImagem';
import {MonitorImagem} from './MonitorImagem';

export const PaineisImagem: PaineisDoModulo = {
  tituloLista: 'Camadas',
  Lista: CamadasImagem,
  Monitor: () => <MonitorImagem />,
  Inspector: InspectorImagem,
};
