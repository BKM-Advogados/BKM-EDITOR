// Atalhos de arquivo da casca (transversal-D4). Ctrl+O, Ctrl+N e Ctrl+W pertencem ao terminal quando ele está em foco:
// o Ctrl+W apaga uma palavra no Claude Code e o app fechava o projeto, matando conversas e terminais. Fora do terminal
// continuam valendo como sempre; o menu do projeto tem os mesmos três itens para quem estiver no terminal. No Mac o
// modificador é o Cmd (teclas.ts).
import {comando, EH_MAC} from '../teclas';

export type AcaoDeArquivo = 'abrir' | 'novo' | 'fechar';

export type TeclaApertada = {key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey?: boolean};

const POR_TECLA = new Map<string, AcaoDeArquivo>([['o', 'abrir'], ['n', 'novo'], ['w', 'fechar']]);

/** A ação de arquivo da tecla, ou null se a tecla não é de arquivo ou o foco está no terminal. */
export const acaoDeArquivo = (t: TeclaApertada, noTerminal: boolean, mac: boolean = EH_MAC): AcaoDeArquivo | null => {
  if (noTerminal || !comando(t, mac) || t.altKey || t.shiftKey) return null;
  return POR_TECLA.get(t.key.toLowerCase()) ?? null;
};
