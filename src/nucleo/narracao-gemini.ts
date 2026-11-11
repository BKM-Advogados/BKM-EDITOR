// Narração pelo Gemini TTS (Gemini API / Google AI Studio), com fetch injetável (os testes usam um HTTP falso). Conferido na
// doc em 10/11/2026 (aistudio.google.com/docs/speech-generation, variante generateContent):
//  - POST {base}/models/{modelo}:generateContent, chave no cabeçalho x-goog-api-key (fora da URL e dos registros);
//  - contents[0].parts[0] = {text: o roteiro literal, speech_metadata: {style}} (o estilo vai à parte, não no texto);
//  - generationConfig = {responseModalities: ["AUDIO"], speechConfig: {voiceConfig: {voice}}};
//  - a resposta traz o áudio em candidates[0].content.parts[].inlineData {mimeType, data (base64)}: WAV de 16 bits, 24 kHz,
//    mono no Gemini 3.8; PCM cru (audio/L16) nos modelos anteriores. wavDaResposta aceita os dois.
// Se o Google recusar os campos novos (400 "Unknown name"), o pedido vai de novo no formato anterior, que a pesquisa da
// pessoa trazia: voiceConfig.prebuiltVoiceConfig.voiceName e o estilo como instrução antes do texto. Sem marcação de tempo
// por palavra e sem controle de fonema: as legendas vêm da transcrição local (transcrever), e a pronúncia, do dicionário.
import {erroDeRede, erroDoGoogle, ErroNarracao, IDIOMA_NARRACAO, bytesDeBase64, VOZES_GEMINI, wavDaResposta, type VozNarracao} from './narracao';

export const BASE_GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const TEMPO_MS = 120_000;

export type PedidoGemini = {chave: string; modelo: string; voz: string; texto: string; estilo?: string; fetch?: typeof fetch; sinal?: AbortSignal; base?: string};
/** `formato`: no Gemini, se o pedido que valeu foi o da doc do 3.8 ou o anterior (o teste ao vivo mostra qual). */
export type SomGerado = {wav: Uint8Array; taxa: number; canais: number; duracao_ms: number; uso?: {entrada: number; saida: number}; formato?: 'doc-3.8' | 'anterior'};

/** O corpo do pedido no formato da doc do Gemini 3.8 (ou no anterior, `legado`). */
export const corpoGemini = (o: Pick<PedidoGemini, 'voz' | 'texto' | 'estilo'>, legado = false) => {
  const estilo = o.estilo?.trim();
  const parte = legado
    ? {text: estilo ? `${estilo}:\n${o.texto}` : o.texto}
    : {text: o.texto, ...(estilo ? {speech_metadata: {style: estilo}} : {})};
  return {
    contents: [{role: 'user', parts: [parte]}],
    generationConfig: {responseModalities: ['AUDIO'], speechConfig: {voiceConfig: legado ? {prebuiltVoiceConfig: {voiceName: o.voz}} : {voice: o.voz}}},
  };
};

type RespostaGemini = {
  candidates?: {content?: {parts?: {inlineData?: {mimeType?: string; data?: string}; inline_data?: {mime_type?: string; data?: string}; text?: string}[]}; finishReason?: string}[];
  promptFeedback?: {blockReason?: string};
  usageMetadata?: {promptTokenCount?: number; candidatesTokenCount?: number};
};

const sinalComTempo = (sinal?: AbortSignal) => (sinal ? AbortSignal.any([sinal, AbortSignal.timeout(TEMPO_MS)]) : AbortSignal.timeout(TEMPO_MS));

