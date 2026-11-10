// Nomes de arquivo e de pasta que valem nos três sistemas (docs/portes.md). O Windows é o mais exigente: recusa
// <>:"/\|?* e os caracteres de controle, apaga ponto e espaço do fim e reserva CON, PRN, AUX, NUL, COM1–9 e LPT1–9 (também
// com extensão: "nul.txt" e "CON.srt" não podem existir). O Mac recusa ":" no Finder e "/" em todo lugar; o Linux, "/".

/** Nomes que o Windows reserva, com ou sem extensão (inclusive COM¹, COM², COM³). */
export const ehNomeReservado = (nome: string) => /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.[^.]*)*$/i.test(nome.trim().replace(/[. ]+$/, ''));

/** Caracteres que algum dos três sistemas recusa num nome. */
export const PROIBIDOS = /[<>:"/\\|?*\u0000-\u001f]/g;

/** O nome (sem pasta) limpo para qualquer sistema: proibidos trocados por `troca`, espaços juntos, até `max` letras, sem
 *  ponto ou espaço no fim, e um "_" na frente dos nomes reservados do Windows. Vazio vira `vazio`. */
export const nomeDeArquivo = (nome: string, o: {troca?: string; max?: number; vazio?: string} = {}) => {
  const troca = o.troca ?? '-';
  const limpo = nome
    .replace(PROIBIDOS, troca)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, o.max ?? 120)
    .replace(/[. ]+$/, '');
  if (!limpo) return o.vazio ?? 'sem nome';
  return ehNomeReservado(limpo) ? `_${limpo}` : limpo;
};
