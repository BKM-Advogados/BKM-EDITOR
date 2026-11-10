// HTTP falso dos dois provedores da narração por IA (Gemini TTS e Google Cloud TTS): guarda cada pedido e responde com um WAV
// de verdade (um seno de 220 Hz) do tamanho do texto. Nenhuma chave real, nenhuma rede.
import {wavDePcm16} from '../../src/nucleo/narracao';

export const CHAVE_GEMINI = 'AIzaFALSAgemini1234';
export const CHAVE_TTS = 'AIzaFALSAtts5678';

/** PCM 16 bits mono de `ms` milissegundos (seno de 220 Hz a −12 dBFS). */
export const pcmSeno = (ms: number, taxa = 24000) => {
  const n = Math.round((taxa * ms) / 1000);
  const b = new Uint8Array(n * 2);
  const v = new DataView(b.buffer);
  for (let i = 0; i < n; i++) v.setInt16(i * 2, Math.round(Math.sin((2 * Math.PI * 220 * i) / taxa) * 0.25 * 32767), true);
  return b;
};
export const base64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

export type PedidoFalso = {url: string; metodo: string; cabecalhos: Record<string, string>; corpo?: any};

/** Duração da fala falsa: 60 ms por caractere, para a cena longa passar do fim. */
export const msDoTexto = (t: string) => Math.max(300, t.length * 60);

export const criarGoogleFalso = (o: {gemini?: 'wav' | 'l16'; respostas?: ((p: PedidoFalso) => Response | undefined)[]} = {}) => {
  const pedidos: PedidoFalso[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const cab: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (cab[k] = v));
    const p: PedidoFalso = {url: String(url), metodo: init?.method ?? 'GET', cabecalhos: cab, corpo: init?.body ? JSON.parse(String(init.body)) : undefined};
    pedidos.push(p);
    for (const r of o.respostas ?? []) {
      const x = r(p);
      if (x) return x;
    }
    const chave = cab['x-goog-api-key'];
    if (p.url.includes('generativelanguage')) {
      if (chave !== CHAVE_GEMINI) return new Response(JSON.stringify({error: {code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT',
        details: [{reason: 'API_KEY_INVALID'}]}}), {status: 400});
      if (p.url.includes('/voices')) return Response.json({voices: [{id: 'voz-estendida-1', display_name: 'Bia', language_code: 'pt-BR', gender: 'FEMALE'}]});
      const texto = String(p.corpo?.contents?.[0]?.parts?.[0]?.text ?? '');
      const pcm = pcmSeno(msDoTexto(texto));
      const audio = o.gemini === 'l16' ? {mimeType: 'audio/L16;codec=pcm;rate=24000', data: base64(pcm)} : {mimeType: 'audio/wav', data: base64(wavDePcm16(pcm, 24000))};
      return Response.json({candidates: [{content: {parts: [{inlineData: audio}]}, finishReason: 'STOP'}], usageMetadata: {promptTokenCount: 20, candidatesTokenCount: 100}});
    }
    if (p.url.includes('texttospeech')) {
      if (chave !== CHAVE_TTS) return new Response(JSON.stringify({error: {code: 403, message: 'The request is missing a valid API key.', status: 'PERMISSION_DENIED'}}), {status: 403});
      if (p.url.includes('/voices')) return Response.json({voices: [{name: 'pt-BR-Chirp3-HD-Kore', ssmlGender: 'FEMALE', languageCodes: ['pt-BR']},
        {name: 'pt-BR-Chirp3-HD-Charon', ssmlGender: 'MALE', languageCodes: ['pt-BR']}, {name: 'pt-BR-Wavenet-A', ssmlGender: 'FEMALE', languageCodes: ['pt-BR']}]});
      const texto = String(p.corpo?.input?.text ?? p.corpo?.input?.markup ?? '');
      return Response.json({audioContent: base64(wavDePcm16(pcmSeno(msDoTexto(texto)), 24000))});
    }
    return new Response('não achado', {status: 404});
  }) as typeof fetch;
  return {fetch: f, pedidos, sinteses: () => pedidos.filter((p) => p.metodo === 'POST')};
};
