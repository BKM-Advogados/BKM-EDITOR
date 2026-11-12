// Ferramentas MCP do projeto como um todo (frente 2): o que traz arquivo de fora, mexe no manifesto ou marca a versão.
// - registrarProjeto (chamado por registrarFerramentas, em todo servidor com projeto): importar_midia (cartão: traz um
//   arquivo do computador para midia/, com a mesma regra do botão da tela, importar-midia.ts), renomear_documento (livre:
//   o título no manifesto, como renomear_projeto) e marcar_ponto_de_restauracao (livre: o Ctrl+S, um commit no git do
//   projeto; o diário e o Reverter seguem como estão).
// - registrarTrocaDeProjeto: criar_projeto, abrir_projeto, duplicar_projeto e fechar_projeto (cartão). Só existem onde a
//   conversa sobrevive à troca (decisão em docs/claude-desktop.md, "Criar, abrir e trocar de projeto"):
//   · Claude Desktop (mcp-desktop.ts): com o app aberto, vão ao app pelo token fixo do Claude Desktop, que não morre na
//     troca (o app atende estas quatro mesmo sem projeto aberto, mcp-http.ts); com o app fechado, rodam no próprio
//     servidor: criar e duplicar gravam a pasta e a escolhem, abrir escolhe, fechar esquece a escolha.
//   · IDE (mcp/nucleo.ts): com o app aberto no projeto da IDE, vão ao app; com ele fechado, criar e duplicar gravam a
//     pasta, e abrir e fechar explicam que o MCP da IDE fica na pasta da IDE.
//   · Apps de IA de fora (token fixo): vão ao app, como o Claude Desktop.
//   · Conversa dentro do app (aba do Claude, laço próprio, agente ACP): as quatro não aparecem. Trocar de projeto fecha as
//     conversas do projeto aberto (main.ts, fecharSessao), e a conversa que pediu morreria no meio da resposta; o guia do
//     projeto diz para pedir à pessoa.
// Os serviços que dependem de onde o MCP roda (git do projeto, medida do áudio) chegam por definir...(), como a prévia e
// a música: o app liga os dele em src/main/main.ts; o MCP por stdio, em mcp/nucleo.ts e mcp/desktop.ts.
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {importarMidia} from './importar-midia';
import {MODELOS, type IdModelo} from './modelos';
import {PastaModelos} from './pasta-modelos';
import {criarPastaDoModelo, criarPastaDoProjeto, duplicarPastaDoProjeto, formatoDoPedido, resumoDoProjeto, type PedidoFormato} from './novo-projeto';
import {PastaMarcas} from './pasta-marcas';
import {ErroProjeto, type Projeto} from './projeto';

const texto = (x: unknown) => ({content: [{type: 'text' as const, text: typeof x === 'string' ? x : JSON.stringify(x, null, 2)}]});
const erro = (e: unknown) => ({
  isError: true,
  content: [{type: 'text' as const, text: e instanceof ErroProjeto ? `${e.codigo}: ${e.message}` : String((e as Error)?.message ?? e)}],
});
const seguro = <A,>(f: (a: A) => unknown) => async (a: A) => {
  try {
    return texto(await f(a));
  } catch (e) {
    return erro(e);
  }
};

// ---------- serviços de quem roda o MCP ----------

/** Mede o envelope de um áudio do projeto (duração e forma de onda em midia/<arquivo>.envelope.json). O app e o MCP por
 *  stdio ligam o medidor do processo principal (src/main/ipc-audio.ts, medirEnvelopeDoArquivo). */
export type MedidorDeEnvelope = (p: Projeto, arquivo: string) => Promise<{duracao_ms: number}>;
let medidor: MedidorDeEnvelope | null = null;
export const definirMedidorDeEnvelope = (m: MedidorDeEnvelope | null) => {
  medidor = m;
};

/** Cria o ponto de restauração (commit no git do projeto). No app, pela sessão aberta (a fila do git dela); fora dele, o
 *  mesmo commit sem observar a pasta (src/main/sessao-projeto.ts, SessaoProjeto.pontoSemApp). */
export type PontoDeRestauracao = (raiz: string, mensagem?: string) => Promise<{ok: boolean; mensagem: string}>;
let ponto: PontoDeRestauracao | null = null;
export const definirPontoDeRestauracao = (f: PontoDeRestauracao | null) => {
  ponto = f;
};

