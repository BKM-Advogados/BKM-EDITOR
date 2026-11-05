// Depois do electron-builder: copia o instalador para a pasta raiz do projeto, para achar e rodar sem abrir out\instalador.
import {copyFileSync, readFileSync} from 'node:fs';

const {version} = JSON.parse(readFileSync('package.json', 'utf-8'));
const nome = `Estudio-Setup-${version}.exe`;
copyFileSync(`out/instalador/${nome}`, nome);
console.log(`instalador pronto: ${nome}`);
