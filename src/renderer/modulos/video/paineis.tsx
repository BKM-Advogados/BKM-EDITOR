import type {PaineisDoModulo} from '../../casca/contrato';
import {comLimiteDeErro} from '../../componentes/LimiteDeErro';
import {CenasVideo} from './CenasVideo';
import {InspectorVideo} from './InspectorVideo';
import {LinhaDoTempo} from './LinhaDoTempo';
import {MonitorVideo} from './MonitorVideo';

// cada painel dentro do seu limite de erro (como Efeitos e 3D): um erro ao desenhar a linha do tempo, por exemplo,
// mostra o motivo no painel e a janela segue viva, em vez de derrubar a interface inteira
export const PaineisVideo: PaineisDoModulo = comLimiteDeErro({
  tituloLista: 'Cenas e blocos',
  Lista: CenasVideo,
  Monitor: () => <MonitorVideo />,
  Inspector: InspectorVideo,
  Linha: LinhaDoTempo,
}, 'Vídeo');
