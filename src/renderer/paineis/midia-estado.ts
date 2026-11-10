// Estado do painel de mídia (frente Casca, rodada 3): a lista de midia/ vinda do processo principal e as marcas das tomadas.
// Fica fora do estado geral da interface (loja.ts) de propósito: é só deste painel, e a seleção múltipla da frente Imagem
// mexe no `Estado` de lá. O painel relê a lista quando um arquivo de midia/ muda no disco (a pessoa traz um arquivo, o Claude
// grava uma tomada, a limpeza de voz acaba) e depois de cada marcação.
import {useSyncExternalStore} from 'react';
import type {EstadoDaTomada, IndiceDaMidia} from '../../nucleo/midia';
import {avisar, loja, mensagemDe} from '../estado/loja';

type EstadoMidia = {indice: IndiceDaMidia | null; erro?: string};

let estado: EstadoMidia = {indice: null};
const ouvintes = new Set<() => void>();
const definir = (p: Partial<EstadoMidia>) => {
  estado = {...estado, ...p};
  ouvintes.forEach((f) => f());
};
const assinar = (f: () => void) => {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
};

/** Lê uma parte do estado; o seletor devolve valores estáveis (o índice, o erro), como em useLoja. */
export const useMidia = <T,>(sel: (e: EstadoMidia) => T): T => useSyncExternalStore(assinar, () => sel(estado));

let corrida = 0;
export const carregarMidia = async () => {
  const raiz = loja.get().info?.raiz;
  if (!raiz) return definir({indice: null, erro: undefined});
  const minha = ++corrida;
  try {
    const indice = await window.estudio.midia.indice();
    // a resposta é do projeto anterior, ou de uma leitura que já foi superada: descarta
    if (minha === corrida && loja.get().info?.raiz === raiz) definir({indice, erro: undefined});
  } catch (e) {
    if (minha === corrida && loja.get().info?.raiz === raiz) definir({erro: mensagemDe(e)});
  }
};

let relogio: ReturnType<typeof setTimeout> | undefined;
/** Muitos arquivos mudando em sequência (copiar uma pasta) viram uma leitura só. */
export const recarregarMidiaEmBreve = () => {
  clearTimeout(relogio);
  relogio = setTimeout(() => void carregarMidia(), 250);
};

export const marcarTomada = async (caminho: string, mudanca: {estado?: EstadoDaTomada | null; nota?: string}) => {
  try {
    await window.estudio.midia.marcar(caminho, mudanca);
    await carregarMidia();
  } catch (e) {
    avisar(mensagemDe(e), 'erro');
  }
};

/** Endereço do arquivo no servidor de mídia do app (o mesmo que a prévia e a imagem usam). */
export const urlDoArquivo = (caminho: string): string =>
  `${loja.get().info?.base_midia ?? ''}/${caminho.split(/[\\/]/).filter(Boolean).map(encodeURIComponent).join('/')}`;
