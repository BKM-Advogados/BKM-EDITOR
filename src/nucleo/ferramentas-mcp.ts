// Ferramentas do MCP "estudio", as mesmas por stdio (mcp/nucleo.ts, fora do app) e por HTTP (o app, uma conexão
// por aba do Claude). O autor e a origem vão para o diário, para a pessoa ver quem mudou o quê.
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {ErroProjeto, valorEm, type Projeto} from './projeto';
import type {OperacaoPatch} from './documentos';

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

export const registrarFerramentas = (servidor: McpServer, projeto: Projeto, autor: string, origem: string) => {
  servidor.registerTool('projeto_info', {
    description: 'Nome do projeto, documentos (id, módulo, caminho) e quantos comentários estão abertos.',
    inputSchema: {},
  }, seguro(() => ({
    pasta: projeto.raiz,
    ...projeto.manifesto(),
    comentarios_abertos: projeto.comentarios().filter((c) => c.estado === 'aberto').length,
  })));

  servidor.registerTool('estado_do_editor', {
    description: 'O que a pessoa está vendo agora no app: área (video, imagem, 3d, efeitos), documento, objeto selecionado (caminho JSON Pointer) e tempo do vídeo.',
    inputSchema: {},
  }, seguro(() => {
    const e = projeto.estado();
    if (!e) return 'o app ainda não gravou estado (projeto fechado ou recém-aberto)';
    if (!e.documento || !e.selecao) return e;
    const {doc} = projeto.lerJson(projeto.arquivoDoDocumento(e.documento));
    return {...e, objeto_selecionado: valorEm(doc, e.selecao)};
  }));

  servidor.registerTool('ler_documento', {
    description: 'Lê um documento (pelo id do manifesto ou caminho). Devolve o JSON e a versão, que vai em versao_base no aplicar_patch. Com "caminho", devolve só aquele trecho.',
    inputSchema: {documento: z.string(), caminho: z.string().optional().describe('JSON Pointer, ex.: /cenas/2/blocos/1')},
  }, seguro(({documento, caminho}: {documento: string; caminho?: string}) => {
    const rel = projeto.arquivoDoDocumento(documento);
    const {doc, versao} = projeto.lerJson(rel);
    return {documento: rel, versao, conteudo: caminho ? valorEm(doc, caminho) : doc};
  }));

  servidor.registerTool('aplicar_patch', {
    description: 'Muda um documento com JSON Patch (RFC 6902), de forma atômica. Passe a versao_base lida em ler_documento e um "test" no valor que vai trocar; se o documento mudou por baixo, nada é gravado e você deve ler de novo. A tela do app atualiza sozinha.',
    inputSchema: {
      documento: z.string(),
      versao_base: z.string(),
      patch: z.array(z.object({op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']), path: z.string(), value: z.any().optional(), from: z.string().optional()})),
      rotulo: z.string().optional().describe('o que a mudança faz, em poucas palavras'),
    },
  }, seguro(({documento, versao_base, patch, rotulo}: {documento: string; versao_base: string; patch: OperacaoPatch[]; rotulo?: string}) => {
    const r = projeto.aplicarPatch({documento, versao_base, patch, autor: autor, origem, rotulo});
    return {ok: true, versao: r.versao, seq: r.entrada.seq};
  }));

  servidor.registerTool('listar_comentarios', {
    description: 'Comentários da pessoa. Por padrão só os abertos.',
    inputSchema: {estado: z.enum(['aberto', 'resolvido', 'todos']).optional(), documento: z.string().optional()},
  }, seguro(({estado = 'aberto', documento}: {estado?: 'aberto' | 'resolvido' | 'todos'; documento?: string}) =>
    projeto.comentarios()
      .filter((c) => estado === 'todos' || c.estado === estado)
      .filter((c) => !documento || c.documento === documento)
      .map((c) => ({id: c.id, documento: c.documento, estado: c.estado, texto: c.texto, objeto: c.alvo.objeto, tempo_ms: c.alvo.tempo_ms, respostas: c.respostas.length}))));

  servidor.registerTool('ler_comentario', {
    description: 'Um comentário com o alvo resolvido: o trecho do documento comentado (objeto), a versão do documento e as respostas.',
    inputSchema: {id: z.string()},
  }, seguro(({id}: {id: string}) => {
    const c = projeto.comentarios().find((x) => x.id === id);
    if (!c) throw new ErroProjeto(`comentário não achado: ${id}`, 'nao_achado');
    const rel = projeto.arquivoDoDocumento(c.documento);
    const {doc, versao} = projeto.lerJson(rel);
    const objeto = c.alvo.objeto ? valorEm(doc, c.alvo.objeto) : undefined;
    return {...c, arquivo: rel, versao, objeto_atual: objeto ?? (c.alvo.objeto ? 'o caminho não existe mais: procure pelo objeto_id ou pelo contexto' : undefined)};
  }));

  servidor.registerTool('responder_comentario', {
    description: 'Responde a um comentário (aparece para a pessoa no painel de comentários).',
    inputSchema: {id: z.string(), texto: z.string()},
  }, seguro(({id, texto: t}: {id: string; texto: string}) => projeto.responder(id, autor, t)));

  servidor.registerTool('resolver_comentario', {
    description: 'Marca um comentário como resolvido, com uma nota do que foi feito.',
    inputSchema: {id: z.string(), nota: z.string().optional()},
  }, seguro(({id, nota}: {id: string; nota?: string}) => projeto.resolver(id, autor, nota)));

  servidor.registerTool('listar_mudancas', {
    description: 'Diário de mudanças desde um número de sequência: quem mudou (pessoa ou agente), o rótulo e o patch. Use para ver o que a pessoa editou à mão.',
    inputSchema: {desde: z.number().optional(), autor: z.string().optional()},
  }, seguro(({desde = 0, autor}: {desde?: number; autor?: string}) =>
    projeto.diario(desde).filter((e) => !autor || e.autor === autor).map(({inverso: _i, ...e}) => e)));
};
