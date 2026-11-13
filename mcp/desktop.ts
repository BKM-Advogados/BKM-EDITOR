// Servidor MCP "estudio" do Claude Desktop (docs/claude-desktop.md), por stdio. Quem o roda é o próprio executável do
// Estúdio em modo Node (ELECTRON_RUN_AS_NODE=1): pela entrada que o botão "Conectar ao Claude Desktop" grava no
// claude_desktop_config.json, ou pela extensão .mcpb, cujo lançador acha o Estúdio instalado (mcpb/lancador.ts).
// Com o app aberto num projeto, as chamadas vão a ele (arquivo de descoberta); com o app fechado, rodam aqui, no projeto
// escolhido (src/nucleo/mcp-desktop.ts). Os serviços são os do MCP da IDE (mcp/nucleo.ts).
// Uso: ELECTRON_RUN_AS_NODE=1 <Estudio> dist-mcp/desktop.cjs
import path from 'node:path';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {arquivoDescoberta, descobertaViva, pastaDadosEstudio, pastaPadraoProjetos, sistemaAtual} from '../src/nucleo/claude-desktop';
import {criarServidorDesktop} from '../src/nucleo/mcp-desktop';
import {confiarNoClienteNasPreferencias} from '../src/nucleo/preferencias-arquivo';
import {criarRede, registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {Transcritor} from '../src/main/transcricao';
import {definirServicoMusica} from '../src/nucleo/musica-projeto';
import {servicoDeRender} from '../src/main/musica-render';
import {servicoDoAmbiente} from '../src/main/narracao';
import {definirServicoPrevia} from '../src/nucleo/mcp-previa';
import {servicoDePreviaStdio} from '../src/main/previa-stdio';
import {definirServicoExportacao} from '../src/nucleo/mcp-exportacao-final';
import {servicoDeExportacaoStdio} from '../src/main/exportacao-servico';
// frente 2: ponto de restauração com o app fechado (o mesmo commit do Ctrl+S) e o áudio importado já medido
import {definirMedidorDeEnvelope, definirPontoDeRestauracao, mensagemDoPonto, respostaDoPonto} from '../src/nucleo/mcp-projeto';
import {SessaoProjeto} from '../src/main/sessao-projeto';
import {medirEnvelopeDoArquivo} from '../src/main/ipc-audio';
import {definirServicoMedidas} from '../src/nucleo/medidas-som'; // frente 3: loudness, envelope e limpeza com o app fechado
import {pastaDoFfmpegDoApp, servicoDeMedidas} from '../src/main/medidas';

const raizApp = path.resolve(__dirname, '..');
definirServicoMusica(servicoDeRender());
definirServicoPrevia(servicoDePreviaStdio(raizApp));
definirServicoExportacao(servicoDeExportacaoStdio(raizApp));
definirPontoDeRestauracao(async (raiz, mensagem) => {
  const r = await SessaoProjeto.pontoSemApp(raiz, mensagemDoPonto(mensagem));
  return respostaDoPonto(r.ok, r.temGit);
});
definirMedidorDeEnvelope((p, arquivo) => medirEnvelopeDoArquivo(p, arquivo));
const ffmpeg = pastaDoFfmpegDoApp(raizApp);
definirServicoMedidas(servicoDeMedidas({binarios: () => ffmpeg}));
const transcritor = new Transcritor({raizApp});
const rede = criarRede();
const narrador = servicoDoAmbiente();

const sistema = sistemaAtual();
// ESTUDIO_DADOS: outra pasta de dados (testes e quem roda o app de desenvolvimento com outro userData)
const dados = process.env.ESTUDIO_DADOS || pastaDadosEstudio(sistema);
const arquivo = process.env.ESTUDIO_DADOS ? path.join(dados, path.basename(arquivoDescoberta(sistema))) : arquivoDescoberta(sistema);

const {servidor} = criarServidorDesktop({
  dados,
  pastas: [pastaPadraoProjetos(sistema)],
  descoberta: () => descobertaViva(arquivo),
  registrar: (s, projeto, origem, portao) => registrarFerramentas(s, projeto, 'agente', origem, rede, transcritor, portao, narrador),
  // a pessoa liga na configuração do servidor quando o cliente não sabe perguntar (o Code do app Claude Desktop recusa a
  // elicitação sem mostrar): o próprio cliente já controla a permissão das ferramentas
  confiarNoCliente: () => process.env.ESTUDIO_CONFIAR_NO_CLIENTE === '1' || confiarNoClienteNasPreferencias(dados),
});

// o Claude Desktop fechou a conversa (stdin acabou): sai, para o processo não sobrar no Windows, onde fechar o lançador
// da extensão não fecha este
process.stdin.on('end', () => process.exit(0));

servidor.connect(new StdioServerTransport()).catch((e: unknown) => {
  process.stderr.write(`estudio MCP (Claude Desktop): ${String(e)}\n`);
  process.exit(1);
});
