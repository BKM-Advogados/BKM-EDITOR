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

/** A definição do tipo, ou undefined se o tipo não existe (o JSON pode ter sido escrito à mão ou pela IA). */
export const definicaoDe = (tipo: unknown): DefinicaoEfeito | undefined => EFEITOS.find((d) => d.tipo === tipo);

export const definicao = (tipo: TipoEfeito) => EFEITOS.find((d) => d.tipo === tipo)!;

const ligado = (e: Efeito) => e.ativo !== false;
const CAMADAS: TipoEfeito[] = ['vinheta', 'granulado', 'tom'];

// ---------- leitura validada (tres-efeitos-D1, D2) ----------

/** Um item da pilha como está no documento: `efeito` é o item pronto para desenhar (valor dentro da faixa do tipo), ou
 *  null quando não dá para desenhar (tipo desconhecido, item que nem objeto é); `problema` diz o que foi corrigido ou
 *  por que o item não vale. A posição na lista é a do documento (os caminhos /efeitos/i continuam batendo). */
export type EfeitoLido = {efeito: Efeito | null; problema?: string; original: unknown};

const numeroDe = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const entre = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const COR_HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Valida a pilha de efeitos do documento sem perder a posição de ninguém. Valor em texto numérico ("1.2") vira número; fora
 *  da faixa do tipo, a faixa; sem valor, o padrão do tipo; `ativo` que não é booleano some; cor do tom que não é hexadecimal
 *  volta à do padrão. Tipo desconhecido não desenha (efeito null) e fica avisado, para a pilha mostrar e deixar excluir. */
export const lerEfeitos = (x: unknown): EfeitoLido[] => {
  if (!Array.isArray(x)) return [];
  return x.map((bruto, i): EfeitoLido => {
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return {efeito: null, original: bruto, problema: `efeito ${i + 1}: não é um objeto`};
    const e = bruto as Record<string, unknown>;
    const d = definicaoDe(e.tipo);
    const id = typeof e.id === 'string' && e.id ? e.id : `efeito-${i + 1}`;
    if (!d) return {efeito: null, original: bruto, problema: `${id}: tipo "${String(e.tipo)}" não existe (${EFEITOS.map((x2) => x2.tipo).join(', ')})`};
    const problemas: string[] = [];
    let valor = numeroDe(e.valor);
    if (valor === null) {
      problemas.push(`sem valor numérico (${JSON.stringify(e.valor ?? null)}): usado ${d.padrao}`);
      valor = d.padrao;
    } else if (typeof e.valor !== 'number') problemas.push(`valor em texto: lido como ${valor}`);
    const preso = entre(valor, d.min, d.max);
    if (preso !== valor) {
      problemas.push(`valor ${valor} fora de ${d.min} a ${d.max}: usado ${preso}`);
      valor = preso;
    }
    const lido: Efeito = {id, tipo: d.tipo, valor};
    if (e.ativo === false) lido.ativo = false;
    if (d.tipo === 'tom') lido.cor = typeof e.cor === 'string' && COR_HEX.test(e.cor.trim()) ? e.cor.trim() : '#C88155';
    return {efeito: lido, original: bruto, ...(problemas.length ? {problema: `${id}: ${problemas.join('; ')}`} : {})};
  });
};

/** Só os efeitos que dá para desenhar, já corrigidos. Serve ao filtro, às camadas, ao PNG e à pilha de qualquer destino. */
export const efeitosValidos = (x: unknown): Efeito[] => lerEfeitos(x).flatMap((l) => (l.efeito ? [l.efeito] : []));

/** Os problemas da pilha, um texto por item (para o aviso do resolvedor e da área Efeitos). */
export const problemasDosEfeitos = (x: unknown): string[] => lerEfeitos(x).flatMap((l) => (l.problema ? [l.problema] : []));

/** Filtro CSS da pilha (vale em `style.filter` e em `CanvasRenderingContext2D.filter`). Vazio quando não há filtro. Lê a
 *  pilha validada: um valor fora da faixa não derruba o filtro inteiro (o navegador descarta a cadeia com um item inválido). */
export const filtroCss = (efeitos: unknown = []): string =>
  efeitosValidos(efeitos)
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

export const camadas = (efeitos: unknown = []) => efeitosValidos(efeitos).filter((e) => ligado(e) && CAMADAS.includes(e.tipo));

/** Novo efeito com o valor padrão; o id não repete os que já estão na pilha. */
export const novoEfeito = (tipo: TipoEfeito, existentes: {id: string}[] = []): Efeito => {
  let n = 1;
  while (existentes.some((e) => e.id === `${tipo}-${n}`)) n++;
  return {id: `${tipo}-${n}`, tipo, valor: definicao(tipo).padrao, ...(tipo === 'tom' ? {cor: '#C88155'} : {})};
};
