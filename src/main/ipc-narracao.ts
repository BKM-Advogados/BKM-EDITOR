// IPC da narração por IA (docs/narracao.md): o estado das chaves, a chave do Google Cloud TTS (testada na lista de vozes,
// sem custo, antes de gravar; recusada não grava), as vozes, a prévia, gerar com andamento e Cancelar, e a amostra de voz.
// A chave só vive aqui, no processo principal: a tela recebe "tem chave", a origem e os 4 últimos caracteres. O mesmo
// serviço atende as ferramentas do MCP por HTTP (definirNarradorMcp). Registrado no main.ts com uma linha.
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import type {EstadoNarracaoIA, ResultadoChave} from '../compartilhado/api';
import {ErroNarracao, type ConfigNarracao, type ProvedorNarracao} from '../nucleo/narracao';
import {vozesCloudTts} from '../nucleo/narracao-cloud-tts';
import {amostraDeVoz, gerarNarracao, listarVozes, previaDaNarracao, videoDeCenasDe, type ServicoNarracao} from '../nucleo/narracao-servico';
import type {Projeto} from '../nucleo/projeto';
import {acharChave, finalDaChave} from './ia/chaves';
import {cofreAtual, registrarUsoDoMes, textoDoCofreAtual} from './ipc-ia';
import {definirNarradorMcp} from './mcp-http';
import {ID_DA_CHAVE, servicoDoCofre} from './narracao';

type Lidar = <A extends unknown[], R>(canal: string, f: (...a: A) => R | Promise<R>) => void;

export type CanaisNarracao = {estado: string; gravarChave: string; apagarChave: string; vozes: string; previa: string; gerar: string; cancelar: string; andamento: string;
  amostra: string};

const provedorValido = (p: unknown): ProvedorNarracao => (p === 'google-tts' ? 'google-tts' : 'gemini');

/** O que a tela pode saber das chaves da narração. */
export const estadoDaNarracao = (): EstadoNarracaoIA => {
  const um = (p: ProvedorNarracao) => {
    const k = acharChave(cofreAtual(), ID_DA_CHAVE[p]);
    return {pronto: Boolean(k.chave), origem: k.origem, final: finalDaChave(k.chave), ...(k.variavel ? {variavel: k.variavel} : {})};
  };
  const c = textoDoCofreAtual();
  return {gemini: um('gemini'), 'google-tts': um('google-tts'), cofre_persistente: c.persistente, cofre_texto: c.texto};
};

/** A chave do Google Cloud TTS: testada na lista de vozes (não gasta nada). Recusada ou com a API desativada: não grava, e a
 *  mensagem diz o que fazer. Sem rede (ou o Google fora do ar): grava e avisa, como as chaves das conversas. */
export const gravarChaveTts = async (chave: string, f?: typeof fetch): Promise<ResultadoChave> => {
  const limpa = String(chave ?? '').trim();
  if (limpa.length < 8 || /\s/.test(limpa)) return {ok: false, mensagem: 'essa não parece uma chave de API (curta demais ou com espaço)'};
  const c = textoDoCofreAtual();
  try {
    const r = await vozesCloudTts({chave: limpa, fetch: f});
    cofreAtual().gravar(ID_DA_CHAVE['google-tts'], limpa);
    return {ok: true, persistente: c.persistente, mensagem: `chave aceita (${r.vozes.length} vozes Chirp 3: HD em português) e ${c.texto}`};
  } catch (e) {
    if (e instanceof ErroNarracao && (e.tipo === 'chave' || e.tipo === 'desativada')) return {ok: false, mensagem: e.message};
    cofreAtual().gravar(ID_DA_CHAVE['google-tts'], limpa);
    return {ok: true, persistente: c.persistente, mensagem: `chave ${c.texto}, mas não deu para testar agora: ${(e as Error).message}`};
  }
};

