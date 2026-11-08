// Preferências da exportação por projeto: a marca d'água de cada destino (ligada, logo ou assinatura, canto, tamanho e
// opacidade) que o diálogo lembra de uma exportação para a outra. Ficam em .estudio/exportacao.json, dentro do projeto,
// para quem abrir a mesma pasta achar a mesma escolha (e fora do relógio do ponto de restauração, como o resto de
// .estudio/). Arquivo ausente ou estragado é preferência vazia: o diálogo volta aos padrões. Registrado no main.ts com
// uma linha; sem Electron aqui, os testes chamam `lerPrefsExportacao` e `gravarPrefsExportacao` direto.
import {CANAL} from '../compartilhado/api';
import type {Projeto} from '../nucleo/projeto';
import type {PrefsExportacao} from '../nucleo/exportacao';
import {ARQUIVO_PREFS_EXPORTACAO, gravarPrefsExportacao, lerPrefsExportacao} from '../nucleo/prefs-exportacao';

// a leitura e a gravação moram em src/nucleo/prefs-exportacao.ts (o MCP usa as mesmas); aqui continuam acessíveis para quem já
// importava daqui
export {ARQUIVO_PREFS_EXPORTACAO, gravarPrefsExportacao, lerPrefsExportacao};

type Lidar = <A extends unknown[], R>(canal: string, f: (...a: A) => R | Promise<R>) => void;

export const registrarPrefsExportacao = (lidar: Lidar, projeto: () => Projeto) => {
  lidar(CANAL.prefsExportacao, () => lerPrefsExportacao(projeto()));
  lidar(CANAL.gravarPrefsExportacao, (mudanca: PrefsExportacao) => gravarPrefsExportacao(projeto(), mudanca));
};
