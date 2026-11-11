// Gera a extensão do Claude Desktop (docs/claude-desktop.md): out/mcpb/Estudio-<versão>.mcpb, um zip com o
// manifest.json (mcpb/manifest.json, manifesto MCPB 0.3), o lançador em server/index.js (mcpb/lancador.ts, num arquivo só,
// sem node_modules) e o ícone. Um .mcpb só serve aos três sistemas: o lançador é JavaScript puro e acha o Estúdio de cada um.
//   npm run mcpb
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {buildSync} from 'esbuild';
import {zipar} from '../mcpb/zip';

const raiz = path.resolve(__dirname, '..');
const versao = (JSON.parse(readFileSync(path.join(raiz, 'package.json'), 'utf-8')) as {version: string}).version;
const manifesto = JSON.parse(readFileSync(path.join(raiz, 'mcpb', 'manifest.json'), 'utf-8')) as {version: string};
if (manifesto.version !== versao) throw new Error(`mcpb/manifest.json está na versão ${manifesto.version} e o package.json na ${versao}: acerte o manifesto`);

const lancador = buildSync({entryPoints: [path.join(raiz, 'mcpb', 'index.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node18',
  write: false, define: {__VERSAO__: JSON.stringify(versao)}, logLevel: 'warning', legalComments: 'none'}).outputFiles[0].contents;

const saida = path.join(raiz, 'out', 'mcpb');
mkdirSync(saida, {recursive: true});
const arquivo = path.join(saida, `Estudio-${versao}.mcpb`);
writeFileSync(arquivo, zipar([
  {nome: 'manifest.json', dados: readFileSync(path.join(raiz, 'mcpb', 'manifest.json'))},
  {nome: 'server/index.js', dados: Buffer.from(lancador)},
  {nome: 'icon.png', dados: readFileSync(path.join(raiz, 'mcpb', 'icone.png'))},
]));
console.log(arquivo);
