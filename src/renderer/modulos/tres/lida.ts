// A cena 3D lida com validação (nucleo/cena3d.ts, lerCena3d) para os painéis do 3D: a lista, o monitor e o inspetor desenham
// a cena corrigida, e o inspetor mostra o que estava fora do lugar no documento, com o botão "Corrigir" (tres-efeitos-D12).
// Os caminhos /objetos/i e /luzes/i são os do documento (as listas mantêm a ordem e o tamanho).
import React from 'react';
import type {DocCena3D, OperacaoPatch} from '../../../nucleo/documentos';
import {lerCena3d, type CenaLida, type ProblemaCena3D} from '../../../nucleo/cena3d';
import {aplicar, useLoja} from '../../estado/loja';

/** A cena do documento, validada; undefined enquanto o documento não está carregado. */
export const useCena3d = (documento: string | undefined): CenaLida | undefined => {
  const bruto = useLoja((e) => (documento ? e.docs[documento]?.doc : undefined)) as unknown;
  return React.useMemo(() => (bruto ? lerCena3d(bruto) : undefined), [bruto]);
};

const valorNo = (doc: DocCena3D, caminho: string): unknown =>
  caminho.split('/').slice(1).reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), doc);

/** O patch que grava no documento o que a tela está usando no lugar de cada problema: troca o campo pelo valor corrigido, ou
 *  tira o campo opcional que não tem valor certo; um item inteiro que não era objeto é trocado pelo item corrigido. */
export const patchDeCorrecao = (lida: CenaLida, problemas: ProblemaCena3D[]): OperacaoPatch[] =>
  problemas.map((p): OperacaoPatch => {
    const inteiro = /^\/(objetos|luzes)\/\d+$/.test(p.caminho) || p.caminho === '/camera';
    if (inteiro) return {op: 'replace', path: p.caminho, value: valorNo(lida.doc, p.caminho)};
    return p.valor === undefined ? {op: 'remove', path: p.caminho} : {op: 'replace', path: p.caminho, value: p.valor};
  });

/** Grava a correção de uma lista de problemas (um patch, um Ctrl+Z desfaz). */
export const corrigirCena3d = (documento: string, lida: CenaLida, problemas: ProblemaCena3D[]) =>
  aplicar(documento, patchDeCorrecao(lida, problemas), `corrigir ${problemas.length} ${problemas.length === 1 ? 'campo' : 'campos'} da cena 3D`);
