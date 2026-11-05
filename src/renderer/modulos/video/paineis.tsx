import type {PaineisDoModulo} from '../../casca/contrato';
import {CenasVideo} from './CenasVideo';
import {InspectorVideo} from './InspectorVideo';
import {LinhaDoTempo} from './LinhaDoTempo';
import {MonitorVideo} from './MonitorVideo';

export const PaineisVideo: PaineisDoModulo = {
  tituloLista: 'Cenas e blocos',
  Lista: CenasVideo,
  Monitor: () => <MonitorVideo />,
  Inspector: InspectorVideo,
  Linha: LinhaDoTempo,
};
