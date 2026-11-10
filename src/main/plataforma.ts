// O que muda de um sistema para outro no processo principal, escrito sem o Electron para ter teste (docs/portes.md):
// a barra da janela, onde procurar programas (o PATH de um app aberto pelo Finder ou pelo menu Iniciar é curto), o
// shell do terminal, a pasta de projeto recebida por argumento e o pedido de microfone do Mac. Cada função recebe a
// plataforma e o ambiente, para o vitest conferir os três sistemas em qualquer um.
import path from 'node:path';

export type Plataforma = 'win32' | 'darwin' | 'linux' | (string & {});
type Ambiente = Record<string, string | undefined>;

// ---------- janela ----------

/** Linux com gerenciador em mosaico (Hyprland/Omarchy, Sway, i3...): as janelas vêm sem moldura nem minimizar. */
export const ehMosaico = (plataforma: Plataforma, env: Ambiente) =>
  plataforma === 'linux' && (!!env.HYPRLAND_INSTANCE_SIGNATURE || /hyprland|sway|i3|river|niri/i.test(env.XDG_CURRENT_DESKTOP ?? ''));

/** A barra de título própria em cada sistema. A casca desenha nome, áreas e ações; os botões da janela são os do
 *  sistema, por cima (titleBarOverlay): no Windows e no Linux à direita, no Mac os três "semáforos" à esquerda, que a
 *  casca contorna pelas variáveis CSS env(titlebar-area-x) da Window Controls Overlay. No mosaico não há botões. */
export const opcoesDaBarra = (plataforma: Plataforma, mosaico: boolean) => {
  if (plataforma === 'darwin') {
    // semáforos no meio da barra de 36 px (botões de 14 px)
    return {titleBarStyle: 'hidden' as const, titleBarOverlay: true, trafficLightPosition: {x: 14, y: 11}};
  }
  if (mosaico) return {titleBarStyle: 'hidden' as const};
  return {titleBarStyle: 'hidden' as const, titleBarOverlay: {color: '#0f0f0f', symbolColor: '#b4b4b4', height: 36}};
};

// ---------- PATH ----------

/** Pastas onde o Claude Code, o Homebrew, o npm e o whisper-cli costumam ficar, e que faltam no PATH de um app aberto
 *  pelo Finder (só /usr/bin:/bin:/usr/sbin:/sbin), pelo menu Iniciar ou pelo lançador do Linux. */
export const pastasExtrasDoPath = (plataforma: Plataforma, home: string, env: Ambiente = {}): string[] => {
  if (plataforma === 'win32') {
    const w = path.win32;
    return [
      w.join(home, '.local', 'bin'), // instalador oficial do Claude Code (claude.exe)
      ...(env.APPDATA ? [w.join(env.APPDATA, 'npm')] : []), // npm install -g (claude.cmd)
    ];
  }
  const p = path.posix;
  const comuns = [p.join(home, '.local', 'bin'), p.join(home, '.claude', 'local')];
  if (plataforma === 'darwin') return [...comuns, '/opt/homebrew/bin', '/usr/local/bin', p.join(home, '.npm-global', 'bin')];
  return comuns;
};

/** O PATH com as pastas extras no fim (as da pessoa vêm antes), sem repetir. */
export const caminhoDeBusca = (o: {plataforma: Plataforma; PATH?: string; home: string; env?: Ambiente}) => {
  const sep = o.plataforma === 'win32' ? ';' : ':';
  const igual = (a: string, b: string) => (o.plataforma === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  const lista: string[] = [];
  for (const d of [...(o.PATH ?? '').split(sep), ...pastasExtrasDoPath(o.plataforma, o.home, o.env)]) {
    if (d && !lista.some((x) => igual(x, d))) lista.push(d);
  }
  return lista.join(sep);
};

/** O ambiente com o PATH trocado. No Windows a chave costuma ser "Path": somar um "PATH" ao lado dela deixava duas, e o
 *  processo filho (o PowerShell do terminal) lia a antiga. */
export const comPath = (env: Ambiente, valor: string, plataforma: Plataforma): Record<string, string> => {
  const saida: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    if (plataforma === 'win32' ? k.toUpperCase() === 'PATH' : k === 'PATH') continue;
    saida[k] = v;
  }
  saida.PATH = valor;
  return saida;
};

// ---------- terminal ----------

/** O shell da aba de terminal: PowerShell no Windows (vem em todo Windows 10 e 11); no Mac e no Linux o da conta da
 *  pessoa (zsh no Mac desde o Catalina), como shell de login para ler o perfil dela. */
export const shellPadrao = (plataforma: Plataforma, env: Ambiente, shellDaConta?: string | null): {arquivo: string; args: string[]} => {
  if (plataforma === 'win32') return {arquivo: 'powershell.exe', args: ['-NoLogo']};
  const arquivo = env.SHELL || shellDaConta || (plataforma === 'darwin' ? '/bin/zsh' : '/bin/sh');
  return {arquivo, args: ['-l']};
};

/** O nome do shell para a interface. */
export const nomeDoShell = (plataforma: Plataforma, arquivo: string) =>
  plataforma === 'win32' ? 'PowerShell' : path.posix.basename(arquivo) || 'shell';

// ---------- abrir projeto por argumento ----------

/** A pasta de projeto passada na linha de comando ("Abrir com", atalho com a pasta, segunda abertura do app): o primeiro
 *  argumento que não é opção e é uma pasta com estudio.json. No desenvolvimento o argv traz o caminho do app ("."),
 *  que não tem estudio.json e fica de fora pela mesma regra. */
export const projetoNosArgumentos = (argv: readonly string[], existe: (arquivo: string) => boolean, cwd?: string): string | null => {
  for (const a of argv.slice(1)) {
    if (!a || a.startsWith('-')) continue;
    const pasta = cwd ? path.resolve(cwd, a) : a;
    if (existe(path.join(pasta, 'estudio.json'))) return pasta;
  }
  return null;
};

// ---------- microfone ----------

export type AcessoAoMicrofone = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';

/** O que fazer com um pedido de permissão do renderer. Só o microfone no Mac passa pelo sistema (o macOS pergunta uma
 *  vez e lembra em Ajustes › Privacidade › Microfone); o resto segue liberado, como era no padrão do Electron. */
export const decidirPermissao = (plataforma: Plataforma, permissao: string, tiposDeMidia: readonly string[] = []):
  'permitir' | 'perguntar_ao_mac' => (plataforma === 'darwin' && permissao === 'media' && tiposDeMidia.includes('audio') ? 'perguntar_ao_mac' : 'permitir');

// ---------- git ----------

/** No Mac, /usr/bin/git é um atalho das ferramentas de linha de comando do Xcode: sem elas, chamar o git abre o
 *  instalador da Apple na cara da pessoa. Só se chama o git quando há um de verdade: o do Homebrew ou o das ferramentas
 *  já instaladas (xcode-select -p responde). */
export const gitDoMac = (existe: (arquivo: string) => boolean, ferramentasDoXcode: boolean): string | null => {
  for (const g of ['/opt/homebrew/bin/git', '/usr/local/bin/git']) if (existe(g)) return g;
  return ferramentasDoXcode ? '/usr/bin/git' : null;
};
