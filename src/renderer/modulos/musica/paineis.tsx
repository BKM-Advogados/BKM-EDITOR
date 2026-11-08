// A área Música na casca: lista de canais e padrões, monitor (transporte, passos e mixer), propriedades e o arranjo
// na faixa de baixo. O painel do Claude (conversa e terminal) é o mesmo das outras áreas, e a IA vê a Música pelo
// estado_do_editor e pelas ferramentas de docs/musica.md.
import type {PaineisDoModulo} from '../../casca/contrato';
import {ArranjoMusica} from './Arranjo';
import {InspectorMusica, ListaMusica} from './Inspector';
import {MonitorMusica} from './Monitor';
import './musica.css';

export const PaineisMusica: PaineisDoModulo = {tituloLista: 'Canais', Lista: ListaMusica, Monitor: MonitorMusica, Inspector: InspectorMusica, Linha: ArranjoMusica};
