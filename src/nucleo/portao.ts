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
/** Quanto o cartão espera a pessoa responder no app; sem resposta, nega. O MCP da IDE espera o app por isso e mais uma
 *  folga (mcp-app.ts). */
export const ESPERA_DO_CARTAO_MS = 10 * 60 * 1000;

export const CLASSES: Record<string, {classe: Classe; motivo: string; livreSe?: (entrada: Record<string, unknown>) => boolean}> = {
  ler_fonte: {classe: 'cartao', motivo: 'abrir uma página da internet'},
  transcrever: {classe: 'cartao', motivo: 'transcrever o áudio neste PC (na primeira vez baixa o modelo de voz, uns 200 MB)'},
  remover_fundo: {classe: 'cartao', motivo: 'recortar o fundo da imagem neste PC (na primeira vez baixa o modelo, uns 26 MB)'},
  exportar_legendas: {classe: 'cartao', motivo: 'gravar arquivos de legenda em saidas/'},
  // integração da rodada 3: as que as outras frentes declararam "cartao" nos docs
  destravar_camadas: {classe: 'cartao', motivo: 'destravar camadas que você travou na imagem'},
  exportar_musica: {classe: 'cartao', motivo: 'gravar a música em arquivo em saidas/'},
  importar_midi: {classe: 'cartao', motivo: 'trazer um arquivo MIDI para o projeto'},
  escolher_trilha: {classe: 'cartao', motivo: 'trazer uma trilha da sua pasta de trilhas para o projeto'},
  // narração por IA (docs/narracao.md): vai ao Google com a chave da pessoa; a prévia (previa: true) não sai do PC
  narrar: {classe: 'cartao', motivo: 'gerar a narração com a IA do Google (sai do PC, usa a sua chave e pode ter custo)', livreSe: (e) => e.previa === true},
  vozes_narracao: {classe: 'cartao', motivo: 'listar as vozes de narração do Google (usa a sua chave, sem custo)'},
  // exportação final pelo MCP (src/nucleo/mcp-exportacao-final.ts): grava o arquivo final em saidas/
  exportar_video: {classe: 'cartao', motivo: 'exportar o vídeo para saidas/ (leva de segundos a minutos)'},
  exportar_imagem: {classe: 'cartao', motivo: 'exportar a imagem para saidas/'},
  exportar_carrossel: {classe: 'cartao', motivo: 'exportar o carrossel (PNG por página e PDF) para saidas/'},
  // frente 2 (mcp-projeto.ts, mcp-marca-edicao.ts): trazer arquivo de fora, trocar de projeto e gravar na pasta dos kits
  importar_midia: {classe: 'cartao', motivo: 'trazer um arquivo do seu computador para midia/ do projeto'},
  criar_projeto: {classe: 'cartao', motivo: 'criar um projeto novo e abri-lo no Estúdio (o projeto aberto fecha, com as conversas dele)'},
  abrir_projeto: {classe: 'cartao', motivo: 'abrir outro projeto no Estúdio (o projeto aberto fecha, com as conversas dele)'},
  duplicar_projeto: {classe: 'cartao', motivo: 'copiar o projeto para uma pasta nova e abrir a cópia no Estúdio'},
  fechar_projeto: {classe: 'cartao', motivo: 'fechar o projeto aberto no Estúdio (as conversas dele fecham)'},
  criar_marca: {classe: 'cartao', motivo: 'criar um kit de marca na sua pasta de kits (fora do projeto)'},
  editar_marca: {classe: 'cartao', motivo: 'mudar um kit de marca na sua pasta de kits (fora do projeto, sem Reverter)'},
  importar_logo_marca: {classe: 'cartao', motivo: 'trazer uma imagem do seu computador como logo de um kit de marca'},
  importar_fonte_marca: {classe: 'cartao', motivo: 'trazer um arquivo de fonte do seu computador para um kit de marca'},
  // Onda B (mcp-modelos.ts): grava na pasta de modelos da pessoa, fora do projeto e sem Reverter
  salvar_como_modelo: {classe: 'cartao', motivo: 'salvar o projeto como modelo na sua pasta de modelos (fora do projeto, aparece em Novo)'},
  // Onda B (mcp-plano.ts): a aprovação é da pessoa; com o app aberto ela confirma aqui (ou aprova pelo botão do cartão)
  aprovar_plano: {classe: 'cartao', motivo: 'registrar que você aprovou o Plano do vídeo (depois disso a IA começa a montar)'},
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
      if (o.portao && classeDe(nome, config.annotations) === 'cartao' && !CLASSES[nome]?.livreSe?.(entrada ?? {})) {
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
