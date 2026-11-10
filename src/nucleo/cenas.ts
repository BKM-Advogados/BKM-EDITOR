// "Vídeo de cenas": o tipo de vídeo que se começa do zero. Cada cena tem duração própria em ms e blocos (título, texto,
// lista, número, imagem) que entram e saem em ms contados do começo da cena. Posição e tamanho são frações do quadro
// (0 a 1), e a letra é uma fração do lado menor: trocar 9:16 por 16:9 não desmonta o layout. O som é opcional: `audio`
// traz faixas (narração, música, efeitos) com clipes em ms da linha do tempo (audio.ts); a transcrição da narração fica
// para a Onda B. O carrossel narrado continua no resolvedor de roteiro. `refs` (opcional, no bloco e na cena) cita
// os fatos da pesquisa (`F3`, em pesquisa/pesquisa.json) que sustentam o que está escrito; o resolvedor só repassa.
import {resolverAudio, type AudioCenas, type AudioP, type Envelope} from './audio';
import {efeitosValidos, problemasDosEfeitos, type Efeito} from './efeitos';
import {formatoDoVideo, type Formato} from './formatos';
import type {Teleprompter} from './gravacao';
import {resolverLegendas, type LegendasCenas, type LegendasP} from './legendas'; // frente Fala: legendas (docs/legendas.md)

export type TipoBlocoCenas = 'titulo' | 'texto' | 'lista' | 'numero' | 'imagem';

export type BlocoCenas = {
  id: string;
  tipo: TipoBlocoCenas;
  em?: number; // ms desde o começo da cena (padrão 0)
  sai?: number; // ms desde o começo da cena (padrão: fim da cena)
  x: number; // canto de cima à esquerda, fração da largura
  y: number; // fração da altura
  largura: number; // fração da largura
  altura?: number; // imagem: fração da altura
  texto?: string; // "**trecho**" sai na cor de destaque
  itens?: string[]; // lista
  de?: number; // número que conta de `de` até `ate`
  ate?: number;
  prefixo?: string;
  sufixo?: string;
  rotulo?: string; // linha abaixo do número
  src?: string; // imagem: caminho no projeto
  ajuste?: 'cobrir' | 'conter';
  tam?: number; // altura da letra, fração do lado menor do quadro
  cor?: string;
  peso?: number;
  alinhar?: 'esquerda' | 'centro' | 'direita';
  refs?: string[]; // ids dos fatos da pesquisa (F1, F2…) que este bloco afirma
  movimento?: MovimentoImagem; // imagem: zoom dinâmico (Ken Burns) enquanto o bloco está na tela; sem ele, parada (frente C)
  desde_ms?: number; // lâmina: o bloco já estava na tela há tanto quando esta cena começa (a segunda metade continua a primeira) (frente C)
  segue_ms?: number; // lâmina: o bloco continua na cena seguinte por mais tanto depois do `sai` (não some no corte) (frente C)
  casas?: number; // número: casas decimais (0 a 4); sem ele, as dos valores, e duas em dinheiro (R$) com centavos (frente C)
};

/** Ken Burns do bloco de imagem (composicoes/cenas/movimento.ts): aproximar, afastar ou deslizar para um lado.
 *  `intensidade` é quanto a imagem cresce (0,05 a 0,4; padrão 0,15); `suave` (padrão sim) começa e termina devagar. */
export type MovimentoImagem = {tipo: 'aproximar' | 'afastar' | 'esquerda' | 'direita' | 'cima' | 'baixo'; intensidade?: number; suave?: boolean};

export type CenaCenas = {id: string; nome?: string; duracao_ms: number; fundo?: string; blocos: BlocoCenas[]; refs?: string[]};

export type TemaCenas = {fundo: string; texto: string; destaque: string; suave: string; fonte: string};

