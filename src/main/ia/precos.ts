// Tabela de preços por milhão de tokens, em dólar, conferida nas páginas oficiais em 07/11 e 08/11/2026 (docs/ia.md).
// Mudança de preço é um commit aqui: o app nunca busca preço sozinho. O custo que sai daqui é estimado e diz a data da
// tabela. Modelo fora da tabela não ganha custo (a tela mostra só os tokens).

export const DATA_DA_TABELA = '08/11/2026';

type Faixa = {ate?: string; entrada: number; cache?: number; saida: number}; // ate = último dia (AAAA-MM-DD) do preço
type Linha = {provedor: string; modelo: RegExp; faixas: Faixa[]; pico?: (d: Date) => boolean; fonte: string};

// DeepSeek: pico 01:00–04:00 e 06:00–10:00 UTC, de segunda a sexta (feriados chineses ficam fora da conta: o custo
// sai como fora do pico nesses dias, ou seja, a estimativa pode ficar abaixo do cobrado)
const picoDeepSeek = (d: Date) => {
  const dia = d.getUTCDay();
  const h = d.getUTCHours();
  return dia >= 1 && dia <= 5 && ((h >= 1 && h < 4) || (h >= 6 && h < 10));
};

const TABELA: Linha[] = [
  {provedor: 'deepseek', modelo: /^deepseek-(flash|v4-flash|chat)/, pico: picoDeepSeek, fonte: 'api-docs.deepseek.com/quick_start/pricing',
    faixas: [{entrada: 0.15, cache: 0.003, saida: 0.6}]},
  {provedor: 'deepseek', modelo: /^deepseek-v4-pro/, pico: picoDeepSeek, fonte: 'api-docs.deepseek.com/quick_start/pricing',
    faixas: [{entrada: 0.66, cache: 0.022, saida: 1.98}]},
  {provedor: 'gemini', modelo: /^gemini-4-argon/, fonte: 'aistudio.google.com/docs/pricing',
    faixas: [{ate: '2026-11-30', entrada: 2, saida: 10}, {entrada: 4, saida: 20}]},
  {provedor: 'gemini', modelo: /^gemini-3\.(8|6)-flash$/, fonte: 'aistudio.google.com/docs/pricing',
    faixas: [{ate: '2026-12-31', entrada: 0.75, saida: 3.75}, {entrada: 1.5, saida: 7.5}]},
  {provedor: 'gemini', modelo: /^gemini-3\.5-flash-lite/, fonte: 'aistudio.google.com/docs/pricing', faixas: [{entrada: 0.3, saida: 2.5}]},
  {provedor: 'gemini', modelo: /^gemini-3\.1-flash-lite/, fonte: 'aistudio.google.com/docs/pricing', faixas: [{entrada: 0.25, saida: 1.5}]},
];

export type UsoTokens = {entrada: number; entrada_cache: number; saida: number};

/** Custo estimado do uso, ou undefined se o modelo não está na tabela. O cache sem preço próprio conta como entrada cheia. */
export const custoEstimado = (provedor: string, modelo: string, u: UsoTokens, quando = new Date()) => {
  const linha = TABELA.find((l) => l.provedor === provedor && l.modelo.test(modelo));
  if (!linha) return undefined;
  const dia = quando.toISOString().slice(0, 10);
  const f = linha.faixas.find((x) => !x.ate || dia <= x.ate) ?? linha.faixas[linha.faixas.length - 1];
  const fator = linha.pico?.(quando) ? 2 : 1;
  const semCache = Math.max(0, u.entrada - u.entrada_cache);
  const usd = ((semCache * f.entrada + u.entrada_cache * (f.cache ?? f.entrada) + u.saida * f.saida) * fator) / 1_000_000;
  return {usd, pico: fator === 2, tabela: DATA_DA_TABELA, fonte: linha.fonte};
};

// ---------- narração por IA (docs/narracao.md) ----------
// Conferida em 10/11/2026 em aistudio.google.com/docs/pricing (Gemini TTS) e cloud.google.com/text-to-speech/pricing (Chirp 3: HD).
// Gemini: texto de entrada e áudio de saída por milhão de tokens; o áudio conta 25 tokens por segundo. Os dois preços dobram
// em 01/01/2027. Cloud TTS: por milhão de caracteres, com 1 milhão grátis por mês (a estimativa não desconta a parte grátis,
// porque o app não sabe quanto a pessoa já usou no mês).
export const DATA_DA_TABELA_NARRACAO = '10/11/2026';

type FaixaTts = {ate?: string; entrada?: number; saida?: number; caracteres?: number};
const TABELA_TTS: {provedor: 'gemini' | 'google-tts'; modelo: RegExp; faixas: FaixaTts[]; fonte: string; nota?: string}[] = [
  {provedor: 'gemini', modelo: /^gemini-3\.8-flash-lite-tts/, fonte: 'aistudio.google.com/docs/pricing',
    faixas: [{ate: '2026-12-31', entrada: 0.5, saida: 6}, {entrada: 1, saida: 12}]},
  {provedor: 'gemini', modelo: /^gemini-3\.8-flash-tts/, fonte: 'aistudio.google.com/docs/pricing',
    faixas: [{ate: '2026-12-31', entrada: 0.5, saida: 9}, {entrada: 1, saida: 18}]},
  {provedor: 'gemini', modelo: /^gemini-3\.1-flash-tts/, fonte: 'aistudio.google.com/docs/pricing', faixas: [{entrada: 1, saida: 20}]},
  {provedor: 'google-tts', modelo: /^chirp3-hd$/, fonte: 'cloud.google.com/text-to-speech/pricing', faixas: [{caracteres: 30}],
    nota: 'o Google dá 1 milhão de caracteres grátis por mês nas vozes Chirp 3: HD; a estimativa não desconta'},
];

/** Custo estimado de uma narração: tokens de texto e de áudio no Gemini, caracteres no Cloud TTS. Modelo fora da tabela: undefined. */
export const custoNarracao = (provedor: string, modelo: string, m: {tokens_entrada: number; tokens_saida: number; caracteres: number}, quando = new Date()) => {
  const linha = TABELA_TTS.find((l) => l.provedor === provedor && l.modelo.test(modelo));
  if (!linha) return undefined;
  const dia = quando.toISOString().slice(0, 10);
  const f = linha.faixas.find((x) => !x.ate || dia <= x.ate) ?? linha.faixas[linha.faixas.length - 1];
  const usd = ((f.entrada ?? 0) * m.tokens_entrada + (f.saida ?? 0) * m.tokens_saida + (f.caracteres ?? 0) * m.caracteres) / 1_000_000;
  return {usd, tabela: DATA_DA_TABELA_NARRACAO, fonte: linha.fonte, ...(linha.nota ? {nota: linha.nota} : {})};
};
