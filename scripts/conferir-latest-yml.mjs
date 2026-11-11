// Confere o latest.yml do instalador do Windows (docs/atualizacao.md): é por ele que o electron-updater do app acha a
// versão nova. Versão, nome do Setup .exe e sha512 têm de bater com o instalador ao lado, e o .blockmap tem de existir.
//   node scripts/conferir-latest-yml.mjs out/instalador [versão]
// O CI do Windows roda depois do electron-builder; scripts/publicar-release.mjs roda antes de publicar.
import {createHash} from 'node:crypto';
import {createReadStream, existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

/** Os campos de primeiro nível do latest.yml (version, path, sha512, releaseDate); os de files: ficam de fora. */
export const camposDoLatest = (texto) => {
  const campos = {};
  for (const linha of texto.split(/\r?\n/)) {
    const m = /^([A-Za-z][A-Za-z0-9]*):\s*(.*?)\s*$/.exec(linha);
    if (m && m[2] !== '') campos[m[1]] = m[2].replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
  }
  return campos;
};

/** sha512 em base64, como o electron-builder grava e o electron-updater confere. */
export const sha512Base64 = (arquivo) => new Promise((ok, falha) => {
  const h = createHash('sha512');
  createReadStream(arquivo).on('error', falha).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('base64')));
});

/** Lança com o motivo se o latest.yml de `pasta` não serve; devolve os nomes conferidos. */
export const conferirLatest = async (pasta, versao) => {
  const yml = path.join(pasta, 'latest.yml');
  if (!existsSync(yml)) throw new Error(`falta o latest.yml em ${pasta} (o electron-builder.yml perdeu o bloco publish?)`);
  const texto = readFileSync(yml, 'utf-8');
  const c = camposDoLatest(texto);
  const v = versao ?? c.version;
  const exe = `Estudio-Setup-${v}.exe`;
  if (c.version !== v) throw new Error(`o latest.yml diz versão ${c.version}, e o instalador é da ${v}`);
  if (c.path !== exe) throw new Error(`o latest.yml aponta para ${c.path}, e o instalador é ${exe}`);
  if (!existsSync(path.join(pasta, exe))) throw new Error(`falta o ${exe} ao lado do latest.yml`);
  if (!existsSync(path.join(pasta, `${exe}.blockmap`))) throw new Error(`falta o ${exe}.blockmap ao lado do latest.yml`);
  const real = await sha512Base64(path.join(pasta, exe));
  if (c.sha512 !== real) throw new Error(`o sha512 do latest.yml não é o do ${exe} (o instalador foi trocado depois?)`);
  // instalação por usuário (perMachine: false): o electron-updater não pode pedir administrador
  if (/^\s*isAdminRightsRequired:\s*true/m.test(texto)) throw new Error('o latest.yml pede administrador (isAdminRightsRequired), e o instalador é por usuário');
  return {versao: v, arquivos: [exe, `${exe}.blockmap`, 'latest.yml']};
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [pasta = 'out/instalador', versao] = process.argv.slice(2);
  try {
    const r = await conferirLatest(pasta, versao);
    console.log(`latest.yml confere: ${r.arquivos.join(', ')} (versão ${r.versao})`);
  } catch (e) {
    console.error(`latest.yml: ${e.message}`);
    process.exit(1);
  }
}