export type DocCenas = {tipo: 'cenas'; formato: Formato; tema: TemaCenas; cenas: CenaCenas[]; efeitos?: Efeito[]; audio?: AudioCenas;
  legendas?: LegendasCenas; // frente Fala: segmentos com tempo, palavras e falante, e o estilo (legendas.ts)
  teleprompter?: Teleprompter; // frente Som (rodada 3): o texto que a pessoa lê ao gravar a narração (gravacao.ts)
};

export const TEMA_NEUTRO: TemaCenas = {fundo: '#111418', texto: '#F2F2F2', destaque: '#70B8FF', suave: '#A3ABB5', fonte: 'Inter'};

export const DURACAO_CENA_PADRAO = 4000;
const DURACAO_MIN = 300;
const DURACAO_MAX = 10 * 60 * 1000;

/** Tamanho de letra padrão de cada tipo (fração do lado menor) e os rótulos de quem edita. */
export const TIPOS_BLOCO_CENAS: Record<TipoBlocoCenas, {nome: string; tam: number; peso: number}> = {
  titulo: {nome: 'Título', tam: 0.085, peso: 700},
  texto: {nome: 'Texto', tam: 0.045, peso: 400},
  lista: {nome: 'Lista', tam: 0.045, peso: 600},
  numero: {nome: 'Número', tam: 0.2, peso: 700},
  imagem: {nome: 'Imagem', tam: 0, peso: 400},
};

export const ehDocCenas = (doc: unknown): doc is DocCenas => (doc as {tipo?: unknown} | null)?.tipo === 'cenas';

/** Bloco novo com conteúdo de exemplo, no meio do quadro. */
export const novoBlocoCenas = (tipo: TipoBlocoCenas, id: string): BlocoCenas => {
  const base = {id, tipo, em: 0, x: 0.1, largura: 0.8, alinhar: 'centro' as const};
  switch (tipo) {
    case 'titulo': return {...base, y: 0.4, texto: 'Seu título'};
    case 'texto': return {...base, y: 0.55, texto: 'Escreva o texto aqui'};
    case 'lista': return {...base, y: 0.35, alinhar: 'esquerda', itens: ['Primeiro ponto', 'Segundo ponto', 'Terceiro ponto']};
    case 'numero': return {...base, y: 0.3, de: 0, ate: 100, sufixo: '%', rotulo: 'o que o número mede'};
    case 'imagem': return {...base, x: 0.2, y: 0.2, largura: 0.6, altura: 0.4, ajuste: 'conter'};
  }
};

export const novaCenaCenas = (id: string, idBloco: string, comTitulo = true): CenaCenas => ({
  id,
  duracao_ms: DURACAO_CENA_PADRAO,
  blocos: comTitulo ? [novoBlocoCenas('titulo', idBloco)] : [],
});

export const novoDocCenas = (formato: Formato): DocCenas => ({
  tipo: 'cenas',
  formato,
  tema: {...TEMA_NEUTRO},
  cenas: [novaCenaCenas('cena-1', 'cena-1-titulo')],
  efeitos: [],
});

/** Id livre no documento, a partir de uma base ("cena", "cena-2-texto"). */
export const idLivre = (doc: unknown, base: string): string => {
  const usados = new Set<string>();
  const coletar = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(coletar);
    else if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      if (typeof o.id === 'string') usados.add(o.id);
      Object.values(o).forEach(coletar);
    }
  };
  coletar(doc);
  let n = 1;
  while (usados.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
};

/** Cópia profunda com ids novos (duplicar cena ou bloco). */
export const comIdsNovos = <T>(obj: T, doc: unknown, base: string): T => {
  const copia = structuredClone(obj) as Record<string, unknown>;
  const usados: unknown[] = [doc];
  const trocar = (o: Record<string, unknown>, b: string) => {
    o.id = idLivre(usados, b);
    usados.push({id: o.id});
    for (const filho of (o.blocos ?? []) as Record<string, unknown>[]) trocar(filho, `${String(o.id)}-${String(filho.tipo)}`);
  };
  trocar(copia, base);
  return copia as T;
};

