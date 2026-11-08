// Ferramentas do MCP "estudio" para a seleção e o layout da imagem (frente B2, rodada 3): selecionar camadas na tela da
// pessoa, alinhar, distribuir, agrupar, desagrupar, travar e destravar. As camadas vêm por id (único no documento) ou
// por caminho, todas da mesma página. As contas são as do monitor (src/nucleo/layout-imagem.ts); cada mudança é um patch
// com autor e origem, no diário e com Reverter. Classe de permissão: livre, menos destravar_camadas (cartão: desfaz uma
// trava que a pessoa pôs). Esquemas sem união solta, para qualquer provedor. Ver docs/imagem.md.
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import path from 'node:path';
import {z} from 'zod';
import {ErroProjeto, PASTA_INTERNA, serializar, type Projeto} from './projeto';
import type {DocImagem, OperacaoPatch} from './documentos';
import {baseCamadas, caminhosDoId, indiceNaBase, paginasDe, temPaginas} from './carrossel';
import {ALINHAMENTOS, DISTRIBUICOES, patchAgrupar, patchDesagrupar, patchMover, patchTravar, planoAlinhar, planoDistribuir, unidadesDe, type Alinhamento, type Distribuicao} from './layout-imagem';
import {destravando} from './travas-imagem';

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
    description: 'Alinha camadas da imagem. Com uma camada (ou um grupo), à prancheta; com várias, à caixa delas. Grupo anda inteiro; travada fica.',
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
    const lista = paginasDe(doc)[r.pagina].camadas;
    const plano = planoAlinhar(lista, r.indices, como, {largura: doc.largura, altura: doc.altura}, alvo === 'prancheta' ? {x: 0, y: 0, w: doc.largura, h: doc.altura} : undefined);
    const patch = patchMover(lista, r.base, plano.indices, plano.desl);
    if (!patch.length) return {ok: true, movidas: 0, aviso: r.indices.some((i) => lista[i]?.travada) ? 'nada andou: as camadas que andariam estão travadas' : 'já estavam alinhadas'};
    const feito = projeto.aplicarPatch({documento, versao_base: versao, patch, autor, origem, rotulo: `alinhar (${como}) ${r.indices.length} camada(s)`});
    return {ok: true, movidas: patch.filter((o) => o.op === 'test').length, versao: feito.versao};
  }));

  servidor.registerTool('distribuir_camadas', {
    description: 'Distribui três camadas ou mais da imagem com o mesmo espaço entre elas; a primeira e a última ficam.',
    inputSchema: {documento: z.string(), camadas: camadasSchema, eixo: z.enum(DISTRIBUICOES as [Distribuicao, ...Distribuicao[]])},
  }, seguro(({documento, camadas, eixo}: {documento: string; camadas: string[]; eixo: Distribuicao}) => {
    const {doc, versao} = ler(documento);
    const r = resolverCamadas(doc, camadas);
    const lista = paginasDe(doc)[r.pagina].camadas;
    if (unidadesDe(lista, r.indices).length < 3) throw new ErroProjeto('distribuir pede três camadas ou mais (cada grupo conta como uma)', 'patch');
    const plano = planoDistribuir(lista, r.indices, eixo);
    const patch = patchMover(lista, r.base, plano.indices, plano.desl);
    if (!patch.length) return {ok: true, movidas: 0, aviso: 'já estavam distribuídas'};
    const feito = projeto.aplicarPatch({documento, versao_base: versao, patch, autor, origem, rotulo: `distribuir na ${eixo} ${r.indices.length} camadas`});
    return {ok: true, movidas: patch.filter((o) => o.op === 'test').length, versao: feito.versao};
  }));

  const mudarCamadas = (nome: string, descricao: string, minimo: number, fazer: (doc: DocImagem, r: ReturnType<typeof resolverCamadas>) => {patch: OperacaoPatch[]; rotulo: string; extra?: object}, embrulho = <T,>(f: () => T) => f()) =>
    servidor.registerTool(nome, {description: descricao, inputSchema: {documento: z.string(), camadas: camadasSchema}},
      seguro(({documento, camadas}: {documento: string; camadas: string[]}) => {
        const {doc, versao} = ler(documento);
        if (camadas.length < minimo) throw new ErroProjeto(`passe ${minimo === 1 ? 'ao menos uma camada' : `${minimo} camadas ou mais`}`, 'patch');
        const r = resolverCamadas(doc, camadas);
        const {patch, rotulo, extra} = fazer(doc, r);
        if (!patch.length) return {ok: true, mudou: false, ...extra};
        const feito = embrulho(() => projeto.aplicarPatch({documento, versao_base: versao, patch, autor, origem, rotulo}));
        return {ok: true, mudou: true, versao: feito.versao, ...extra};
      }));

  mudarCamadas('agrupar_camadas', 'Agrupa camadas da imagem: escolhidas e movidas juntas, vizinhas na pilha.', 2, (doc, r) => {
    const g = patchAgrupar(paginasDe(doc)[r.pagina].camadas, r.base, r.indices);
    if (!g) throw new ErroProjeto('agrupar pede duas camadas ou mais', 'patch');
    return {patch: g.patch, rotulo: `agrupar ${r.indices.length} camadas (${g.grupo})`, extra: {grupo: g.grupo, caminhos: g.caminhos}};
  });
  mudarCamadas('desagrupar_camadas', 'Desfaz os grupos das camadas pedidas (o grupo inteiro).', 1, (doc, r) =>
    ({patch: patchDesagrupar(paginasDe(doc)[r.pagina].camadas, r.base, r.indices), rotulo: 'desagrupar'}));
  mudarCamadas('travar_camadas', 'Trava camadas da imagem: não andam na tela e patch da IA nelas é recusado.', 1, (doc, r) =>
    ({patch: patchTravar(paginasDe(doc)[r.pagina].camadas, r.base, r.indices, true), rotulo: `travar ${r.indices.length} camada(s)`}));
  mudarCamadas('destravar_camadas', 'Destrava camadas que a pessoa travou. Peça o ok dela antes.', 1, (doc, r) =>
    ({patch: patchTravar(paginasDe(doc)[r.pagina].camadas, r.base, r.indices, false), rotulo: `destravar ${r.indices.length} camada(s)`}), destravando);
};
