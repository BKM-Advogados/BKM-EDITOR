// O serviço da narração por IA (src/nucleo/narracao-servico.ts) montado de dois jeitos, sem Electron aqui: no MCP por stdio,
// com as chaves das variáveis de ambiente (GEMINI_API_KEY ou GOOGLE_API_KEY, e GOOGLE_TTS_API_KEY); no app, com as chaves do
// cofre (src/main/ipc-narracao.ts). O Gemini TTS usa a mesma chave do provedor Gemini das conversas; o Google Cloud TTS tem
// a dele ("google-tts"). O preço vem de src/main/ia/precos.ts.
import type {ProvedorNarracao} from '../nucleo/narracao';
import type {ServicoNarracao} from '../nucleo/narracao-servico';
import {acharChave, CofreMemoria, type Cofre} from './ia/chaves';
import {custoNarracao} from './ia/precos';

/** Onde cada provedor da narração guarda a chave no cofre (e nas variáveis de ambiente, por chaves.ts). */
export const ID_DA_CHAVE: Record<ProvedorNarracao, string> = {gemini: 'gemini', 'google-tts': 'google-tts'};
/** O nome no uso do mês (config.ts): separado das conversas do Gemini. */
export const ID_DO_USO: Record<ProvedorNarracao, string> = {gemini: 'gemini-tts', 'google-tts': 'google-tts'};

/** MCP por stdio: a chave vem do ambiente do processo. */
export const servicoDoAmbiente = (ambiente: NodeJS.ProcessEnv = process.env, f?: typeof fetch): ServicoNarracao => ({
  chave: (p) => acharChave(new CofreMemoria(), ID_DA_CHAVE[p], ambiente).chave,
  ondePorChave: (p) => (p === 'gemini' ? 'defina GEMINI_API_KEY (ou GOOGLE_API_KEY) no ambiente do MCP' : 'defina GOOGLE_TTS_API_KEY no ambiente do MCP'),
  fetch: f,
  custo: (p, m, x, quando) => custoNarracao(p, m, x, quando),
});

/** No app: a chave do cofre (ou da variável de ambiente, como reserva), o net.fetch do Electron e a soma do uso do mês. */
export const servicoDoCofre = (o: {cofre: () => Cofre; fetch?: typeof fetch;
  registrarUso?: (id: string, u: {entrada: number; entrada_cache: number; saida: number}, custo?: number) => void}): ServicoNarracao => ({
  chave: (p) => acharChave(o.cofre(), ID_DA_CHAVE[p]).chave,
  ondePorChave: (p) => (p === 'gemini' ? 'ponha a chave do Gemini em Configurações › IA › Gemini (a mesma das conversas)'
    : 'ponha a chave do Google Cloud TTS em Configurações › IA › Narração por IA'),
  fetch: o.fetch,
  custo: (p, m, x, quando) => custoNarracao(p, m, x, quando),
  aoUso: (p, _m, u, custo) => {
    try {
      // no Cloud TTS a cobrança é por caractere: entra como "entrada" e a tela diz que são caracteres
      o.registrarUso?.(ID_DO_USO[p], p === 'gemini' ? {entrada: u.entrada, entrada_cache: 0, saida: u.saida} : {entrada: u.caracteres, entrada_cache: 0, saida: 0}, custo);
    } catch {
      /* a soma do mês nunca derruba a narração */
    }
  },
});
