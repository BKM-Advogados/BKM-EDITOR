// MCP do Claude Desktop (frente claude-desktop, docs/claude-desktop.md). O Claude Desktop não abre "pasta de projeto":
// ele sobe um servidor por stdio e conversa com ele. Este servidor decide, a cada chamada de ferramenta, onde ela roda:
// 1. Com o Estúdio aberto num projeto (o arquivo de descoberta, claude-desktop.ts), a chamada vai ao app com o token do
//    Claude Desktop: um escritor só, o portão de permissão na tela da pessoa, o diário e o Reverter. É o caminho preferido.
// 2. Com o app fechado (ou aberto sem projeto), roda aqui, no projeto que o Claude escolheu com escolher_projeto (os
//    recentes do app e ~/Estudio, por listar_projetos), com a trava de escrita do projeto, como o MCP da IDE. Se o
//    projeto escolhido estiver aberto num Estúdio que não publicou a descoberta, a chamada vai a ele pelo
//    .estudio/mcp-app.json do projeto (mcp-app.ts), para nunca gravar por fora de um app aberto.
// Nos dois casos a origem no diário e no Histórico é "Claude Desktop". As ferramentas sensíveis (classe "cartao" do
// portão) pedem permissão: pelo app quando ele atende; aqui, pelo pedido de confirmação do próprio Claude Desktop
// (elicitação do MCP) quando ele oferece; sem os dois, não rodam, e a resposta diz para abrir o Estúdio.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {CallToolRequestSchema, CallToolResultSchema, ListToolsRequestSchema, type CallToolResult, type JSONRPCMessage,
  type Tool} from '@modelcontextprotocol/sdk/types.js';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {listarProjetos, ORIGEM_CLAUDE_DESKTOP, resolverProjeto, type Descoberta} from './claude-desktop';
import {appAberto, encaminharAoApp, novaConversaIde, PRAZO_DO_APP_MS, type DestinoApp} from './mcp-app';
import {INSTRUCOES_MCP} from './mcp-ia';
import {ESPERA_DO_CARTAO_MS, type Portao} from './portao';
import {Projeto} from './projeto';

export const INSTRUCOES_DESKTOP = `${INSTRUCOES_MCP}

Pelo Claude Desktop: com o Estúdio aberto num projeto, as ferramentas operam nesse projeto, e o pedido de permissão aparece
na tela do app. Com o app fechado, chame listar_projetos e escolher_projeto antes das outras ferramentas.`;

export const SEM_PROJETO = 'Nenhum projeto escolhido e o Estúdio não está aberto num projeto. Chame listar_projetos e depois '
  + 'escolher_projeto com o nome ou a pasta; ou peça à pessoa para abrir o projeto no Estúdio.';
export const SEM_PORTAO = 'Esta ação precisa da permissão da pessoa, e o Claude Desktop não ofereceu como perguntar com o Estúdio '
  + 'fechado. Peça à pessoa para abrir o Estúdio com o projeto e tente de novo: o pedido de permissão aparece na tela do app.';
export const RECUSADO_DESKTOP = 'O Estúdio aberto recusou a conexão do Claude Desktop (o app foi reaberto?). Tente de novo; '
  + 'se continuar, feche e abra o Estúdio. Nada foi gravado.';

/** Monta as ferramentas do Estúdio num servidor (mcp/desktop.ts liga transcrição, narração, rede e prévias). */
export type Registrar = (servidor: McpServer, projeto: Projeto, origem: string, portao?: Portao) => void;

export type OpcoesDesktop = {
  registrar: Registrar;
  /** A descoberta de um app vivo, ou null (claude-desktop.ts, descobertaViva). */
  descoberta: () => Descoberta | null;
  /** Pasta de dados do Estúdio (recentes e preferências) e pastas de projetos a varrer (~/Estudio). */
  dados: string;
  pastas: string[];
  versao?: string;
  /** Para os testes: o repasse ao app e o app aberto num projeto (.estudio/mcp-app.json). */
  encaminhar?: typeof encaminharAoApp;
  appDoProjeto?: typeof appAberto;
  prazo?: number;
};