export const registrarIpcNarracao = (o: {lidar: Lidar; canais: CanaisNarracao; ouvir: (canal: string, f: (...a: unknown[]) => void) => void;
  enviar: (canal: string, ...a: unknown[]) => void; projeto: () => Projeto; pasta: string; buscar?: typeof fetch}) => {
  const servico: ServicoNarracao = servicoDoCofre({cofre: cofreAtual, fetch: o.buscar, registrarUso: (id, u, custo) => registrarUsoDoMes(id, u, custo)});
  definirNarradorMcp(servico); // o MCP por HTTP (as abas de conversa e os apps de fora) usa o mesmo serviço
  const {lidar, canais} = o;
  const vozesGuardadas = new Map<string, Awaited<ReturnType<typeof listarVozes>>>();
  let geracao: AbortController | null = null;

  lidar(canais.estado, () => estadoDaNarracao());
  lidar(canais.gravarChave, async (chave: string) => {
    const r = await gravarChaveTts(chave, o.buscar);
    if (r.ok) vozesGuardadas.clear();
    return r;
  });
  lidar(canais.apagarChave, () => {
    cofreAtual().apagar(ID_DA_CHAVE['google-tts']);
    vozesGuardadas.clear();
  });
  lidar(canais.vozes, async (p: unknown, atualizar?: boolean) => {
    const provedor = provedorValido(p);
    // guardada por provedor e chave (o final): trocar a chave busca de novo
    const chave = `${provedor}|${finalDaChave(servico.chave(provedor)) ?? ''}`;
    if (!atualizar && vozesGuardadas.has(chave)) return vozesGuardadas.get(chave)!;
    const r = await listarVozes(servico, provedor);
    vozesGuardadas.set(chave, r);
    return r;
  });
  lidar(canais.previa, (documento: string, x?: {cenas?: string[]; refazer?: boolean}) => {
    const p = o.projeto();
    const {alvo, doc} = videoDeCenasDe(p, String(documento));
    return previaDaNarracao(p, alvo, doc, {cenas: Array.isArray(x?.cenas) ? x!.cenas.map(String) : undefined, refazer: Boolean(x?.refazer)}, servico);
  });
  lidar(canais.gerar, async (documento: string, x?: {cenas?: string[]; refazer?: boolean}) => {
    if (geracao) throw new Error('já há uma narração sendo gerada: espere ou cancele');
    geracao = new AbortController();
    try {
      return await gerarNarracao(o.projeto(), servico, {documento: String(documento), cenas: Array.isArray(x?.cenas) ? x!.cenas.map(String) : undefined, refazer: Boolean(x?.refazer),
        sinal: geracao.signal, andamento: (a) => o.enviar(canais.andamento, a), autor: 'pessoa', origem: 'interface'});
    } finally {
      geracao = null;
    }
  });
  o.ouvir(canais.cancelar, () => geracao?.abort());
  // a amostra fica em userData/ia/amostras-narracao/<hash>.wav: a mesma frase na mesma voz não é paga duas vezes
  lidar(canais.amostra, async (config: ConfigNarracao) => {
    const a = await amostraDeVoz(servico, config && typeof config === 'object' ? config : undefined);
    const arquivo = path.join(o.pasta, 'amostras-narracao', `${a.hash}.wav`);
    const comoArray = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    if (existsSync(arquivo)) return {wav: comoArray(new Uint8Array(readFileSync(arquivo))), do_cache: true};
    const som = await a.gerar();
    mkdirSync(path.dirname(arquivo), {recursive: true});
    writeFileSync(`${arquivo}.tmp`, som.wav);
    renameSync(`${arquivo}.tmp`, arquivo);
    const custo = servico.custo?.(a.cfg.provedor, a.cfg.modelo, {...a.medida, ...(som.uso ? {tokens_entrada: som.uso.entrada, tokens_saida: som.uso.saida} : {})});
    servico.aoUso?.(a.cfg.provedor, a.cfg.modelo, {entrada: som.uso?.entrada ?? a.medida.tokens_entrada, saida: som.uso?.saida ?? a.medida.tokens_saida, caracteres: a.medida.caracteres}, custo?.usd);
    return {wav: comoArray(som.wav), do_cache: false, ...(custo ? {custo_usd: custo.usd} : {})};
  });
};
