// Gerar a narração por IA de um vídeo de cenas, com cache (docs/narracao.md). O mesmo código serve à tela (pelo processo
// principal, com a chave do cofre) e ao MCP (por HTTP no app, ou por stdio com a chave das variáveis de ambiente): quem
// chama entrega o ServicoNarracao, que sabe achar a chave, fazer o fetch e dizer o preço. A chave nunca sai daqui para a
// tela nem para o documento.
//
// Cache: midia/narracao/<hash>.wav, em que o hash é o do pedido (texto já com as pronúncias + provedor + modelo + voz +
// parâmetros). Mudou só a cena 3: só a cena 3 vai ao Google. Ao lado de cada WAV ficam o envelope de loudness
// (<hash>.wav.envelope.json, medido aqui mesmo, das amostras, para o ducking valer na hora, também fora do app) e uma
// ficha (.estudio/narracao/<hash>.json, fora de midia/ para não aparecer no painel Mídia) com o texto, a voz e a data.
import {mkdirSync, readFileSync, renameSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {envelopeDeAmostras} from './audio';
import {ehDocCenas, type DocCenas} from './cenas';
import {amostrasDoWav16, configDaNarracao, ErroNarracao, FRASE_AMOSTRA, hashDaFala, lerWav16, medirFala, NOMES_PROVEDOR, textoFalado,
  VOZES_CHIRP, type ConfigNarracao, type ConfigNarracaoN, type CustoNarracao, type MedidaFala, type ProvedorNarracao, type VozNarracao} from './narracao';
import {escolherCenas, itensDaNarracao, patchDasFalas, type ItemNarracao} from './narracao-cenas';
import {sintetizarCloudTts, vozesCloudTts} from './narracao-cloud-tts';
import {sintetizarGemini, vozesGemini, type SomGerado} from './narracao-gemini';
import {sha256DoArquivo} from './pasta-trilhas';
import {ErroProjeto, type Projeto} from './projeto';

/** O que quem chama entrega: a chave de cada provedor (do cofre no app, do ambiente no stdio), o fetch (o falso nos testes,
 *  o net.fetch no app), o preço (src/main/ia/precos.ts) e onde somar o uso do mês. */
export type ServicoNarracao = {
  chave: (p: ProvedorNarracao) => string | undefined;
  /** De onde a chave viria, para a mensagem de "falta a chave". */
  ondePorChave?: (p: ProvedorNarracao) => string;
  fetch?: typeof fetch;
  custo?: (p: ProvedorNarracao, modelo: string, m: MedidaFala, quando?: Date) => CustoNarracao | undefined;
  aoUso?: (p: ProvedorNarracao, modelo: string, u: {entrada: number; saida: number; caracteres: number}, custo?: number) => void;
};

const ONDE_PADRAO: Record<ProvedorNarracao, string> = {
  gemini: 'ponha a chave do Gemini em Configurações › IA (a mesma das conversas) ou na variável GEMINI_API_KEY',
  'google-tts': 'ponha a chave do Google Cloud TTS em Configurações › IA ou na variável GOOGLE_TTS_API_KEY',
};

export const exigirChave = (servico: ServicoNarracao, p: ProvedorNarracao) => {
  const c = servico.chave(p);
  if (!c) throw new ErroNarracao(`falta a chave do ${NOMES_PROVEDOR[p]}: ${servico.ondePorChave?.(p) ?? ONDE_PADRAO[p]}`, 'sem_chave');
  return c;
};

/** Chama o provedor da configuração com o texto final (já com pronúncias e pausas). */
export const sintetizar = async (servico: ServicoNarracao, cfg: ConfigNarracaoN, texto_final: string, sinal?: AbortSignal): Promise<SomGerado> => {
  const chave = exigirChave(servico, cfg.provedor);
  if (cfg.provedor === 'gemini') return sintetizarGemini({chave, modelo: cfg.modelo, voz: cfg.voz, texto: texto_final, estilo: cfg.estilo, fetch: servico.fetch, sinal});
  return sintetizarCloudTts({chave, voz: cfg.voz, texto: texto_final, velocidade: cfg.velocidade, fetch: servico.fetch, sinal});
};

/** As vozes do provedor. Gemini: as 30 prontas e, com a chave, a biblioteca estendida em português. Cloud TTS: a lista do Google
 *  (pede a chave; sem ela, o catálogo das 30, com aviso). */
export const listarVozes = async (servico: ServicoNarracao, p: ProvedorNarracao, sinal?: AbortSignal): Promise<{provedor: ProvedorNarracao; vozes: VozNarracao[]; aviso?: string}> => {
  const chave = servico.chave(p);
  if (p === 'gemini') return {provedor: p, ...(await vozesGemini({chave, fetch: servico.fetch, sinal}))};
  if (!chave) return {provedor: p, vozes: VOZES_CHIRP, aviso: `sem a chave, o catálogo das 30 vozes Chirp 3: HD (${ONDE_PADRAO[p]})`};
  return {provedor: p, ...(await vozesCloudTts({chave, fetch: servico.fetch, sinal}))};
};

// ---------- disco ----------

const gravarBytes = (projeto: Projeto, rel: string, bytes: Uint8Array) => {
  const abs = projeto.caminho(rel);
  mkdirSync(path.dirname(abs), {recursive: true});
  const tmp = `${abs}.${process.pid}.tmp`; // o observador da pasta ignora .tmp: a tela só vê o arquivo inteiro
  writeFileSync(tmp, bytes);
  renameSync(tmp, abs);
};

/** O envelope de loudness do WAV gerado, carimbado como o de qualquer áudio (tamanho, data e sha256): o ducking da música sob
 *  esta voz vale na hora, sem a tela medir, também no MCP fora do app. */
export const gravarEnvelopeDaFala = (projeto: Projeto, arquivo: string, wav: Uint8Array) => {
  const a = amostrasDoWav16(wav);
  if (!a) return;
  const env = envelopeDeAmostras(a.canais, a.taxa);
  const abs = projeto.caminho(arquivo);
  const st = statSync(abs);
  projeto.gravarTexto(`${arquivo}.envelope.json`, `${JSON.stringify({...env, fonte: {tamanho: st.size, modificado_ms: st.mtimeMs, sha256: sha256DoArquivo(abs)}})}\n`);
};

/** A duração (ms) de um WAV de fala do cache, ou null se não estiver lá inteiro. */
export const duracaoNoCache = (projeto: Projeto, arquivo: string): number | null => {
  try {
    if (!projeto.existe(arquivo)) return null;
    const b = new Uint8Array(readFileSync(projeto.caminho(arquivo)));
    const w = lerWav16(b);
    return w && w.bytes > 0 ? Math.round((w.bytes / (2 * w.canais) / w.taxa) * 1000) : null;
  } catch {
    return null;
  }
};

// ---------- prévia: o texto final, os caracteres e o custo, sem chamar a API ----------

export type ItemPrevia = Pick<ItemNarracao, 'cena' | 'n' | 'nome' | 'estado' | 'texto_final' | 'hash' | 'arquivo' | 'motivo'> & {
  caracteres: number; segundos_estimados: number; em_cache: boolean; vai_a_api: boolean; custo_usd?: number};
export type Previa = {
  documento: string;
  provedor: ProvedorNarracao;
  modelo: string;
  voz: string;
  itens: ItemPrevia[];
  total: {cenas: number; a_gerar: number; vao_a_api: number; caracteres: number; segundos_estimados: number; custo_usd?: number; tabela?: string; fonte?: string; nota?: string};
  sem_texto: number[];
  nao_achadas?: string[];
  tem_chave: boolean;
};

/** Quais cenas vão ser geradas: as pedidas (com texto) ou, sem pedido, as que estão a gerar ou desatualizadas. `refazer`: todas
 *  as pedidas com texto, mesmo as geradas, e sem usar o cache. */
const selecionar = (doc: DocCenas, itens: ItemNarracao[], o: {cenas?: string[]; refazer?: boolean}) => {
  const {ids, nao_achadas} = escolherCenas(doc, o.cenas);
  const pedidas = itens.filter((i) => ids.includes(i.cena));
  const comTexto = pedidas.filter((i) => i.estado !== 'sem_texto');
  const alvo = o.refazer || o.cenas?.length ? comTexto : comTexto.filter((i) => i.estado !== 'gerada');
  return {alvo, sem_texto: pedidas.filter((i) => i.estado === 'sem_texto').map((i) => i.n), nao_achadas};
};

export const previaDaNarracao = (projeto: Projeto, documento: string, doc: DocCenas, o: {cenas?: string[]; refazer?: boolean}, servico?: ServicoNarracao): Previa => {
  const cfg = configDaNarracao(doc.narracao);
  const itens = itensDaNarracao(doc, (r) => projeto.existe(r));
  const {alvo, sem_texto, nao_achadas} = selecionar(doc, itens, o);
  const lista: ItemPrevia[] = alvo.map((i) => {
    const em_cache = !o.refazer && Boolean(i.arquivo && duracaoNoCache(projeto, i.arquivo) !== null);
    const m = i.medida!;
    const custo = em_cache ? undefined : servico?.custo?.(cfg.provedor, cfg.modelo, m);
    return {cena: i.cena, n: i.n, ...(i.nome ? {nome: i.nome} : {}), estado: i.estado, texto_final: i.texto_final, hash: i.hash, arquivo: i.arquivo,
      ...(i.motivo ? {motivo: i.motivo} : {}), caracteres: m.caracteres, segundos_estimados: m.segundos, em_cache, vai_a_api: !em_cache,
      ...(custo ? {custo_usd: custo.usd} : {})};
  });
  const api = lista.filter((i) => i.vai_a_api);
  const soma = (f: (i: ItemPrevia) => number) => Math.round(api.reduce((s, i) => s + f(i), 0) * 10) / 10;
  const medidaTotal: MedidaFala = {caracteres: api.reduce((s, i) => s + i.caracteres, 0), bytes: 0, palavras: 0, segundos: soma((i) => i.segundos_estimados),
    tokens_entrada: alvo.filter((x) => api.some((a) => a.cena === x.cena)).reduce((s, x) => s + (x.medida?.tokens_entrada ?? 0), 0),
    tokens_saida: alvo.filter((x) => api.some((a) => a.cena === x.cena)).reduce((s, x) => s + (x.medida?.tokens_saida ?? 0), 0)};
  const custo = api.length ? servico?.custo?.(cfg.provedor, cfg.modelo, medidaTotal) : undefined;
  return {documento, provedor: cfg.provedor, modelo: cfg.modelo, voz: cfg.voz, itens: lista,
    total: {cenas: itens.length, a_gerar: lista.length, vao_a_api: api.length, caracteres: medidaTotal.caracteres, segundos_estimados: medidaTotal.segundos,
      ...(custo ? {custo_usd: custo.usd, tabela: custo.tabela, fonte: custo.fonte, ...(custo.nota ? {nota: custo.nota} : {})} : api.length ? {} : {custo_usd: 0})},
    sem_texto, ...(nao_achadas.length ? {nao_achadas} : {}), tem_chave: Boolean(servico?.chave(cfg.provedor))};
};

// ---------- gerar ----------

export type AndamentoNarracao = {documento: string; feitas: number; total: number; cena?: string; n?: number; fase: 'gerando' | 'cache' | 'pronto'};
export type ResultadoNarracao = {
  ok: boolean;
  documento: string;
  versao?: string;
  seq?: number;
  provedor: ProvedorNarracao;
  modelo: string;
  voz: string;
  geradas: {cena: string; n: number; arquivo: string; duracao_ms: number; do_cache: boolean; clipe?: string}[];
  faixa?: string;
  custo_usd?: number;
  avisos: string[];
  sem_texto: number[];
  nao_achadas?: string[];
  erro?: string;
  tipo_erro?: string;
  cancelado?: boolean;
};

const docDe = (projeto: Projeto, documento?: string) => {
  const alvo = documento ?? projeto.estado()?.documento ?? projeto.manifesto().documentos.find((d) => d.modulo === 'video')?.id;
  if (!alvo) throw new ErroProjeto('o projeto não tem vídeo de cenas', 'nao_achado');
  const rel = projeto.arquivoDoDocumento(alvo);
  const lido = projeto.lerJson<unknown>(rel);
  if (!ehDocCenas(lido.doc)) throw new ErroProjeto(`${alvo} não é um vídeo de cenas`, 'patch');
  return {alvo, rel, doc: lido.doc as DocCenas, versao: lido.versao};
};
export {docDe as videoDeCenasDe};

/** Gera a fala das cenas (as pedidas, ou as que estão a gerar ou desatualizadas), uma por vez, e põe no vídeo num patch só.
 *  Para no primeiro erro (chave, cota, voz): o que já foi gerado entra no vídeo, e o erro volta em `erro`. */
export const gerarNarracao = async (projeto: Projeto, servico: ServicoNarracao, o: {documento?: string; cenas?: string[]; refazer?: boolean; sinal?: AbortSignal;
  andamento?: (a: AndamentoNarracao) => void; autor: string; origem: string}): Promise<ResultadoNarracao> => {
  const {alvo, doc} = docDe(projeto, o.documento);
  const cfg = configDaNarracao(doc.narracao);
  const itens = itensDaNarracao(doc, (r) => projeto.existe(r));
  const {alvo: fila, sem_texto, nao_achadas} = selecionar(doc, itens, o);
  const base: ResultadoNarracao = {ok: true, documento: alvo, provedor: cfg.provedor, modelo: cfg.modelo, voz: cfg.voz, geradas: [], avisos: [], sem_texto,
    ...(nao_achadas.length ? {nao_achadas} : {})};
  if (!fila.length) return {...base, avisos: [sem_texto.length && !itens.some((i) => i.estado !== 'sem_texto') ? 'nenhuma cena tem texto de narração (cenas[i].narracao.texto)' : 'nada a gerar: as falas pedidas já estão geradas']};
  // sem chave e com alguma fora do cache: avisa antes de gastar tempo
  const precisaApi = fila.some((i) => o.refazer || duracaoNoCache(projeto, i.arquivo!) === null);
  if (precisaApi) exigirChave(servico, cfg.provedor);
  let custo = 0;
  let erro: ErroNarracao | Error | undefined;
  const feitas: {item: ItemNarracao; duracao_ms: number; do_cache: boolean}[] = [];
  for (const item of fila) {
    if (o.sinal?.aborted) {
      erro = new ErroNarracao('cancelado', 'cancelado');
      break;
    }
    const arquivo = item.arquivo!;
    const noCache = o.refazer ? null : duracaoNoCache(projeto, arquivo);
    if (noCache !== null) {
      if (!projeto.existe(`${arquivo}.envelope.json`)) gravarEnvelopeDaFala(projeto, arquivo, new Uint8Array(readFileSync(projeto.caminho(arquivo))));
      feitas.push({item, duracao_ms: noCache, do_cache: true});
      o.andamento?.({documento: alvo, feitas: feitas.length, total: fila.length, cena: item.cena, n: item.n, fase: 'cache'});
      continue;
    }
    o.andamento?.({documento: alvo, feitas: feitas.length, total: fila.length, cena: item.cena, n: item.n, fase: 'gerando'});
    try {
      const som = await sintetizar(servico, cfg, item.texto_final, o.sinal);
      gravarBytes(projeto, arquivo, som.wav);
      gravarEnvelopeDaFala(projeto, arquivo, som.wav);
      projeto.gravarTexto(fichaDaNarracao(item.hash!), `${JSON.stringify({provedor: cfg.provedor, modelo: cfg.modelo, voz: cfg.voz,
        ...(cfg.provedor === 'gemini' ? {estilo: cfg.estilo, formato_pedido: som.formato} : {velocidade: cfg.velocidade}), texto: item.texto_final, cena: item.cena, duracao_ms: som.duracao_ms,
        taxa: som.taxa, criado_em: new Date().toISOString()}, null, 2)}\n`);
      const m = item.medida!;
      const real: MedidaFala = som.uso ? {...m, tokens_entrada: som.uso.entrada, tokens_saida: som.uso.saida} : {...m, segundos: som.duracao_ms / 1000, tokens_saida: Math.ceil((som.duracao_ms / 1000) * 25)};
      const c = servico.custo?.(cfg.provedor, cfg.modelo, real);
      custo += c?.usd ?? 0;
      servico.aoUso?.(cfg.provedor, cfg.modelo, {entrada: real.tokens_entrada, saida: real.tokens_saida, caracteres: m.caracteres}, c?.usd);
      feitas.push({item, duracao_ms: som.duracao_ms, do_cache: false});
      o.andamento?.({documento: alvo, feitas: feitas.length, total: fila.length, cena: item.cena, n: item.n, fase: 'gerando'});
    } catch (e) {
      erro = e as Error;
      break;
    }
  }
  const r: ResultadoNarracao = {...base, custo_usd: Math.round(custo * 1e6) / 1e6};
  if (erro) {
    r.ok = false;
    r.erro = erro.message;
    r.tipo_erro = erro instanceof ErroNarracao ? erro.tipo : undefined;
    if (erro instanceof ErroNarracao && erro.tipo === 'cancelado') {
      r.cancelado = true;
      r.erro = feitas.length ? `cancelado depois de ${feitas.length} de ${fila.length}` : 'cancelado';
    }
  }
  if (!feitas.length) return r;
  // o documento pode ter mudado enquanto o áudio era gerado: lê de novo e grava sobre a versão nova
  const atual = docDe(projeto, alvo);
  const p = patchDasFalas(atual.doc, feitas.map((f) => ({cena: f.item.cena, arquivo: f.item.arquivo!, duracao_ms: f.duracao_ms, hash: f.item.hash!})));
  r.avisos.push(...p.avisos);
  r.faixa = p.faixa;
  r.geradas = feitas.map((f) => ({cena: f.item.cena, n: f.item.n, arquivo: f.item.arquivo!, duracao_ms: f.duracao_ms, do_cache: f.do_cache,
    clipe: p.clipes.find((c) => c.cena === f.item.cena)?.id}));
  if (p.patch.length) {
    const novas = feitas.filter((f) => !f.do_cache).length;
    const gravado = projeto.aplicarPatch({documento: atual.rel, versao_base: atual.versao, patch: p.patch, autor: o.autor, origem: o.origem,
      rotulo: `narração por IA: ${feitas.length === 1 ? `cena ${feitas[0].item.n}` : `${feitas.length} cenas`}${novas < feitas.length ? ` (${feitas.length - novas} do cache)` : ''}`});
    r.versao = gravado.versao;
    r.seq = gravado.entrada.seq;
  }
  o.andamento?.({documento: alvo, feitas: feitas.length, total: fila.length, fase: 'pronto'});
  return r;
};

/** Uma frase curta na voz da configuração, para ouvir antes de gerar tudo (custa centavos de centavo). O cache fica com quem
 *  chama (o processo principal guarda em userData). Devolve o WAV e o hash do pedido. */
export const amostraDeVoz = async (servico: ServicoNarracao, config: ConfigNarracao | undefined, frase = FRASE_AMOSTRA, sinal?: AbortSignal) => {
  const cfg = configDaNarracao(config);
  const texto = textoFalado(frase, cfg);
  const hash = hashDaFala(texto, cfg);
  return {hash, texto, gerar: () => sintetizar(servico, cfg, texto, sinal), medida: medirFala(texto, cfg), cfg};
};

/** A ficha do WAV gerado: o texto, o provedor, a voz e a data (para saber de onde veio cada arquivo do cache). */
export const fichaDaNarracao = (hash: string) => `.estudio/narracao/${hash}.json`;