export type BlocoCenasP = BlocoCenas & {origem: string; em: number; sai: number};
export type CenaCenasP = {origem: string; id: string; nome?: string; tipo: 'cena'; n: number; t_in: number; t_out: number; fundo: string; blocos: BlocoCenasP[]; refs?: string[]};
export type PropsCenas = {
  composicao: 'VideoCenas';
  duracao_ms: number;
  largura: number;
  altura: number;
  fps: number;
  tema: TemaCenas;
  cenas: CenaCenasP[];
  efeitos: Efeito[];
  audio?: AudioP;
  base_midia?: string;
  legendas_cenas?: LegendasP; // frente Fala (o nome não é "legendas" porque a linha do tempo lê esse do carrossel narrado)
};

/** O que o resolvedor recebe de fora do documento: os envelopes já medidos, por arquivo (midia/x.wav). */
export type OpcoesResolver = {envelopes?: Record<string, Envelope | undefined>};

const numero = (v: unknown, padrao: number) => (typeof v === 'number' && Number.isFinite(v) ? v : padrao);

/** Props da composição VideoCenas, em ms de saída. Valores fora do lugar viram aviso, não erro: o vídeo sempre toca. */
export const resolverCenas = (doc: DocCenas, opcoes: OpcoesResolver = {}): {props: PropsCenas; avisos: string[]} => {
  const avisos: string[] = [];
  const formato = formatoDoVideo(doc);
  const tema = {...TEMA_NEUTRO, ...(doc.tema ?? {})};
  let t = 0;
  const cenas: CenaCenasP[] = (Array.isArray(doc.cenas) ? doc.cenas : []).map((c, i) => {
    let dur = numero(c.duracao_ms, DURACAO_CENA_PADRAO);
    if (dur < DURACAO_MIN || dur > DURACAO_MAX) {
      avisos.push(`a cena ${i + 1} tem duração ${dur} ms; vai com ${Math.min(DURACAO_MAX, Math.max(DURACAO_MIN, dur))} ms`);
      dur = Math.min(DURACAO_MAX, Math.max(DURACAO_MIN, dur));
    }
    const t_in = t;
    const t_out = t + dur;
    t = t_out;
    const blocos = (Array.isArray(c.blocos) ? c.blocos : []).map((b, j): BlocoCenasP => {
      const em = Math.max(0, Math.min(dur, numero(b.em, 0)));
      const sai = Math.max(em + 100, Math.min(dur, numero(b.sai, dur)));
      if (numero(b.em, 0) > dur) avisos.push(`o bloco ${j + 1} da cena ${i + 1} entra depois do fim da cena`);
      return {...b, x: numero(b.x, 0.1), y: numero(b.y, 0.4), largura: numero(b.largura, 0.8), origem: `/cenas/${i}/blocos/${j}`, em: t_in + em, sai: t_in + sai};
    });
    return {origem: `/cenas/${i}`, id: c.id, nome: c.nome, tipo: 'cena', n: i + 1, t_in, t_out, fundo: c.fundo ?? tema.fundo, blocos,
      ...(Array.isArray(c.refs) ? {refs: c.refs} : {})};
  });
  const duracao_ms = Math.max(1000, t);
  const som = resolverAudio(doc.audio, duracao_ms, opcoes.envelopes);
  avisos.push(...som.avisos);
  avisos.push(...problemasDosEfeitos(doc.efeitos).map((p) => `Efeitos: ${p}`)); // frente C (tres-efeitos-D1, D2)
  const legendas = resolverLegendas(doc.legendas, {audio: som.audio, largura: formato.largura, altura: formato.altura, tema, duracao_ms, fala: doc.audio}, avisos); // frente Fala
  return {
    props: {composicao: 'VideoCenas', duracao_ms, largura: formato.largura, altura: formato.altura, fps: formato.fps, tema, cenas,
      efeitos: efeitosValidos(doc.efeitos), ...(som.audio ? {audio: som.audio} : {}), ...(legendas ? {legendas_cenas: legendas} : {})},
    avisos,
  };
};
