// Legendas do vídeo de cenas (docs/legendas.md). O campo `legendas` do documento é opcional: sem ele, nada muda. Cada
// segmento tem começo e fim em ms da linha do tempo do vídeo, o texto, as palavras com o tempo de cada uma (para a
// palavra falada ficar em destaque), o falante e o clipe de voz de onde veio. As legendas nascem do palavras.json que a
// transcrição local grava ao lado do áudio (src/main/transcricao.ts), quebradas por pausa, pontuação e largura, ou de
// um SRT/VTT importado. Os estilos são predefinições (posição, tamanho, caixa, destaque) com as cores e a fonte do
// `tema`, que o kit de marca preenche. Puro: sem disco, para a interface, o processo principal e o MCP usarem igual.
import {papelDe, type AudioCenas, type AudioP, type ClipeAudio, type FaixaAudio} from './audio';
import type {TemaCenas} from './cenas';
import {conjuntoDe, zonaSugerida} from './zonas-seguras';

// ---------- formato no documento ----------

export type PalavraLegenda = {w: string; s: number; e: number}; // ms na linha do tempo do vídeo
export type SegmentoLegenda = {
  id: string;
  em: number; // ms na linha do tempo do vídeo
  sai: number;
  texto: string; // "\n" quebra a linha à mão
  palavras?: PalavraLegenda[]; // sem elas (SRT importado), o tempo de cada palavra é estimado pelo tamanho
  falante?: string;
  clipe?: string; // id do clipe de voz de onde a fala veio
};
export type IdEstiloLegenda = 'classica' | 'caixa' | 'karaoke' | 'faixa' | 'discreta';
export type PosicaoLegenda = 'baixo' | 'meio' | 'cima';
export type EstiloLegenda = {
  predefinicao: IdEstiloLegenda;
  posicao?: PosicaoLegenda;
  tam?: number; // altura da letra, fração do lado menor do quadro
  maiusculas?: boolean;
  falante?: boolean; // "Nome:" antes do texto
  cor?: string; // texto (padrão: tema.texto)
  cor_destaque?: string; // palavra falada (padrão: tema.destaque)
  fundo?: string; // caixa e faixa (padrão: tema.fundo)
  fonte?: string; // padrão: tema.fonte
};
/** De onde as legendas vieram: o clipe, o arquivo de áudio, a transcrição e onde o clipe estava naquela hora. Se o
 *  clipe muda de lugar ou é aparado depois, o resolvedor desloca as legendas dele junto. */
export type OrigemLegendas = {clipe: string; arquivo: string; palavras: string; em: number; corte_ms: number;
  sha256?: string}; // do áudio transcrito (o carimbo do palavras.json): a correção à mão só passa para a mesma tomada
export type LegendasCenas = {segmentos: SegmentoLegenda[]; estilo?: EstiloLegenda; oculto?: boolean; origens?: OrigemLegendas[]};

// ---------- predefinições ----------

export type Predefinicao = {
  id: IdEstiloLegenda;
  nome: string;
  descricao: string;
  posicao: PosicaoLegenda;
  tam: number;
  peso: number;
  maiusculas: boolean;
  caixa: 'nenhuma' | 'linha' | 'faixa'; // fundo atrás do texto: nenhum, uma caixa por linha ou uma faixa de lado a lado
  destaque: 'cor' | 'caixa' | 'sublinhado' | 'nenhum'; // como a palavra falada aparece
  apagadas: boolean; // palavras que ainda vão ser ditas em cor suave (karaokê)
  sombra: boolean;
  linhas: 1 | 2;
  max_palavras?: number;
};

export const PREDEFINICOES_LEGENDA: Record<IdEstiloLegenda, Predefinicao> = {
  classica: {id: 'classica', nome: 'Clássica', descricao: 'Embaixo, caixa escura atrás da linha, palavra falada na cor de destaque', posicao: 'baixo', tam: 0.042,
    peso: 600, maiusculas: false, caixa: 'linha', destaque: 'cor', apagadas: false, sombra: false, linhas: 2},
  caixa: {id: 'caixa', nome: 'Palavra em caixa', descricao: 'Grande, em maiúsculas, poucas palavras por vez e a palavra falada dentro de uma caixa', posicao: 'meio',
    tam: 0.068, peso: 800, maiusculas: true, caixa: 'nenhuma', destaque: 'caixa', apagadas: false, sombra: true, linhas: 2, max_palavras: 3},
  karaoke: {id: 'karaoke', nome: 'Karaokê', descricao: 'As palavras acendem conforme são ditas, como no carrossel da Cliente', posicao: 'baixo', tam: 0.056, peso: 700,
    maiusculas: false, caixa: 'nenhuma', destaque: 'cor', apagadas: true, sombra: true, linhas: 2, max_palavras: 4},
  faixa: {id: 'faixa', nome: 'Faixa da marca', descricao: 'Faixa na cor de destaque da marca, de lado a lado, com a palavra falada sublinhada', posicao: 'baixo', tam: 0.04,
    peso: 600, maiusculas: false, caixa: 'faixa', destaque: 'sublinhado', apagadas: false, sombra: false, linhas: 2},
  discreta: {id: 'discreta', nome: 'Discreta', descricao: 'Pequena, sem caixa nem destaque, com sombra para ler em qualquer fundo', posicao: 'baixo', tam: 0.034,
    peso: 500, maiusculas: false, caixa: 'nenhuma', destaque: 'nenhum', apagadas: false, sombra: true, linhas: 2},
};
export const ESTILO_PADRAO: EstiloLegenda = {predefinicao: 'classica'};
export const POSICOES_LEGENDA: [PosicaoLegenda, string][] = [['baixo', 'Embaixo'], ['meio', 'No meio'], ['cima', 'Em cima']];

// ---------- onde a legenda cabe: a zona segura do destino ----------

export type AreaLegenda = {topo: number; base: number; esq: number; dir: number}; // frações do quadro; esq e dir são margens
const MARGEM = 0.05; // área segura de título (SMPTE RP 218), a mesma da sobreposição do monitor

/** A área livre da interface das redes no formato (zonas-seguras.ts): abaixo do que cobre o topo, acima do que cobre a
 *  base e, de cada lado, longe da coluna de botões. As margens dos lados são iguais, para o texto centrado ficar no
 *  centro do quadro. */
export const areaDaLegenda = (largura: number, altura: number): AreaLegenda => {
  let topo = MARGEM;
  let base = 1 - MARGEM;
  let lado = MARGEM;
  for (const z of conjuntoDe(zonaSugerida(largura, altura))?.zonas ?? []) {
    if (z.tipo !== 'coberta') continue;
    const inteira = z.largura >= 0.99;
    if (inteira && z.y <= 0.01) topo = Math.max(topo, z.altura);
    else if (inteira && z.y + z.altura >= 0.99) base = Math.min(base, z.y);
    else if (z.x >= 0.5) lado = Math.max(lado, 1 - z.x);
    else if (z.x + z.largura <= 0.5) lado = Math.max(lado, z.x + z.largura);
  }
  return {topo: topo + 0.01, base: base - 0.01, esq: lado, dir: lado};
};

