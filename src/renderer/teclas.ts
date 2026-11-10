// Atalhos nos três sistemas (docs/portes.md). No Windows e no Linux o modificador dos atalhos é o Ctrl; no Mac é o
// Cmd (⌘), e o Ctrl fica para o terminal (Ctrl+C, Ctrl+W apagando palavra...). A tecla "delete" do teclado do Mac é o
// Backspace: lá ela também apaga a seleção. Os rótulos dos menus seguem o sistema (Ctrl+N vira ⌘N).

/** Se a interface roda num Mac. */
export const EH_MAC = typeof navigator !== 'undefined'
  && /^mac/i.test((navigator as {userAgentData?: {platform?: string}}).userAgentData?.platform || navigator.platform || '');

type Modificadores = {ctrlKey: boolean; metaKey?: boolean};

/** O modificador de atalho do sistema está apertado: Cmd no Mac, Ctrl nos outros. */
export const comando = (e: Modificadores, mac: boolean = EH_MAC) => (mac ? Boolean(e.metaKey) : e.ctrlKey);

/** Algum modificador que tira a tecla do atalho de uma letra só (M comenta, V seleciona...): Ctrl, Cmd ou Alt. */
export const comModificador = (e: Modificadores & {altKey: boolean}) => e.ctrlKey || Boolean(e.metaKey) || e.altKey;

/** A tecla que apaga a seleção: Delete, e no Mac também o Backspace (a tecla "delete" do teclado dele). */
export const teclaDeApagar = (e: {key: string}, mac: boolean = EH_MAC) => e.key === 'Delete' || (mac && e.key === 'Backspace');

/** O rótulo do atalho no sistema: "Ctrl+Shift+E" vira "⇧⌘E" no Mac (a ordem da Apple: ⌃ ⌥ ⇧ ⌘). */
export const rotuloDoAtalho = (texto: string, mac: boolean = EH_MAC) => {
  if (!mac) return texto;
  return texto.replace(/((?:Ctrl|Alt|Shift)\+)+/g, (m) => `${m.includes('Alt+') ? '⌥' : ''}${m.includes('Shift+') ? '⇧' : ''}${m.includes('Ctrl+') ? '⌘' : ''}`)
    .replace(/\bDelete\b/g, '⌫');
};
