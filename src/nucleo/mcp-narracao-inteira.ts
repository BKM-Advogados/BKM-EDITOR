// Ferramenta MCP da narração gravada inteira (Onda B, docs/narracao.md): `dividir_narracao` divide uma gravação longa (um
// áudio só) nas cenas do vídeo pela transcrição. Com `previa: true` só devolve a proposta de cortes; sem ela, grava: cada
// cena ganha um clipe com o trecho dela da mesma gravação, a duração da cena se ajusta à fala e as legendas de cada trecho
// saem da transcrição. Classe `livre` (portao.ts): vai para o diário, e o Reverter desfaz. A conta é de narracao-inteira.ts,
// a mesma da tela. Registrado com uma linha em registrarFerramentas.
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {arquivoDasPalavras, fonteDaFala, palavrasValidas} from './legendas';
import {videoDeCenasDe} from './narracao-servico';
import {gravacaoDe, patchDaDivisao, proporDivisao, type PropostaDivisao} from './narracao-inteira';
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
const seg = (ms: number) => (ms / 1000).toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1});

/** A proposta em segundos, curta, para a IA mostrar à pessoa. */
export const resumoDaProposta = (p: PropostaDivisao) => ({
  metodo: p.metodo,
  palavras: p.palavras,
  trechos: p.trechos.map((t) => ({cena: t.cena, n: t.n, ...(t.de_ms === null || t.ate_ms === null ? {sem_fala: true}
    : {de_ms: t.de_ms, ate_ms: t.ate_ms, trecho: `${seg(t.de_ms)}–${seg(t.ate_ms)} s`, texto: t.texto}), metodo: t.metodo, ...(t.acerto !== undefined ? {acerto: t.acerto} : {})})),
  cortes: p.cortes.map((c) => ({ms: c.ms, entre_cenas: c.entre, pausa_ms: c.pausa_ms, onde: `${c.antes} | ${c.depois}`})),
  ...(p.avisos.length ? {avisos: p.avisos} : {}),
});

