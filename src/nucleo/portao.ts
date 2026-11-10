// Portão de permissão do MCP estudio (frente IA, rodada 3, docs/ia.md). Envolve o registerTool do servidor: toda
// ferramenta registrada depois dele, de qualquer frente, passa por aqui sem mudar nada no código dela.
// - Classe "cartao" (baixa modelo, lê a web, traz arquivo de fora, exporta, apaga): antes de rodar, o app pergunta à
//   pessoa com o mesmo cartão para qualquer IA (Claude, laço próprio, agente ACP ou app de fora). Negado, nada roda.
// - Classe "livre": grava no diário e tem Reverter; roda direto.
// - Depois de qualquer ferramenta, o resultado ganha as mudanças que ela fez no diário (seq, documento, rótulo), para
//   o cartão da conversa oferecer Ver e Reverter com qualquer provedor.
// Uma frente declara a classe de uma ferramenta nova na tabela CLASSES (com uma linha) ou pelas anotações do MCP:
// openWorldHint (fala com fora do PC ou do projeto) ou destructiveHint (apaga) viram "cartao".
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {EntradaDiario} from './documentos';

export type Classe = 'livre' | 'cartao';
export type PedidoPortao = {ferramenta: string; entrada: Record<string, unknown>; motivo: string; sinal?: AbortSignal};
/** Quem pergunta à pessoa (o app); sem ele (MCP por stdio, fora do app), nada pergunta. Devolve se pode rodar. */
export type Portao = {perguntar: (p: PedidoPortao) => Promise<boolean>};

export const CLASSES: Record<string, {classe: Classe; motivo: string}> = {
  ler_fonte: {classe: 'cartao', motivo: 'abrir uma página da internet'},
  transcrever: {classe: 'cartao', motivo: 'transcrever o áudio neste PC (na primeira vez baixa o modelo de voz, uns 200 MB)'},
  remover_fundo: {classe: 'cartao', motivo: 'recortar o fundo da imagem neste PC (na primeira vez baixa o modelo, uns 26 MB)'},
  exportar_legendas: {classe: 'cartao', motivo: 'gravar arquivos de legenda em saidas/'},
};

type Anotacoes = {openWorldHint?: boolean; destructiveHint?: boolean};

export const classeDe = (nome: string, anotacoes?: Anotacoes): Classe =>
  CLASSES[nome]?.classe ?? (anotacoes?.openWorldHint || anotacoes?.destructiveHint ? 'cartao' : 'livre');

const motivoDe = (nome: string, anotacoes?: Anotacoes) =>
  CLASSES[nome]?.motivo ?? (anotacoes?.destructiveHint ? `apagar com ${nome.replace(/_/g, ' ')}` : `usar ${nome.replace(/_/g, ' ')}, que sai do projeto`);

/** O que o diário precisa oferecer ao portão: a marca do fim e o que entrou depois dela. */
export type DiarioDoPortao = {marcaDoDiario: () => number; entradasDesde: (marca: number) => EntradaDiario[]};

const NEGADO = 'A pessoa negou esta ação no Estúdio. Não tente de novo sem ela pedir.';

export const instalarPortao = (servidor: McpServer, o: {projeto: DiarioDoPortao; origem: string; portao?: Portao}) => {
  const original = servidor.registerTool.bind(servidor) as (...a: unknown[]) => unknown;
  const envolvido = (nome: string, config: {inputSchema?: unknown; annotations?: Anotacoes}, cb: (...a: unknown[]) => unknown) =>
    original(nome, config, async (...a: unknown[]) => {
      // com inputSchema o SDK chama (args, extra); sem ele, só (extra)
      const entrada = (config.inputSchema ? a[0] : {}) as Record<string, unknown>;
      const extra = (config.inputSchema ? a[1] : a[0]) as {signal?: AbortSignal} | undefined;
      if (o.portao && classeDe(nome, config.annotations) === 'cartao') {
        const ok = await o.portao.perguntar({ferramenta: nome, entrada: entrada ?? {}, motivo: motivoDe(nome, config.annotations), sinal: extra?.signal});
        if (!ok) return {isError: true, content: [{type: 'text', text: NEGADO}]};
      }
      const marca = o.projeto.marcaDoDiario();
      const r = (await cb(...a)) as {content?: unknown[]} | undefined;
      const novas = o.projeto.entradasDesde(marca).filter((e) => e.origem === o.origem);
      if (novas.length && r && Array.isArray(r.content)) {
        r.content = [...r.content, {type: 'text', text: JSON.stringify({estudio_mudancas: novas.map((e) => ({seq: e.seq, documento: e.documento, rotulo: e.rotulo}))})}];
      }
      return r;
    });
  (servidor as unknown as {registerTool: typeof envolvido}).registerTool = envolvido;
};

/** As mudanças do diário que o portão pôs no resultado de uma ferramenta (para o cartão: Ver e Reverter). */
export const mudancasDoResultado = (texto: string | undefined): {seq: number; documento: string; rotulo: string}[] => {
  if (!texto) return [];
  const r: {seq: number; documento: string; rotulo: string}[] = [];
  for (const m of texto.matchAll(/\{"estudio_mudancas":\[.*?\]\}/g)) {
    try {
      r.push(...(JSON.parse(m[0]).estudio_mudancas as typeof r));
    } catch {
      /* resultado cortado */
    }
  }
  return r;
};
