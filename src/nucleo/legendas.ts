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
export type OrigemLegendas = {clipe: string; arquivo: string; palavras: string; em: number; corte_ms: number};
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
export const legendasDaFala = (fontes: {clipe: ClipeFala; faixa: {nome?: string}; palavras: PalavraLegenda[]; caminhoPalavras: string}[], o: {
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
    origens: fontes.map((f) => ({clipe: f.clipe.id, arquivo: f.clipe.arquivo, palavras: f.caminhoPalavras, em: f.clipe.em, corte_ms: f.clipe.corte_ms ?? 0})),
  };
};

/** O palavras.json que a transcrição grava ao lado do arquivo de áudio (midia/narracao.wav → midia/narracao.wav.palavras.json). */
export const arquivoDasPalavras = (arquivo: string) => `${arquivo}.palavras.json`;

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

/** Palavras de um palavras.json qualquer (o da transcrição tem {w, s, e, p}); o que não for palavra fica de fora. */
export const palavrasValidas = (x: unknown): PalavraLegenda[] =>
  (Array.isArray(x) ? x : []).filter((p): p is PalavraLegenda => Boolean(p) && typeof p.w === 'string' && Number.isFinite(p.s) && Number.isFinite(p.e))
    .map((p) => ({w: p.w, s: p.s, e: p.e}));

/** As legendas do documento a partir das transcrições já gravadas. Clipes cujo arquivo ainda não foi transcrito vão em
 *  `faltam`; as legendas de clipes que não estão no pedido (outro clipe, outra faixa) ficam como estavam. */
export const legendasDoDocumento = (doc: {audio?: AudioCenas; legendas?: LegendasCenas}, lerPalavras: (caminho: string) => unknown, o: {
  largura: number; altura: number; estilo?: EstiloLegenda; clipe?: string; faixa?: string;
}): {legendas: LegendasCenas; faltam: string[]; clipes: number} => {
  const fontes: Parameters<typeof legendasDaFala>[0] = [];
  const faltam: string[] = [];
  const escolhidos = clipesDeVoz(doc, o);
  for (const {clipe, faixa} of escolhidos) {
    const caminho = arquivoDasPalavras(clipe.arquivo);
    let palavras: PalavraLegenda[] = [];
    try {
      palavras = palavrasValidas(lerPalavras(caminho));
    } catch {
      palavras = [];
    }
    if (!palavras.length) faltam.push(clipe.arquivo);
    else fontes.push({clipe: {...clipe, em: Number(clipe.em) || 0, duracao_ms: Number(clipe.duracao_ms) || 0}, faixa, palavras, caminhoPalavras: caminho});
  }
  const nova = legendasDaFala(fontes, {estilo: o.estilo ?? doc.legendas?.estilo, largura: o.largura, altura: o.altura});
  if (!o.clipe && !o.faixa || !doc.legendas) return {legendas: {...doc.legendas, ...nova}, faltam, clipes: fontes.length};
  // pedido de um clipe ou de uma faixa: troca só as legendas desses clipes
  const trocados = new Set(escolhidos.map((e) => e.clipe.id));
  const ficam = (doc.legendas.segmentos ?? []).filter((s) => !s.clipe || !trocados.has(s.clipe));
  const segmentos = [...ficam, ...nova.segmentos].sort((a, b) => a.em - b.em).map((s, i) => ({...s, id: `leg-${i + 1}`}));
  const origens = [...(doc.legendas.origens ?? []).filter((x) => !trocados.has(x.clipe)), ...(nova.origens ?? [])];
  return {legendas: {...doc.legendas, estilo: nova.estilo, segmentos, origens}, faltam, clipes: fontes.length};
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

/** As palavras do segmento: as gravadas, se ainda batem com o texto; senão, estimadas no tempo do segmento. */
export const palavrasDe = (s: SegmentoLegenda): PalavraLegenda[] => {
  const ws = tokensDe(s.texto);
  if (Array.isArray(s.palavras) && s.palavras.length === ws.length && s.palavras.every((p, i) => p.w === ws[i] && Number.isFinite(p.s) && Number.isFinite(p.e))) {
    return s.palavras.map((p) => ({...p}));
  }
  return estimarPalavras(s.texto, s.em, s.sai);
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

/** Os segmentos que aparecem em `ms` (pode haver mais de um quando duas vozes se sobrepõem). */
export const segmentosEm = (segmentos: SegmentoLegendaP[], ms: number) => segmentos.filter((s) => ms >= s.em && ms < s.sai);

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
