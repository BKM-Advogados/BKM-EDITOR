// Servidor MCP "estudio" por stdio, para usar o projeto fora do app (outro editor, CI, uma IDE de agentes). Dentro do app,
// as abas do Claude falam com o mesmo conjunto de ferramentas por HTTP local (src/main/mcp-http.ts), sem um processo por aba.
// Com o app aberto no mesmo projeto, as chamadas de ferramenta vão para ele (src/nucleo/mcp-app.ts): portão, aviso na
// tela e um escritor só. Com o app fechado, rodam aqui, com a trava de escrita do projeto.
// A rede do ler_fonte aqui é o fetch do Node (criarRede, em src/nucleo/ferramentas-mcp.ts).
// A narração por IA (docs/narracao.md) usa as chaves do ambiente: GEMINI_API_KEY (ou GOOGLE_API_KEY) e GOOGLE_TTS_API_KEY.
// Uso: node dist-mcp/nucleo.cjs --projeto <pasta> [--autor agente] [--ide] [--origem "Gemini CLI"]
// --origem é o nome do harness que abriu o processo (docs/harnesses.md): o diário grava "ide-<id> Gemini CLI" e o
// Histórico mostra "Gemini CLI"; sem ele, "Claude na IDE", como antes.
// O .mcp.json que o app escreve em cada projeto (frente IDE, docs/ide.md) roda este arquivo pelo próprio executável do
// Estúdio em modo Node (ELECTRON_RUN_AS_NODE=1), com --ide: a pasta de trabalho da IDE manda quando ela é
// um projeto do Estúdio (uma pasta copiada à mão leva o .mcp.json da original, com o --projeto de lá).
import {existsSync} from 'node:fs';
import path from 'node:path';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {Projeto} from '../src/nucleo/projeto';
import {novaConversaIde, origemDaIde, repassarAoAppQuandoAberto, rotuloAceito} from '../src/nucleo/mcp-app';
import {criarRede, registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {INSTRUCOES_MCP} from '../src/nucleo/mcp-ia';
import {Transcritor} from '../src/main/transcricao';
import {definirServicoMusica} from '../src/nucleo/musica-projeto';
import {servicoDeRender} from '../src/main/musica-render';
import {servicoDoAmbiente} from '../src/main/narracao';
import {definirServicoPrevia} from '../src/nucleo/mcp-previa'; // frente IDE: ver_quadro, ver_cenas, ver_trecho
import {servicoDePreviaStdio} from '../src/main/previa-stdio';
import {definirServicoExportacao} from '../src/nucleo/mcp-exportacao-final'; // exportar_video com o app fechado
import {servicoDeExportacaoStdio} from '../src/main/exportacao-servico';

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
// exportação final: o vídeo renderiza aqui com o app fechado; imagem e carrossel pedem o app (src/main/exportacao-servico.ts)
definirServicoExportacao(servicoDeExportacaoStdio(path.resolve(__dirname, '..')));
// a transcrição local acha o ffmpeg no node_modules do repositório (dist-mcp/ fica na raiz)
const raiz = pasta;
// um processo por conversa da IDE: a mesma origem (ide-<id>) no diário com o app aberto ou fechado (mcp-app.ts)
const rotulo = arg('--origem');
if (rotulo !== undefined && !rotuloAceito(rotulo)) process.stderr.write(`estudio MCP: --origem "${rotulo}" ignorado (letras, números, espaço, ponto e hífen, até 32)\n`);
const quem = {conversa: novaConversaIde(), autor: arg('--autor') ?? 'agente', ...(rotuloAceito(rotulo) ? {rotulo} : {})};
registrarFerramentas(servidor, new Projeto(raiz), quem.autor, origemDaIde(quem.conversa, quem.rotulo), criarRede(),
  new Transcritor({raizApp: path.resolve(__dirname, '..')}), undefined, servicoDoAmbiente());

const transporte = new StdioServerTransport();
servidor.connect(transporte).then(() => repassarAoAppQuandoAberto(transporte, raiz, {quem})).catch((e: unknown) => {
  process.stderr.write(`estudio MCP: ${String(e)}\n`);
  process.exit(1);
});
