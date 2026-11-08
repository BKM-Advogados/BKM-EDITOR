// Ferramentas do MCP "estudio" para a seleção e o layout da imagem (frente B2, rodada 3): selecionar camadas na tela da
// pessoa, alinhar e distribuir. As camadas vêm por id (único no documento) ou por caminho, todas da mesma página. As
// contas são as do monitor (src/nucleo/layout-imagem.ts); cada mudança é um patch com autor e origem, no diário e com
// Reverter. Classe de permissão de todas: livre (docs/imagem.md). Esquemas sem união solta, para qualquer provedor.
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import path from 'node:path';
import {z} from 'zod';
import {ErroProjeto, PASTA_INTERNA, serializar, type Projeto} from './projeto';
import type {DocImagem} from './documentos';
import {baseCamadas, caminhosDoId, indiceNaBase, paginasDe, temPaginas} from './carrossel';
import {ALINHAMENTOS, alinhar, alvoDoAlinhamento, DISTRIBUICOES, distribuir, patchMover, type Alinhamento, type Distribuicao} from './layout-imagem';

const texto = (x: unknown) => ({content: [{type: 'text' as const, text: typeof x === 'string' ? x : JSON.stringify(x)}]});
const seguro = <A,>(f: (a: A) => unknown) => async (a: A) => {
  try {
    return texto(await f(a));
  } catch (e) {
    return {isError: true, content: [{type: 'text' as const, text: e instanceof ErroProjeto ? `${e.codigo}: ${e.message}` : String((e as Error)?.message ?? e)}]};
  }
};

/** Camadas pedidas (ids ou caminhos) na página delas: índices, caminhos e a base. Recusa id repetido (página duplicada),
 *  camada que não existe e camadas de páginas diferentes. */
export const resolverCamadas = (doc: DocImagem, refs: string[]) => {
  if (!Array.isArray(doc?.camadas) && !Array.isArray(doc?.paginas)) throw new ErroProjeto('o documento não é uma imagem', 'patch');
  const caminhos = refs.map((r) => {
    if (r.startsWith('/')) return r;
    const achados = caminhosDoId(doc, r);
    if (achados.length > 1) throw new ErroProjeto(`o id ${r} está em ${achados.length} camadas (${achados.join(', ')}): passe o caminho`, 'patch');
    if (!achados.length) throw new ErroProjeto(`camada não achada: ${r}`, 'nao_achado');
    return achados[0];
  });
  const paginas = paginasDe(doc);
  let p = -1;
  const indices = caminhos.map((c) => {
    const q = paginas.findIndex((_, k) => indiceNaBase(c, baseCamadas(doc, k)) >= 0);
    const i = q >= 0 ? indiceNaBase(c, baseCamadas(doc, q)) : -1;
    if (q < 0 || !paginas[q].camadas?.[i]) throw new ErroProjeto(`camada não achada: ${c}`, 'nao_achado');
    if (p >= 0 && q !== p) throw new ErroProjeto('as camadas precisam ser da mesma página', 'patch');
    p = q;
    return i;
  });
  const base = baseCamadas(doc, Math.max(0, p));
  return {pagina: Math.max(0, p), base, indices: [...new Set(indices)], caminhos: [...new Set(indices)].map((i) => `${base}/${i}`)};
};

const camadasSchema = z.array(z.string().min(1)).max(200).describe('ids (únicos no documento) ou caminhos, como /paginas/1/camadas/0');

