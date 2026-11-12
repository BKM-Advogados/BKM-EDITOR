// IPC dos modelos da pessoa (Salvar como modelo): a pasta modelos/ das preferências (listar, salvar o projeto aberto ou
// um documento, renomear, remover). Criar um projeto a partir do modelo fica no main.ts, que abre o projeto. Também
// aponta o MCP (salvar_como_modelo) para a mesma pasta.
import {CANAL} from '../compartilhado/api';
import {definirPastaModelos, PastaModelos} from '../nucleo/pasta-modelos';
import type {Projeto} from '../nucleo/projeto';
import type {Memoria} from './memoria';

type Lidar = <A extends unknown[], R>(canal: string, f: (...a: A) => R | Promise<R>) => void;

export const registrarIpcModelos = (o: {lidar: Lidar; memoria: Memoria; exigirProjeto: () => Projeto}) => {
  const pasta = () => o.memoria.prefs().pasta_modelos;
  const modelos = new PastaModelos({pasta});
  definirPastaModelos(pasta);
  o.lidar(CANAL.modelosListar, () => modelos.listar());
  o.lidar(CANAL.modelosSalvar, (p: {nome: string; descricao?: string; documento?: string}) => {
    const projeto = o.exigirProjeto();
    return projeto.comTrava(() => modelos.salvar(projeto, p)); // ninguém grava no meio da cópia
  });
  o.lidar(CANAL.modelosRenomear, (id: string, nome: string) => modelos.renomear(id, nome));
  o.lidar(CANAL.modelosRemover, (id: string) => modelos.remover(id));
  return modelos;
};
