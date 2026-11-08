// Servidor MCP "estudio" por stdio, para usar o projeto fora do app (outro editor, CI). Dentro do app, as abas do
// Claude falam com o mesmo conjunto de ferramentas por HTTP local (src/main/mcp-http.ts), sem um processo por aba.
// A rede do ler_fonte aqui é o fetch do Node (criarRede, em src/nucleo/ferramentas-mcp.ts).
// Uso: node dist-mcp/nucleo.cjs --projeto <pasta> [--autor agente]
import path from 'node:path';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {Projeto} from '../src/nucleo/projeto';
import {criarRede, registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {Transcritor} from '../src/main/transcricao';
import {definirServicoMusica} from '../src/nucleo/musica-projeto';
import {servicoDeRender} from '../src/main/musica-render';

const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const servidor = new McpServer({name: 'estudio', version: '0.1.0'});
// frente Música: o render da música para o vídeo (o ffmpeg do node_modules, como a transcrição)
definirServicoMusica(servicoDeRender());
// a transcrição local acha o ffmpeg no node_modules do repositório (dist-mcp/ fica na raiz)
registrarFerramentas(servidor, new Projeto(path.resolve(arg('--projeto') ?? process.cwd())), arg('--autor') ?? 'agente', 'mcp', criarRede(),
  new Transcritor({raizApp: path.resolve(__dirname, '..')}));

servidor.connect(new StdioServerTransport()).catch((e: unknown) => {
  process.stderr.write(`estudio MCP: ${String(e)}\n`);
  process.exit(1);
});
