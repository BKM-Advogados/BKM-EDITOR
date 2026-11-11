// Narração pelo Google Cloud Text-to-Speech com as vozes Chirp 3: HD em português, com fetch injetável. Conferido na
// referência REST da v1 e na página do Chirp 3: HD em 10/11/2026 (docs.cloud.google.com/text-to-speech):
//  - POST {base}/text:synthesize, chave de API no cabeçalho x-goog-api-key;
//  - {input: {text} ou {markup} (as pausas [pause short] e [pause long] só valem em markup), voice: {languageCode: "pt-BR",
//    name: "pt-BR-Chirp3-HD-<Nome>"}, audioConfig: {audioEncoding: "LINEAR16", speakingRate (0,25 a 2)}};
//  - a resposta é {audioContent: base64}; em LINEAR16 o áudio já vem com o cabeçalho WAV;
//  - a entrada tem no máximo 5000 bytes por pedido;
//  - GET {base}/voices?languageCode=pt-BR lista as vozes, sem custo: é o teste da chave antes de gravar.
// A pronúncia por IPA/X-SAMPA (customPronunciations) fica de fora: a referência REST diz que só vale para en-US. O
// dicionário do app (troca de texto) serve aos dois provedores.
import {bytesDeBase64, erroDeRede, erroDoGoogle, ErroNarracao, IDIOMA_NARRACAO, LIMITE_BYTES_CLOUD_TTS, VELOCIDADE_MAX, VELOCIDADE_MIN, VOZES_CHIRP, wavDaResposta,
  type VozNarracao} from './narracao';
import type {SomGerado} from './narracao-gemini';

export const BASE_CLOUD_TTS = 'https://texttospeech.googleapis.com/v1';
const TEMPO_MS = 60_000;

export type PedidoCloudTts = {chave: string; voz: string; texto: string; velocidade?: number; fetch?: typeof fetch; sinal?: AbortSignal; base?: string};

const sinalComTempo = (sinal?: AbortSignal) => (sinal ? AbortSignal.any([sinal, AbortSignal.timeout(TEMPO_MS)]) : AbortSignal.timeout(TEMPO_MS));

/** O corpo do text:synthesize: markup quando o texto tem pausa do Chirp, texto puro no resto. */
export const corpoCloudTts = (o: Pick<PedidoCloudTts, 'voz' | 'texto' | 'velocidade'>) => ({
  input: /\[pause(?: short| long)?\]/.test(o.texto) ? {markup: o.texto} : {text: o.texto},
  voice: {languageCode: IDIOMA_NARRACAO, name: o.voz},
  audioConfig: {audioEncoding: 'LINEAR16', speakingRate: Math.min(VELOCIDADE_MAX, Math.max(VELOCIDADE_MIN, o.velocidade ?? 1))},
});

/** Gera a fala (WAV de 16 bits). Erros em pt-BR: chave recusada, API desativada, cota, voz inexistente, texto grande demais. */
export const sintetizarCloudTts = async (o: PedidoCloudTts): Promise<SomGerado> => {
  const bytes = new TextEncoder().encode(o.texto).length;
  if (bytes > LIMITE_BYTES_CLOUD_TTS) {
    throw new ErroNarracao(`a fala tem ${bytes} bytes e o Google Cloud TTS aceita até ${LIMITE_BYTES_CLOUD_TTS} por pedido: divida a cena em duas`, 'texto');
  }
  const f = o.fetch ?? fetch;
  let r: Response;
  try {
    r = await f(`${(o.base ?? BASE_CLOUD_TTS).replace(/\/+$/, '')}/text:synthesize`, {method: 'POST', headers: {'Content-Type': 'application/json', 'x-goog-api-key': o.chave},
      body: JSON.stringify(corpoCloudTts(o)), signal: sinalComTempo(o.sinal)});
  } catch (e) {
    throw erroDeRede(e, {provedor: 'google-tts', chave: o.chave, sinal: o.sinal});
  }
  if (!r.ok) throw erroDoGoogle(r.status, await r.text().catch(() => ''), {provedor: 'google-tts', voz: o.voz, chave: o.chave});
  let j: {audioContent?: string};
  try {
    j = (await r.json()) as {audioContent?: string};
  } catch {
    throw new ErroNarracao('o Google Cloud TTS respondeu, mas não com JSON', 'sem_audio');
  }
  if (!j.audioContent) throw new ErroNarracao('o Google Cloud TTS não devolveu áudio', 'sem_audio');
  const som = wavDaResposta(bytesDeBase64(j.audioContent), 'audio/l16; rate=24000');
  if (som.duracao_ms < 50) throw new ErroNarracao('o Google Cloud TTS devolveu um áudio vazio', 'sem_audio');
  return som;
};

/** As vozes Chirp 3: HD em português que a chave enxerga (GET /v1/voices, sem custo). Serve também de teste da chave: recusada,
 *  lança ErroNarracao do tipo 'chave' ou 'desativada'. */
export const vozesCloudTts = async (o: {chave: string; fetch?: typeof fetch; base?: string; sinal?: AbortSignal}): Promise<{vozes: VozNarracao[]; aviso?: string}> => {
  const f = o.fetch ?? fetch;
  let r: Response;
  try {
    r = await f(`${(o.base ?? BASE_CLOUD_TTS).replace(/\/+$/, '')}/voices?languageCode=${IDIOMA_NARRACAO}`, {headers: {'x-goog-api-key': o.chave}, signal: sinalComTempo(o.sinal)});
  } catch (e) {
    throw erroDeRede(e, {provedor: 'google-tts', chave: o.chave, sinal: o.sinal});
  }
  if (!r.ok) throw erroDoGoogle(r.status, await r.text().catch(() => ''), {provedor: 'google-tts', chave: o.chave});
  const j = (await r.json().catch(() => ({}))) as {voices?: {name?: string; ssmlGender?: string; languageCodes?: string[]}[]};
  const vozes = (j.voices ?? []).filter((v) => typeof v.name === 'string' && /Chirp3-HD/i.test(v.name)).map((v): VozNarracao => ({
    id: v.name!, nome: v.name!.split('-').pop() ?? v.name!, idioma: v.languageCodes?.[0] ?? IDIOMA_NARRACAO,
    genero: v.ssmlGender === 'FEMALE' ? 'feminina' : v.ssmlGender === 'MALE' ? 'masculina' : undefined,
  })).sort((a, b) => a.nome.localeCompare(b.nome));
  if (!vozes.length) return {vozes: VOZES_CHIRP, aviso: 'a lista do Google não trouxe vozes Chirp 3: HD em português; ficam as 30 do catálogo'};
  return {vozes};
};
