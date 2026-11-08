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
