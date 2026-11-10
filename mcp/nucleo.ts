// Servidor MCP "estudio" por stdio, para usar o projeto fora do app (outro editor, CI, uma IDE de agentes). Dentro do app,
// as abas do Claude falam com o mesmo conjunto de ferramentas por HTTP local (src/main/mcp-http.ts), sem um processo por aba.
// A rede do ler_fonte aqui é o fetch do Node (criarRede, em src/nucleo/ferramentas-mcp.ts).
// A narração por IA (docs/narracao.md) usa as chaves do ambiente: GEMINI_API_KEY (ou GOOGLE_API_KEY) e GOOGLE_TTS_API_KEY.
// Uso: node dist-mcp/nucleo.cjs --projeto <pasta> [--autor agente] [--origem mcp] [--ide]
// O .mcp.json que o app escreve em cada projeto (frente IDE, docs/ide.md) roda este arquivo pelo próprio executável do
// Estúdio em modo Node (ELECTRON_RUN_AS_NODE=1), com --origem IDE e --ide: a pasta de trabalho da IDE manda quando ela é
// um projeto do Estúdio (uma pasta copiada à mão leva o .mcp.json da original, com o --projeto de lá).
import {existsSync} from 'node:fs';
import path from 'node:path';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {Projeto} from '../src/nucleo/projeto';
import {criarRede, registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {INSTRUCOES_MCP} from '../src/nucleo/mcp-ia';
import {Transcritor} from '../src/main/transcricao';
import {definirServicoMusica} from '../src/nucleo/musica-projeto';
import {servicoDeRender} from '../src/main/musica-render';
import {servicoDoAmbiente} from '../src/main/narracao';
import {definirServicoPrevia} from '../src/nucleo/mcp-previa'; // frente IDE: ver_quadro, ver_cenas, ver_trecho
import {servicoDePreviaStdio} from '../src/main/previa-stdio';

const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const doCwd = process.argv.includes('--ide') && existsSync(path.join(process.cwd(), 'estudio.json')) ? process.cwd() : undefined;
const pasta = path.resolve(doCwd ?? arg('--projeto') ?? process.cwd());
if (doCwd && arg('--projeto') && path.resolve(arg('--projeto')!) !== pasta) {
  process.stderr.write(`estudio MCP: a pasta de trabalho (${pasta}) é um projeto do Estúdio e vale no lugar de --projeto (${arg('--projeto')})\n`);
}

const servidor = new McpServer({name: 'estudio', version: '0.1.0'}, {instructions: INSTRUCOES_MCP});
// frente Música: o render da música para o vídeo (o ffmpeg do node_modules, como a transcrição)
definirServicoMusica(servicoDeRender());
// frente IDE: as prévias renderizam com o app de onde veio este arquivo (src/main/previa-stdio.ts)
definirServicoPrevia(servicoDePreviaStdio(path.resolve(__dirname, '..')));
// a transcrição local acha o ffmpeg no node_modules do repositório (dist-mcp/ fica na raiz)
registrarFerramentas(servidor, new Projeto(pasta), arg('--autor') ?? 'agente', arg('--origem') ?? 'mcp', criarRede(),
  new Transcritor({raizApp: path.resolve(__dirname, '..')}), undefined, servicoDoAmbiente());

servidor.connect(new StdioServerTransport()).catch((e: unknown) => {
  process.stderr.write(`estudio MCP: ${String(e)}\n`);
  process.exit(1);
});