/** A mensagem do commit: a do Ctrl+S, com a nota de quem pediu numa linha só. */
export const mensagemDoPonto = (nota?: string) => {
  const limpa = (nota ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return limpa ? `estúdio: ponto de restauração — ${limpa}` : 'estúdio: ponto de restauração';
};

/** O texto da resposta do ponto de restauração, igual para o Ctrl+S e para o MCP. */
export const respostaDoPonto = (ok: boolean, temGit: boolean) => ({
  ok,
  mensagem: ok ? 'Ponto de restauração criado'
    : temGit ? 'O Git não conseguiu criar o ponto de restauração agora; o histórico continua no diário'
      : 'Sem o Git instalado não há pontos de restauração; o histórico continua no diário',
});

// ---------- ferramentas do projeto da conexão ----------

const DICA_DO_TIPO = {
  imagem: 'use o caminho em "src" de um bloco imagem (vídeo de cenas) ou de uma camada imagem (imagem, animação)',
  audio: 'ponha numa faixa com adicionar_clipe_audio {arquivo}',
  video: 'use o caminho como mídia de um documento (ex.: "src" de um bloco ou camada de vídeo)',
};

export const registrarProjeto = (servidor: McpServer, projeto: Projeto) => {
  servidor.registerTool('importar_midia', {
    description: 'Traz um arquivo do computador para midia/ do projeto (copia; o original fica onde está), com um nome livre ("foto.png", "foto (2).png"). Entram imagem (png, jpg, jpeg, webp, gif, svg, avif), áudio (wav, mp3, m4a, ogg, aac) e vídeo (mp4, webm, mov). Um arquivo que já está no projeto é usado no lugar, sem cópia. No áudio, mede a duração e a forma de onda. Pede a permissão da pessoa.',
    inputSchema: {
      caminho: z.string().min(1).describe('caminho absoluto do arquivo no computador'),
      pasta: z.string().optional().describe('subpasta de midia/, ex.: "tomadas"'),
      nome: z.string().max(60).optional().describe('nome do arquivo no projeto, sem a extensão'),
    },
  }, seguro(async ({caminho, pasta, nome}: {caminho: string; pasta?: string; nome?: string}) => {
    const r = importarMidia(projeto, caminho, {pasta, nome});
    let medida: Record<string, unknown> = {};
    if (r.tipo === 'audio') {
      if (!medidor) medida = {aviso: 'a duração e a forma de onda são medidas quando o áudio entrar na linha do tempo'};
      else {
        try {
          const env = await medidor(projeto, r.caminho);
          medida = {duracao_ms: env.duracao_ms, envelope: `${r.caminho}.envelope.json`};
        } catch (e) {
          medida = {aviso: `não deu para medir o áudio agora (${(e as Error).message}); a linha do tempo mede quando ele entrar num clipe`};
        }
      }
    }
    return {ok: true, ...r, ...medida, proximo: DICA_DO_TIPO[r.tipo]};
  }));

  servidor.registerTool('renomear_documento', {
    description: 'Muda o título de um documento (o nome nas abas e na lista do projeto). O id e o arquivo não mudam.',
    inputSchema: {
      documento: z.string().min(1).describe('id do documento no manifesto'),
      titulo: z.string().min(1).max(120),
    },
  }, seguro(({documento, titulo}: {documento: string; titulo: string}) => {
    if (!titulo.trim()) throw new ErroProjeto('o título não pode ficar vazio');
    const rel = projeto.arquivoDoDocumento(documento);
    const id = projeto.manifesto().documentos.find((d) => d.caminho === rel)?.id ?? documento;
    const e = projeto.renomearDocumento(id, titulo.trim().slice(0, 120));
    return {ok: true, id: e.id, titulo: e.titulo};
  }));

  servidor.registerTool('marcar_ponto_de_restauracao', {
    description: 'Cria um ponto de restauração do projeto agora (o mesmo do Ctrl+S: um commit no git do projeto, além do diário). Bom antes de uma mudança grande. "mensagem" entra na descrição do ponto.',
    inputSchema: {mensagem: z.string().max(200).optional().describe('ex.: antes de trocar o roteiro')},
  }, seguro(async ({mensagem}: {mensagem?: string}) => {
    if (!ponto) throw new ErroProjeto('este MCP não tem como criar pontos de restauração aqui; o histórico continua no diário');
    return ponto(projeto.raiz, mensagem);
  }));
};

// ---------- trocar de projeto ----------

export const FERRAMENTAS_DE_TROCA = ['criar_projeto', 'abrir_projeto', 'duplicar_projeto', 'fechar_projeto'] as const;
export const ehTrocaDeProjeto = (nome: unknown): boolean => (FERRAMENTAS_DE_TROCA as readonly unknown[]).includes(nome);

/** `modeloProprio`: id de um modelo da pessoa (listar_modelos), no lugar do modelo de fábrica; o tamanho vem do modelo. */
export type PedidoNovoProjeto = {nome?: string; modelo?: IdModelo; modeloProprio?: string; formato?: PedidoFormato; marca?: string; pasta?: string};

/** Quem troca de projeto: o app (main.ts), o servidor do Claude Desktop com o app fechado (mcp-desktop.ts) ou o MCP da IDE
 *  com o app fechado (mcp/nucleo.ts). Cada um devolve o que a IA lê. */
export type TrocadorDeProjeto = {
  criar: (o: PedidoNovoProjeto) => Promise<unknown>;
  abrir: (projeto: string) => Promise<unknown>;
  duplicar: (o: {nome?: string}) => Promise<unknown>;
  fechar: () => Promise<unknown>;
};

const IDS_MODELO = MODELOS.map((m) => m.id) as [IdModelo, ...IdModelo[]];

type ArgsCriar = {nome?: string; modelo?: IdModelo; modelo_proprio?: string; formato?: string; largura?: number; altura?: number; marca?: string; pasta?: string};

/** O pedido do criar_projeto, do jeito que as ferramentas recebem (formato por id, ou largura e altura soltas). Com
 *  `modelo_proprio` (um modelo da pessoa), o modelo de fábrica e o formato não valem: o modelo da pessoa traz os dele. */
export const pedidoDoCriar = (a: ArgsCriar): PedidoNovoProjeto => {
  if (a.modelo_proprio) {
    if (a.modelo) throw new ErroProjeto('passe "modelo" (de fábrica) ou "modelo_proprio" (da pessoa, de listar_modelos), não os dois', 'patch');
    if (a.formato || a.largura || a.altura) throw new ErroProjeto('com "modelo_proprio" o tamanho vem do modelo: tire formato, largura e altura', 'patch');
    return {modeloProprio: a.modelo_proprio, ...(a.nome ? {nome: a.nome} : {}), ...(a.marca ? {marca: a.marca} : {}), ...(a.pasta ? {pasta: a.pasta} : {})};
  }
  return {
    ...(a.nome ? {nome: a.nome} : {}),
    modelo: a.modelo ?? 'video-branco',
    ...(a.formato ? {formato: a.formato} : a.largura && a.altura ? {formato: {largura: a.largura, altura: a.altura}} : {}),
    ...(a.marca ? {marca: a.marca} : {}),
    ...(a.pasta ? {pasta: a.pasta} : {}),
  };
};

export const registrarTrocaDeProjeto = (servidor: McpServer, t: TrocadorDeProjeto) => {
  servidor.registerTool('criar_projeto', {
    description: 'Cria um projeto novo do Estúdio, numa pasta própria dentro da pasta de projetos da pessoa (ou em "pasta"), e o abre: com o app aberto, o app troca para ele (o projeto aberto fecha, com as conversas dele); com o app fechado, veja a resposta. "formato": reels, feed, quadrado, youtube, story… (ou largura e altura). "marca": id de um kit (listar_marcas). "modelo_proprio": id de um modelo da pessoa (listar_modelos) em vez do de fábrica; o tamanho vem do modelo. Pede a permissão da pessoa.',
    inputSchema: {
      nome: z.string().max(120).optional(),
      modelo: z.enum(IDS_MODELO).optional().describe('modelo de fábrica; padrão video-branco'),
      modelo_proprio: z.string().optional().describe('id de um modelo da pessoa (listar_modelos); não vale com modelo, formato, largura nem altura'),
      formato: z.string().optional().describe('id do formato, ex.: reels'),
      largura: z.number().int().min(16).max(7680).optional(),
      altura: z.number().int().min(16).max(7680).optional(),
      marca: z.string().optional().describe('id do kit de marca'),
      pasta: z.string().optional().describe('pasta absoluta onde criar a pasta do projeto'),
    },
  }, seguro((a: ArgsCriar) => t.criar(pedidoDoCriar(a))));

  servidor.registerTool('abrir_projeto', {
    description: 'Abre outro projeto do Estúdio: com o app aberto, o app troca para ele (o projeto aberto fecha, com as conversas dele); com o app fechado, veja a resposta. Aceita o nome (listar_projetos) ou a pasta. Pede a permissão da pessoa.',
    inputSchema: {projeto: z.string().min(1).describe('nome do projeto ou caminho absoluto da pasta')},
  }, seguro(({projeto}: {projeto: string}) => t.abrir(projeto)));

  servidor.registerTool('duplicar_projeto', {
    description: 'Copia o projeto em que as ferramentas operam para uma pasta ao lado ("Nome (cópia)" ou "nome"), sem o histórico, o diário e as saídas, e abre a cópia. Antes, marca um ponto de restauração no original. Pede a permissão da pessoa.',
    inputSchema: {nome: z.string().max(120).optional()},
  }, seguro(({nome}: {nome?: string}) => t.duplicar({nome})));

  servidor.registerTool('fechar_projeto', {
    description: 'Fecha o projeto: com o app aberto, a tela volta ao início (as conversas do projeto fecham); com o app fechado, as ferramentas deixam de operar nele até abrir_projeto ou escolher_projeto. Pede a permissão da pessoa.',
    inputSchema: {},
  }, seguro(() => t.fechar()));
};

// ---------- trocar de projeto com o app fechado ----------

/** O que diz a IDE quando pedem para abrir ou fechar projeto com o app fechado. */
export const fixoNaPastaDaIde = (raiz: string) => `Com o Estúdio fechado, o MCP da IDE fica na pasta da IDE (${raiz}). Nada foi feito. `
  + 'Para trabalhar em outro projeto, abra a pasta dele na IDE; ou peça à pessoa para abrir o Estúdio, e então abrir_projeto troca o projeto do app.';

/** Criar, abrir, duplicar e fechar projeto sem o app: o servidor do Claude Desktop passa a operar no projeto (`usar`); o MCP
 *  da IDE não troca (sem `usar`): grava a pasta nova e diz para abri-la na IDE. */
export const trocadorSemApp = (o: {
  pastaProjetos: string;
  /** O projeto em que as ferramentas operam (o escolhido no Claude Desktop, a pasta da IDE), ou null. */
  atual: () => string | null;
  /** Claude Desktop: passa a operar no projeto (ou em nenhum, com null). */
  usar?: (raiz: string | null) => void;
  /** Claude Desktop: o projeto pelo nome (listar_projetos) ou pela pasta. */
  resolver?: (pedido: string) => {pasta: string; nome: string} | {erro: string};
  marcas?: PastaMarcas;
  /** A pasta de modelos da pessoa (criar_projeto com modelo_proprio). */
  modelos?: PastaModelos;
}): TrocadorDeProjeto => {
  const marcas = o.marcas ?? new PastaMarcas();
  const depois = (raiz: string) => {
    if (o.usar) {
      o.usar(raiz);
      return {aberto_no_app: false, aviso: 'O Estúdio está fechado: as próximas ferramentas operam neste projeto. Ele abre no app pela tela inicial (pasta de projetos).'};
    }
    return {aberto_no_app: false, aviso: `O Estúdio está fechado e este MCP da IDE continua em ${o.atual() ?? 'outra pasta'}: abra a pasta nova na IDE (ou no Estúdio) para trabalhar nela.`};
  };
  return {
    criar: async (p) => {
      if (p.modeloProprio) {
        const {raiz} = criarPastaDoModelo({modelos: o.modelos ?? new PastaModelos(), id: p.modeloProprio, nome: p.nome, marca: p.marca ? marcas.ler(p.marca) : null, pasta: p.pasta || o.pastaProjetos});
        return {ok: true, ...resumoDoProjeto(raiz), ...depois(raiz)};
      }
      const modelo = p.modelo ?? 'video-branco';
      const formato = formatoDoPedido(modelo, p.formato);
      const {raiz} = criarPastaDoProjeto({nome: p.nome, modelo, formato, marca: p.marca ? marcas.ler(p.marca) : null, pasta: p.pasta || o.pastaProjetos});
      return {ok: true, ...resumoDoProjeto(raiz), ...depois(raiz)};
    },
    abrir: async (pedido) => {
      if (!o.usar || !o.resolver) throw new Error(fixoNaPastaDaIde(o.atual() ?? ''));
      const r = o.resolver(pedido);
      if ('erro' in r) throw new Error(r.erro);
      return {ok: true, ...resumoDoProjeto(r.pasta), ...depois(r.pasta)};
    },
    duplicar: async ({nome}) => {
      const origem = o.atual();
      if (!origem) throw new ErroProjeto('nenhum projeto escolhido para duplicar: chame escolher_projeto ou abrir_projeto antes', 'nao_achado');
      const marcado = ponto ? await ponto(origem, 'antes de duplicar').catch(() => null) : null;
      const {raiz} = duplicarPastaDoProjeto(origem, nome);
      return {ok: true, ...resumoDoProjeto(raiz), ...(marcado?.ok ? {ponto_no_original: true} : {}), ...depois(raiz)};
    },
    fechar: async () => {
      if (!o.usar) throw new Error(fixoNaPastaDaIde(o.atual() ?? ''));
      const fechado = o.atual();
      o.usar(null);
      return {ok: true, fechado, aviso: 'As ferramentas não operam em nenhum projeto até abrir_projeto ou escolher_projeto.'};
    },
  };
};
