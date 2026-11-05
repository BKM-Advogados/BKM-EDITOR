// Módulo 3D: o que a casca monta na área 3D (lista de objetos, monitor com Three.js e inspector). Carregado sob demanda
// pela casca, então o Three.js só entra na memória quando alguém abre a área.
import type {PaineisDoModulo} from '../../casca/contrato';
import {InspectorTres} from './InspectorTres';
import {ListaTres} from './ListaTres';
import {MonitorTres} from './MonitorTres';

export const PaineisTres: PaineisDoModulo = {tituloLista: 'Objetos', Lista: ListaTres, Monitor: MonitorTres, Inspector: InspectorTres};
