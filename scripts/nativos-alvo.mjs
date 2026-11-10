// Empacotar para outro sistema (Windows ou Mac a partir do Linux, por exemplo): o npm só instala os binários nativos do
// sistema em que roda, e o pacote do app precisa dos do sistema-alvo. Este script baixa, na versão e com a integridade
// presas no package-lock.json, o compositor do Remotion (render e ffmpeg) e o node-pty (terminais) do alvo, e os
// descompacta em node_modules, ao lado dos do sistema atual. Não mexe no package.json nem no lock.
//   node scripts/nativos-alvo.mjs win32 x64
//   node scripts/nativos-alvo.mjs darwin arm64
// No CI cada sistema empacota a si mesmo e não precisa disto (o npm ci já traz os nativos certos).
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [plataforma, arq] = process.argv.slice(2);
const ALVOS = {'win32 x64': '@remotion/compositor-win32-x64-msvc', 'darwin arm64': '@remotion/compositor-darwin-arm64',
  'darwin x64': '@remotion/compositor-darwin-x64', 'linux x64': '@remotion/compositor-linux-x64-gnu'};
const compositor = ALVOS[`${plataforma} ${arq}`];
if (!compositor) {
  console.error(`Uso: node scripts/nativos-alvo.mjs <win32 x64 | darwin arm64 | darwin x64 | linux x64>`);
  process.exit(1);
}

const lock = JSON.parse(readFileSync(path.join(raiz, 'package-lock.json'), 'utf-8')).packages;
const pacotes = [compositor, `@lydell/node-pty-${plataforma}-${arq}`];
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// a pasta temporária fica dentro de node_modules: o /tmp pode ser outro disco, e o rename entre discos falha
mkdirSync(path.join(raiz, 'node_modules'), {recursive: true});
const temp = mkdtempSync(path.join(raiz, 'node_modules', '.estudio-nativos-'));
try {
  for (const nome of pacotes) {
    const entrada = lock[`node_modules/${nome}`];
    if (!entrada) throw new Error(`${nome} não está no package-lock.json`);
    const destino = path.join(raiz, 'node_modules', nome);
    const atual = path.join(destino, 'package.json');
    if (existsSync(atual) && JSON.parse(readFileSync(atual, 'utf-8')).version === entrada.version) {
      console.log(`${nome}@${entrada.version}: já está em node_modules`);
      continue;
    }
    const [info] = JSON.parse(execFileSync(npm, ['pack', `${nome}@${entrada.version}`, '--json', '--pack-destination', temp], {encoding: 'utf-8'}));
    const tgz = path.join(temp, info.filename);
    // a mesma conferência do npm ci: o sha512 do .tgz contra o "integrity" do lock
    const [algoritmo, esperado] = entrada.integrity.split('-');
    const obtido = createHash(algoritmo).update(readFileSync(tgz)).digest('base64');
    if (obtido !== esperado) throw new Error(`${nome}: a integridade não confere com o package-lock.json`);
    const pasta = path.join(temp, nome.replace(/[@/]/g, '_'));
    mkdirSync(pasta, {recursive: true});
    execFileSync('tar', ['-xzf', tgz, '-C', pasta]);
    rmSync(destino, {recursive: true, force: true});
    mkdirSync(path.dirname(destino), {recursive: true});
    renameSync(path.join(pasta, 'package'), destino);
    console.log(`${nome}@${entrada.version}: instalado para ${plataforma}-${arq}`);
  }
} finally {
  rmSync(temp, {recursive: true, force: true});
}
