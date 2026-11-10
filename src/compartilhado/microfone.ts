// O microfone negado pelo sistema (gravação de narração): o que dizer e onde liberar, em cada sistema (docs/portes.md).
// Compartilhado porque quem vê a recusa é a janela (getUserMedia) e quem sabe o sistema pode ser qualquer lado.

export type SistemaDoMicrofone = 'win32' | 'darwin' | 'linux' | (string & {});

/** O sistema pela plataforma do navegador da janela ("MacIntel", "Win32", "Linux x86_64"). */
export const sistemaDoNavegador = (plataforma: string): SistemaDoMicrofone => (/^mac/i.test(plataforma) ? 'darwin' : /^win/i.test(plataforma) ? 'win32' : 'linux');

/** Se o erro do getUserMedia é recusa de permissão (e não microfone ausente ou ocupado). */
export const ehRecusaDoMicrofone = (e: unknown) => ['NotAllowedError', 'SecurityError', 'PermissionDeniedError'].includes((e as {name?: string})?.name ?? '');

/** O que dizer quando o microfone foi negado, com o caminho para liberar em cada sistema. */
export const avisoDoMicrofone = (sistema: SistemaDoMicrofone) => {
  if (sistema === 'darwin') return 'O macOS não liberou o microfone para o Estúdio. Libere em Ajustes do Sistema › Privacidade e Segurança › Microfone e grave de novo.';
  if (sistema === 'win32') return 'O Windows não liberou o microfone. Libere em Configurações › Privacidade e segurança › Microfone ("Permitir que aplicativos da área de trabalho acessem o microfone") e grave de novo.';
  return 'O sistema não liberou o microfone: confira se ele está conectado e se o PipeWire ou o PulseAudio o enxerga.';
};
