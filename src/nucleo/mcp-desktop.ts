// MCP do Claude Desktop (frente claude-desktop, docs/claude-desktop.md). O Claude Desktop não abre "pasta de projeto":
// ele sobe um servidor por stdio e conversa com ele. Este servidor decide, a cada chamada de ferramenta, onde ela roda:
// 1. Com o Estúdio aberto num projeto (o arquivo de descoberta, claude-desktop.ts), a chamada vai ao app com o token do
//    Claude Desktop: um escritor só, o portão de permissão na tela da pessoa, o diário e o Reverter. É o caminho preferido.
//    Se o Claude escolheu outro projeto, a chamada é recusada (nunca grava num projeto que ele não escolheu nem por fora
//    do app aberto); sem escolha, quando o projeto muda entre uma chamada e outra (a pessoa abriu outro no app), a
//    primeira chamada depois da troca é recusada, dizendo de qual para qual.
// 2. Com o app fechado (ou aberto sem projeto), roda aqui, no projeto que o Claude escolheu com escolher_projeto (os
//    recentes do app e ~/Estudio, por listar_projetos), com a trava de escrita do projeto, como o MCP da IDE. Se o
//    projeto escolhido estiver aberto num Estúdio que não publicou a descoberta, a chamada vai a ele pelo
//    .estudio/mcp-app.json do projeto (mcp-app.ts), para nunca gravar por fora de um app aberto.
// Nos dois casos a origem no diário e no Histórico é "Claude Desktop". As ferramentas sensíveis (classe "cartao" do
// portão) pedem permissão: pelo app quando ele atende; aqui, pelo pedido de confirmação do próprio Claude Desktop
// (elicitação do MCP) quando ele oferece; sem os dois, não rodam, e a resposta diz para abrir o Estúdio.
// Frente 2: criar_projeto, abrir_projeto, duplicar_projeto e fechar_projeto (mcp-projeto.ts) são ferramentas deste servidor.
// Com o app vivo, vão a ele (que as atende mesmo sem projeto aberto, pelo token fixo do Claude Desktop, que sobrevive à
// troca) e a escolha daqui passa a ser o projeto do app; com o app fechado, rodam aqui (trocadorSemApp): criar e duplicar
// gravam a pasta e a escolhem, abrir escolhe, fechar esquece a escolha.
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
import {modelosDaPessoa} from './mcp-modelos';
import {pastaPadraoModelos, PastaModelos} from './pasta-modelos';
import {pastaDasPreferencias} from './preferencias-arquivo';
import {ehTrocaDeProjeto, registrarTrocaDeProjeto, trocadorSemApp} from './mcp-projeto'; // frente 2
import {Projeto} from './projeto';

export const INSTRUCOES_DESKTOP = `${INSTRUCOES_MCP}

Pelo Claude Desktop: com o Estúdio aberto num projeto, as ferramentas operam nesse projeto, e o pedido de permissão aparece
na tela do app. Com o app fechado, chame listar_projetos e escolher_projeto (ou criar_projeto) antes das outras ferramentas.`;

export const SEM_PROJETO = 'Nenhum projeto escolhido e o Estúdio não está aberto num projeto. Chame listar_projetos e depois '
  + 'escolher_projeto com o nome ou a pasta; ou peça à pessoa para abrir o projeto no Estúdio.';
export const SEM_PORTAO = 'Esta ação precisa da permissão da pessoa, e o Claude Desktop não ofereceu como perguntar com o Estúdio '
  + 'fechado. Peça à pessoa para abrir o Estúdio com o projeto e tente de novo: o pedido de permissão aparece na tela do app.';
/** O app está aberto num projeto e o Claude escolheu outro: nada roda. */
export const outroProjetoNoApp = (noApp: string, escolhido: string) => `O Estúdio está aberto em ${noApp}, mas o projeto escolhido é `
  + `${escolhido}. Nada foi feito. Para trabalhar no escolhido, peça à pessoa para abri-lo no Estúdio (ou fechar o projeto do app); `
  + `para trabalhar no que está aberto, chame escolher_projeto com ${noApp}.`;
