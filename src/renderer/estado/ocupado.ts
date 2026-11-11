// O que a tela está fazendo e segura o reinício para atualizar (docs/atualizacao.md): a gravação da narração, as
// exportações feitas pela tela (imagem, carrossel, música) e o documento sendo salvo. A exportação de vídeo o processo
// principal já conhece. Só manda ao processo principal quando muda.
import {useEffect} from 'react';
import type {OcupadoNaTela} from '../../compartilhado/atualizacao';
import {loja} from './loja';

type Tarefa = 'gravando_narracao' | 'exportando';
const contagem: Record<Tarefa, number> = {gravando_narracao: 0, exportando: 0};
let ultimo = '';

const contar = () => {
  const o: OcupadoNaTela = {gravando_narracao: contagem.gravando_narracao > 0, exportando: contagem.exportando > 0,
    salvando: loja.get().gravacao.estado === 'gravando'};
  const chave = JSON.stringify(o);
  if (chave === ultimo) return;
  ultimo = chave;
  window.estudio.atualizacao?.ocupado(o);
};

/** Marca a tarefa como em andamento; a função devolvida solta (uma vez só). */
export const ocupar = (t: Tarefa) => {
  contagem[t]++;
  contar();
  let solto = false;
  return () => {
    if (solto) return;
    solto = true;
    contagem[t] = Math.max(0, contagem[t] - 1);
    contar();
  };
};

/** Enquanto `ativo`, a tarefa segura o reinício. */
export const usarOcupado = (t: Tarefa, ativo: boolean) => useEffect(() => (ativo ? ocupar(t) : undefined), [t, ativo]);

/** Uma exportação feita pela tela, do começo ao fim. */
export const ocupadoDurante = async <T>(t: Tarefa, f: () => Promise<T>): Promise<T> => {
  const soltar = ocupar(t);
  try {
    return await f();
  } finally {
    soltar();
  }
};

/** O selo "Gravando…" (documento sendo salvo) também segura o reinício. */
export const vigiarGravacao = () => loja.assinar(contar);
