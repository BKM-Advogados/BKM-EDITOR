// Onde o app acha a chave de cada provedor. A chave fica só no processo principal: a tela recebe "tem chave" e os 4
// últimos caracteres, nunca o texto. O cofre do Electron (safeStorage, cofre-electron.ts) entra no app; nos testes,
// o cofre em memória. Uma variável de ambiente que já exista no PC vale como reserva, com aviso na tela.

export interface Cofre {
  ler(provedor: string): string | undefined;
  gravar(provedor: string, chave: string): void;
  apagar(provedor: string): void;
}

export class CofreMemoria implements Cofre {
  private chaves = new Map<string, string>();
  ler(p: string) {
    return this.chaves.get(p);
  }
  gravar(p: string, c: string) {
    this.chaves.set(p, c);
  }
  apagar(p: string) {
    this.chaves.delete(p);
  }
}

const VARIAVEIS: Record<string, string[]> = {
  deepseek: ['DEEPSEEK_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  xai: ['XAI_API_KEY'],
  groq: ['GROQ_API_KEY'],
};

export type OrigemChave = 'cofre' | 'ambiente' | 'nenhuma';

/** A chave do provedor e de onde ela veio. */
export const acharChave = (cofre: Cofre, provedor: string, ambiente: NodeJS.ProcessEnv = process.env): {chave?: string; origem: OrigemChave; variavel?: string} => {
  const c = cofre.ler(provedor);
  if (c) return {chave: c, origem: 'cofre'};
  for (const v of VARIAVEIS[provedor] ?? []) if (ambiente[v]) return {chave: ambiente[v], origem: 'ambiente', variavel: v};
  return {origem: 'nenhuma'};
};

/** O que a tela pode saber da chave. */
export const finalDaChave = (c?: string) => (c && c.length >= 8 ? c.slice(-4) : undefined);
