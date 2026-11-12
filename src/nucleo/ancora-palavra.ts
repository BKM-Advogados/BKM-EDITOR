// Âncora de palavra: "palavra@ms" é a primeira palavra que começa com `palavra` a partir de `ms` (sem diferença de
// acento, caixa ou pontuação); "palavra$@ms" ancora no fim dela e "palavra@ms+120" desloca (ou "-80" adianta). Nasceu no
// resolvedor do roteiro do carrossel narrado (roteiro/resolver.ts, porte do preparar_carrossel.py), onde `ms` é do
// vídeo-fonte; o vídeo de cenas usa a mesma regra com `ms` contado do começo da cena (cenas.ts, `em_palavra` e
// `sai_palavra` do bloco). Puro: sem disco, para o resolvedor, a interface e o MCP lerem igual.

export type Palavra = {w: string; s: number; e: number};

export class ErroRoteiro extends Error {}

const ANCORA = /^(?<w>[^@]+?)(?<fim>\$)?@(?<ms>\d+)(?<d>[+-]\d+)?$/;
const PONTUACAO = '.,;:!?"\'“”()…';

/** A palavra como a âncora compara: sem acento, em minúsculas e sem pontuação nas pontas. */
export const norm = (w: string): string => {
  let s = w.trim().toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '');
  let a = 0;
  let z = s.length;
  while (a < z && PONTUACAO.includes(s[a])) a++;
  while (z > a && PONTUACAO.includes(s[z - 1])) z--;
  s = s.slice(a, z);
  return s;
};

export type AncoraLida = {w: string; fim: boolean; ms: number; d: number};

/** Lê "palavra@ms", "palavra$@ms" e "palavra@ms+120"; escrita fora disso é ErroRoteiro. */
export const lerAncora = (a: string): AncoraLida => {
  const m = ANCORA.exec(a.trim());
  if (!m?.groups) throw new ErroRoteiro(`âncora mal escrita: '${a}' (use palavra@ms, palavra@ms+120 ou palavra$@ms)`);
  return {w: m.groups.w, fim: Boolean(m.groups.fim), ms: Number(m.groups.ms), d: Number(m.groups.d ?? 0)};
};

/** A âncora escrita de volta, no formato que lerAncora lê. */
export const escreverAncora = (a: AncoraLida): string => `${a.w}${a.fim ? '$' : ''}@${Math.max(0, Math.round(a.ms))}${a.d ? `${a.d > 0 ? '+' : ''}${Math.round(a.d)}` : ''}`;

/** A mesma âncora com o `ms` de busca deslocado (nunca abaixo de 0): a lâmina conta o tempo do novo começo da cena.
 *  Âncora mal escrita volta como veio. */
export const deslocarAncora = (a: string, delta: number): string => {
  try {
    const m = lerAncora(a);
    return escreverAncora({...m, ms: Math.max(0, m.ms + delta)});
  } catch {
    return a;
  }
};

/** Índice da primeira palavra que começa em `depois` ou mais tarde e cuja forma normalizada começa com `w`; -1 se não há. */
export const acharPalavra = (palavras: readonly Palavra[], w: string, depois: number): number => {
  const alvo = norm(w);
  return palavras.findIndex((p) => p.s >= depois && norm(p.w).startsWith(alvo));
};

/** As palavras em volta de `depois` ("w@s"), para a mensagem de âncora não achada dizer o que havia por perto. */
export const palavrasPerto = (palavras: readonly Palavra[], depois: number): string =>
  palavras.filter((p) => depois - 1500 <= p.s && p.s <= depois + 6000).map((p) => `${p.w.trim()}@${p.s}`).join(' ');

/** O tempo da âncora no mesmo relógio das palavras dadas (começo ou fim da palavra, mais o deslocamento), ou o motivo de
 *  não dar: a âncora mal escrita, a falta de palavras ou a palavra que não aparece depois de `ms`. */
export const tempoDaAncora = (a: string, palavras: readonly Palavra[]): {ms: number; palavra: Palavra} | {erro: string} => {
  let m: AncoraLida;
  try {
    m = lerAncora(a);
  } catch (e) {
    return {erro: (e as Error).message};
  }
  if (!palavras.length) return {erro: 'sem palavras transcritas'};
  const i = acharPalavra(palavras, m.w, m.ms);
  if (i < 0) {
    const perto = palavrasPerto(palavras, m.ms);
    return {erro: `não achei "${m.w}" a partir de ${m.ms} ms${perto ? ` (perto: ${perto})` : ''}`};
  }
  const p = palavras[i];
  return {ms: (m.fim ? p.e : p.s) + m.d, palavra: p};
};

/** A âncora que prende exatamente esta palavra (o começo dela como `ms`), ou null se a palavra é só pontuação. */
export const ancoraDaPalavra = (p: Palavra, fim = false): string | null => {
  const w = norm(p.w).replace(/[@$]/g, ''); // "@" e "$" têm sentido na âncora
  return w ? escreverAncora({w, fim, ms: Math.max(0, Math.floor(p.s)), d: 0}) : null;
};
