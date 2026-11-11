// A tela da pessoa pelo MCP (auditoria MCP, M10): o pedido de navegação é o .estudio/selecao.json, que a interface já
// segue (src/renderer/estado/loja.ts, aplicarSelecaoPedida): troca de área e de documento e seleciona os caminhos.
// - mostrar_documento leva a tela a um documento (e a um objeto ou a um tempo, se pedir).
// - Documento criado pelo Claude (criar_documento, criar_animacao) leva a tela até ele por padrão; "mostrar: false" não
//   leva. Fica num envoltório do registerTool, como o portão, para valer em qualquer frente que crie documento sem
//   mudar o código dela.
// Sem o app (MCP por stdio puro), o arquivo fica gravado e não faz mal. Criar documento não entra no diário: a pessoa vê
// o documento novo na tela (docs/ia.md).
import path from 'node:path';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {ErroProjeto, PASTA_INTERNA, serializar, valorEm, type Projeto} from './projeto';

export const ARQUIVO_SELECAO = path.join(PASTA_INTERNA, 'selecao.json');

/** O pedido que a interface lê. tempo_ms é opcional: quem não o conhece ignora. */
export type PedidoTela = {documento: string; caminhos: string[]; tempo_ms?: number; autor: string; em: string};

/** Grava o pedido de navegação para a tela da pessoa. */
export const pedirTela = (projeto: Projeto, p: Omit<PedidoTela, 'em'>) =>
  projeto.gravarTexto(ARQUIVO_SELECAO, serializar({...p, em: new Date().toISOString()}));

const texto = (x: unknown) => ({content: [{type: 'text' as const, text: typeof x === 'string' ? x : JSON.stringify(x, null, 2)}]});
const erro = (e: unknown) => ({
  isError: true,
  content: [{type: 'text' as const, text: e instanceof ErroProjeto ? `${e.codigo}: ${e.message}` : String((e as Error)?.message ?? e)}],
});

/** Ferramentas que criam documento e, por padrão, levam a tela até ele. */
export const CRIAM_DOCUMENTO = new Set(['criar_documento', 'criar_animacao']);

type Config = {description?: string; inputSchema?: Record<string, z.ZodTypeAny>};
type Resultado = {isError?: boolean; content?: {type: string; text?: string}[]};

/** Envolve o registerTool: as ferramentas de CRIAM_DOCUMENTO ganham o parâmetro "mostrar" (padrão true) e, quando um
 *  documento novo entra no manifesto, a tela vai até ele; a resposta ganha "mostrado". */
export const instalarMostrarCriado = (servidor: McpServer, projeto: Projeto, autor: string) => {
  const original = servidor.registerTool.bind(servidor) as (nome: string, config: Config, cb: (...a: unknown[]) => unknown) => unknown;
  const envolvido = (nome: string, config: Config, cb: (...a: unknown[]) => unknown) => {
    if (!CRIAM_DOCUMENTO.has(nome) || !config.inputSchema) return original(nome, config, cb);
    const inputSchema = {...config.inputSchema, mostrar: z.boolean().optional().describe('leva a tela da pessoa até o documento criado (padrão: sim)')};
    const description = `${config.description ?? ''} A tela da pessoa vai até o documento novo; "mostrar: false" não leva.`.trim();
    return original(nome, {...config, description, inputSchema}, async (args: unknown, ...resto: unknown[]) => {
      const {mostrar, ...entrada} = (args ?? {}) as {mostrar?: boolean};
      const antes = new Set(projeto.manifesto().documentos.map((d) => d.id));
      const r = (await cb(entrada, ...resto)) as Resultado;
      if (r?.isError) return r;
      const novo = projeto.manifesto().documentos.find((d) => !antes.has(d.id));
      if (!novo) return r;
      const mostrado = mostrar !== false;
      if (mostrado) pedirTela(projeto, {documento: novo.id, caminhos: [], autor});
      const t = r?.content?.[0];
      if (t?.type !== 'text' || typeof t.text !== 'string') return r;
      try {
        const dado = JSON.parse(t.text) as unknown;
        if (!dado || typeof dado !== 'object' || Array.isArray(dado)) return r;
        return {...r, content: [{...t, text: JSON.stringify({...dado, mostrado}, null, 2)}, ...(r.content ?? []).slice(1)]};
      } catch {
        return r;
      }
    });
  };
  (servidor as unknown as {registerTool: typeof envolvido}).registerTool = envolvido;
};

export const registrarTela = (servidor: McpServer, projeto: Projeto, autor: string) => {
  servidor.registerTool('mostrar_documento', {
    description: 'Leva a tela da pessoa para um documento (troca de área e de documento). Com "caminho", seleciona aquele objeto; com "tempo_ms", põe a agulha ali. Use quando a pessoa pedir para ver algo (criar_documento e criar_animacao já levam a tela ao documento novo).',
    inputSchema: {
      documento: z.string().describe('id do documento no manifesto (ou o caminho dele)'),
      caminho: z.string().optional().describe('JSON Pointer do objeto a selecionar, ex.: /camadas/2'),
      tempo_ms: z.number().min(0).optional().describe('onde pôr a agulha, em ms (vídeo, música e animação)'),
    },
  }, async ({documento, caminho, tempo_ms}: {documento: string; caminho?: string; tempo_ms?: number}) => {
    try {
      const m = projeto.manifesto();
      const entrada = m.documentos.find((d) => d.id === documento || d.caminho === documento);
      if (!entrada) throw new ErroProjeto(`documento não achado: ${documento} (ids: ${m.documentos.map((d) => d.id).join(', ')})`, 'nao_achado');
      if (caminho) {
        const {doc} = projeto.lerJson<unknown>(entrada.caminho);
        if (valorEm(doc, caminho) === undefined) throw new ErroProjeto(`o caminho ${caminho} não existe em ${entrada.id}`, 'nao_achado');
      }
      pedirTela(projeto, {documento: entrada.id, caminhos: caminho ? [caminho] : [], ...(tempo_ms !== undefined ? {tempo_ms} : {}), autor});
      return texto({ok: true, documento: entrada.id, modulo: entrada.modulo, titulo: entrada.titulo});
    } catch (e) {
      return erro(e);
    }
  });
};
