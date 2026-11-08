// Ferramentas MCP da mídia do projeto (frente Casca, rodada 3; docs/casca.md). O painel de mídia da interface e a IA veem a
// mesma lista: `listar_midia` mostra o que há em midia/ (com os derivados sob o original, a duração, as dimensões, a marca da
// tomada e onde cada arquivo é usado) e `marcar_midia` marca uma tomada como boa ou descartada, com uma nota.
// Classe de permissão: as duas são `livre`. A primeira só lê; a segunda grava só midia/marcas.json, entra no diário com o patch
// e o inverso (tem Ver e Reverter) e não apaga nem move nenhum arquivo de mídia.
// Esquema sem z.any() nem união solta, descrições curtas e resultado enxuto: serve a qualquer provedor de IA.
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {duracaoCurta, filtrarMidia, tamanhoCurto, ROTULO_DERIVADO, type EntradaMidia} from './midia';
import {documentosQueUsam, indiceDaMidia, marcarMidia} from './midia-disco';
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

const LIMITE_PADRAO = 50;

/** A entrada como a IA a lê: poucos campos, só os que existem. */
const resumo = (e: EntradaMidia, usos: string[] | undefined) => ({
  caminho: e.caminho,
  tipo: e.tipo,
  tamanho: tamanhoCurto(e.tamanho),
  ...(e.duracao_ms !== undefined ? {duracao: duracaoCurta(e.duracao_ms), duracao_ms: e.duracao_ms} : {}),
  ...(e.largura !== undefined ? {largura: e.largura, altura: e.altura} : {}),
  ...(e.marca?.estado ? {marca: e.marca.estado} : {}),
  ...(e.marca?.nota ? {nota: e.marca.nota} : {}),
  ...(e.derivados.length ? {derivados: e.derivados.map((d) => ({tipo: ROTULO_DERIVADO[d.tipo], ...(d.detalhe ? {detalhe: d.detalhe} : {}), caminho: d.caminho}))} : {}),
  ...(usos?.length ? {usada_em: usos} : {}),
});

export const registrarMidia = (servidor: McpServer, projeto: Projeto, autor: string, origem: string) => {
  servidor.registerTool('listar_midia', {
    description: 'Arquivos de midia/ com tipo, tamanho, duração (áudio e vídeo), dimensões (imagem), marca da tomada e onde são usados. Transcrição, loudness medido, voz limpa e recorte sem fundo vêm dentro do arquivo de origem. "busca" acha por palavras no nome, na pasta, na nota e nos derivados ("transcrito", "sem fundo").',
    inputSchema: {
      busca: z.string().optional().describe('palavras; todas têm de aparecer'),
      tipo: z.enum(['video', 'audio', 'imagem', 'outro']).optional(),
      pasta: z.string().optional().describe('ex.: midia/tomadas; inclui as subpastas'),
      marca: z.enum(['boa', 'descartada', 'sem_marca']).optional(),
      ordem: z.enum(['nome', 'recentes', 'tamanho']).optional(),
      limite: z.number().int().min(1).max(200).optional().describe(`padrão ${LIMITE_PADRAO}`),
    },
  }, seguro(({busca, tipo, pasta, marca, ordem, limite}: {busca?: string; tipo?: 'video' | 'audio' | 'imagem' | 'outro'; pasta?: string; marca?: 'boa' | 'descartada' | 'sem_marca'; ordem?: 'nome' | 'recentes' | 'tamanho'; limite?: number}) => {
    const indice = indiceDaMidia(projeto);
    const achados = filtrarMidia(indice.entradas, {busca, tipo, pasta, marca, ordem});
    const mostrados = achados.slice(0, limite ?? LIMITE_PADRAO);
    const usos = documentosQueUsam(projeto, mostrados.map((e) => e.caminho));
    return {
      total_no_projeto: indice.total,
      achados: achados.length,
      mostrados: mostrados.length,
      ...(indice.total === 0 ? {aviso: 'midia/ está vazia: traga um arquivo pela interface ou copie para a pasta midia/ do projeto'} : {}),
      arquivos: mostrados.map((e) => resumo(e, usos[e.caminho])),
    };
  }));

  servidor.registerTool('marcar_midia', {
    description: 'Marca uma tomada de midia/ como boa ou descartada e/ou escreve uma nota (grava só midia/marcas.json; nenhum arquivo de mídia é apagado nem movido). estado "nenhuma" tira a marca. Devolve o seq do diário, para Ver e Reverter.',
    inputSchema: {
      caminho: z.string().describe('ex.: midia/narracao.wav; o arquivo original, não um derivado'),
      estado: z.enum(['boa', 'descartada', 'nenhuma']).optional(),
      nota: z.string().max(500).optional().describe('texto vazio apaga a nota'),
    },
  }, seguro(({caminho, estado, nota}: {caminho: string; estado?: 'boa' | 'descartada' | 'nenhuma'; nota?: string}) => {
    if (estado === undefined && nota === undefined) throw new ErroProjeto('passe "estado" e/ou "nota"', 'patch');
    return marcarMidia(projeto, caminho, {...(estado !== undefined ? {estado: estado === 'nenhuma' ? null : estado} : {}), ...(nota !== undefined ? {nota} : {})}, {autor, origem});
  }));
};
