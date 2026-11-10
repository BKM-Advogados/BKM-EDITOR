// Módulo de imagem: lista de camadas, monitor com a prévia em DOM (e a exportação em PNG) e o inspector da camada ou
// do documento. Sem linha do tempo: o terminal ocupa a faixa de baixo.
import type {PaineisDoModulo} from '../../casca/contrato';
import {comLimiteDeErro} from '../../componentes/LimiteDeErro';
import {CamadasImagem} from './CamadasImagem';
import {InspectorImagem} from './InspectorImagem';
import {MonitorImagem} from './MonitorImagem';

// cada painel dentro do seu limite de erro: um erro ao desenhar um painel mostra o motivo nele e a janela segue viva
export const PaineisImagem: PaineisDoModulo = comLimiteDeErro({
  tituloLista: 'Camadas',
  Lista: CamadasImagem,
  Monitor: () => <MonitorImagem />,
  Inspector: InspectorImagem,
}, 'Imagem');
