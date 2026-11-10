// DMG do Mac: empacota com o Electron Forge (Estudio.app, assinado e notarizado se houver as variáveis da Apple; ver
// build/mac.ts) e monta o DMG com o electron-builder. Só roda num Mac: o DMG sai do hdiutil da Apple.
//   npm run instalador:mac             a arquitetura deste Mac
//   npm run instalador:mac -- x64      a outra (num Mac Apple Silicon, o x64 também sai)
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';

if (process.platform !== 'darwin') {
  console.error('O DMG só sai num Mac (hdiutil). Daqui dá para gerar o .zip com o Estudio.app: npm run pacote:mac (docs/portes.md).');
  process.exit(1);
}
const arch = process.argv[2] ?? process.arch;
if (!['arm64', 'x64'].includes(arch)) {
  console.error(`arquitetura desconhecida: ${arch} (arm64 ou x64)`);
  process.exit(1);
}
const rodar = (cmd, args) => execFileSync(cmd, args, {stdio: 'inherit', env: {...process.env, ELECTRON_RUN_AS_NODE: ''}});
rodar('npm', ['run', 'mcp:build']);
rodar('npx', ['electron-forge', 'package', '--platform', 'darwin', '--arch', arch]);
const app = `out/pacote/Estudio-darwin-${arch}/Estudio.app`;
if (!existsSync(app)) throw new Error(`o Forge não gerou ${app}`);
rodar('npx', ['electron-builder', '--prepackaged', app, '--mac', 'dmg', `--${arch}`, '--publish', 'never']);