export const registrarImagem = (servidor: McpServer, projeto: Projeto, autor: string, origem: string) => {
  const ler = (documento: string) => {
    const rel = projeto.arquivoDoDocumento(documento);
    return {rel, ...projeto.lerJson<DocImagem>(rel)};
  };

  servidor.registerTool('selecionar_camadas', {
    description: 'Seleciona camadas da imagem na tela da pessoa (a página delas vem para a frente). Lista vazia limpa a seleção.',
    inputSchema: {documento: z.string(), camadas: camadasSchema},
  }, seguro(({documento, camadas}: {documento: string; camadas: string[]}) => {
    const {doc} = ler(documento);
    const r = camadas.length ? resolverCamadas(doc, camadas) : {caminhos: [] as string[], pagina: 0};
    const id = projeto.manifesto().documentos.find((d) => d.id === documento || d.caminho === documento)?.id ?? documento;
    projeto.gravarTexto(path.join(PASTA_INTERNA, 'selecao.json'), serializar({documento: id, caminhos: r.caminhos, autor, em: new Date().toISOString()}));
    return {ok: true, documento: id, caminhos: r.caminhos, ...(temPaginas(doc) && r.caminhos.length ? {pagina: `/paginas/${r.pagina}`} : {})};
  }));

  servidor.registerTool('alinhar_camadas', {
    description: 'Alinha camadas da imagem. Com uma camada, à prancheta; com várias, à caixa delas (ou à prancheta com alvo "prancheta").',
    inputSchema: {
      documento: z.string(),
      camadas: camadasSchema,
      como: z.enum(ALINHAMENTOS as [Alinhamento, ...Alinhamento[]]).describe('esquerda, centro e direita na horizontal; topo, meio e base na vertical'),
      alvo: z.enum(['selecao', 'prancheta']).optional(),
    },
  }, seguro(({documento, camadas, como, alvo}: {documento: string; camadas: string[]; como: Alinhamento; alvo?: 'selecao' | 'prancheta'}) => {
    const {doc, versao} = ler(documento);
    if (!camadas.length) throw new ErroProjeto('passe ao menos uma camada', 'patch');
    const r = resolverCamadas(doc, camadas);
    const cs = r.indices.map((i) => paginasDe(doc)[r.pagina].camadas[i]);
    const caixa = alvo === 'prancheta' ? {x: 0, y: 0, w: doc.largura, h: doc.altura} : alvoDoAlinhamento(cs, {largura: doc.largura, altura: doc.altura});
    const patch = patchMover(paginasDe(doc)[r.pagina].camadas, r.base, r.indices, alinhar(cs, como, caixa));
    if (!patch.length) return {ok: true, movidas: 0, aviso: 'já estavam alinhadas'};
    const feito = projeto.aplicarPatch({documento, versao_base: versao, patch, autor, origem, rotulo: `alinhar (${como}) ${r.indices.length} camada(s)`});
    return {ok: true, movidas: patch.filter((o) => o.op === 'test').length, versao: feito.versao};
  }));

  servidor.registerTool('distribuir_camadas', {
    description: 'Distribui três camadas ou mais da imagem com o mesmo espaço entre elas; a primeira e a última ficam.',
    inputSchema: {documento: z.string(), camadas: camadasSchema, eixo: z.enum(DISTRIBUICOES as [Distribuicao, ...Distribuicao[]])},
  }, seguro(({documento, camadas, eixo}: {documento: string; camadas: string[]; eixo: Distribuicao}) => {
    const {doc, versao} = ler(documento);
    const r = resolverCamadas(doc, camadas);
    if (r.indices.length < 3) throw new ErroProjeto('distribuir pede três camadas ou mais', 'patch');
    const cs = r.indices.map((i) => paginasDe(doc)[r.pagina].camadas[i]);
    const patch = patchMover(paginasDe(doc)[r.pagina].camadas, r.base, r.indices, distribuir(cs, eixo));
    if (!patch.length) return {ok: true, movidas: 0, aviso: 'já estavam distribuídas'};
    const feito = projeto.aplicarPatch({documento, versao_base: versao, patch, autor, origem, rotulo: `distribuir na ${eixo} ${r.indices.length} camadas`});
    return {ok: true, movidas: patch.filter((o) => o.op === 'test').length, versao: feito.versao};
  }));
};
