// Servidor MCP "estudio" por stdio, para usar o projeto fora do app (outro editor, CI). Dentro do app, as abas do
// Claude falam com o mesmo conjunto de ferramentas por HTTP local (src/main/mcp-http.ts), sem um processo por aba.
// Com o app aberto no mesmo projeto, as chamadas de ferramenta vão para ele (src/nucleo/mcp-app.ts): portão, aviso na
// tela e um escritor só. Com o app fechado, rodam aqui, com a trava de escrita do projeto.
// A rede do ler_fonte aqui é o fetch do Node (criarRede, em src/nucleo/ferramentas-mcp.ts).
// Uso: node dist-mcp/nucleo.cjs --projeto <pasta> [--autor agente]
import path from 'node:path';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {Projeto} from '../src/nucleo/projeto';
import {novaConversaIde, origemDaIde, repassarAoAppQuandoAberto} from '../src/nucleo/mcp-app';
import {criarRede, registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {INSTRUCOES_MCP} from '../src/nucleo/mcp-ia';
import {Transcritor} from '../src/main/transcricao';
import {definirServicoMusica} from '../src/nucleo/musica-projeto';
import {servicoDeRender} from '../src/main/musica-render';

const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const servidor = new McpServer({name: 'estudio', version: '0.1.0'}, {instructions: INSTRUCOES_MCP});
// frente Música: o render da música para o vídeo (o ffmpeg do node_modules, como a transcrição)
definirServicoMusica(servicoDeRender());
// a transcrição local acha o ffmpeg no node_modules do repositório (dist-mcp/ fica na raiz)
const raiz = path.resolve(arg('--projeto') ?? process.cwd());
// um processo por conversa da IDE: a mesma origem (ide-<id>) no diário com o app aberto ou fechado (mcp-app.ts)
const quem = {conversa: novaConversaIde(), autor: arg('--autor') ?? 'agente'};
registrarFerramentas(servidor, new Projeto(raiz), quem.autor, origemDaIde(quem.conversa), criarRede(),
  new Transcritor({raizApp: path.resolve(__dirname, '..')}));

const transporte = new StdioServerTransport();
servidor.connect(transporte).then(() => repassarAoAppQuandoAberto(transporte, raiz, {quem})).catch((e: unknown) => {
  process.stderr.write(`estudio MCP: ${String(e)}\n`);
  process.exit(1);
});