/** O projeto mudou entre duas chamadas sem o Claude escolher: a primeira depois da troca não roda. */
export const projetoMudou = (antes: string, agora: string) => `O projeto mudou: as chamadas anteriores foram em ${antes}, e agora `
  + `o Estúdio está em ${agora}. Nada foi feito. Confirme com a pessoa e repita a chamada para trabalhar em ${agora}, ou chame `
  + 'escolher_projeto.';
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
  /** A pasta de modelos (listar_modelos sem projeto e criar_projeto com modelo_proprio); padrão: a pasta_modelos das preferências
   *  do app (em `dados`), e sem ela ESTUDIO_MODELOS ou ~/Estudio/meus-modelos. */
  modelos?: PastaModelos;
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
  // o rótulo leva "Claude Desktop" ao diário também pelo .estudio/mcp-app.json (a origem fica ide-<id> Claude Desktop, e o
  // Histórico mostra o nome)
  const conversa = {conversa: novaConversaIde(), autor: 'agente', rotulo: ORIGEM_CLAUDE_DESKTOP};
  let escolhido: string | null = null;
  // o projeto em que a última chamada rodou (para avisar quando ele muda sem o Claude escolher)
  let ultimo: string | null = null;

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
  // o catálogo: as mesmas ferramentas, registradas sobre um projeto que não existe (registrar não toca no disco). Fica
  // fora do mapa dos internos e com um portão que sempre nega: escolher uma pasta com o mesmo caminho dá um interno novo,
  // com o portão de verdade
  let catalogo: Promise<Tool[]> | null = null;
  const ferramentasDoEstudio = () => (catalogo ??= (async () => {
    const s = new McpServer({name: 'estudio', version: o.versao ?? '0.1.0'});
    o.registrar(s, new Projeto(path.join(os.tmpdir(), 'estudio-catalogo-sem-projeto')), ORIGEM_CLAUDE_DESKTOP, {perguntar: async () => false});
    registrarTrocaDeProjeto(s, trocaLocal); // frente 2: criar, abrir, duplicar e fechar projeto
    const [a, b] = InMemoryTransport.createLinkedPair();
    await s.connect(a);
    const c = new Client({name: 'estudio-catalogo', version: o.versao ?? '0.1.0'});
    await c.connect(b);
    const lista = (await c.listTools()).tools;
    await c.close().catch(() => undefined);
    return lista;
  })());

  servidor.setRequestHandler(ListToolsRequestSchema, async () => ({tools: [...FERRAMENTAS_PROPRIAS, ...(await ferramentasDoEstudio())]}));

  /** A resposta do app virou resultado da ferramenta; erro de JSON-RPC sobe como erro. */
  const resultadoDoApp = (r: JSONRPCMessage): CallToolResult => {
    const m = r as {result?: CallToolResult; error?: {code: number; message: string}};
    if (m.error) return texto(m.error.message, true);
    return m.result ?? texto('o Estúdio respondeu sem resultado', true);
  };

  const modelos = o.modelos ?? new PastaModelos({pasta: () => pastaDasPreferencias(o.dados, 'pasta_modelos') ?? pastaPadraoModelos()});
  const listar = () => listarProjetos({dados: o.dados, pastas: o.pastas});

  // frente 2: trocar de projeto com o app fechado, aqui mesmo (mcp-projeto.ts)
  const trocaLocal = trocadorSemApp({
    pastaProjetos: o.pastas[0] ?? path.join(os.homedir(), 'Estudio'),
    atual: () => escolhido,
    usar: (raiz) => {
      escolhido = raiz;
      ultimo = raiz; // escolha explícita: a troca não precisa de aviso
    },
    resolver: (pedido) => resolverProjeto(pedido, listar()),
    modelos,
  });
  // criar e duplicar gravam uma pasta nova: pedem a permissão pela confirmação do Claude Desktop; abrir e fechar só escolhem
  const MOTIVO_LOCAL: Record<string, string> = {criar_projeto: 'criar um projeto novo do Estúdio numa pasta nova', duplicar_projeto: 'copiar o projeto do Estúdio para uma pasta nova'};
  let servidorDaTroca: Promise<Client> | null = null;
  const clienteDaTroca = () => (servidorDaTroca ??= (async () => {
    const s = new McpServer({name: 'estudio', version: o.versao ?? '0.1.0'});
    registrarTrocaDeProjeto(s, trocaLocal);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await s.connect(a);
    const c = new Client({name: 'estudio-troca', version: o.versao ?? '0.1.0'});
    await c.connect(b);
    return c;
  })());
  /** A pasta que a ferramenta de troca devolveu (o JSON do primeiro texto), para seguir no projeto novo. */
  const pastaDoResultado = (r: CallToolResult): string | null => {
    try {
      const t = (r.content?.[0] as {text?: string} | undefined)?.text;
      const x = t ? (JSON.parse(t) as {pasta?: unknown}) : null;
      return typeof x?.pasta === 'string' ? x.pasta : null;
    } catch {
      return null;
    }
  };

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
      ultimo = r.pasta; // escolha explícita: a troca não precisa de aviso
      const aviso = app?.projeto && !mesma(app.projeto, r.pasta)
        ? ` Atenção: o Estúdio está aberto em ${app.projeto}. Enquanto ele estiver aberto nesse projeto, as ferramentas não rodam `
          + '(para não gravar no projeto errado). Peça à pessoa para abrir este no app, ou fechar o projeto do app.'
        : '';
      return texto(`Projeto escolhido: ${r.nome} (${r.pasta}).${aviso}`);
    }

    const msg = {jsonrpc: '2.0', id: extra.requestId, method: 'tools/call', params: req.params} as JSONRPCMessage;
    const peloApp = async (destino: DestinoApp, quem?: typeof conversa) => encaminhar(destino, msg, quem, prazo, undefined, extra.signal);

    // frente 2: trocar de projeto. Com o app vivo, ele troca (com ou sem projeto aberto) e as próximas chamadas seguem no
    // projeto do app; com o app fechado (ou numa versão que não troca sem projeto: 409), aqui.
    if (ehTrocaDeProjeto(nome)) {
      if (app) {
        let r = await peloApp(app);
        if (r === 'recusado') {
          const deNovo = o.descoberta();
          r = deNovo && deNovo.token !== app.token ? await peloApp(deNovo) : 'recusado';
          if (r === 'recusado') return texto(RECUSADO_DESKTOP, true);
        }
        if (r) {
          const res = resultadoDoApp(r);
          if (!res.isError) {
            escolhido = null; // o projeto do app manda daqui em diante
            ultimo = nome === 'fechar_projeto' ? null : pastaDoResultado(res) ?? ultimo;
          }
          return res;
        }
      }
      const motivo = MOTIVO_LOCAL[nome];
      try {
        if (motivo && !(await portaoLocal.perguntar({ferramenta: nome, entrada: (args ?? {}) as Record<string, unknown>, motivo, sinal: extra.signal}))) {
          return texto('A pessoa negou esta ação no Claude Desktop. Não tente de novo sem ela pedir.', true);
        }
      } catch (e) {
        return texto((e as Error).message, true); // sem como perguntar (SEM_PORTAO)
      }
      return (await (await clienteDaTroca()).callTool(req.params, CallToolResultSchema, {signal: extra.signal})) as CallToolResult;
    }

    // listar_modelos não precisa de projeto: sem app aberto num projeto e sem projeto escolhido, responde daqui (a pessoa pede
    // "cria um projeto do meu modelo X" de cara); com projeto, segue o caminho de sempre
    if (nome === 'listar_modelos' && !app?.projeto && !escolhido) return texto(modelosDaPessoa(modelos));

    // o projeto em que a chamada vai rodar: o do app, se ele está aberto num projeto; senão, o escolhido
    const alvo = app?.projeto ?? escolhido;
    if (app?.projeto && escolhido && !mesma(app.projeto, escolhido)) return texto(outroProjetoNoApp(app.projeto, escolhido), true);
    if (alvo && ultimo && !mesma(alvo, ultimo)) {
      const antes = ultimo;
      ultimo = alvo;
      return texto(projetoMudou(antes, alvo), true);
    }
    if (alvo) ultimo = alvo;

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
      if (servidorDaTroca) await (await servidorDaTroca).close().catch(() => undefined);
      await servidor.close();
    },
  };
};

