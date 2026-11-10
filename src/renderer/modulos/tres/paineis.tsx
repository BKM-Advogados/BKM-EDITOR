// Módulo 3D: o que a casca monta na área 3D (lista de objetos, monitor com Three.js e inspector). Carregado sob demanda
// pela casca, então o Three.js só entra na memória quando alguém abre a área.
import type {PaineisDoModulo} from '../../casca/contrato';
import {comLimiteDeErro} from '../../componentes/LimiteDeErro';
import {InspectorTres} from './InspectorTres';
import {ListaTres} from './ListaTres';
import {MonitorTres} from './MonitorTres';

// cada painel dentro do seu limite de erro (tres-efeitos-D12): se um valor do documento derrubar o desenho, o painel mostra o motivo
export const PaineisTres: PaineisDoModulo = comLimiteDeErro({tituloLista: 'Objetos', Lista: ListaTres, Monitor: MonitorTres, Inspector: InspectorTres}, '3D');
