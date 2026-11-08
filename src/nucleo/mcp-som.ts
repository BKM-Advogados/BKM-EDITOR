// Ferramentas MCP do som do vídeo de cenas (rodada 3, frente Som): dividir e copiar clipe de áudio, crossfade, e (nos
// marcos seguintes) gravar a narração e escolher a trilha. Cada uma faz o mesmo que o botão da interface, com a mesma conta
// (clipes-audio.ts), e grava no diário como o agente, com Reverter. Descrições curtas e esquema sem `z.any()` nem união
// solta: valem para o Claude, o Gemini, o DeepSeek e o OpenAI. Classe de permissão de todas: livre (docs/audio.md).
// Chamado por uma linha no fim de registrarFerramentas (ferramentas-mcp.ts).
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {CURVAS_FADE, ehEnvelope, type CurvaFade} from './audio';
import {ehDocCenas, type DocCenas} from './cenas';
import {copiarClipe, crossfadeEntre, dividirClipe, recusou, type ModoCrossfade} from './clipes-audio';
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

/** O vídeo de cenas pedido, ou o que a pessoa está vendo, ou o primeiro vídeo do projeto. */
const docDe = (projeto: Projeto, documento?: string) => {
  const alvo = documento ?? projeto.estado()?.documento ?? projeto.manifesto().documentos.find((d) => d.modulo === 'video')?.id;
  if (!alvo) throw new ErroProjeto('o projeto não tem vídeo de cenas', 'nao_achado');
  const rel = projeto.arquivoDoDocumento(alvo);
  const lido = projeto.lerJson<unknown>(rel);
  if (!ehDocCenas(lido.doc)) throw new ErroProjeto(`${alvo} não é um vídeo de cenas`, 'patch');
  return {alvo, rel, doc: lido.doc as DocCenas, versao: lido.versao};
};

/** Duração de cada arquivo de áudio já medido (do .envelope.json ao lado), para o crossfade saber a sobra. */
const duracoesDosArquivos = (projeto: Projeto, doc: DocCenas) => {
  const out: Record<string, number | undefined> = {};
  for (const f of doc.audio?.faixas ?? []) {
    for (const c of f.clipes ?? []) {
      if (typeof c.arquivo !== 'string' || c.arquivo in out) continue;
      try {
        const rel = `${c.arquivo}.envelope.json`;
        const env = projeto.existe(rel) ? projeto.lerJson<unknown>(rel).doc : undefined;
        out[c.arquivo] = ehEnvelope(env) ? env.duracao_ms : undefined;
      } catch {
        out[c.arquivo] = undefined;
      }
    }
  }
  return out;
};

const seg = (ms: number) => (ms / 1000).toLocaleString('pt-BR', {maximumFractionDigits: 2});

