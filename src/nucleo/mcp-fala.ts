// Ferramentas MCP dos cortes pela fala (frente Fala, rodada 3; docs/legendas.md, "Cortes pela fala"). Classes de
// permissão: propor_cortes_fala é `livre` (só lê); aplicar_cortes_fala é `livre` (grava um WAV novo em midia/ e o patch
// no diário, que o Reverter desfaz; com voltar, o clipe volta ao arquivo de antes). A conta é de cortes-fala.ts; o WAV,
// do processo principal, que entrega `emendar` pelo transcritor. Registrado com uma linha no fim de registrarFerramentas.
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {ehDocCenas, type DocCenas} from './cenas';
import {acharClipe, conferirCortes, patchDosCortes, patchSemCortes, proporCortes, trechoDoClipe, type CorteFala} from './cortes-fala';
import {arquivoDaFala, arquivoDasPalavras, clipesDeVoz, palavrasValidas, type PalavraLegenda} from './legendas';
import {ErroProjeto, type Projeto} from './projeto';

/** O que o processo principal faz: grava a narração emendada e o palavras.json dela (src/main/cortes-fala.ts). */
export type EmendadorMcp = (projeto: Projeto, pedido: {fonte: string; cortes: {de_ms: number; ate_ms: number}[]; palavras: PalavraLegenda[]}) =>
  Promise<{arquivo: string; palavras: string; sha256?: string; duracao_ms: number; antes_ms: number; removidas: string[]}>;

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

const docDe = (projeto: Projeto, documento?: string) => {
  const alvo = documento ?? projeto.estado()?.documento ?? projeto.manifesto().documentos.find((d) => d.modulo === 'video')?.id;
  if (!alvo) throw new ErroProjeto('o projeto não tem vídeo de cenas', 'nao_achado');
  const rel = projeto.arquivoDoDocumento(alvo);
  const lido = projeto.lerJson<unknown>(rel);
  if (!ehDocCenas(lido.doc)) throw new ErroProjeto(`${alvo} não é um vídeo de cenas`, 'patch');
  return {alvo, rel, doc: lido.doc as DocCenas, versao: lido.versao};
};

/** O clipe pedido, ou o único clipe de voz do vídeo. */
const clipeDe = (doc: DocCenas, id?: string) => {
  if (id) {
    const c = acharClipe(doc.audio, id)?.clipe;
    if (!c) throw new ErroProjeto(`clipe não achado: ${id}`, 'nao_achado');
    return c;
  }
  const voz = clipesDeVoz(doc);
  if (voz.length !== 1) throw new ErroProjeto(voz.length ? `diga o clipe: há ${voz.length} clipes de voz (${voz.map((v) => v.clipe.id).join(', ')})` : 'o vídeo não tem clipe de voz', 'nao_achado');
  return voz[0].clipe;
};

/** As palavras da fala do clipe (a transcrição precisa existir). */
const palavrasDoClipe = (projeto: Projeto, c: ReturnType<typeof clipeDe>) => {
  const caminho = arquivoDasPalavras(arquivoDaFala(c));
  if (!projeto.existe(caminho)) throw new ErroProjeto(`o clipe ${c.id} ainda não tem transcrição: chame transcrever antes`, 'nao_achado');
  return palavrasValidas(projeto.lerJson<unknown>(caminho).doc);
};

/** As três palavras antes e as três depois do corte, para a IA (e a pessoa) saberem onde ele cai. */
const contexto = (palavras: PalavraLegenda[], c: CorteFala) =>
  `${palavras.filter((p) => p.e <= c.de_ms).slice(-3).map((p) => p.w).join(' ')} | ${palavras.filter((p) => p.s >= c.ate_ms).slice(0, 3).map((p) => p.w).join(' ')}`.trim();

