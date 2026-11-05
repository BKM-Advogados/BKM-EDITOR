// Ações do 3D usadas por mais de um painel (o monitor ouve o Delete; a lista não tem mais lixeira por linha).
import type {DocCena3D} from '../../../nucleo/documentos';
import {aplicar, loja, selecionar} from '../../estado/loja';
import {indiceEm, objetosDe} from './comum';

/** Exclui o objeto i (com teste do id, para não apagar outro se o agente mexeu na lista). Ctrl+Z desfaz. */
export const excluirObjeto = async (documento: string, i: number) => {
  const o = objetosDe(loja.get().docs[documento]?.doc as DocCena3D | undefined)[i];
  if (!o) return false;
  const sel = loja.get().selecao;
  if (sel?.documento === documento && indiceEm(sel.caminho, 'objetos') >= 0) selecionar(null); // os índices depois deste mudam
  return aplicar(documento, [{op: 'test', path: `/objetos/${i}/id`, value: o.id}, {op: 'remove', path: `/objetos/${i}`}], `excluir ${o.nome}`);
};