export const registrarSom = (servidor: McpServer, projeto: Projeto, autor: string, origem: string) => {
  servidor.registerTool('dividir_clipe', {
    description: 'Divide um clipe de áudio do vídeo de cenas em dois, no tempo do vídeo (ms). O corte vai para a grade de quadros e as duas metades tocam juntas o mesmo som do clipe inteiro. Volume, mudo, voz limpa e legendas vão junto; o fade de entrada fica na primeira metade e o de saída na segunda. Cada metade tem pelo menos 100 ms.',
    inputSchema: {
      clipe: z.string().describe('id do clipe, em /audio/faixas/N/clipes/M do vídeo'),
      em_ms: z.number().optional().describe('tempo do vídeo em ms; sem ele, onde está a cabeça da pessoa'),
      documento: z.string().optional().describe('id do vídeo; sem ele, o que a pessoa está vendo'),
    },
  }, seguro(({clipe, em_ms, documento}: {clipe: string; em_ms?: number; documento?: string}) => {
    const {alvo, rel, doc, versao} = docDe(projeto, documento);
    const t = em_ms ?? projeto.estado()?.tempo_ms;
    if (t === undefined) throw new ErroProjeto('diga em_ms (o tempo do vídeo em que o clipe se divide): o app não gravou onde está a cabeça', 'patch');
    const r = dividirClipe(doc, clipe, t);
    if (recusou(r)) throw new ErroProjeto(r.erro, 'patch');
    const gravado = projeto.aplicarPatch({documento: rel, versao_base: versao, patch: r.patch, autor, origem, rotulo: `dividir clipe ${clipe} em ${seg(r.corte_ms)} s`});
    return {ok: true, documento: alvo, versao: gravado.versao, corte_ms: r.corte_ms,
      primeiro: {id: r.primeiro.id, em: r.primeiro.em, duracao_ms: r.primeiro.duracao_ms}, segundo: {id: r.segundo.id, em: r.segundo.em, duracao_ms: r.segundo.duracao_ms},
      legendas: r.legendas, ...(r.avisos.length ? {avisos: r.avisos} : {})};
  }));

  servidor.registerTool('copiar_clipe', {
    description: 'Copia um clipe de áudio do vídeo de cenas na mesma faixa, com id novo e as legendas dele. A cópia entra logo depois do original, ou em em_ms (tempo do vídeo).',
    inputSchema: {
      clipe: z.string().describe('id do clipe a copiar'),
      em_ms: z.number().optional().describe('onde a cópia começa, em ms do vídeo; padrão: o fim do original'),
      documento: z.string().optional().describe('id do vídeo; sem ele, o que a pessoa está vendo'),
    },
  }, seguro(({clipe, em_ms, documento}: {clipe: string; em_ms?: number; documento?: string}) => {
    const {alvo, rel, doc, versao} = docDe(projeto, documento);
    const r = copiarClipe(doc, clipe, {em_ms});
    if (recusou(r)) throw new ErroProjeto(r.erro, 'patch');
    const gravado = projeto.aplicarPatch({documento: rel, versao_base: versao, patch: r.patch, autor, origem, rotulo: `copiar clipe ${clipe}`});
    return {ok: true, documento: alvo, versao: gravado.versao, copia: {id: r.copia.id, em: r.copia.em, duracao_ms: r.copia.duracao_ms}, legendas_copiadas: r.legendas_copiadas};
  }));

  servidor.registerTool('crossfade', {
    description: `Crossfade entre dois clipes de áudio da mesma faixa: o fim do que começa antes desce e o começo do outro sobe durante duracao_ms, com os dois tocando juntos. Curvas: ${CURVAS_FADE.join(', ')}. potencia (padrão em música e efeito) mantém o nível no meio quando os sons são diferentes; linear (padrão em voz) vale para a mesma tomada dos dois lados. Modos: estender usa o som que sobra nos arquivos e nada muda de lugar; sobrepor puxa o segundo clipe para trás (ele acaba antes); auto (padrão) estende o que der e sobrepõe o resto.`,
    inputSchema: {
      de: z.string().describe('id de um dos clipes'),
      para: z.string().describe('id do outro clipe, na mesma faixa'),
      duracao_ms: z.number().min(50).max(60000).describe('duração do crossfade em ms'),
      curva: z.enum(['linear', 'suave', 'potencia']).optional(),
      modo: z.enum(['auto', 'estender', 'sobrepor']).optional(),
      documento: z.string().optional().describe('id do vídeo; sem ele, o que a pessoa está vendo'),
    },
  }, seguro(({de, para, duracao_ms, curva, modo, documento}: {de: string; para: string; duracao_ms: number; curva?: CurvaFade; modo?: ModoCrossfade; documento?: string}) => {
    const {alvo, rel, doc, versao} = docDe(projeto, documento);
    const r = crossfadeEntre(doc, {de, para, duracao_ms, curva, modo}, duracoesDosArquivos(projeto, doc));
    if (recusou(r)) throw new ErroProjeto(r.erro, 'patch');
    const gravado = projeto.aplicarPatch({documento: rel, versao_base: versao, patch: r.patch, autor, origem, rotulo: `crossfade de ${seg(r.duracao_ms)} s entre ${de} e ${para}`});
    return {ok: true, documento: alvo, versao: gravado.versao, duracao_ms: r.duracao_ms, curva: r.curva,
      desce: {id: r.de.id, em: r.de.em, duracao_ms: r.de.duracao_ms}, sobe: {id: r.para.id, em: r.para.em, duracao_ms: r.para.duracao_ms},
      ...(r.mudancas.length ? {mudancas: r.mudancas} : {}), ...(r.avisos.length ? {avisos: r.avisos} : {})};
  }));
};
