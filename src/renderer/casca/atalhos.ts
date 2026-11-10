// Atalhos de arquivo da casca (transversal-D4). Ctrl+O, Ctrl+N e Ctrl+W pertencem ao terminal quando ele está em foco:
// o Ctrl+W apaga uma palavra no Claude Code e o app fechava o projeto, matando conversas e terminais. Fora do terminal
// continuam valendo como sempre; o menu do projeto tem os mesmos três itens para quem estiver no terminal.

export type AcaoDeArquivo = 'abrir' | 'novo' | 'fechar';

export type TeclaApertada = {key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean};

const POR_TECLA = new Map<string, AcaoDeArquivo>([['o', 'abrir'], ['n', 'novo'], ['w', 'fechar']]);

/** A ação de arquivo da tecla, ou null se a tecla não é de arquivo ou o foco está no terminal. */
export const acaoDeArquivo = (t: TeclaApertada, noTerminal: boolean): AcaoDeArquivo | null => {
  if (noTerminal || !t.ctrlKey || t.altKey || t.shiftKey) return null;
  return POR_TECLA.get(t.key.toLowerCase()) ?? null;
};
