// Navegador de render (Chrome Headless Shell) de outro sistema, para empacotar o Windows ou o Mac a partir do Linux. O
// ensureBrowser do Remotion só baixa o do sistema em que roda; aqui se baixa o do alvo, do mesmo endereço que o Remotion
// usaria lá (getChromeDownloadUrl dele, na versão testada da 4.0.540), para a mesma pasta que o forge.config.ts copia
// para dentro do app (node_modules/.remotion/chrome-headless-shell/<plataforma>). Só o empacotamento usa: o app nunca
// importa este arquivo.
import {createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {ReadableStream as WebReadableStream} from 'node:stream/web';

/** O nome que o Remotion e o Chrome for Testing dão a cada sistema. */
export const plataformaDoNavegador = (platform: string, arch: string): string | null => {
  if (platform === 'win32') return arch === 'x64' ? 'win64' : null;
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-arm64' : arch === 'x64' ? 'mac-x64' : null;
  if (platform === 'linux') return arch === 'x64' ? 'linux64' : arch === 'arm64' ? 'linux-arm64' : null;
  return null;
};

/** Pastas do build do Chromium que vêm no zip do mac-arm64 da remotion.media e o navegador não usa (gen/ tem ~95 MB e
 *  4.500 arquivos do devtools; pyproto/ são protobufs do Python). Ficam fora do pacote: pesam e atrasam a assinatura. */
export const SOBRAS_DO_BUILD = ['gen', 'pyproto'];

/** Se um caminho dentro da pasta do navegador vai para o pacote. */
export const entraNoPacote = (pastaDoNavegador: string, arquivo: string) => {
  const rel = path.relative(pastaDoNavegador, arquivo).split(path.sep);
  // <plataforma>/chrome-headless-shell-<plataforma>/<primeira pasta>/...
  const primeira = rel[0]?.startsWith('chrome-headless-shell-') ? rel[1] : rel[0];
  return !SOBRAS_DO_BUILD.includes(primeira ?? '');
};

type InfoDoRemotion = {url: string; versao: string};

/** Endereço e versão que o Remotion instalado usaria no sistema-alvo. Lido do próprio @remotion/renderer (arquivo
 *  interno, fora do "exports"), para seguir junto quando ele subir de versão. */
const infoDoRemotion = (raiz: string, plataforma: string): InfoDoRemotion => {
  const arquivo = path.join(raiz, 'node_modules', '@remotion', 'renderer', 'dist', 'browser', 'get-chrome-download-url.js');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const m = require(arquivo) as {TESTED_VERSION: string; getChromeDownloadUrl: (o: {platform: string; version: null; chromeMode: 'headless-shell'}) => string};
  return {url: m.getChromeDownloadUrl({platform: plataforma, version: null, chromeMode: 'headless-shell'}), versao: m.TESTED_VERSION};
};

/** Baixa e descompacta o navegador do alvo em node_modules/.remotion/chrome-headless-shell/<plataforma>, se ainda não
 *  estiver lá na mesma versão. Devolve a pasta. */
export const baixarNavegadorAlvo = async (o: {platform: string; arch: string; raiz: string; avisar?: (t: string) => void}): Promise<string | null> => {
  const plataforma = plataformaDoNavegador(o.platform, o.arch);
  if (!plataforma) return null;
  const {url, versao} = infoDoRemotion(o.raiz, plataforma);
  const pasta = path.join(o.raiz, 'node_modules', '.remotion', 'chrome-headless-shell', plataforma);
  // marca própria: o VERSION da pasta de cima é do ensureBrowser do sistema atual e não pode ser trocado
  const marca = path.join(pasta, '.estudio-versao');
  const esperado = `${versao} ${url}`;
  if (existsSync(marca) && readFileSync(marca, 'utf-8').trim() === esperado) return pasta;
  o.avisar?.(`Baixando o navegador de render de ${plataforma}: ${url}`);
  const r = await fetch(url, {redirect: 'follow'});
  if (!r.ok || !r.body) throw new Error(`não deu para baixar o navegador de ${plataforma}: HTTP ${r.status}`);
  mkdirSync(path.dirname(pasta), {recursive: true});
  const zip = path.join(path.dirname(pasta), `${plataforma}.zip.parcial`);
  await pipeline(Readable.fromWeb(r.body as unknown as WebReadableStream), createWriteStream(zip));
  const temp = `${pasta}.novo`;
  rmSync(temp, {recursive: true, force: true});
  // o extract-zip (dependência do Electron Forge) guarda o modo dos arquivos: o executável do Mac sai executável
  const {default: extrair} = await import('extract-zip');
  await extrair(zip, {dir: temp});
  rmSync(zip, {force: true});
  rmSync(pasta, {recursive: true, force: true});
  renameSync(temp, pasta);
  writeFileSync(marca, `${esperado}\n`);
  return pasta;
};
