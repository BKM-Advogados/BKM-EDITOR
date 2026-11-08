// IPC do painel de mídia (frente Casca, rodada 3): a lista de midia/ com os derivados sob o original e a marcação de tomadas.
// A regra é a de src/nucleo/midia*.ts, a mesma que a ferramenta `listar_midia` do MCP usa. Registrado no main.ts com uma linha.
import {CANAL} from '../compartilhado/api';
import type {EstadoDaTomada} from '../nucleo/midia';
import {indiceDaMidia, marcarMidia} from '../nucleo/midia-disco';
import type {Projeto} from '../nucleo/projeto';

type Lidar = <A extends unknown[], R>(canal: string, f: (...a: A) => R | Promise<R>) => void;

export const registrarIpcMidia = (lidar: Lidar, projeto: () => Projeto) => {
  lidar(CANAL.midia, () => indiceDaMidia(projeto()));
  // a pessoa marca pela interface: entra no diário como 'pessoa', e o Claude vê a mudança em listar_mudancas
  lidar(CANAL.midiaMarcar, (caminho: string, mudanca: {estado?: EstadoDaTomada | null; nota?: string}) =>
    marcarMidia(projeto(), caminho, {
      ...(mudanca.estado === null || mudanca.estado === 'boa' || mudanca.estado === 'descartada' ? {estado: mudanca.estado} : {}),
      ...(typeof mudanca.nota === 'string' ? {nota: mudanca.nota} : {}),
    }, {autor: 'pessoa', origem: 'interface'}));
};