export const registrarCortesFala = (servidor: McpServer, projeto: Projeto, autor: string, origem: string, emendar?: EmendadorMcp) => {
  servidor.registerTool('propor_cortes_fala', {
    description: 'Propõe cortes na narração de um clipe de voz do vídeo de cenas, pela transcrição: pausas acima de silencio_min_ms (padrão 700) ficam com pausa_ms (padrão 300), palavras de preenchimento ("ãh", "hum") saem com a pausa em volta e o silêncio das pontas também. Nenhum corte fica a menos de 80 ms de uma palavra. Só propõe: aplique com aplicar_cortes_fala. Tempos em ms do arquivo de áudio.',
    inputSchema: {
      documento: z.string().optional(),
      clipe: z.string().optional().describe('id do clipe de voz (padrão: o único)'),
      silencio_min_ms: z.number().optional(),
      pausa_ms: z.number().optional(),
      preenchimento: z.boolean().optional().describe('tirar "ãh", "hum" (padrão: sim)'),
      pontas: z.boolean().optional().describe('tirar o silêncio antes da primeira palavra e depois da última (padrão: sim)'),
    },
  }, seguro(({documento, clipe, ...o}: {documento?: string; clipe?: string; silencio_min_ms?: number; pausa_ms?: number; preenchimento?: boolean; pontas?: boolean}) => {
    const {alvo, doc} = docDe(projeto, documento);
    const c = clipeDe(doc, clipe);
    const palavras = palavrasDoClipe(projeto, c);
    const cortes = proporCortes(palavras, {...trechoDoClipe(c), ...o});
    const economia = cortes.reduce((s, x) => s + x.ate_ms - x.de_ms, 0);
    return {documento: alvo, clipe: c.id, arquivo: c.arquivo, duracao_ms: c.duracao_ms, economia_ms: economia,
      cortes: cortes.map((x) => ({...x, dura_ms: x.ate_ms - x.de_ms, contexto: contexto(palavras, x)})),
      nota: cortes.length ? 'aplique com aplicar_cortes_fala: todos (sem "cortes") ou só os que a pessoa escolher' : 'nada a cortar'};
  }));

  servidor.registerTool('aplicar_cortes_fala', {
    description: 'Aplica cortes na narração de um clipe de voz: grava um WAV novo sem os trechos (emenda com crossfade de 8 ms), troca o arquivo do clipe por ele e leva as legendas junto (a palavra cortada sai delas). Sem "cortes", aplica os que propor_cortes_fala sugere com os padrões. Recusa corte a menos de 80 ms de uma palavra. Com voltar: true, o clipe volta ao arquivo de antes dos cortes. Vai para o diário: Reverter desfaz.',
    inputSchema: {
      documento: z.string().optional(),
      clipe: z.string().optional().describe('id do clipe de voz (padrão: o único)'),
      cortes: z.array(z.object({de_ms: z.number(), ate_ms: z.number()})).optional().describe('ms do arquivo de áudio, como em propor_cortes_fala'),
      voltar: z.boolean().optional().describe('true: o clipe volta ao arquivo de antes dos cortes'),
    },
  }, seguro(async ({documento, clipe, cortes, voltar}: {documento?: string; clipe?: string; cortes?: {de_ms: number; ate_ms: number}[]; voltar?: boolean}) => {
    const {alvo, rel, doc, versao} = docDe(projeto, documento);
    const c = clipeDe(doc, clipe);
    if (voltar) {
      const patch = patchSemCortes(doc, c.id);
      if (!patch) throw new ErroProjeto(`o clipe ${c.id} não tem cortes pela fala`, 'patch');
      const gravado = projeto.aplicarPatch({documento: rel, versao_base: versao, autor, origem, rotulo: `voltar ao áudio sem cortes: ${c.id}`, patch});
      return {ok: true, documento: alvo, versao: gravado.versao, clipe: c.id, arquivo: c.cortes_fala?.fonte};
    }
    if (!emendar) throw new ErroProjeto('este MCP não grava áudio: abra o projeto no Estúdio (ou use o MCP por stdio)', 'patch');
    const palavras = palavrasDoClipe(projeto, c);
    const lista = cortes?.length ? cortes : proporCortes(palavras, trechoDoClipe(c));
    if (!lista.length) return {ok: true, documento: alvo, clipe: c.id, nada: 'nenhum corte a aplicar'};
    const {problemas} = conferirCortes(palavras, lista);
    if (problemas.length) throw new ErroProjeto(`cortes recusados: ${problemas.join('; ')}`, 'patch');
    const r = await emendar(projeto, {fonte: c.arquivo, cortes: lista, palavras});
    // o documento pode ter mudado enquanto o áudio era gravado: lê de novo e grava sobre a versão nova
    const atual = docDe(projeto, alvo);
    const tirado = r.antes_ms - r.duracao_ms;
    const gravado = projeto.aplicarPatch({documento: atual.rel, versao_base: atual.versao, autor, origem,
      rotulo: `cortes pela fala: ${c.id} (−${(tirado / 1000).toFixed(1).replace('.', ',')} s)`, patch: patchDosCortes(atual.doc, c.id, lista, r)});
    return {ok: true, documento: alvo, versao: gravado.versao, clipe: c.id, arquivo: r.arquivo, cortes: lista.length, tirado_ms: tirado,
      ...(r.removidas.length ? {palavras_tiradas: r.removidas} : {}), nota: 'Reverter, ou aplicar_cortes_fala com voltar: true, desfaz'};
  }));
};
