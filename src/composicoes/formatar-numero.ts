// Como o número que conta de `de` até `ate` aparece (video-D8): com as casas decimais que os valores têm, em vez de arredondar
// para inteiro (7,5% saía 8%) ou fixar uma casa só (R$ 1.412,50 saía "1.412,5"). Puro: serve ao vídeo de cenas e ao carrossel.
const MAX_CASAS = 4;

/** Quantas casas decimais um número tem (até 4): 7,5 → 1; 2824,68 → 2; 280 → 0. */
export const casasDe = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  const t = Math.abs(n).toString();
  if (t.includes('e')) return Math.min(MAX_CASAS, Math.max(0, Number(t.split('e-')[1] ?? 0)));
  const i = t.indexOf('.');
  return i < 0 ? 0 : Math.min(MAX_CASAS, t.length - i - 1);
};

const DINHEIRO = /R\$|reais?\b/i;

/** As casas do bloco: o campo `casas` (0 a 4), se o documento o traz; senão as dos valores. Em dinheiro (prefixo ou sufixo com
 *  "R$" ou "reais") com centavos, sempre duas: R$ 1.412,50, nunca "1.412,5". */
export const casasDoNumero = (b: {de?: number; ate?: number; casas?: number; prefixo?: string; sufixo?: string}): number => {
  if (typeof b.casas === 'number' && Number.isFinite(b.casas)) return Math.min(MAX_CASAS, Math.max(0, Math.round(b.casas)));
  const casas = Math.max(casasDe(b.de ?? 0), casasDe(b.ate ?? 0));
  return casas > 0 && DINHEIRO.test(`${b.prefixo ?? ''} ${b.sufixo ?? ''}`) ? Math.max(2, casas) : casas;
};

/** O valor no ponto da contagem, em pt-BR e com as casas dadas (milhar com ponto, decimais com vírgula). */
export const formatarNumero = (valor: number, casas: number): string =>
  valor.toLocaleString('pt-BR', {minimumFractionDigits: casas, maximumFractionDigits: casas});