const texto = (t: unknown, erro = false): CallToolResult => ({...(erro ? {isError: true} : {}),
  content: [{type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2)}]});

const FERRAMENTAS_PROPRIAS: Tool[] = [
  {
    name: 'listar_projetos',
    description: 'Projetos do Estúdio neste computador (os recentes do app e os da pasta Estudio), o projeto aberto no app, se houver, '
      + 'e o escolhido por escolher_projeto. Com o app aberto num projeto, as ferramentas operam nele.',
    inputSchema: {type: 'object', properties: {}},
    annotations: {readOnlyHint: true, title: 'Listar projetos do Estúdio'},
  },
  {
    name: 'escolher_projeto',
    description: 'Escolhe o projeto em que as ferramentas operam quando o Estúdio está fechado (ou aberto sem projeto). '
      + 'Aceita o nome mostrado por listar_projetos ou o caminho da pasta.',
    inputSchema: {type: 'object', properties: {projeto: {type: 'string', description: 'nome do projeto ou caminho absoluto da pasta'}}, required: ['projeto']},
    annotations: {readOnlyHint: true, title: 'Escolher o projeto do Estúdio'},
  },
];

const mesma = (a: string, b: string) => {
  const n = (x: string) => path.resolve(x).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
};

/** O servidor do Claude Desktop, ainda sem transporte (mcp/desktop.ts liga o stdio; os testes, a memória). */
export const criarServidorDesktop = (o: OpcoesDesktop) => {
  const servidor = new Server({name: 'estudio', version: o.versao ?? '0.1.0'}, {capabilities: {tools: {}}, instructions: INSTRUCOES_DESKTOP});
  const encaminhar = o.encaminhar ?? encaminharAoApp;
  const appDoProjeto = o.appDoProjeto ?? appAberto;
  const prazo = o.prazo ?? PRAZO_DO_APP_MS;
  const conversa = {conversa: novaConversaIde(), autor: 'agente'};
  let escolhido: string | null = null;

  // o portão daqui (app fechado): a confirmação do próprio Claude Desktop, quando ele oferece; sem ela, não roda
  const portaoLocal: Portao = {
    perguntar: async (p) => {
      if (!servidor.getClientCapabilities()?.elicitation) throw new Error(SEM_PORTAO);
      const r = await servidor.elicitInput({
        message: `O Claude quer ${p.motivo} (${p.ferramenta}) no projeto do Estúdio. Permitir?`,
        requestedSchema: {type: 'object', properties: {permitir: {type: 'boolean', title: 'Permitir', description: p.motivo}}, required: ['permitir']},
      }, {signal: p.sinal, timeout: ESPERA_DO_CARTAO_MS});
      return r.action === 'accept' && r.content?.permitir === true;
    },
  };

  // um servidor interno por projeto, com as ferramentas de sempre, e um cliente em memória que fala com ele
  const internos = new Map<string, Promise<Client>>();
  const interno = (raiz: string, portao?: Portao) => {
    const chave = path.resolve(raiz);
    let c = internos.get(chave);
    if (!c) {
      c = (async () => {
        const s = new McpServer({name: 'estudio', version: o.versao ?? '0.1.0'});
        o.registrar(s, new Projeto(chave), ORIGEM_CLAUDE_DESKTOP, portao);
        const [a, b] = InMemoryTransport.createLinkedPair();
        await s.connect(a);
        const cliente = new Client({name: 'estudio-desktop', version: o.versao ?? '0.1.0'});
        await cliente.connect(b);
        return cliente;
      })();
      internos.set(chave, c);
    }
    return c;
  };
  // o catálogo: as mesmas ferramentas, registradas sobre um projeto que não existe (registrar não toca no disco)
  let catalogo: Promise<Tool[]> | null = null;
  const ferramentasDoEstudio = () => (catalogo ??= (async () => {
    const c = await interno(path.join(os.tmpdir(), 'estudio-catalogo-sem-projeto'));
    return (await c.listTools()).tools;
  })());

  servidor.setRequestHandler(ListToolsRequestSchema, async () => ({tools: [...FERRAMENTAS_PROPRIAS, ...(await ferramentasDoEstudio())]}));

  /** A resposta do app virou resultado da ferramenta; erro de JSON-RPC sobe como erro. */
  const resultadoDoApp = (r: JSONRPCMessage): CallToolResult => {
    const m = r as {result?: CallToolResult; error?: {code: number; message: string}};
    if (m.error) return texto(m.error.message, true);
    return m.result ?? texto('o Estúdio respondeu sem resultado', true);
  };

  const listar = () => listarProjetos({dados: o.dados, pastas: o.pastas});

  servidor.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const {name: nome, arguments: args} = req.params;
    const app = o.descoberta();

    if (nome === 'listar_projetos') {
      return texto({
        app_aberto: Boolean(app),
        aberto_no_app: app?.projeto ?? null,
        escolhido,
        onde_operam: app?.projeto ? `no projeto aberto no Estúdio (${app.projeto})` : escolhido ? `no projeto escolhido (${escolhido})` : 'em nenhum ainda: chame escolher_projeto',
        projetos: listar(),
      });
    }
    if (nome === 'escolher_projeto') {
      const r = resolverProjeto(String((args as {projeto?: unknown})?.projeto ?? ''), listar());
      if ('erro' in r) return texto(r.erro, true);
      escolhido = r.pasta;
      const aviso = app?.projeto && !mesma(app.projeto, r.pasta)
        ? ` Atenção: o Estúdio está aberto em ${app.projeto}, e enquanto ele estiver aberto com um projeto as ferramentas operam lá. `
          + 'Para trabalhar neste, peça à pessoa para abri-lo no app (ou fechar o projeto do app).'
        : '';
      return texto(`Projeto escolhido: ${r.nome} (${r.pasta}).${aviso}`);
    }

    const msg = {jsonrpc: '2.0', id: extra.requestId, method: 'tools/call', params: req.params} as JSONRPCMessage;
    const peloApp = async (destino: DestinoApp, quem?: typeof conversa) => encaminhar(destino, msg, quem, prazo, undefined, extra.signal);

    // 1. o app aberto num projeto
    if (app) {
      let r = await peloApp(app);
      if (r === 'recusado') {
        const deNovo = o.descoberta(); // o app reabriu e trocou o token
        r = deNovo && deNovo.token !== app.token ? await peloApp(deNovo) : 'recusado';
        if (r === 'recusado') return texto(RECUSADO_DESKTOP, true);
      }
      if (r) return resultadoDoApp(r);
      // null: o app está sem projeto (ou fechou antes de a conexão abrir); segue aqui
    }

    // 2. aqui, no projeto escolhido
    if (!escolhido) return texto(app ? `O Estúdio está aberto, mas sem projeto. ${SEM_PROJETO}` : SEM_PROJETO, true);
    if (!existsSync(path.join(escolhido, 'estudio.json'))) return texto(`O projeto escolhido (${escolhido}) não existe mais. ${SEM_PROJETO}`, true);
    const doProjeto = appDoProjeto(escolhido);
    if (doProjeto) {
      const r = await peloApp(doProjeto, conversa);
      if (r === 'recusado') return texto(RECUSADO_DESKTOP, true);
      if (r) return resultadoDoApp(r);
    }
    const c = await interno(escolhido, portaoLocal);
    return (await c.callTool(req.params, CallToolResultSchema, {signal: extra.signal, timeout: prazo, resetTimeoutOnProgress: true})) as CallToolResult;
  });

  return {
    servidor,
    escolhido: () => escolhido,
    async fechar() {
      for (const c of internos.values()) await (await c).close().catch(() => undefined);
      await servidor.close();
    },
  };
};

