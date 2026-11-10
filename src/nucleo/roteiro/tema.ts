// Tema do carrossel narrado (src/composicoes/carrossel): a paleta e as fontes das cenas presas às palavras da narração.
// Só dados (sem disco nem React): a composição e a exportação importam daqui. Há um tema só, o neutro; o campo `tema`
// do roteiro.json escolhe por nome e o que não for conhecido (como o "c2" dos roteiros antigos) cai no neutro.

/** Cores por papel: o destaque (formas, preenchimentos, a palavra dita), as versões profunda (texto de destaque no fundo
 *  claro) e clara (texto de destaque no fundo escuro), o escuro dos cartões, o fundo das cenas escuras, a névoa (texto de
 *  apoio no claro), o claro (fundo das cenas claras e texto no escuro) e uma cor de apoio. */
export type PaletaCarrossel = {
  destaque: string; destaqueProfundo: string; destaqueClaro: string;
  escuro: string; escuroProfundo: string; nevoa: string; claro: string; apoio: string;
};
export type FontesCarrossel = {titulo: string; texto: string; mono: string};
export type TemaCarrossel = {id: string; nome: string; cores: PaletaCarrossel; fontes: FontesCarrossel};

export const TEMA_CARROSSEL_NEUTRO: TemaCarrossel = {
  id: 'neutro',
  nome: 'Neutro',
  cores: {destaque: '#4A90D9', destaqueProfundo: '#1F5A99', destaqueClaro: '#9CC8F5', escuro: '#262C33', escuroProfundo: '#111418',
    nevoa: '#3A434C', claro: '#F3F4F6', apoio: '#5B6B7A'},
  fontes: {titulo: 'Archivo', texto: 'IBM Plex Sans', mono: 'IBM Plex Mono'},
};

export const TEMAS_CARROSSEL: Record<string, TemaCarrossel> = {neutro: TEMA_CARROSSEL_NEUTRO};

/** O tema pelo nome do roteiro. Ausente, desconhecido ou de antes do tema neutro ("c2"): o neutro. */
export const temaDoCarrossel = (nome?: unknown): TemaCarrossel =>
  (typeof nome === 'string' && TEMAS_CARROSSEL[nome]) || TEMA_CARROSSEL_NEUTRO;

/** Cor de destaque de uma linha do gancho ou de uma faixa da régua. "cobre" é o nome dos roteiros antigos. */
export const ehCorDeDestaque = (cor?: unknown) => cor === 'destaque' || cor === 'cobre';