/** Gera a fala e devolve o WAV (16 bits). Erros em pt-BR (ErroNarracao): chave recusada, cota, voz ou modelo inexistente, sem rede. */
export const sintetizarGemini = async (o: PedidoGemini): Promise<SomGerado> => {
  const f = o.fetch ?? fetch;
  const url = `${(o.base ?? BASE_GEMINI).replace(/\/+$/, '')}/models/${encodeURIComponent(o.modelo)}:generateContent`;
  const pedir = async (legado: boolean) => {
    try {
      return await f(url, {method: 'POST', headers: {'Content-Type': 'application/json', 'x-goog-api-key': o.chave}, body: JSON.stringify(corpoGemini(o, legado)),
        signal: sinalComTempo(o.sinal)});
    } catch (e) {
      throw erroDeRede(e, {provedor: 'gemini', chave: o.chave, sinal: o.sinal});
    }
  };
  let r = await pedir(false);
  let legado = false;
  if (r.status === 400) {
    const corpo = await r.text().catch(() => '');
    if (!/Unknown name|Cannot find field|Invalid JSON payload/i.test(corpo)) throw erroDoGoogle(400, corpo, {provedor: 'gemini', voz: o.voz, modelo: o.modelo, chave: o.chave});
    legado = true;
    r = await pedir(true);
  }
  if (!r.ok) throw erroDoGoogle(r.status, await r.text().catch(() => ''), {provedor: 'gemini', voz: o.voz, modelo: o.modelo, chave: o.chave});
  let j: RespostaGemini;
  try {
    j = (await r.json()) as RespostaGemini;
  } catch {
    throw new ErroNarracao('o Gemini respondeu, mas não com JSON', 'sem_audio');
  }
  const partes = j.candidates?.[0]?.content?.parts ?? [];
  const audio = partes.map((p) => p.inlineData ?? (p.inline_data ? {mimeType: p.inline_data.mime_type, data: p.inline_data.data} : undefined)).find((x) => x?.data);
  if (!audio?.data) {
    const motivo = j.promptFeedback?.blockReason ?? j.candidates?.[0]?.finishReason;
    throw new ErroNarracao(`o Gemini não devolveu áudio${motivo ? ` (motivo: ${motivo})` : ''}; confira o texto da cena e o modelo (precisa ser um modelo TTS)`, 'sem_audio');
  }
  const som = wavDaResposta(bytesDeBase64(audio.data), audio.mimeType);
  if (som.duracao_ms < 50) throw new ErroNarracao('o Gemini devolveu um áudio vazio', 'sem_audio');
  const u = j.usageMetadata;
  return {...som, formato: legado ? 'anterior' : 'doc-3.8', ...(u ? {uso: {entrada: u.promptTokenCount ?? 0, saida: u.candidatesTokenCount ?? 0}} : {})};
};

type RespostaVozes = {voices?: {id?: string; name?: string; display_name?: string; displayName?: string; language_code?: string; languageCode?: string; gender?: string;
  description?: string}[]; next_page_token?: string; nextPageToken?: string};

/** As vozes do Gemini: as 30 prontas e, com a chave, as da biblioteca estendida em português (GET /v1beta/voices, de graça).
 *  Falhou a biblioteca (modelo antigo, sem rede), ficam as 30, com o aviso; chave recusada é erro. */
export const vozesGemini = async (o: {chave?: string; fetch?: typeof fetch; base?: string; sinal?: AbortSignal}): Promise<{vozes: VozNarracao[]; aviso?: string}> => {
  if (!o.chave) return {vozes: VOZES_GEMINI, aviso: 'sem a chave do Gemini, só as 30 vozes prontas (a biblioteca estendida pede a chave)'};
  const f = o.fetch ?? fetch;
  const extras: VozNarracao[] = [];
  let pagina: string | undefined;
  try {
    for (let i = 0; i < 5; i++) {
      const q = new URLSearchParams({language_code: IDIOMA_NARRACAO, page_size: '100', ...(pagina ? {page_token: pagina} : {})});
      const r = await f(`${(o.base ?? BASE_GEMINI).replace(/\/+$/, '')}/voices?${q}`, {headers: {'x-goog-api-key': o.chave}, signal: sinalComTempo(o.sinal)});
      if (!r.ok) {
        const e = erroDoGoogle(r.status, await r.text().catch(() => ''), {provedor: 'gemini', chave: o.chave});
        if (e.tipo === 'chave' || e.tipo === 'desativada') throw e;
        return {vozes: VOZES_GEMINI, aviso: `a biblioteca estendida não respondeu (${e.message}); ficam as 30 vozes prontas`};
      }
      const j = (await r.json()) as RespostaVozes;
      for (const v of j.voices ?? []) {
        const id = v.id ?? v.name;
        if (!id || VOZES_GEMINI.some((x) => x.id === id)) continue;
        extras.push({id, nome: v.display_name ?? v.displayName ?? id, descricao: v.description, idioma: v.language_code ?? v.languageCode,
          genero: /female|fem/i.test(v.gender ?? '') ? 'feminina' : /male|masc/i.test(v.gender ?? '') ? 'masculina' : undefined});
      }
      pagina = j.next_page_token ?? j.nextPageToken;
      if (!pagina) break;
    }
  } catch (e) {
    if (e instanceof ErroNarracao) throw e;
    return {vozes: VOZES_GEMINI, aviso: `${erroDeRede(e, {provedor: 'gemini', chave: o.chave, sinal: o.sinal}).message}; ficam as 30 vozes prontas`};
  }
  return {vozes: [...VOZES_GEMINI, ...extras]};
};
