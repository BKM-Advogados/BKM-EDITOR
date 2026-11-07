// Zoom dinâmico (Ken Burns) do bloco de imagem do vídeo de cenas: a foto parada aproxima, afasta ou desliza enquanto o
// bloco está na tela, para o vídeo não ter cara de slide. Conta pura, sem React: o VideoCenas passa o progresso do
// bloco (0 no `em`, 1 no `sai`) e aplica a escala e o deslocamento no <Img>, dentro da caixa com o excesso escondido.
// O deslocamento é fração da própria caixa e nunca passa da folga que a escala dá, então a borda da imagem não aparece
// (no encaixe "Preencher"); como tudo é relativo à caixa, vale igual nos quatro formatos. O botão "Movimento em todas as
// imagens" (CenasVideo) usa `patchMovimentoEmTodas`, que alterna os tipos para as fotos seguidas não repetirem o gesto.
import type {BlocoCenas, DocCenas, MovimentoImagem} from '../../nucleo/cenas';
import type {OperacaoPatch} from '../../nucleo/documentos';

export type TipoMovimento = MovimentoImagem['tipo'];

export const TIPOS_MOVIMENTO: {id: TipoMovimento; nome: string}[] = [
  {id: 'aproximar', nome: 'Aproximar'},
  {id: 'afastar', nome: 'Afastar'},
  {id: 'esquerda', nome: 'Deslizar para a esquerda'},
  {id: 'direita', nome: 'Deslizar para a direita'},
  {id: 'cima', nome: 'Deslizar para cima'},
  {id: 'baixo', nome: 'Deslizar para baixo'},
];

export const INTENSIDADE_PADRAO = 0.15;
export const INTENSIDADE_MIN = 0.05;
export const INTENSIDADE_MAX = 0.4;

/** A ordem do "Movimento em todas as imagens": entra, passeia, sai, passeia de volta. */
export const SEQUENCIA_MOVIMENTO: TipoMovimento[] = ['aproximar', 'direita', 'afastar', 'esquerda'];

const ehTipo = (t: unknown): t is TipoMovimento => TIPOS_MOVIMENTO.some((x) => x.id === t);
const limitar = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Intensidade dentro da faixa; ausente ou fora do lugar volta ao padrão. */
export const intensidadeDe = (m: MovimentoImagem) =>
  typeof m.intensidade === 'number' && Number.isFinite(m.intensidade) ? limitar(m.intensidade, INTENSIDADE_MIN, INTENSIDADE_MAX) : INTENSIDADE_PADRAO;

/** Atenuação suave (seno): parte devagar, acelera no meio e pousa devagar. */
const suavizar = (p: number) => 0.5 - Math.cos(Math.PI * p) / 2;

/** Escala e deslocamento (fração da caixa) no progresso `p` do bloco. Tipo desconhecido: parada. */
export const quadroDoMovimento = (m: MovimentoImagem | undefined, p: number): {escala: number; x: number; y: number} => {
  if (!m || !ehTipo(m.tipo)) return {escala: 1, x: 0, y: 0};
  const k = intensidadeDe(m);
  const t = limitar(Number.isFinite(p) ? p : 0, 0, 1);
  const e = m.suave === false ? t : suavizar(t);
  if (m.tipo === 'aproximar') return {escala: 1 + k * e, x: 0, y: 0};
  if (m.tipo === 'afastar') return {escala: 1 + k * (1 - e), x: 0, y: 0};
  // deslizar: escala fixa e o passeio de uma folga à outra (a escala 1 + k sobra k/2 da caixa de cada lado; a conta
  // usa 90% da folga para o arredondamento do navegador não mostrar um fio da borda)
  const folga = (k / 2) * 0.9;
  const ida = folga * (1 - 2 * e); // +folga → −folga
  if (m.tipo === 'esquerda') return {escala: 1 + k, x: ida, y: 0};
  if (m.tipo === 'direita') return {escala: 1 + k, x: -ida, y: 0};
  if (m.tipo === 'cima') return {escala: 1 + k, x: 0, y: ida};
  return {escala: 1 + k, x: 0, y: -ida};
};

/** O `transform` CSS do <Img>; undefined quando a imagem fica parada (o quadro sai idêntico ao de antes). */
export const transformDoMovimento = (m: MovimentoImagem | undefined, p: number): string | undefined => {
  if (!m || !ehTipo(m.tipo)) return undefined;
  const q = quadroDoMovimento(m, p);
  const n = (v: number) => Math.round(v * 1e5) / 1e5;
  return `translate(${n(q.x * 100)}%, ${n(q.y * 100)}%) scale(${n(q.escala)})`;
};

/** Patch do botão da barra: põe movimento nas imagens que estão paradas, alternando a SEQUENCIA_MOVIMENTO pela ordem do
 *  vídeo; se todas já se movem, tira de todas (o mesmo botão desfaz o "de uma vez"). Cada operação confere o id do bloco. */
export const patchMovimentoEmTodas = (doc: DocCenas): {patch: OperacaoPatch[]; n: number; acao: 'por' | 'tirar'} => {
  const imagens: {caminho: string; b: BlocoCenas}[] = [];
  (doc.cenas ?? []).forEach((c, i) => (c.blocos ?? []).forEach((b, j) => {
    if (b?.tipo === 'imagem') imagens.push({caminho: `/cenas/${i}/blocos/${j}`, b});
  }));
  const teste = (caminho: string, b: BlocoCenas): OperacaoPatch[] => (typeof b.id === 'string' ? [{op: 'test', path: `${caminho}/id`, value: b.id}] : []);
  const paradas = imagens.filter((x) => !x.b.movimento);
  if (!imagens.length) return {patch: [], n: 0, acao: 'por'};
  if (!paradas.length) {
    return {patch: imagens.flatMap((x) => [...teste(x.caminho, x.b), {op: 'remove', path: `${x.caminho}/movimento`} as OperacaoPatch]), n: imagens.length, acao: 'tirar'};
  }
  const patch = imagens.flatMap((x, i): OperacaoPatch[] => (x.b.movimento ? []
    : [...teste(x.caminho, x.b), {op: 'add', path: `${x.caminho}/movimento`, value: {tipo: SEQUENCIA_MOVIMENTO[i % SEQUENCIA_MOVIMENTO.length]}}]));
  return {patch, n: paradas.length, acao: 'por'};
};
