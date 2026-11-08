// Listas com marcadores e numeradas no texto da imagem (rodada 3, frente Marca): a camada de texto com `lista` vira uma lista,
// um item por linha do texto. O marcador fica na margem e o texto do item, e as linhas que ele quebra, ficam recuados
// (recuo pendente): é o que o texto livre não faz sozinho. As regras de quebra e posição são puras e recebem a medida do
// texto de quem chama: a pintura em canvas (prévia, PNG e PDF usam o mesmo desenho) mede com o contexto dela, então os três
// quebram igual. Camada com lista sempre vai pelo canvas. Ver docs/marca.md.
import type {CamadaImagem} from './documentos';

export type TipoDeLista = NonNullable<CamadaImagem['lista']>;
export const TIPOS_DE_LISTA: [TipoDeLista | 'nenhuma', string][] = [['nenhuma', 'Sem lista'], ['marcadores', 'Com marcadores'], ['numerada', 'Numerada']];
export const MARCADOR_PADRAO = '•';

/** O texto é uma lista? Só camada de texto com `lista` válida. */
export const temLista = (c: Pick<CamadaImagem, 'tipo' | 'lista'>) => c.tipo === 'texto' && (c.lista === 'marcadores' || c.lista === 'numerada');

/** O marcador do item `n` (1, 2, 3…, contando só os itens com texto): o dela ou "•", ou "1.", "2."… na lista numerada. */
export const marcadorDe = (c: Pick<CamadaImagem, 'lista' | 'lista_marcador'>, n: number) => {
  if (c.lista === 'numerada') return `${n}.`;
  const m = typeof c.lista_marcador === 'string' ? c.lista_marcador.trim().slice(0, 4) : '';
  return m || MARCADOR_PADRAO;
};

/** O recuo do texto dos itens, em px: o do documento ou a largura do maior marcador mais 40% do tamanho da letra. */
export const recuoDaLista = (c: Pick<CamadaImagem, 'lista_recuo' | 'tamanho'>, larguraDoMaiorMarcador: number, tamanhoPadrao = 48) => {
  if (typeof c.lista_recuo === 'number' && c.lista_recuo > 0) return c.lista_recuo;
  return Math.ceil(larguraDoMaiorMarcador + (c.tamanho ?? tamanhoPadrao) * 0.4);
};

export type LayoutDeLista = {linhas: string[]; x: number[]; marcas: (string | null)[]; recuo: number};

/** Quebra a lista em linhas: cada linha do texto é um item (linha em branco fica em branco, sem marcador) e o que passa da
 *  coluna (a largura menos o recuo) quebra com o mesmo recuo. `x` é onde cada linha começa, ou termina se o texto é
 *  alinhado à direita, ou fica no meio se centralizado, sempre dentro da coluna; `marcas[k]` é o marcador que a linha k
 *  leva na margem (só a primeira de cada item). `medir` mede um trecho; `quebrar` parte um item pela largura. */
export const layoutDeLista = (c: Pick<CamadaImagem, 'texto' | 'lista' | 'lista_marcador' | 'lista_recuo' | 'tamanho' | 'largura' | 'alinhar'>,
  medir: (texto: string) => number, quebrar: (texto: string, largura: number) => string[]): LayoutDeLista => {
  const itens = (c.texto ?? '').split('\n');
  let n = 0;
  const marcadores = itens.map((t) => (t.trim() ? marcadorDe(c, ++n) : null));
  const maior = Math.max(0, ...marcadores.map((m) => (m ? medir(m) : 0)));
  const recuo = recuoDaLista(c, maior);
  const coluna = Math.max(1, c.largura - recuo);
  const a = c.alinhar ?? 'esquerda';
  const xTexto = a === 'centro' ? recuo + coluna / 2 : a === 'direita' ? c.largura : recuo;
  const linhas: string[] = [];
  const x: number[] = [];
  const marcas: (string | null)[] = [];
  itens.forEach((item, i) => {
    if (!marcadores[i]) {
      linhas.push('');
      x.push(xTexto);
      marcas.push(null);
      return;
    }
    quebrar(item, coluna).forEach((parte, j) => {
      linhas.push(parte);
      x.push(xTexto);
      marcas.push(j === 0 ? marcadores[i] : null);
    });
  });
  return {linhas, x, marcas, recuo};
};
