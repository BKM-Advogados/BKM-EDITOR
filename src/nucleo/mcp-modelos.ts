// Ferramenta MCP salvar_como_modelo (Onda B, tela inicial): o "Salvar como modelo" do menu do ícone do editor, pela mesma
// pasta de modelos (pasta-modelos.ts: a das preferências no app, ESTUDIO_MODELOS ou ~/Estudio/modelos fora dele). É
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