export const registrarNarracaoInteira = (servidor: McpServer, projeto: Projeto, autor: string, origem: string) => {
  servidor.registerTool('dividir_narracao', {
    description: 'Divide uma narração gravada inteira (um áudio só, já transcrito com transcrever {arquivo}) nas cenas do vídeo. Com o texto falado das cenas (cenas[i].narracao.texto), alinha o texto à transcrição (sem diferença de acento, caixa e pontuação, tolerante a palavra trocada); sem texto, corta nas pausas mais longas. O corte cai sempre numa pausa entre palavras. Com previa: true, devolve a proposta (o trecho de cada cena em ms do arquivo, o texto ouvido e os cortes) sem gravar — mostre à pessoa antes. Sem previa, grava: cada cena ganha um clipe com o trecho dela da MESMA gravação (corte_ms e duracao_ms; o arquivo não é cortado), a cena passa a durar folga + trecho + margem (como ajustar_cenas_a_fala, e o resto do som anda junto) e as legendas de cada trecho saem da transcrição (a âncora em_palavra acha a fala de cada cena). "cortes" (ms do arquivo) troca a proposta pelos cortes dados, cada um na pausa mais perto. O clipe da gravação inteira, uma divisão anterior dela e a fala por IA das cenas que ganham trecho saem. Vai para o diário: Reverter desfaz.',
    inputSchema: {
      arquivo: z.string().optional().describe('a gravação em midia/ (ex.: midia/narracao.wav); sem ele, a única gravação nos clipes de voz'),
      clipe: z.string().optional().describe('o clipe da gravação no vídeo, quando há mais de um'),
      previa: z.boolean().optional().describe('true: só a proposta, sem gravar'),
      cortes: z.array(z.number().min(0)).optional().describe('cortes à mão, em ms do arquivo (no máximo cenas − 1), no lugar da proposta'),
      margem_corte_ms: z.number().min(0).max(2000).optional().describe('quanto o trecho pega antes da primeira e depois da última palavra da cena (padrão 200)'),
      margem_ms: z.number().min(0).max(10000).optional().describe('o que sobra na cena depois da fala (padrão: o da configuração da narração, 500)'),
      documento: z.string().optional().describe('id do vídeo; sem ele, o que a pessoa está vendo'),
    },
  }, seguro(({arquivo, clipe, previa, cortes, margem_corte_ms, margem_ms, documento}: {arquivo?: string; clipe?: string; previa?: boolean; cortes?: number[];
    margem_corte_ms?: number; margem_ms?: number; documento?: string}) => {
    const {alvo, rel, doc, versao} = videoDeCenasDe(projeto, documento);
    let g: ReturnType<typeof gravacaoDe>;
    try {
      g = gravacaoDe(doc, {arquivo, clipe});
    } catch (e) {
      throw new ErroProjeto((e as Error).message, /não achado|diga a gravação/.test((e as Error).message) ? 'nao_achado' : 'patch');
    }
    const caminho = arquivoDasPalavras(g.arquivo);
    if (!projeto.existe(caminho)) {
      if (!projeto.existe(g.arquivo)) throw new ErroProjeto(`a gravação ${g.arquivo} não está no projeto`, 'nao_achado');
      throw new ErroProjeto(`${g.arquivo} ainda não tem transcrição: chame transcrever {arquivo: "${g.arquivo}"} antes`, 'nao_achado');
    }
    const lido = projeto.lerJson<unknown>(caminho).doc;
    const palavras = palavrasValidas(lido);
    let duracao_ms: number | undefined;
    try {
      const env = projeto.existe(`${g.arquivo}.envelope.json`) ? projeto.lerJson<{duracao_ms?: unknown}>(`${g.arquivo}.envelope.json`).doc : undefined;
      if (typeof env?.duracao_ms === 'number') duracao_ms = env.duracao_ms;
    } catch {
      /* sem a medida, o fim do último trecho é o da última palavra mais a margem */
    }
    let proposta: PropostaDivisao;
    try {
      proposta = proporDivisao(palavras, doc.cenas.map((c) => ({id: c.id, texto: c.narracao?.texto})), {margem_ms: margem_corte_ms, duracao_ms, cortes});
    } catch (e) {
      throw new ErroProjeto((e as Error).message, 'patch');
    }
    const base = {documento: alvo, arquivo: g.arquivo, ...(g.clipe ? {clipe: g.clipe} : {})};
    if (previa) return {...base, ...resumoDaProposta(proposta), nota: 'nada foi gravado: chame dividir_narracao sem previa para aplicar (ou com "cortes" para mudar algum)'};
    let r: ReturnType<typeof patchDaDivisao>;
    try {
      r = patchDaDivisao(doc, {arquivo: g.arquivo, proposta, palavras, caminhoPalavras: caminho, sha256: fonteDaFala(lido)?.sha256, clipe: g.clipe, margem_ms});
    } catch (e) {
      throw new ErroProjeto((e as Error).message, 'patch');
    }
    const gravado = projeto.aplicarPatch({documento: rel, versao_base: versao, patch: r.patch, autor, origem,
      rotulo: `narração gravada dividida em ${r.clipes.length} ${r.clipes.length === 1 ? 'cena' : 'cenas'}`});
    return {ok: true, ...base, versao: gravado.versao, metodo: proposta.metodo, faixa: r.faixa,
      clipes: r.clipes.map((c) => ({cena: c.cena, n: c.n, clipe: c.id, trecho: `${seg(c.corte_ms)}–${seg(c.corte_ms + c.duracao_ms)} s`, em_ms: c.em, duracao_ms: c.duracao_ms})),
      mudancas: r.mudancas.map((m) => ({...m, texto: `cena ${m.n}: ${seg(m.antes_ms)} s → ${seg(m.depois_ms)} s`})), legendas: r.legendas,
      ...([...proposta.avisos, ...r.avisos].length ? {avisos: [...proposta.avisos, ...r.avisos]} : {}), nota: 'Reverter desfaz tudo de uma vez'};
  }));
};
