// Ferramenta MCP salvar_como_modelo (Onda B, tela inicial): o "Salvar como modelo" do menu do ícone do editor, pela mesma
// pasta de modelos (pasta-modelos.ts: a das preferências no app, ESTUDIO_MODELOS ou ~/Estudio/meus-modelos fora dele). É
// "cartao" (portao.ts): grava fora do projeto, sem diário nem Reverter. O modelo aparece em Novo na tela inicial.
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {PastaModelos} from './pasta-modelos';
import {ErroProjeto, type Projeto} from './projeto';

const texto = (x: unknown) => ({content: [{type: 'text' as const, text: typeof x === 'string' ? x : JSON.stringify(x, null, 2)}]});
const erro = (e: unknown) => ({
  isError: true,
  content: [{type: 'text' as const, text: e instanceof ErroProjeto ? `${e.codigo}: ${e.message}` : String((e as Error)?.message ?? e)}],
});

export const registrarModelos = (servidor: McpServer, projeto: Projeto, modelos = new PastaModelos()) => {
  servidor.registerTool('listar_modelos', {
    description: 'Lista os modelos da pessoa (os que ela salvou com salvar_como_modelo, na pasta de modelos dela): id, nome, descrição, módulo, tamanho e documentos. O id vai em criar_projeto {modelo_proprio} para criar um projeto novo a partir de um deles. Os modelos de fábrica não entram aqui (são o "modelo" do criar_projeto). Só lê.',
    inputSchema: {},
  }, async () => {
    try {
      const lista = modelos.listar().map((m) => ({id: m.id, nome: m.nome, ...(m.descricao ? {descricao: m.descricao} : {}), modulo: m.modulo,
        ...(m.largura ? {largura: m.largura, altura: m.altura} : {}), documentos: m.documentos}));
      return texto({modelos: lista, ...(lista.length ? {} : {aviso: 'a pessoa ainda não salvou modelo: salvar_como_modelo guarda o projeto como um'})});
    } catch (e) {
      return erro(e);
    }
  });

  servidor.registerTool('salvar_como_modelo', {
    description: 'Salva o projeto (ou só um documento) como modelo da pessoa, na pasta de modelos dela, fora do projeto: os documentos e a mídia que eles citam (midia/ e fontes/), sem o diário, o git, as conversas nem a pesquisa. O modelo aparece em Novo na tela inicial, ao lado dos de fábrica, e a pessoa o renomeia ou remove por lá. Pede a permissão da pessoa.',
    inputSchema: {
      nome: z.string().min(1).max(80).describe('nome do modelo, como aparece na tela inicial'),
      descricao: z.string().max(200).optional().describe('uma linha sobre para que serve'),
      documento: z.string().optional().describe('id ou caminho de um documento; sem ele, o projeto inteiro'),
    },
  }, async ({nome, descricao, documento}: {nome: string; descricao?: string; documento?: string}) => {
    try {
      const m = projeto.comTrava(() => modelos.salvar(projeto, {nome, descricao, documento}));
      return texto({ok: true, modelo: {id: m.id, nome: m.nome, modulo: m.modulo, documentos: m.documentos, ...(m.largura ? {largura: m.largura, altura: m.altura} : {})},
        copiados: m.copiados, ...(m.faltando.length ? {aviso: `ficaram de fora arquivos citados que não estão no projeto: ${m.faltando.join(', ')}`} : {})});
    } catch (e) {
      return erro(e);
    }
  });
};
