// Onde o safeStorage guarda a chave de cifra no Linux. O Chromium só escolhe sozinho o chaveiro nos ambientes que
// conhece (GNOME, KDE, XFCE...): no Hyprland, Sway, i3 e afins ele cai em "basic_text" mesmo com o gnome-keyring
// rodando, e então o safeStorage diz que não há cifra. Sem o chaveiro o app não grava chave nenhuma em disco (a chave
// vale só na sessão): ver cofre-arquivo.ts. Aqui só se escolhe o chaveiro; se ele não existir, nada é fingido.

/** Valor do switch `--password-store` para o Linux, ou undefined quando o Chromium decide bem sozinho (KDE) ou a pessoa já escolheu. */
export const lojaDeSenhasLinux = (env: NodeJS.ProcessEnv, argv: readonly string[]): 'gnome-libsecret' | undefined => {
  if (argv.some((a) => a.startsWith('--password-store'))) return undefined;
  if (/kde|plasma/i.test(env.XDG_CURRENT_DESKTOP ?? '')) return undefined;
  return 'gnome-libsecret'; // o serviço Secret Service (gnome-keyring, KeePassXC, kwallet 6 com a ponte) responde por D-Bus
};

/** O que dizer à pessoa sobre a cifra das chaves: onde ficam e, quando não ficam, por quê. */
export const textoDoCofre = (o: {persistente: boolean; plataforma: NodeJS.Platform; loja?: string}): string => {
  if (o.persistente) {
    if (o.plataforma === 'win32') return 'guardada cifrada neste PC, na sua conta do Windows';
    if (o.plataforma === 'darwin') return 'guardada cifrada no Keychain deste Mac';
    return `guardada cifrada pelo chaveiro do sistema${o.loja ? ` (${o.loja})` : ''}`;
  }
  if (o.plataforma === 'win32') return 'válida só enquanto o app estiver aberto (o Windows não ofereceu a cifra)';
  if (o.plataforma === 'linux') {
    return 'válida só enquanto o app estiver aberto: não há chaveiro ativo (gnome-keyring, KWallet ou KeePassXC) e o app não grava chave sem cifra';
  }
  return 'válida só enquanto o app estiver aberto (o sistema não ofereceu a cifra)';
};
