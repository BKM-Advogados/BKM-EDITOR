// Qual git o app usa (pontos de restauração do projeto). Achado uma vez, no começo: no Windows e no Linux é o "git" do
// PATH; no Mac é preciso cuidado, porque /usr/bin/git sem as ferramentas de linha de comando do Xcode abre o instalador
// da Apple em vez de responder (gitDoMac, plataforma.ts). Sem git, o projeto segue só com o diário.
import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {gitDoMac, type Plataforma} from './plataforma';

const responde = (exe: string, args: string[]) =>
  new Promise<boolean>((ok) => execFile(exe, args, {windowsHide: true, timeout: 15_000}, (e) => ok(!e)));

/** O executável do git que funciona nesta máquina, ou null. */
export const acharGit = async (plataforma: Plataforma = process.platform): Promise<string | null> => {
  const candidato = plataforma === 'darwin' ? gitDoMac(existsSync, await responde('xcode-select', ['-p'])) : 'git';
  return candidato && (await responde(candidato, ['--version'])) ? candidato : null;
};

let achado: Promise<string | null> | null = null;

/** O git do app: procurado na primeira chamada e lembrado. */
export const gitDoApp = () => (achado ??= acharGit());
