// Pilha de efeitos visuais, a mesma para vídeo e imagem. Filtros de cor e desfoque viram uma string de filtro CSS, que
// vale no DOM (prévia e render do Remotion) e no canvas 2D (ctx.filter, exportação da imagem). Vinheta, granulado e tom
// são camadas por cima. Tudo determinístico: o granulado usa o quadro como semente.

export type TipoEfeito = 'desfoque' | 'brilho' | 'contraste' | 'saturacao' | 'matiz' | 'sepia' | 'vinheta' | 'granulado' | 'tom';

export type Efeito = {
  id: string;
  tipo: TipoEfeito;
  valor: number;
  ativo?: boolean; // padrão: ligado
  cor?: string; // só "tom"
};

export type DefinicaoEfeito = {tipo: TipoEfeito; nome: string; min: number; max: number; passo: number; padrao: number; unidade: string};

export const EFEITOS: DefinicaoEfeito[] = [
  {tipo: 'desfoque', nome: 'Desfoque', min: 0, max: 30, passo: 0.5, padrao: 4, unidade: 'px'},
  {tipo: 'brilho', nome: 'Brilho', min: 0, max: 2, passo: 0.01, padrao: 1.1, unidade: '×'},
  {tipo: 'contraste', nome: 'Contraste', min: 0, max: 2, passo: 0.01, padrao: 1.15, unidade: '×'},
  {tipo: 'saturacao', nome: 'Saturação', min: 0, max: 3, passo: 0.01, padrao: 1.2, unidade: '×'},
  {tipo: 'matiz', nome: 'Matiz', min: -180, max: 180, passo: 1, padrao: 15, unidade: '°'},
  {tipo: 'sepia', nome: 'Sépia', min: 0, max: 1, passo: 0.01, padrao: 0.4, unidade: ''},
  {tipo: 'vinheta', nome: 'Vinheta', min: 0, max: 1, passo: 0.01, padrao: 0.5, unidade: ''},
  {tipo: 'granulado', nome: 'Granulado', min: 0, max: 1, passo: 0.01, padrao: 0.25, unidade: ''},
  {tipo: 'tom', nome: 'Tom de cor', min: 0, max: 1, passo: 0.01, padrao: 0.25, unidade: ''},
];

export const definicao = (tipo: TipoEfeito) => EFEITOS.find((d) => d.tipo === tipo)!;

const ligado = (e: Efeito) => e.ativo !== false;

/** Filtro CSS da pilha (vale em `style.filter` e em `CanvasRenderingContext2D.filter`). Vazio quando não há filtro. */
export const filtroCss = (efeitos: Efeito[] = []): string =>
  efeitos
    .filter(ligado)
    .map((e) => {
      switch (e.tipo) {
        case 'desfoque': return `blur(${e.valor}px)`;
        case 'brilho': return `brightness(${e.valor})`;
        case 'contraste': return `contrast(${e.valor})`;
        case 'saturacao': return `saturate(${e.valor})`;
        case 'matiz': return `hue-rotate(${e.valor}deg)`;
        case 'sepia': return `sepia(${e.valor})`;
        default: return '';
      }
    })
    .filter(Boolean)
    .join(' ');

export const camadas = (efeitos: Efeito[] = []) => efeitos.filter((e) => ligado(e) && ['vinheta', 'granulado', 'tom'].includes(e.tipo));

/** Novo efeito com o valor padrão; o id não repete os que já estão na pilha. */
export const novoEfeito = (tipo: TipoEfeito, existentes: Efeito[] = []): Efeito => {
  let n = 1;
  while (existentes.some((e) => e.id === `${tipo}-${n}`)) n++;
  return {id: `${tipo}-${n}`, tipo, valor: definicao(tipo).padrao, ...(tipo === 'tom' ? {cor: '#C88155'} : {})};
};
