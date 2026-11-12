// Estado dos primeiros passos na interface. Dois fatos só o editor vê (a prévia tocou, uma exportação terminou bem):
// quem toca e quem exporta avisa aqui. O resto (mídia, texto, o Claude no diário) vem do estado do projeto. E o que já se
// marcou, com o "Não mostrar mais", mora nas preferências do app: o cartão da barra e as Preferências leem e gravam
// por aqui, para os dois verem a mesma coisa. A regra de cada passo fica em nucleo/primeiros-passos.ts.
import {useSyncExternalStore} from 'react';
import {normalizarPassos, type EstadoPassos} from '../../nucleo/primeiros-passos';

export type FatosDoEditor = {tocou: boolean; exportou: boolean};

let fatos: FatosDoEditor = {tocou: false, exportou: false};
let passos: EstadoPassos | null = null; // null: as preferências ainda não foram lidas
const ouvintes = new Set<() => void>();
const avisarOuvintes = () => ouvintes.forEach((f) => f());

const assinar = (f: () => void) => {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
};

/** Marca um fato do editor (vale para a sessão do app; o que se marca nos passos fica nas preferências). */
export const fatoDoEditor = (k: keyof FatosDoEditor) => {
  if (fatos[k]) return;
  fatos = {...fatos, [k]: true};
  avisarOuvintes();
};

export const useFatosDoEditor = (): FatosDoEditor => useSyncExternalStore(assinar, () => fatos);

/** Lê as preferências uma vez por sessão do app. */
export const carregarPassos = async () => {
  if (passos) return;
  try {
    const p = await window.estudio.preferencias();
    passos ??= normalizarPassos(p.primeiros_passos);
  } catch {
    passos ??= normalizarPassos(undefined);
  }
  avisarOuvintes();
};

/** Troca o estado e grava nas preferências. */
export const definirPassos = (e: EstadoPassos) => {
  passos = e;
  avisarOuvintes();
  void window.estudio.gravarPreferencias({primeiros_passos: e}).catch(() => undefined);
};

export const usePassos = (): EstadoPassos | null => useSyncExternalStore(assinar, () => passos);
