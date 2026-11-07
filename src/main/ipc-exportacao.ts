// Preferências da exportação por projeto: a marca d'água de cada destino (ligada, logo ou assinatura, canto, tamanho e
// opacidade) que o diálogo lembra de uma exportação para a outra. Ficam em .estudio/exportacao.json, dentro do projeto,
// para quem abrir a mesma pasta achar a mesma escolha (e fora do relógio do ponto de restauração, como o resto de
// .estudio/). Arquivo ausente ou estragado é preferência vazia: o diálogo volta aos padrões. Registrado no main.ts com
// uma linha; sem Electron aqui, os testes chamam `lerPrefsExportacao` e `gravarPrefsExportacao` direto.
import path from 'node:path';
import {CANAL} from '../compartilhado/api';
import {normalizarPrefsExportacao, type PrefsExportacao} from '../nucleo/exportacao';
import {PASTA_INTERNA, serializar, type Projeto} from '../nucleo/projeto';

export const ARQUIVO_PREFS_EXPORTACAO = path.join(PASTA_INTERNA, 'exportacao.json');

export const lerPrefsExportacao = (p: Projeto): PrefsExportacao => {
  try {
    return p.existe(ARQUIVO_PREFS_EXPORTACAO) ? normalizarPrefsExportacao(p.lerJson<unknown>(ARQUIVO_PREFS_EXPORTACAO).doc) : {};
  } catch {
    return {};
  }
};

/** Junta a mudança ao que já estava (por destino) e grava; devolve o arquivo inteiro como ficou. */
export const gravarPrefsExportacao = (p: Projeto, mudanca: PrefsExportacao): PrefsExportacao => {
  const atual = lerPrefsExportacao(p);
  const novo = normalizarPrefsExportacao({...atual, marca_dagua: {...atual.marca_dagua, ...normalizarPrefsExportacao(mudanca).marca_dagua}});
  p.gravarTexto(ARQUIVO_PREFS_EXPORTACAO, serializar(novo));
  return novo;
};

type Lidar = <A extends unknown[], R>(canal: string, f: (...a: A) => R | Promise<R>) => void;

export const registrarPrefsExportacao = (lidar: Lidar, projeto: () => Projeto) => {
  lidar(CANAL.prefsExportacao, () => lerPrefsExportacao(projeto()));
  lidar(CANAL.gravarPrefsExportacao, (mudanca: PrefsExportacao) => gravarPrefsExportacao(projeto(), mudanca));
};
