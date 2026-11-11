// Depois do electron-builder: copia o instalador para a pasta raiz do projeto, para achar e rodar sem abrir out\instalador.
// O latest.yml e o .blockmap da atualização automática (docs/atualizacao.md) ficam em out\instalador, conferidos aqui.
import {copyFileSync, readFileSync} from 'node:fs';
import {conferirLatest} from './conferir-latest-yml.mjs';

const {version} = JSON.parse(readFileSync('package.json', 'utf-8'));
const nome = `Estudio-Setup-${version}.exe`;
copyFileSync(`out/instalador/${nome}`, nome);
console.log(`instalador pronto: ${nome}`);
try {
  await conferirLatest('out/instalador', version);
  console.log(`atualização: out/instalador/latest.yml e ${nome}.blockmap conferem`);
} catch (e) {
  console.warn(`atualização: ${e.message}`);
}