/** Quantos caracteres cabem numa linha da legenda nesse formato (letra média de 0,55 em). */
export const caracteresPorLinha = (estilo: EstiloLegenda | undefined, largura: number, altura: number) => {
  const p = PREDEFINICOES_LEGENDA[estilo?.predefinicao ?? 'classica'] ?? PREDEFINICOES_LEGENDA.classica;
  const area = areaDaLegenda(largura, altura);
  const tam = (estilo?.tam ?? p.tam) * Math.min(largura, altura);
  const util = (1 - area.esq - area.dir) * largura * (p.caixa === 'nenhuma' ? 1 : 0.92);
  const largLetra = tam * ((estilo?.maiusculas ?? p.maiusculas) ? 0.68 : 0.55);
  return Math.max(8, Math.floor(util / largLetra));
};

// ---------- gerar a partir das palavras ----------

export type OpcoesQuebra = {max_caracteres: number; max_palavras?: number; pausa_ms?: number; max_ms?: number; min_ms?: number; segura_ms?: number};
export const PAUSA_QUEBRA_MS = 600; // silêncio que fecha a legenda
export const MAX_SEGMENTO_MS = 6000;
export const MIN_SEGMENTO_MS = 700;
const SEGURA_MS = 250; // a legenda fica um pouco depois da última palavra
const FIM_DE_FRASE = /[.?!…]["'”»)]*$/;
// artigo, preposição e conjunção não terminam legenda quando dá para evitar ("a mudança de | casa")
const PALAVRA_FRACA = /^(a|o|as|os|um|uma|uns|umas|de|da|do|das|dos|em|na|no|nas|nos|e|ou|que|para|pra|por|pela|pelo|com|se|ao|à|aos|às|sem|sua|seu)$/i;
const PAUSA_DE_FRASE = /[,;:]["'”»)]*$/;

/** Junta o que o Whisper às vezes separa ("25 %", "seguro -desemprego") e tira palavras vazias. */
export const juntarPedacos = (palavras: PalavraLegenda[]): PalavraLegenda[] => {
  const out: PalavraLegenda[] = [];
  for (const p of palavras) {
    const w = String(p.w ?? '').trim();
    if (!w || !Number.isFinite(p.s) || !Number.isFinite(p.e)) continue;
    const u = out[out.length - 1];
    if (u && (w === '%' || /^[.,;:!?…]+$/.test(w) || (w.startsWith('-') && w.length > 1))) {
      u.w += w;
      u.e = Math.max(u.e, p.e);
      continue;
    }
    out.push({w, s: p.s, e: Math.max(p.s, p.e)});
  }
  return out;
};

/** Quebra as palavras em legendas: fecha na pausa longa, no fim de frase, na vírgula quando já há meia legenda, quando
 *  passaria da largura (em caracteres) ou do número de palavras, e aos 6 s. O fim fica 250 ms depois da última palavra,
 *  sem invadir a próxima, e nenhuma dura menos de 0,7 s se houver espaço. */
export const quebrarEmSegmentos = (palavras: PalavraLegenda[], o: OpcoesQuebra): Omit<SegmentoLegenda, 'id'>[] => {
  const pausa = o.pausa_ms ?? PAUSA_QUEBRA_MS;
  const maxMs = o.max_ms ?? MAX_SEGMENTO_MS;
  const grupos: PalavraLegenda[][] = [];
  let atual: PalavraLegenda[] = [];
  const tamanho = (ws: PalavraLegenda[]) => ws.reduce((n, p, i) => n + p.w.length + (i ? 1 : 0), 0);
  const fechar = () => {
    if (atual.length) grupos.push(atual);
    atual = [];
  };
  // corte por largura, por número de palavras ou por tempo: a legenda não termina em artigo ou preposição, que passa
  // para a próxima ("Com o fim | da produção")
  const fecharSemFraca = () => {
    const ultima = atual[atual.length - 1];
    if (atual.length > 1 && PALAVRA_FRACA.test(ultima.w)) {
      atual.pop();
      fechar();
      atual = [ultima];
    } else fechar();
  };
  for (const p of juntarPedacos(palavras)) {
    if (atual.length) {
      const ultima = atual[atual.length - 1];
      if (p.s - ultima.e >= pausa) fechar();
      else if (tamanho([...atual, p]) > o.max_caracteres || (o.max_palavras && atual.length >= o.max_palavras) || p.e - atual[0].s > maxMs) fecharSemFraca();
    }
    atual.push(p);
    if (FIM_DE_FRASE.test(p.w)) fechar();
    else if (PAUSA_DE_FRASE.test(p.w) && tamanho(atual) >= o.max_caracteres * 0.5) fechar();
  }
  fechar();
  equilibrar(grupos, o, tamanho, pausa);
  const min = o.min_ms ?? MIN_SEGMENTO_MS;
  const segura = o.segura_ms ?? SEGURA_MS;
  return grupos.map((g, i) => {
    const prox = grupos[i + 1]?.[0].s ?? Infinity;
    const em = g[0].s;
    let sai = Math.min(g[g.length - 1].e + segura, prox);
    if (sai - em < min) sai = Math.min(em + min, prox);
    sai = Math.max(sai, g[g.length - 1].e);
    return {em, sai, texto: g.map((p) => p.w).join(' '), palavras: g.map((p) => ({...p}))};
  });
};

/** A legenda curta que sobrou da largura no meio de uma frase ("concordância." sozinha) divide o texto com a anterior:
 *  o corte mais equilibrado que caiba nas duas, de preferência depois de vírgula. */
const equilibrar = (grupos: PalavraLegenda[][], o: OpcoesQuebra, tamanho: (ws: PalavraLegenda[]) => number, pausa: number) => {
  for (let i = 1; i < grupos.length; i++) {
    const a = grupos[i - 1];
    const b = grupos[i];
    if (tamanho(b) >= o.max_caracteres * 0.35 || FIM_DE_FRASE.test(a[a.length - 1].w) || b[0].s - a[a.length - 1].e >= pausa) continue;
    const todas = [...a, ...b];
    let melhor = a.length;
    let nota = Math.max(tamanho(a), tamanho(b));
    for (let k = 1; k < todas.length; k++) {
      const x = todas.slice(0, k);
      const y = todas.slice(k);
      if (tamanho(x) > o.max_caracteres || tamanho(y) > o.max_caracteres) continue;
      if (o.max_palavras && (x.length > o.max_palavras || y.length > o.max_palavras)) continue;
      const ultima = x[x.length - 1].w;
      const n = Math.max(tamanho(x), tamanho(y)) - (PAUSA_DE_FRASE.test(ultima) ? o.max_caracteres * 0.15 : 0) + (PALAVRA_FRACA.test(ultima) ? o.max_caracteres * 0.1 : 0);
      if (n < nota) {
        nota = n;
        melhor = k;
      }
    }
    grupos[i - 1] = todas.slice(0, melhor);
    grupos[i] = todas.slice(melhor);
  }
};

type ClipeFala = {id: string; arquivo: string; nome?: string; em: number; duracao_ms: number; corte_ms?: number};

/** A palavra está no trecho [de, ate) quando o meio dela está: a que o corte pega pela metade fica com o lado maior. */
export const palavraNoTrecho = (p: {s: number; e: number}, de: number, ate: number) => {
  const meio = (p.s + Math.max(p.s, p.e)) / 2;
  return meio >= de && meio < ate;
};

/** As palavras do arquivo (ms no arquivo) no tempo do vídeo, só as que caem no trecho que o clipe toca. */
export const palavrasDoClipe = (palavras: PalavraLegenda[], clipe: ClipeFala): PalavraLegenda[] => {
  const corte = clipe.corte_ms ?? 0;
  const fim = corte + clipe.duracao_ms;
  return palavras.filter((p) => palavraNoTrecho(p, corte, fim))
    .map((p) => ({w: p.w, s: Math.round(clipe.em + Math.max(p.s, corte) - corte), e: Math.round(clipe.em + Math.min(p.e, fim) - corte)}));
};

/** O nome que a pessoa deu ao clipe, se deu: nome de arquivo ("narracao.wav", ou o do próprio clipe sem a extensão) não
 *  é falante. */
export const nomeDoFalante = (c: {nome?: string; arquivo: string}) => {
  const n = c.nome?.trim();
  if (!n) return undefined;
  const arq = c.arquivo.split('/').pop() ?? '';
  if (n === arq || n === arq.replace(/\.[^.]+$/, '') || /\.(wav|mp3|m4a|ogg|aac|flac|mp4|mov|webm|mkv)$/i.test(n)) return undefined;
  return n;
};

/** Legendas de um ou mais clipes de voz, cada um com as palavras transcritas dele (ms do arquivo). O falante é o nome do
 *  clipe, se a pessoa deu um, ou o da faixa. Os ids saem `leg-1`, `leg-2`… na ordem do tempo. */
export const legendasDaFala = (fontes: {clipe: ClipeFala; faixa: {nome?: string}; palavras: PalavraLegenda[]; caminhoPalavras: string; sha256?: string}[], o: {
  estilo?: EstiloLegenda; largura: number; altura: number; quebra?: Partial<OpcoesQuebra>;
}): LegendasCenas => {
  const estilo = o.estilo ?? ESTILO_PADRAO;
  const p = PREDEFINICOES_LEGENDA[estilo.predefinicao] ?? PREDEFINICOES_LEGENDA.classica;
  const quebra: OpcoesQuebra = {max_caracteres: caracteresPorLinha(estilo, o.largura, o.altura) * p.linhas, max_palavras: p.max_palavras, ...o.quebra};
  const segs = fontes.flatMap((f) => {
    const falante = nomeDoFalante(f.clipe) || f.faixa.nome?.trim() || undefined;
    return quebrarEmSegmentos(palavrasDoClipe(f.palavras, f.clipe), quebra).map((s) => ({...s, ...(falante ? {falante} : {}), clipe: f.clipe.id}));
  }).sort((a, b) => a.em - b.em);
  return {
    segmentos: segs.map((s, i) => ({id: `leg-${i + 1}`, ...s})),
    estilo,
    origens: fontes.map((f) => ({clipe: f.clipe.id, arquivo: f.clipe.arquivo, palavras: f.caminhoPalavras, em: f.clipe.em, corte_ms: f.clipe.corte_ms ?? 0,
      ...(f.sha256 ? {sha256: f.sha256} : {})})),
  };
};

/** O palavras.json que a transcrição grava ao lado do arquivo de áudio (midia/narracao.wav → midia/narracao.wav.palavras.json). */
export const arquivoDasPalavras = (arquivo: string) => `${arquivo}.palavras.json`;

/** O arquivo de onde sai a fala do clipe: o da pessoa (`original`) quando o clipe toca a versão de voz limpa, que tem os
 *  mesmos tempos; senão o próprio `arquivo`. Limpar a voz, ou voltar ao original, não pede outra transcrição. */
export const arquivoDaFala = (c: {arquivo: string; original?: string}) => (typeof c.original === 'string' && c.original ? c.original : c.arquivo);

/** O palavras.json ao lado do áudio, na versão 2: as palavras com o carimbo do áudio transcrito (tamanho, data e sha256,
 *  como o envelope do som), para transcrever de novo quando a tomada é regravada com o mesmo nome. A versão 1 era só a
 *  lista de palavras (é o que o `destino` do roteiro da Cliente continua recebendo) e conta como sem carimbo. */
export const VERSAO_PALAVRAS = 2;
export type FonteDaFala = {tamanho: number; modificado_ms?: number; sha256?: string};
export type PalavrasGravadas = {versao: typeof VERSAO_PALAVRAS; fonte: FonteDaFala; modelo?: string; trecho?: {de_ms?: number; dur_ms?: number};
  palavras: (PalavraLegenda & {p?: number})[]};
/** 'em_dia': a transcrição é do áudio como ele está; 'velha': o áudio mudou (ou o arquivo não tem carimbo); 'falta': não
 *  há transcrição. */
export type EstadoDaFala = 'em_dia' | 'velha' | 'falta';

/** Caminho no projeto comparável: barras para a frente, sem "." e "..", sem diferença de caixa (o Windows não tem). */
const chaveDoCaminho = (c: string) => {
  const out: string[] = [];
  for (const p of c.replace(/\\/g, '/').split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/').toLowerCase();
};

/** Por que o `destino` das palavras (o transcrever de um arquivo, para o roteiro da Cliente) não serve, ou null se serve. A
 *  transcrição grava por cima, fora do diário: o destino é um .json que não é do app (manifesto, documento, comentários,
 *  pesquisa, .estudio/) e, se já existe, uma lista de palavras. `atual`: o que está no destino, se ele existe (doc
 *  undefined quando não deu para ler). */
export const recusaDoDestino = (destino: string, documentos: string[], atual?: {doc: unknown}): string | null => {
  const outro = ': escolha outro caminho, como video/palavras.json';
  const k = chaveDoCaminho(destino);
  if (!k.endsWith('.json')) return 'o destino das palavras termina em .json';
  if (k === 'estudio.json') return `${destino} é o manifesto do projeto${outro}`;
  if (documentos.some((d) => chaveDoCaminho(d) === k)) return `${destino} é um documento do projeto${outro}`;
  if (k === 'comentarios.json') return `${destino} guarda os comentários da pessoa${outro}`;
  if (k === 'pesquisa/pesquisa.json') return `${destino} é a pesquisa do projeto${outro}`;
  if (k.startsWith('.estudio/')) return `${destino} é do app${outro}`;
  if (atual && !palavrasValidas(atual.doc).length && !(Array.isArray(atual.doc) && !atual.doc.length)) {
    return `${destino} já existe e não é uma lista de palavras${outro}`;
  }
  return null;
};

/** recusaDoDestino com o que o projeto tem: os documentos do manifesto e o que já está no destino. */
export const recusaDoDestinoNoProjeto = (projeto: {manifesto(): {documentos: {caminho: string}[]}; existe(c: string): boolean; lerJson<T>(c: string): {doc: T}},
  destino: string): string | null => {
  let documentos: string[] = [];
  try {
    documentos = projeto.manifesto().documentos.map((d) => d.caminho);
  } catch {
    /* manifesto ilegível: o resto da regra vale */
  }
  let atual: {doc: unknown} | undefined;
  try {
    if (projeto.existe(destino)) {
      try {
        atual = {doc: projeto.lerJson<unknown>(destino).doc};
      } catch {
        atual = {doc: undefined};
      }
    }
  } catch {
    /* fora do projeto: quem grava recusa */
  }
  return recusaDoDestino(destino, documentos, atual);
};

/** O carimbo do palavras.json lido, se for da versão 2. */
export const fonteDaFala = (x: unknown): FonteDaFala | undefined => {
  const o = x as Partial<PalavrasGravadas> | null;
  const f = o && !Array.isArray(o) && o.versao === VERSAO_PALAVRAS ? o.fonte : undefined;
  return f && typeof f === 'object' && typeof f.tamanho === 'number' ? f : undefined;
};

/** A transcrição lida ainda é do áudio como ele está? Mesmo tamanho e mesma data: 'em_dia'. Mesmo tamanho e outra data
 *  (cópia, git clone): 'conferir', e só o sha256 decide (quem chama lê o arquivo). Outro tamanho ou sem carimbo: 'velha'. */
export const conferirFala = (lido: unknown, atual: {tamanho: number; modificado_ms: number}): EstadoDaFala | 'conferir' => {
  if (!palavrasValidas(lido).length) return 'falta';
  const f = fonteDaFala(lido);
  if (!f || f.tamanho !== atual.tamanho) return 'velha';
  if (typeof f.modificado_ms === 'number' && Math.floor(f.modificado_ms) === Math.floor(atual.modificado_ms)) return 'em_dia';
  return f.sha256 ? 'conferir' : 'velha';
};

/** Os clipes das faixas de voz do documento (não mudos), com a faixa de cada um. `clipe` ou `faixa` (ids) escolhem um
 *  só; o clipe pedido entra mesmo que esteja numa faixa de música ou de efeitos. */
export const clipesDeVoz = (doc: {audio?: AudioCenas}, filtro: {clipe?: string; faixa?: string} = {}): {clipe: ClipeAudio; faixa: FaixaAudio}[] => {
  const out: {clipe: ClipeAudio; faixa: FaixaAudio}[] = [];
  for (const faixa of Array.isArray(doc.audio?.faixas) ? doc.audio.faixas : []) {
    if (filtro.faixa && faixa.id !== filtro.faixa) continue;
    for (const clipe of Array.isArray(faixa.clipes) ? faixa.clipes : []) {
      if (typeof clipe?.arquivo !== 'string') continue;
      if (filtro.clipe ? clipe.id === filtro.clipe : !faixa.mudo && !clipe.mudo && (filtro.faixa || papelDe(faixa) === 'voz')) out.push({clipe, faixa});
    }
  }
  return out;
};

/** Palavras de um palavras.json qualquer (a lista da versão 1 ou o `palavras` da versão 2, com {w, s, e, p}); o que não
 *  for palavra fica de fora. */
export const palavrasValidas = (x: unknown): PalavraLegenda[] =>
  (Array.isArray(x) ? x : Array.isArray((x as {palavras?: unknown} | null)?.palavras) ? (x as {palavras: unknown[]}).palavras : []).filter((p): p is PalavraLegenda => Boolean(p) && typeof p.w === 'string' && Number.isFinite(p.s) && Number.isFinite(p.e))
    .map((p) => ({w: p.w, s: p.s, e: p.e}));

/** As palavras que a pessoa corrigiu nas legendas de um clipe, passadas para a transcrição (ms do arquivo): a palavra da
 *  legenda que está no tempo de uma palavra transcrita (até 40 ms no começo e no fim) e tem outro texto. Só entre legendas
 *  e transcrição da mesma tomada: com o sha256 da origem diferente do da transcrição, nada passa. O que perdeu o tempo
 *  (outro número de palavras, legenda arrastada) não passa. */
export const levarCorrecoes = (leg: LegendasCenas, clipe: string, palavras: PalavraLegenda[], sha256?: string): {palavras: PalavraLegenda[]; n: number} => {
  const o = (Array.isArray(leg.origens) ? leg.origens : []).find((x) => x.clipe === clipe);
  if (!o || (o.sha256 && sha256 && o.sha256 !== sha256)) return {palavras, n: 0};
  const desloc = (o.corte_ms ?? 0) - o.em; // ms do vídeo de quando a legenda nasceu → ms do arquivo
  const novas = palavras.map((p) => ({...p}));
  let n = 0;
  for (const s of Array.isArray(leg.segmentos) ? leg.segmentos : []) {
    if (s?.clipe !== clipe || !Array.isArray(s.palavras) || typeof s.texto !== 'string') continue;
    for (const p of palavrasDe(s)) {
      const alvo = novas.find((q) => Math.abs(q.s - (p.s + desloc)) <= 40 && Math.abs(q.e - (p.e + desloc)) <= 40);
      if (alvo && alvo.w !== p.w) {
        alvo.w = p.w;
        n++;
      }
    }
  }
  return {palavras: novas, n};
};

/** As legendas do documento a partir das transcrições já gravadas. Gera só o que falta: o clipe que já tem legendas fica
 *  como está (vai em `mantidos`), a não ser que esteja em `refazer` (true: todos os pedidos); aí as palavras corrigidas à
 *  mão que ainda caem no tempo da transcrição passam para as novas (`corrigidas`). Clipe sem transcrição vai em `faltam`.
 *  As legendas de outros clipes e as que não vêm de clipe (importadas, criadas à mão) ficam. */
export const legendasDoDocumento = (doc: {audio?: AudioCenas; legendas?: LegendasCenas}, lerPalavras: (caminho: string) => unknown, o: {
  largura: number; altura: number; estilo?: EstiloLegenda; clipe?: string; faixa?: string; refazer?: boolean | string[];
}): {legendas: LegendasCenas; faltam: string[]; clipes: number; mantidos: string[]; corrigidas: number; geradas: number} => {
  const antes = doc.legendas && Array.isArray(doc.legendas.segmentos) ? doc.legendas : undefined;
  const comLegenda = new Set((antes?.segmentos ?? []).map((s) => s?.clipe).filter(Boolean));
  const refazer = (id: string) => o.refazer === true || (Array.isArray(o.refazer) && o.refazer.includes(id));
  const fontes: Parameters<typeof legendasDaFala>[0] = [];
  const faltam: string[] = [];
  const mantidos: string[] = [];
  let corrigidas = 0;
  for (const {clipe, faixa} of clipesDeVoz(doc, o)) {
    if (comLegenda.has(clipe.id) && !refazer(clipe.id)) {
      mantidos.push(clipe.id);
      continue;
    }
    const arquivo = arquivoDaFala(clipe);
    const caminho = arquivoDasPalavras(arquivo);
    let lido: unknown;
    try {
      lido = lerPalavras(caminho);
    } catch {
      lido = undefined;
    }
    let palavras = palavrasValidas(lido);
    if (!palavras.length) {
      faltam.push(arquivo);
      continue;
    }
    const sha256 = fonteDaFala(lido)?.sha256;
    if (antes && comLegenda.has(clipe.id)) {
      const c = levarCorrecoes(antes, clipe.id, palavras, sha256);
      palavras = c.palavras;
      corrigidas += c.n;
    }
    fontes.push({clipe: {...clipe, arquivo, em: Number(clipe.em) || 0, duracao_ms: Number(clipe.duracao_ms) || 0}, faixa, palavras, caminhoPalavras: caminho, sha256});
  }
  const nova = legendasDaFala(fontes, {estilo: o.estilo ?? antes?.estilo, largura: o.largura, altura: o.altura});
  const resto = {faltam, clipes: fontes.length, mantidos, corrigidas, geradas: nova.segmentos.length};
  if (!antes) return {legendas: {...doc.legendas, ...nova}, ...resto};
  const trocados = new Set(fontes.map((f) => f.clipe.id));
  const ficam = antes.segmentos.filter((s) => !s?.clipe || !trocados.has(s.clipe));
  const segmentos = [...ficam, ...nova.segmentos].sort((a, b) => a.em - b.em).map((s, i) => ({...s, id: `leg-${i + 1}`}));
  const origens = [...(antes.origens ?? []).filter((x) => !trocados.has(x.clipe)), ...(nova.origens ?? [])];
  return {legendas: {...antes, estilo: nova.estilo, segmentos, origens}, ...resto};
};

/** Quebra de novo as legendas de um estilo para outro (largura e palavras por vez mudam), mantendo falante e clipe. */
export const requebrar = (leg: LegendasCenas, estilo: EstiloLegenda, largura: number, altura: number): LegendasCenas => {
  const p = PREDEFINICOES_LEGENDA[estilo.predefinicao] ?? PREDEFINICOES_LEGENDA.classica;
  const quebra: OpcoesQuebra = {max_caracteres: caracteresPorLinha(estilo, largura, altura) * p.linhas, max_palavras: p.max_palavras};
  // os segmentos seguidos do mesmo falante e clipe voltam a ser uma fala só e são quebrados de novo
  const blocos: SegmentoLegenda[][] = [];
  for (const s of [...leg.segmentos].sort((a, b) => a.em - b.em)) {
    const u = blocos[blocos.length - 1];
    if (u && u[0].falante === s.falante && u[0].clipe === s.clipe) u.push(s);
    else blocos.push([s]);
  }
  const segs = blocos.flatMap((b) => quebrarEmSegmentos(b.flatMap(palavrasDe), quebra)
    .map((s) => ({...s, ...(b[0].falante ? {falante: b[0].falante} : {}), ...(b[0].clipe ? {clipe: b[0].clipe} : {})})));
  return {...leg, estilo, segmentos: segs.map((s, i) => ({id: `leg-${i + 1}`, ...s}))};
};

// ---------- palavras e texto andando juntos ----------

const tokensDe = (texto: string) => texto.split(/\s+/).filter(Boolean);

/** Tempo de cada palavra estimado pelo tamanho dela (com um respiro por palavra), dentro de [em, sai]. */
export const estimarPalavras = (texto: string, em: number, sai: number): PalavraLegenda[] => {
  const ws = tokensDe(texto);
  if (!ws.length) return [];
  const pesos = ws.map((w) => w.length + 2);
  const total = pesos.reduce((s, x) => s + x, 0);
  const dur = Math.max(1, sai - em);
  let t = em;
  return ws.map((w, i) => {
    const s = t;
    t += (pesos[i] / total) * dur;
    return {w, s: Math.round(s), e: Math.round(i === ws.length - 1 ? sai : t)};
  });
};

/** As palavras do segmento, sempre com o texto dele. Com as palavras gravadas e o mesmo número de palavras no texto,
 *  cada uma fica com o tempo da que estava no lugar (o texto corrigido por patch, sem mexer em `palavras`, não perde o
 *  compasso da fala); com outro número, espalham no tempo que as gravadas ocupavam. Sem palavras gravadas (SRT
 *  importado), o tempo é estimado pelo tamanho dentro do segmento. É a regra do comTexto, que a lista do app usa. */
export const palavrasDe = (s: SegmentoLegenda): PalavraLegenda[] => {
  const ws = tokensDe(s.texto);
  const gravadas = Array.isArray(s.palavras) && s.palavras.length && s.palavras.every((p) => p && Number.isFinite(p.s) && Number.isFinite(p.e)) ? s.palavras : undefined;
  if (!gravadas || !ws.length) return estimarPalavras(s.texto, s.em, s.sai);
  if (gravadas.length === ws.length) return gravadas.map((p, i) => ({w: ws[i], s: p.s, e: p.e}));
  return estimarPalavras(s.texto, gravadas[0].s, gravadas[gravadas.length - 1].e);
};

/** Quanto a legenda anda na tela desde que nasceu: o "zero do arquivo" do clipe de voz agora (`em − corte_ms`) menos o
 *  de quando ela foi gerada (`origens`). Tempo na tela = tempo guardado + deslocamento; 0 sem clipe ou sem origem. */
export const deslocamentoDaLegenda = (s: {clipe?: string}, origens: OrigemLegendas[] | undefined, clipes: {id: string; em: number; corte_ms?: number}[]): number => {
  if (!s.clipe) return 0;
  const c = clipes.find((x) => x.id === s.clipe);
  const o = (Array.isArray(origens) ? origens : []).find((x) => x.clipe === s.clipe);
  if (!c || !o) return 0;
  return ((Number(c.em) || 0) - (Number(c.corte_ms) || 0)) - ((Number(o.em) || 0) - (Number(o.corte_ms) || 0));
};

/** Troca o texto do segmento sem perder o tempo das palavras: com o mesmo número de palavras, cada uma fica com o tempo
 *  da que estava no lugar; com outro número, as palavras se espalham no tempo que as antigas ocupavam. */
export const comTexto = (s: SegmentoLegenda, texto: string): SegmentoLegenda => {
  const novas = tokensDe(texto);
  const antigas = Array.isArray(s.palavras) && s.palavras.length ? s.palavras : undefined;
  if (!antigas || !novas.length) {
    const {palavras: _p, ...resto} = s;
    return {...resto, texto};
  }
  if (antigas.length === novas.length) return {...s, texto, palavras: antigas.map((p, i) => ({...p, w: novas[i]}))};
  return {...s, texto, palavras: estimarPalavras(texto, antigas[0].s, antigas[antigas.length - 1].e)};
};

/** Junta o segmento com o seguinte (texto, palavras e tempo). */
export const juntarSegmentos = (a: SegmentoLegenda, b: SegmentoLegenda): SegmentoLegenda => ({
  ...a,
  em: Math.min(a.em, b.em),
  sai: Math.max(a.sai, b.sai),
  texto: `${a.texto.trim()} ${b.texto.trim()}`.trim(),
  palavras: [...palavrasDe(a), ...palavrasDe(b)],
  ...(a.falante ?? b.falante ? {falante: a.falante ?? b.falante} : {}),
});

/** Divide o segmento antes da palavra `indice` (1 até o número de palavras − 1); sem índice, no meio do texto. O
 *  segundo pedaço recebe `idNovo`. */
export const dividirSegmento = (s: SegmentoLegenda, idNovo: string, indice?: number): [SegmentoLegenda, SegmentoLegenda] | null => {
  const ps = palavrasDe(s);
  if (ps.length < 2) return null;
  let i = indice ?? 0;
  if (!indice) {
    // o corte mais perto da metade dos caracteres, preferindo depois de pontuação
    const total = ps.reduce((n, p) => n + p.w.length + 1, 0);
    let melhor = 1;
    let nota = Infinity;
    let conta = 0;
    for (let k = 1; k < ps.length; k++) {
      conta += ps[k - 1].w.length + 1;
      const n = Math.abs(conta - total / 2) - (/[.,;:?!]$/.test(ps[k - 1].w) ? total * 0.15 : 0);
      if (n < nota) {
        nota = n;
        melhor = k;
      }
    }
    i = melhor;
  }
  i = Math.max(1, Math.min(ps.length - 1, Math.round(i)));
  const a = ps.slice(0, i);
  const b = ps.slice(i);
  const corte = b[0].s;
  return [
    {...s, sai: Math.max(a[a.length - 1].e, Math.min(corte, s.sai)), texto: a.map((p) => p.w).join(' '), palavras: a},
    {...s, id: idNovo, em: corte, texto: b.map((p) => p.w).join(' '), palavras: b},
  ];
};

export type OpcoesBusca = {caixa?: boolean; palavra_inteira?: boolean};
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const semAcento = (s: string) => s.normalize('NFD').replace(/\p{Mn}/gu, '');

/** Expressão da busca: sem diferença de caixa (padrão) e, com `palavra_inteira`, só a palavra inteira. */
export const expressaoDeBusca = (procurar: string, o: OpcoesBusca = {}) => {
  const corpo = escapar(procurar);
  return new RegExp(o.palavra_inteira ? `(?<![\\p{L}\\p{N}])${corpo}(?![\\p{L}\\p{N}])` : corpo, `gu${o.caixa ? '' : 'i'}`);
};

/** Ids dos segmentos que têm o texto procurado (sem diferença de acento quando a busca é sem caixa). */
export const localizar = (segmentos: SegmentoLegenda[], procurar: string, o: OpcoesBusca = {}): string[] => {
  if (!procurar) return [];
  const re = expressaoDeBusca(o.caixa ? procurar : semAcento(procurar), o);
  return segmentos.filter((s) => {
    re.lastIndex = 0;
    return re.test(o.caixa ? s.texto : semAcento(s.texto));
  }).map((s) => s.id);
};

/** Localiza e substitui em todas as legendas; o tempo das palavras fica (comTexto). Devolve as legendas novas e quantas
 *  trocas houve. */
export const substituirEmLote = (segmentos: SegmentoLegenda[], procurar: string, trocar: string, o: OpcoesBusca = {}): {segmentos: SegmentoLegenda[]; trocas: number} => {
  if (!procurar) return {segmentos, trocas: 0};
  const re = expressaoDeBusca(procurar, o);
  let trocas = 0;
  const novos = segmentos.map((s) => {
    let n = 0;
    const texto = s.texto.replace(re, () => (n++, trocar));
    if (!n) return s;
    trocas += n;
    return comTexto(s, texto.replace(/[ \t]{2,}/g, ' ').trim());
  });
  return {segmentos: novos, trocas};
};

// ---------- resolver para a composição ----------

export type EstiloLegendaP = Predefinicao & {cor: string; cor_destaque: string; cor_suave: string; fundo: string; fonte: string; falante: boolean};
export type SegmentoLegendaP = {id: string; em: number; sai: number; texto: string; palavras: PalavraLegenda[]; falante?: string; origem: string};
export type LegendasP = {segmentos: SegmentoLegendaP[]; estilo: EstiloLegendaP; area: AreaLegenda; oculto: boolean};

const numero = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Estilo com tudo preenchido: a predefinição, por cima o que o documento mudou, e as cores e a fonte do tema. */
export const resolverEstilo = (e: EstiloLegenda | undefined, tema: TemaCenas): EstiloLegendaP => {
  const p = PREDEFINICOES_LEGENDA[e?.predefinicao ?? 'classica'] ?? PREDEFINICOES_LEGENDA.classica;
  const tam = numero(e?.tam);
  // a faixa da marca é da cor de destaque, com o texto (e o sublinhado da palavra falada) na cor do fundo: no fundo do
  // próprio vídeo ela sumiria
  const faixa = p.caixa === 'faixa';
  return {
    ...p,
    posicao: e?.posicao === 'meio' || e?.posicao === 'cima' || e?.posicao === 'baixo' ? e.posicao : p.posicao,
    tam: tam !== null && tam > 0.01 && tam < 0.3 ? tam : p.tam,
    maiusculas: typeof e?.maiusculas === 'boolean' ? e.maiusculas : p.maiusculas,
    cor: e?.cor || (faixa ? tema.fundo : tema.texto),
    cor_destaque: e?.cor_destaque || (faixa ? tema.fundo : tema.destaque),
    cor_suave: tema.suave,
    fundo: e?.fundo || (faixa ? tema.destaque : tema.fundo),
    fonte: e?.fonte || tema.fonte,
    falante: Boolean(e?.falante),
  };
};

/** Props das legendas, em ms de saída. Segmento que veio de um clipe anda com ele (o clipe mudou de lugar ou foi aparado
 *  depois de gerar) e some no que o clipe não toca mais. O que estiver fora do lugar vira aviso, não erro. */
export const resolverLegendas = (leg: LegendasCenas | undefined, ctx: {audio?: AudioP; largura: number; altura: number; tema: TemaCenas; duracao_ms: number},
  avisos: string[] = []): LegendasP | undefined => {
  if (!leg || typeof leg !== 'object') return undefined;
  const clipes = new Map((ctx.audio?.faixas ?? []).flatMap((f) => f.clipes.map((c) => [c.id, c] as const)));
  const origens = new Map((Array.isArray(leg.origens) ? leg.origens : []).map((o) => [o.clipe, o]));
  const sumidos = new Set<string>();
  let ruins = 0;
  const segmentos: SegmentoLegendaP[] = [];
  (Array.isArray(leg.segmentos) ? leg.segmentos : []).forEach((s, i) => {
    let em = numero(s?.em);
    let sai = numero(s?.sai);
    if (em === null || sai === null || typeof s.texto !== 'string') {
      ruins++;
      return;
    }
    if (sai <= em) sai = em + MIN_SEGMENTO_MS;
    let palavras = palavrasDe({...s, em, sai});
    // anda com o clipe: o deslocamento é quanto o "zero do arquivo" mudou na linha do tempo desde que a legenda nasceu
    const c = s.clipe ? clipes.get(s.clipe) : undefined;
    const o = s.clipe ? origens.get(s.clipe) : undefined;
    if (s.clipe && !c && o) sumidos.add(s.clipe);
    if (c && o) {
      const delta = (c.em - c.corte_ms) - (o.em - (o.corte_ms ?? 0));
      if (delta) {
        em += delta;
        sai += delta;
        palavras = palavras.map((p) => ({...p, s: p.s + delta, e: p.e + delta}));
      }
      const ini = c.em;
      const fim = c.em + c.duracao_ms;
      palavras = palavras.filter((p) => palavraNoTrecho(p, ini, fim));
      if (!palavras.length) return;
      em = Math.max(em, ini);
      sai = Math.min(sai, Math.max(fim, palavras[palavras.length - 1].e));
    }
    if (em >= ctx.duracao_ms) return;
    sai = Math.min(sai, ctx.duracao_ms);
    const texto = c && o && palavras.length !== tokensDe(s.texto).length ? palavras.map((p) => p.w).join(' ') : s.texto;
    segmentos.push({id: typeof s.id === 'string' ? s.id : `leg-${i + 1}`, em: Math.round(em), sai: Math.round(sai), texto, palavras,
      ...(s.falante ? {falante: s.falante} : {}), origem: `/legendas/segmentos/${i}`});
  });
  if (ruins) avisos.push(`${ruins === 1 ? 'uma legenda está' : `${ruins} legendas estão`} sem começo, fim ou texto e ${ruins === 1 ? 'ficou' : 'ficaram'} de fora`);
  for (const id of sumidos) avisos.push(`as legendas do clipe "${id}" ficaram no tempo em que foram geradas: o clipe não está mais no vídeo`);
  segmentos.sort((a, b) => a.em - b.em);
  return {segmentos, estilo: resolverEstilo(leg.estilo, ctx.tema), area: areaDaLegenda(ctx.largura, ctx.altura), oculto: Boolean(leg.oculto)};
};

/** As legendas para outro tamanho de quadro (um destino da exportação, como o Reels de um vídeo 16:9): a área segura do
 *  destino e, onde a legenda não cabe nas linhas do estilo nesse tamanho, ela dividida em pedaços que cabem, pela mesma
 *  regra da quebra e dentro dela. Nada se junta com a vizinha: o que a pessoa dividiu, juntou ou corrigiu fica. Na mesma
 *  proporção do documento (`doc`), só a área é refeita, para o arquivo sair igual à prévia. */
export const legendasNoDestino = (leg: LegendasP, largura: number, altura: number, doc?: {largura: number; altura: number}): LegendasP => {
  const area = areaDaLegenda(largura, altura);
  if (doc && Math.abs(largura / altura - doc.largura / doc.altura) < 0.01) return {...leg, area};
  const e = leg.estilo;
  const quebra: OpcoesQuebra = {max_caracteres: caracteresPorLinha({predefinicao: e.id, tam: e.tam, maiusculas: e.maiusculas}, largura, altura) * e.linhas,
    max_palavras: e.max_palavras};
  const cabe = (ps: PalavraLegenda[]) => ps.reduce((n, p, i) => n + p.w.length + (i ? 1 : 0), 0) <= quebra.max_caracteres && (!quebra.max_palavras || ps.length <= quebra.max_palavras);
  const segmentos = leg.segmentos.flatMap((s): SegmentoLegendaP[] => {
    if (s.palavras.length < 2 || cabe(s.palavras)) return [s];
    const pedacos = quebrarEmSegmentos(s.palavras, quebra);
    return pedacos.map((x, k) => ({...s, id: k ? `${s.id}.${k + 1}` : s.id, texto: x.texto, palavras: x.palavras ?? [],
      em: k ? Math.max(s.em, x.em) : s.em, sai: k === pedacos.length - 1 ? s.sai : Math.min(s.sai, x.sai)}));
  });
  return {...leg, segmentos, area};
};

/** Os segmentos que aparecem em `ms` (pode haver mais de um quando duas vozes se sobrepõem). */
export const segmentosEm = (segmentos: SegmentoLegendaP[], ms: number) => segmentos.filter((s) => ms >= s.em && ms < s.sai);

export const ENTRA_LEGENDA_MS = 120; // a legenda acende em 120 ms antes de `em`
export const SAI_LEGENDA_MS = 120; // e apaga em 120 ms depois de `sai`

/** A legenda da tela em `ms`, uma só: a que está no ar (com duas vozes ao mesmo tempo, a que começou por último). Na fala
 *  contínua, em que uma sai quando a outra entra, a troca é no quadro, sem as duas juntas. No silêncio entre duas, a que
 *  sai apaga na primeira metade do vão e a que entra acende na segunda, cada uma em até 120 ms. `entrada` (0 a 1) é o
 *  quanto a legenda já entrou, para a subida dela; `opacidade` junta entrada e saída. */
export const legendaNoAr = (segmentos: SegmentoLegendaP[], ms: number): {s: SegmentoLegendaP; opacidade: number; entrada: number} | null => {
  let atual: SegmentoLegendaP | undefined;
  let antes: SegmentoLegendaP | undefined;
  let depois: SegmentoLegendaP | undefined;
  for (const s of segmentos) {
    if (s.em <= ms && ms < s.sai) {
      if (!atual || s.em >= atual.em) atual = s;
    } else if (s.sai <= ms) {
      if (!antes || s.sai > antes.sai) antes = s;
    } else if (!depois || s.em < depois.em) depois = s;
  }
  if (atual) return {s: atual, opacidade: 1, entrada: 1};
  const fim = antes?.sai ?? -Infinity;
  const ini = depois?.em ?? Infinity;
  const metade = (ini - fim) / 2;
  if (antes && ms - fim < metade) {
    const o = 1 - (ms - fim) / Math.min(SAI_LEGENDA_MS, metade);
    return o > 0 ? {s: antes, opacidade: o, entrada: 1} : null;
  }
  if (depois) {
    const e = 1 - (ini - ms) / Math.min(ENTRA_LEGENDA_MS, metade);
    return e > 0 ? {s: depois, opacidade: e, entrada: e} : null;
  }
  return null;
};

// ---------- SRT e VTT ----------

const doisDig = (n: number, d = 2) => String(Math.floor(n)).padStart(d, '0');
/** "00:01:02,345" (SRT) ou "00:01:02.345" (VTT). */
export const carimboLegenda = (ms: number, separador: ',' | '.') => {
  const t = Math.max(0, Math.round(ms));
  return `${doisDig(t / 3_600_000)}:${doisDig((t / 60_000) % 60)}:${doisDig((t / 1000) % 60)}${separador}${doisDig(t % 1000, 3)}`;
};

/** Quebra o texto em até duas linhas equilibradas de no máximo `max` caracteres (a quebra à mão, "\n", manda). */
export const linhasDaLegenda = (texto: string, max = 42): string[] => {
  if (texto.includes('\n')) return texto.split('\n').map((l) => l.trim()).filter(Boolean);
  const t = texto.trim();
  if (t.length <= max) return [t];
  const ws = tokensDe(t);
  let melhor = 1;
  let nota = Infinity;
  for (let k = 1; k < ws.length; k++) {
    const a = ws.slice(0, k).join(' ').length;
    const b = ws.slice(k).join(' ').length;
    const n = Math.max(a, b) + (a > max || b > max ? 1000 : 0);
    if (n < nota) {
      nota = n;
      melhor = k;
    }
  }
  return [ws.slice(0, melhor).join(' '), ws.slice(melhor).join(' ')];
};

type SegmentoExportavel = {em: number; sai: number; texto: string; falante?: string};

export const paraSrt = (segmentos: SegmentoExportavel[], o: {max_linha?: number; falantes?: boolean} = {}) =>
  [...segmentos].sort((a, b) => a.em - b.em).map((s, i) => {
    const texto = o.falantes && s.falante ? `${s.falante}: ${s.texto}` : s.texto;
    return `${i + 1}\n${carimboLegenda(s.em, ',')} --> ${carimboLegenda(s.sai, ',')}\n${linhasDaLegenda(texto, o.max_linha).join('\n')}\n`;
  }).join('\n');

const escaparVtt = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** WebVTT com o falante na marca de voz (<v Nome>), que os players mostram ou usam para o leitor de tela. */
export const paraVtt = (segmentos: SegmentoExportavel[], o: {max_linha?: number} = {}) =>
  `WEBVTT\n\n${[...segmentos].sort((a, b) => a.em - b.em).map((s, i) => {
    const linhas = linhasDaLegenda(s.texto, o.max_linha).map(escaparVtt);
    const voz = s.falante ? `<v ${escaparVtt(s.falante).replace(/>/g, '')}>` : '';
    return `${i + 1}\n${carimboLegenda(s.em, '.')} --> ${carimboLegenda(s.sai, '.')}\n${voz}${linhas.join('\n')}\n`;
  }).join('\n')}`;

/** "01:02:03,456", "02:03.456", "00:00:01.5" → ms. */
const lerCarimbo = (t: string): number | null => {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(t.trim());
  if (!m) return null;
  const ms = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
  return (Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + ms;
};

const ENTIDADES: Record<string, string> = {amp: '&', lt: '<', gt: '>', nbsp: ' ', quot: '"', apos: "'", lrm: '', rlm: ''};
const limparTexto = (t: string) => t
  .replace(/<\d+:\d+[:.,\d]*>/g, '') // carimbos de palavra do VTT
  .replace(/<\/?[a-z]+[^>]*>/gi, '') // <i>, <b>, <c.cor>, <font>, <v>
  .replace(/\{\\[^}]*\}/g, '') // {\an8} do SRT
  .replace(/&(\w+);/g, (x, n: string) => ENTIDADES[n] ?? x)
  .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');

export type LegendaLida = {em: number; sai: number; texto: string; falante?: string};

/** Lê SRT ou WebVTT (pelo nome do arquivo ou pelo "WEBVTT" do começo). Bloco que não se entende vira aviso. */
export type CodificacaoLegenda = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

/** O texto de um arquivo de legenda pelos bytes: UTF-8 (com ou sem BOM) quando os bytes são UTF-8 válido, UTF-16 com
 *  BOM, e senão Windows-1252, o "ANSI" do Bloco de Notas antigo e do Subtitle Edit, para "rescisão" não virar
 *  "rescis�o". (video-N6) */
export const textoDeLegenda = (bytes: Uint8Array): {texto: string; codificacao: CodificacaoLegenda} => {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return {texto: new TextDecoder('utf-16le').decode(bytes.subarray(2)), codificacao: 'utf-16le'};
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return {texto: new TextDecoder('utf-16be').decode(bytes.subarray(2)), codificacao: 'utf-16be'};
  try {
    return {texto: new TextDecoder('utf-8', {fatal: true}).decode(bytes), codificacao: 'utf-8'};
  } catch {
    return {texto: new TextDecoder('windows-1252').decode(bytes), codificacao: 'windows-1252'};
  }
};

export const lerLegendas = (texto: string, nome = ''): {segmentos: LegendaLida[]; avisos: string[]; formato: 'srt' | 'vtt'} => {
  const limpo = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const formato: 'srt' | 'vtt' = /\.vtt$/i.test(nome) || /^WEBVTT/.test(limpo) ? 'vtt' : 'srt';
  const avisos: string[] = [];
  const segmentos: LegendaLida[] = [];
  const blocos = limpo.split(/\n[ \t]*\n+/).map((b) => b.trim()).filter(Boolean);
  for (const b of blocos) {
    if (formato === 'vtt' && /^(WEBVTT|NOTE|STYLE|REGION)\b/.test(b)) continue;
    const linhas = b.split('\n');
    const i = linhas.findIndex((l) => l.includes('-->'));
    if (i < 0) {
      if (!/^\d+$/.test(b)) avisos.push(`trecho sem tempo ignorado: "${b.slice(0, 40)}"`);
      continue;
    }
    const [a, z] = linhas[i].split('-->');
    const em = lerCarimbo(a);
    const sai = lerCarimbo((z ?? '').trim().split(/\s+/)[0] ?? '');
    if (em === null || sai === null) {
      avisos.push(`tempo que não entendi: "${linhas[i].trim()}"`);
      continue;
    }
    const corpo = linhas.slice(i + 1).join('\n');
    const voz = /<v(?:\.[^\s>]+)?\s+([^>]+)>/.exec(corpo)?.[1]?.trim();
    const t = limparTexto(corpo);
    if (!t) continue;
    segmentos.push({em, sai: Math.max(sai, em + 100), texto: t, ...(voz ? {falante: voz} : {})});
  }
  if (!segmentos.length && !avisos.length) avisos.push(`nenhuma legenda achada no arquivo ${formato.toUpperCase()}`);
  segmentos.sort((x, y) => x.em - y.em);
  return {segmentos, avisos, formato};
};

/** Legendas lidas de um arquivo, prontas para o documento (ids novos, sem palavras: o tempo de cada uma é estimado). */
export const legendasDeArquivo = (texto: string, nome: string, estilo: EstiloLegenda = ESTILO_PADRAO): {legendas: LegendasCenas; avisos: string[]} => {
  const {segmentos, avisos} = lerLegendas(texto, nome);
  return {legendas: {estilo, segmentos: segmentos.map((s, i) => ({id: `leg-${i + 1}`, ...s}))}, avisos};
};

/** Nome do arquivo de legenda em saidas/: o título do vídeo sem o que o Windows não aceita. */
export const nomeDoArquivoDeLegenda = (titulo: string, ext: 'srt' | 'vtt') => `${(titulo.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim() || 'legendas')}.${ext}`;
