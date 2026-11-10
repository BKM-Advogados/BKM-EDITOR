// Legendas do vídeo de cenas (docs/legendas.md). O campo `legendas` do documento é opcional: sem ele, nada muda. Cada
// segmento tem começo e fim em ms da linha do tempo do vídeo, o texto, as palavras com o tempo de cada uma (para a
// palavra falada ficar em destaque), o falante e o clipe de voz de onde veio. As legendas nascem do palavras.json que a
// transcrição local grava ao lado do áudio (src/main/transcricao.ts), quebradas por pausa, pontuação e largura, ou de
// um SRT/VTT importado. Os estilos são predefinições (posição, tamanho, caixa, destaque) com as cores e a fonte do
// `tema`, que o kit de marca preenche. Puro: sem disco, para a interface, o processo principal e o MCP usarem igual.
import {nomeDeArquivo} from './nome-de-arquivo';
import {papelDe, type AudioCenas, type AudioP, type ClipeAudio, type FaixaAudio} from './audio';
import type {TemaCenas} from './cenas';
import {conjuntoDe, zonaSugerida} from './zonas-seguras';
import {medidorDaFonte, type Medir} from './medida-texto';

// ---------- formato no documento ----------

export type PalavraLegenda = {w: string; s: number; e: number; p?: number}; // ms na linha do tempo do vídeo; p: a certeza do whisper (0 a 1)
/** Abaixo disto a palavra vai para "confira" na lista e em `duvidosas` no ler_legendas. */
export const P_DUVIDA = 0.6;
/** As palavras em que o whisper teve pouca certeza (p abaixo de 0,6); a palavra corrigida à mão não entra. */
export const palavrasDuvidosas = (ps: PalavraLegenda[] | undefined) => (Array.isArray(ps) ? ps : []).filter((p) => typeof p.p === 'number' && p.p < P_DUVIDA).map((p) => p.w);
export type SegmentoLegenda = {
  id: string;
  em: number; // ms na linha do tempo do vídeo
  sai: number;
  texto: string; // "\n" quebra a linha à mão
  palavras?: PalavraLegenda[]; // sem elas (SRT importado), o tempo de cada palavra é estimado pelo tamanho
  falante?: string;
  clipe?: string; // id do clipe de voz de onde a fala veio
  palavras_estimadas?: boolean; // as palavras foram repartidas pelo tamanho (SRT de fora), não vieram da fala
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
  no_quadrado?: boolean; // no 4:5, dentro do corte 1:1 da prévia quadrada (padrão: sim; false usa a altura toda) (fala-D8)
};
/** De onde as legendas vieram: o clipe, o arquivo de áudio, a transcrição e onde o clipe estava naquela hora. Se o
 *  clipe muda de lugar ou é aparado depois, o resolvedor desloca as legendas dele junto. */
export type OrigemLegendas = {clipe: string; arquivo: string; palavras: string; em: number; corte_ms: number;
  sha256?: string}; // do áudio transcrito (o carimbo do palavras.json): a correção à mão só passa para a mesma tomada
export type LegendasCenas = {segmentos: SegmentoLegenda[]; estilo?: EstiloLegenda; oculto?: boolean; origens?: OrigemLegendas[];
  dicionario?: EntradaDicionario[]}; // as trocas que a pessoa guardou: voltam a valer em toda legenda gerada

/** Uma troca do dicionário: `de` vira `para`, por padrão só a palavra inteira e sem diferença de maiúsculas e acentos. */
export type EntradaDicionario = {de: string; para: string; palavra_inteira?: boolean; caixa?: boolean};
/** O dicionário da casa: as siglas do direito do trabalho, que o whisper às vezes escreve em minúsculas. Vale em toda
 *  legenda gerada, antes do dicionário do vídeo. */
export const DICIONARIO_CASA: EntradaDicionario[] = ['CLT', 'FGTS', 'INSS', 'TST', 'TRT', 'STF', 'STJ', 'CTPS', 'PIS', 'CPF', 'CNPJ', 'MTE', 'OAB', 'PLR', 'NR']
  .map((s) => ({de: s, para: s}));

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
  pista?: 'fundo'; // além da cor, a palavra falada ganha um fundo translúcido (quem não distingue cores também segue)
};

export const PREDEFINICOES_LEGENDA: Record<IdEstiloLegenda, Predefinicao> = {
  classica: {id: 'classica', nome: 'Clássica', descricao: 'Embaixo, caixa escura atrás da linha, palavra falada na cor de destaque e com um fundo leve', posicao: 'baixo',
    tam: 0.042, peso: 600, maiusculas: false, caixa: 'linha', destaque: 'cor', apagadas: false, sombra: false, linhas: 2, pista: 'fundo'},
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
 *  centro do quadro. `no_quadrado` (padrão sim): no 4:5, dentro do corte 1:1 que a prévia quadrada (WhatsApp, LinkedIn,
 *  a grade antiga) mostra. `legendas_youtube`: no 16:9, acima da faixa das legendas automáticas do YouTube, para quando
 *  o SRT sobe junto e o espectador liga as legendas (fala-D8). */
export const areaDaLegenda = (largura: number, altura: number, o: {no_quadrado?: boolean; legendas_youtube?: boolean} = {}): AreaLegenda => {
  let topo = MARGEM;
  let base = 1 - MARGEM;
  let lado = MARGEM;
  const conjunto = conjuntoDe(zonaSugerida(largura, altura));
  for (const z of conjunto?.zonas ?? []) {
    const inteira = z.largura >= 0.99;
    if (z.tipo === 'contorno') {
      // o corte 1:1 do 4:5 é o contorno de largura inteira do conjunto do feed; a faixa das legendas do YouTube é o
      // contorno que não é miolo
      if (conjunto?.id === 'feed' && z.miolo && inteira && o.no_quadrado !== false && altura > largura * 1.05) { // o quadrado já é 1:1
        topo = Math.max(topo, z.y);
        base = Math.min(base, z.y + z.altura);
      } else if (conjunto?.id === 'youtube' && !z.miolo && o.legendas_youtube) base = Math.min(base, z.y);
      continue;
    }
    if (inteira && z.y <= 0.01) topo = Math.max(topo, z.altura);
    else if (inteira && z.y + z.altura >= 0.99) base = Math.min(base, z.y);
    else if (z.x >= 0.5) lado = Math.max(lado, 1 - z.x);
    else if (z.x + z.largura <= 0.5) lado = Math.max(lado, z.x + z.largura);
  }
  return {topo: topo + 0.01, base: base - 0.01, esq: lado, dir: lado};
};

export const MAX_CARACTERES_LINHA = 42; // a régua da Netflix pt-BR

/** A largura do texto numa linha, em px: a área segura entre as margens, menos o respiro da caixa atrás da linha (o
 *  mesmo que a composição desenha em Legendas.tsx). */
export const larguraDaLinha = (area: AreaLegenda, largura: number, tam: number, caixa: Predefinicao['caixa']) =>
  Math.max(tam * 2, (1 - area.esq - area.dir) * largura - (caixa === 'linha' ? tam * 0.64 : 0));

/** Onde a legenda cabe nesse quadro e nesse estilo: a largura útil da linha em px, o medidor da fonte (os avanços de cada
 *  letra medidos na fonte, medida-texto.ts), o teto de 42 caracteres por linha, as linhas e as palavras por vez. */
export type CapacidadeLegenda = {largura: number; medir: Medir; max_caracteres: number; linhas: number; max_palavras?: number};
export const capacidadeDaLegenda = (estilo: {predefinicao?: IdEstiloLegenda; id?: IdEstiloLegenda; tam?: number; maiusculas?: boolean; fonte?: string} | undefined,
  largura: number, altura: number, o: {fonte?: string; area?: AreaLegenda} = {}): CapacidadeLegenda => {
  const p = PREDEFINICOES_LEGENDA[estilo?.predefinicao ?? estilo?.id ?? 'classica'] ?? PREDEFINICOES_LEGENDA.classica;
  const tam = (numeroOuNada(estilo?.tam) ?? p.tam) * Math.min(largura, altura);
  const maiusculas = typeof estilo?.maiusculas === 'boolean' ? estilo.maiusculas : p.maiusculas;
  return {
    largura: larguraDaLinha(o.area ?? areaDaLegenda(largura, altura), largura, tam, p.caixa),
    // a caixa alta da legenda leva 0,01 em entre as letras (Legendas.tsx)
    medir: ((m: Medir) => (maiusculas ? (s: string) => m(s) + s.length * tam * 0.01 : m))(medidorDaFonte({familia: estilo?.fonte || o.fonte, peso: p.peso, tam, maiusculas})),
    max_caracteres: MAX_CARACTERES_LINHA, linhas: p.linhas, ...(p.max_palavras ? {max_palavras: p.max_palavras} : {}),
  };
};
const numeroOuNada = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0.01 && v < 0.3 ? v : null);

// uma frase comum de narração, para a largura média das letras
const AMOSTRA_PT = 'A transferência do empregado para outra cidade depende da sua concordância, com exceções.';

/** Quantos caracteres cabem numa linha da legenda nesse formato: a largura útil pela largura média das letras de uma
 *  frase em português, medida na fonte, e no máximo 42 (a régua). Serve à regra da vírgula; o que decide se cabe é a
 *  medida de cada linha (cabeNaLegenda). */
export const caracteresPorLinha = (estilo: EstiloLegenda | undefined, largura: number, altura: number, fonte?: string) => {
  const cap = capacidadeDaLegenda(estilo, largura, altura, {fonte});
  const media = cap.medir(AMOSTRA_PT) / AMOSTRA_PT.length;
  return Math.max(8, Math.min(MAX_CARACTERES_LINHA, Math.floor(cap.largura / media)));
};

/** Palavra que não termina linha nem legenda quando dá para evitar: artigo, preposição, conjunção, verbo auxiliar e
 *  "não" (régua da Netflix pt-BR: não separar artigo do nome nem verbo do auxiliar). Com pontuação no fim, pode. */
export const fracaNoFim = (w: string) => !/[,;:.?!…]["'”»)]*$/.test(w) && (PALAVRA_FRACA.test(w) || AUXILIAR.test(w));

/** As linhas de uma legenda: uma só se couber; senão duas, no corte mais equilibrado pela largura medida, de preferência
 *  depois de pontuação e sem palavra fraca no fim da primeira quando dá para evitar; se nem em duas couber, quantas
 *  precisar, levando a palavra fraca para a linha de baixo. Cada linha cabe na largura e no teto de caracteres. */
export const quebrarEmLinhas = (palavras: string[], cap: {largura: number; medir: Medir; max_caracteres?: number}): string[][] => {
  if (!palavras.length) return [];
  const max = cap.max_caracteres ?? Infinity;
  const larg = (ws: string[]) => cap.medir(ws.join(' '));
  const cabe = (ws: string[]) => ws.join(' ').length <= max && larg(ws) <= cap.largura;
  if (palavras.length === 1 || cabe(palavras)) return [palavras];
  let melhor = 0;
  let nota = Infinity;
  for (let k = 1; k < palavras.length; k++) {
    const a = palavras.slice(0, k);
    const b = palavras.slice(k);
    if (!cabe(a) || !cabe(b)) continue;
    const ultima = palavras[k - 1];
    const n = Math.max(larg(a), larg(b)) - (/[,;:.?!…]["'”»)]*$/.test(ultima) ? cap.largura * 0.25 : 0) + (fracaNoFim(ultima) ? cap.largura * 0.3 : 0);
    if (n < nota) {
      nota = n;
      melhor = k;
    }
  }
  if (melhor) return [palavras.slice(0, melhor), palavras.slice(melhor)];
  const linhas: string[][] = [];
  let atual: string[] = [];
  for (const w of palavras) {
    if (atual.length && !cabe([...atual, w])) {
      const f = atual.length > 1 && fracaNoFim(atual[atual.length - 1]) ? atual.pop()! : null;
      linhas.push(atual);
      atual = f ? [f] : [];
    }
    atual.push(w);
  }
  if (atual.length) linhas.push(atual);
  return linhas;
};

/** A legenda cabe nas linhas do estilo (pela largura medida e pelo teto de caracteres) e nas palavras por vez? */
export const cabeNaLegenda = (palavras: string[], cap: CapacidadeLegenda) =>
  (!cap.max_palavras || palavras.length <= cap.max_palavras) && quebrarEmLinhas(palavras, cap).length <= cap.linhas;

// ---------- gerar a partir das palavras ----------

/** `cabe`: se as palavras cabem numa legenda (a medida da fonte, cabeNaLegenda); sem ele, vale `max_caracteres`. */
export type OpcoesQuebra = {max_caracteres: number; max_palavras?: number; pausa_ms?: number; max_ms?: number; min_ms?: number; segura_ms?: number;
  cabe?: (palavras: string[]) => boolean};
// a régua (Netflix pt-BR e @remotion/captions): página nova no silêncio de ~300 ms, cada legenda entre 5/6 s e 7 s, e
// até 17 caracteres por segundo para ler
export const PAUSA_QUEBRA_MS = 300; // silêncio que fecha a legenda
export const MAX_SEGMENTO_MS = 7000;
export const MIN_SEGMENTO_MS = 833;
export const CPS_MAX = 17;
const SEGURA_MS = 250; // a legenda fica um pouco depois da última palavra
const FIM_DE_FRASE = /[.?!…]["'”»)]*$/;
// artigo, preposição e conjunção não terminam legenda quando dá para evitar ("a mudança de | casa")
const PALAVRA_FRACA = /^(a|o|as|os|um|uma|uns|umas|de|da|do|das|dos|em|na|no|nas|nos|e|ou|que|para|pra|por|pela|pelo|com|se|ao|à|aos|às|sem|sua|seu)$/i;
// verbo auxiliar e "não" ficam com o verbo que vem depois ("vai | pagar", "não | pode")
const AUXILIAR = /^(é|são|foi|foram|era|eram|ser|sido|está|estão|estava|estavam|tem|têm|tinha|tinham|ter|tido|vai|vão|ia|iam|ir|pode|podem|podia|podiam|deve|devem|devia|deviam|há|havia|haver|será|serão|seria|seriam|fica|ficam|ficou|precisa|precisam|não)$/i;
const PAUSA_DE_FRASE = /[,;:]["'”»)]*$/;
/** Depois de artigo, preposição, auxiliar ou "não", a pausa abaixo disto não fecha a legenda: a frase não acabou
 *  ("entenda as regras da | transferência", com 580 ms do whisper depois do "da", deixava "da" no fim e
 *  "transferência." sozinha por 810 ms). Pausa maior fecha como antes. */
export const PAUSA_DEPOIS_DE_FRACA_MS = 1000;

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
      if (typeof p.p === 'number') u.p = Math.min(u.p ?? 1, p.p);
      continue;
    }
    out.push({w, s: p.s, e: Math.max(p.s, p.e), ...(typeof p.p === 'number' ? {p: p.p} : {})});
  }
  return out;
};

/** Quebra as palavras em legendas: fecha no silêncio de 300 ms (até 1 s depois de palavra fraca segue junto), no fim de frase, na vírgula quando já há meia legenda,
 *  quando passaria da largura (em caracteres) ou do número de palavras, e aos 7 s. O fim fica 250 ms depois da última
 *  palavra e, se precisar, avança no vão até a próxima para dar tempo de ler: pelo menos 833 ms e no máximo 17
 *  caracteres por segundo, sem passar de 7 s nem invadir a próxima. */
export const quebrarEmSegmentos = (palavras: PalavraLegenda[], o: OpcoesQuebra): Omit<SegmentoLegenda, 'id'>[] => {
  const pausa = o.pausa_ms ?? PAUSA_QUEBRA_MS;
  const maxMs = o.max_ms ?? MAX_SEGMENTO_MS;
  const grupos: PalavraLegenda[][] = [];
  let atual: PalavraLegenda[] = [];
  const tamanho = (ws: PalavraLegenda[]) => ws.reduce((n, p, i) => n + p.w.length + (i ? 1 : 0), 0);
  const excede = (ws: PalavraLegenda[]) => (o.cabe ? !o.cabe(ws.map((p) => p.w)) : tamanho(ws) > o.max_caracteres);
  const fechar = () => {
    if (atual.length) grupos.push(atual);
    atual = [];
  };
  // corte por largura, por número de palavras ou por tempo: a legenda não termina em artigo ou preposição, que passa
  // para a próxima ("Com o fim | da produção")
  const fecharSemFraca = () => {
    const ultima = atual[atual.length - 1];
    if (atual.length > 1 && fracaNoFim(ultima.w)) {
      atual.pop();
      fechar();
      atual = [ultima];
    } else fechar();
  };
  for (const p of juntarPedacos(palavras)) {
    if (atual.length) {
      const ultima = atual[atual.length - 1];
      const vao = p.s - ultima.e;
      const fracaAntes = atual.length > 1 && fracaNoFim(ultima.w) && vao < Math.max(pausa, PAUSA_DEPOIS_DE_FRACA_MS);
      if (vao >= pausa && !fracaAntes) fechar();
      else if (excede([...atual, p]) || (o.max_palavras && atual.length >= o.max_palavras) || p.e - atual[0].s > maxMs) fecharSemFraca();
    }
    atual.push(p);
    if (FIM_DE_FRASE.test(p.w)) fechar();
    else if (PAUSA_DE_FRASE.test(p.w) && tamanho(atual) >= o.max_caracteres * 0.5) fechar();
  }
  fechar();
  equilibrar(grupos, o, tamanho, pausa, excede);
  const min = o.min_ms ?? MIN_SEGMENTO_MS;
  const segura = o.segura_ms ?? SEGURA_MS;
  return grupos.map((g, i) => {
    const prox = grupos[i + 1]?.[0].s ?? Infinity;
    const em = g[0].s;
    const texto = g.map((p) => p.w).join(' ');
    let sai = Math.min(g[g.length - 1].e + segura, prox);
    const leitura = Math.max(min, (texto.length / CPS_MAX) * 1000);
    if (sai - em < leitura) sai = Math.min(em + leitura, prox, em + maxMs);
    sai = Math.round(Math.max(sai, g[g.length - 1].e));
    return {em, sai, texto, palavras: g.map((p) => ({...p}))};
  });
};

/** As opções da quebra para um estilo nesse quadro: a medida da fonte decide o que cabe. */
const opcoesDaQuebra = (estilo: EstiloLegenda, largura: number, altura: number, fonte?: string): OpcoesQuebra => {
  const cap = capacidadeDaLegenda(estilo, largura, altura, {fonte});
  return {max_caracteres: caracteresPorLinha(estilo, largura, altura, fonte) * cap.linhas, max_palavras: cap.max_palavras, cabe: (ws) => cabeNaLegenda(ws, cap)};
};

/** A legenda curta que sobrou da largura no meio de uma frase ("concordância." sozinha) divide o texto com a anterior:
 *  o corte mais equilibrado que caiba nas duas, de preferência depois de vírgula. */
const equilibrar = (grupos: PalavraLegenda[][], o: OpcoesQuebra, tamanho: (ws: PalavraLegenda[]) => number, pausa: number, excede: (ws: PalavraLegenda[]) => boolean) => {
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
      if (excede(x) || excede(y)) continue;
      if (o.max_palavras && (x.length > o.max_palavras || y.length > o.max_palavras)) continue;
      const ultima = x[x.length - 1].w;
      const n = Math.max(tamanho(x), tamanho(y)) - (PAUSA_DE_FRASE.test(ultima) ? o.max_caracteres * 0.15 : 0) + (fracaNoFim(ultima) ? o.max_caracteres * 0.1 : 0);
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
    .map((p) => ({w: p.w, s: Math.round(clipe.em + Math.max(p.s, corte) - corte), e: Math.round(clipe.em + Math.min(p.e, fim) - corte),
      ...(typeof p.p === 'number' ? {p: p.p} : {})}));
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
  estilo?: EstiloLegenda; largura: number; altura: number; quebra?: Partial<OpcoesQuebra>; fonte?: string;
}): LegendasCenas => {
  const estilo = o.estilo ?? ESTILO_PADRAO;
  const quebra: OpcoesQuebra = {...opcoesDaQuebra(estilo, o.largura, o.altura, o.fonte), ...o.quebra};
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
    .map((p) => ({w: p.w, s: p.s, e: p.e, ...(typeof p.p === 'number' && Number.isFinite(p.p) ? {p: p.p} : {})}));

/** As palavras que a pessoa corrigiu nas legendas de um clipe, passadas para a transcrição (ms do arquivo): a palavra da
 *  legenda que está no tempo de uma palavra transcrita (até 40 ms no começo e no fim) e tem outro texto. Só entre legendas
 *  e transcrição da mesma tomada: com o sha256 da origem diferente do da transcrição, nada passa. O que perdeu o tempo
 *  (outro número de palavras, legenda arrastada) não passa. */
export const levarCorrecoes = (leg: LegendasCenas, clipe: string, palavras: PalavraLegenda[], sha256?: string, outraTomada = false): {palavras: PalavraLegenda[]; n: number} => {
  const o = (Array.isArray(leg.origens) ? leg.origens : []).find((x) => x.clipe === clipe);
  if (!o || (o.sha256 && sha256 && o.sha256 !== sha256) || outraTomada) return {palavras, n: 0};
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
}): {legendas: LegendasCenas; faltam: string[]; clipes: number; mantidos: string[]; corrigidas: number; geradas: number; dicionario: number} => {
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
      const c = levarCorrecoes(antes, clipe.id, palavras, sha256, !mesmaTomada(antes.origens?.find((x) => x.clipe === clipe.id) ?? {}, clipe));
      palavras = c.palavras;
      corrigidas += c.n;
    }
    fontes.push({clipe: {...clipe, arquivo, em: Number(clipe.em) || 0, duracao_ms: Number(clipe.duracao_ms) || 0}, faixa, palavras, caminhoPalavras: caminho, sha256});
  }
  const gerada = legendasDaFala(fontes, {estilo: o.estilo ?? antes?.estilo, largura: o.largura, altura: o.altura, fonte: (doc as {tema?: {fonte?: string}}).tema?.fonte});
  // o dicionário da casa e o do vídeo voltam a valer nas legendas novas (a correção guardada sobrevive a gerar de novo)
  const dic = aplicarDicionario(gerada.segmentos, [...DICIONARIO_CASA, ...(Array.isArray(antes?.dicionario) ? antes.dicionario : [])]);
  const nova = {...gerada, segmentos: dic.segmentos};
  const resto = {faltam, clipes: fontes.length, mantidos, corrigidas, geradas: nova.segmentos.length, dicionario: dic.trocas};
  if (!antes) return {legendas: {...doc.legendas, ...nova}, ...resto};
  const trocados = new Set(fontes.map((f) => f.clipe.id));
  const ficam = antes.segmentos.filter((s) => !s?.clipe || !trocados.has(s.clipe));
  const segmentos = [...ficam, ...nova.segmentos].sort((a, b) => a.em - b.em).map((s, i) => ({...s, id: `leg-${i + 1}`}));
  const origens = [...(antes.origens ?? []).filter((x) => !trocados.has(x.clipe)), ...(nova.origens ?? [])];
  return {legendas: {...antes, estilo: nova.estilo, segmentos, origens}, ...resto};
};

/** Quebra de novo as legendas de um estilo para outro (largura e palavras por vez mudam), mantendo falante e clipe.
 *  `fonte`: a do tema, quando o estilo não diz. */
export const requebrar = (leg: LegendasCenas, estilo: EstiloLegenda, largura: number, altura: number, fonte?: string): LegendasCenas => {
  const quebra = opcoesDaQuebra(estilo, largura, altura, fonte);
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

/** Caracteres por segundo da legenda, como a régua conta: letras, espaços e pontuação; a quebra de linha não conta. */
export const cpsDe = (s: {texto: string; em: number; sai: number}) =>
  Math.round((s.texto.replace(/\s*\n\s*/g, ' ').trim().length / Math.max(0.001, (s.sai - s.em) / 1000)) * 10) / 10;

/** As palavras do segmento, sempre com o texto dele. Com as palavras gravadas e o mesmo número de palavras no texto,
 *  cada uma fica com o tempo da que estava no lugar (o texto corrigido por patch, sem mexer em `palavras`, não perde o
 *  compasso da fala); com outro número, espalham no tempo que as gravadas ocupavam. Sem palavras gravadas (SRT
 *  importado), o tempo é estimado pelo tamanho dentro do segmento. É a regra do comTexto, que a lista do app usa. */
export const palavrasDe = (s: SegmentoLegenda): PalavraLegenda[] => {
  const ws = tokensDe(s.texto);
  const gravadas = Array.isArray(s.palavras) && s.palavras.length && s.palavras.every((p) => p && Number.isFinite(p.s) && Number.isFinite(p.e)) ? s.palavras : undefined;
  if (!gravadas || !ws.length) return estimarPalavras(s.texto, s.em, s.sai);
  return realinharPalavras(gravadas, ws);
};

/** As palavras de um texto novo no tempo das antigas. Com o mesmo número de palavras, cada uma fica com o tempo da que
 *  estava no lugar. Com outro número, o começo e o fim iguais ficam com o tempo deles e só o trecho que mudou é
 *  repartido, no tempo que as palavras trocadas ocupavam: trocar "FGTS" por "Fundo de Garantia" reparte só o tempo do
 *  "FGTS" (fala-D5). Palavra inserida sem vão para ela divide o tempo da vizinha de antes. A palavra que mudou perde a
 *  confiança `p`: quem mudou conferiu. */
export const realinharPalavras = (antigas: PalavraLegenda[], novas: string[]): PalavraLegenda[] => {
  const igual = (p: PalavraLegenda, w: string): PalavraLegenda => (p.w === w ? {...p} : semP({...p, w}));
  if (!antigas.length) return [];
  if (antigas.length === novas.length) return antigas.map((p, i) => igual(p, novas[i]));
  let a = 0;
  while (a < antigas.length && a < novas.length && antigas[a].w === novas[a]) a++;
  let z = 0;
  while (z < antigas.length - a && z < novas.length - a && antigas[antigas.length - 1 - z].w === novas[novas.length - 1 - z]) z++;
  let meioNovo = novas.slice(a, novas.length - z);
  let meioAntigo = antigas.slice(a, antigas.length - z);
  // inserção sem vão: a vizinha de antes entra no trecho e divide o tempo dela
  if (!meioAntigo.length && meioNovo.length) {
    const antes = antigas[a - 1];
    const depois = antigas[antigas.length - z];
    const vao = antes && depois ? depois.s - antes.e : 0;
    if (vao < 60 * meioNovo.length) {
      if (antes) {
        a -= 1;
        meioAntigo = [antes];
        meioNovo = [antes.w, ...meioNovo];
      } else if (depois) {
        z -= 1;
        meioAntigo = [depois];
        meioNovo = [...meioNovo, depois.w];
      }
    }
  }
  const de = meioAntigo.length ? meioAntigo[0].s : antigas[a - 1].e;
  const ate = meioAntigo.length ? meioAntigo[meioAntigo.length - 1].e : antigas[antigas.length - z].s;
  const meio = meioNovo.length ? estimarPalavras(meioNovo.join(' '), de, ate) : [];
  return [...antigas.slice(0, a).map((p) => ({...p})), ...meio, ...antigas.slice(antigas.length - z).map((p) => ({...p}))];
};
const semP = (p: PalavraLegenda): PalavraLegenda => {
  const {p: _p, ...resto} = p as PalavraLegenda & {p?: number};
  return resto;
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

/** Troca o texto do segmento sem perder o tempo das palavras (realinharPalavras: só o trecho que mudou é repartido). */
export const comTexto = (s: SegmentoLegenda, texto: string): SegmentoLegenda => {
  const novas = tokensDe(texto);
  const antigas = Array.isArray(s.palavras) && s.palavras.length ? s.palavras : undefined;
  if (!antigas || !novas.length) {
    const {palavras: _p, ...resto} = s;
    return {...resto, texto};
  }
  return {...s, texto, palavras: realinharPalavras(antigas, novas)};
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

/** Aplica o dicionário (a casa e o do vídeo) nas legendas, com o tempo das palavras guardado; conta só o que mudou. */
export const aplicarDicionario = (segmentos: SegmentoLegenda[], dic: EntradaDicionario[]): {segmentos: SegmentoLegenda[]; trocas: number} => {
  let segs = segmentos;
  let trocas = 0;
  for (const e of dic) {
    if (!e?.de || typeof e.para !== 'string') continue;
    const r = substituirEmLote(segs, e.de, e.para, {palavra_inteira: e.palavra_inteira !== false, caixa: Boolean(e.caixa)});
    trocas += r.segmentos.filter((s, i) => s.texto !== segs[i].texto).length;
    segs = r.segmentos;
  }
  return {segmentos: segs, trocas};
};

/** Os termos do dicionário, para o vocabulário do whisper (o prompt dele copia a grafia). */
export const termosDoDicionario = (leg: LegendasCenas | undefined) =>
  [...new Set((Array.isArray(leg?.dicionario) ? leg.dicionario : []).map((e) => e?.para).filter((x): x is string => typeof x === 'string' && Boolean(x.trim())))];

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

export type EstiloLegendaP = Predefinicao & {cor: string; cor_destaque: string; cor_suave: string; fundo: string; fonte: string; falante: boolean; no_quadrado: boolean};
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
    no_quadrado: e?.no_quadrado !== false,
  };
};

/** A legenda nasceu desta tomada do clipe? A origem guarda o arquivo transcrito; vale o arquivo do clipe ou, na voz
 *  limpa, o original (as legendas geradas antes da rodada 3 guardavam o .limpo.wav). Sem arquivo na origem, vale. */
export const mesmaTomada = (o: {arquivo?: string}, c: {arquivo: string; original?: string}) => !o.arquivo || o.arquivo === c.arquivo || o.arquivo === c.original;

/** Os clipes cujas legendas são de outra tomada: o arquivo do clipe foi trocado ("Trocar arquivo…") depois de gerar.
 *  (som-N2) */
export const legendasDeOutraTomada = (doc: {audio?: AudioCenas; legendas?: LegendasCenas}): string[] => {
  const comLegenda = new Set((Array.isArray(doc.legendas?.segmentos) ? doc.legendas.segmentos : []).map((s) => s?.clipe).filter(Boolean));
  const origens = Array.isArray(doc.legendas?.origens) ? doc.legendas.origens : [];
  const out: string[] = [];
  for (const f of Array.isArray(doc.audio?.faixas) ? doc.audio.faixas : []) {
    for (const c of Array.isArray(f.clipes) ? f.clipes : []) {
      const o = origens.find((x) => x.clipe === c?.id);
      if (c && typeof c.arquivo === 'string' && comLegenda.has(c.id) && o && !mesmaTomada(o, c)) out.push(c.id);
    }
  }
  return out;
};

/** Quanto a legenda de um clipe pode andar (ms, para trás e para a frente) com as palavras junto sem sair do trecho que
 *  o clipe toca, onde o resolvedor a esconderia. null quando ela não depende de clipe (importada, criada à mão, de outra
 *  tomada). (som-N6) */
export const limitesDoArrasto = (doc: {audio?: AudioCenas; legendas?: LegendasCenas}, s: SegmentoLegenda): {min: number; max: number} | null => {
  if (!s.clipe) return null;
  const clipes = (Array.isArray(doc.audio?.faixas) ? doc.audio.faixas : []).flatMap((f) => (Array.isArray(f.clipes) ? f.clipes : []));
  const c = clipes.find((x) => x?.id === s.clipe);
  const o = (Array.isArray(doc.legendas?.origens) ? doc.legendas.origens : []).find((x) => x.clipe === s.clipe);
  if (!c || !o || !mesmaTomada(o, c)) return null;
  const desloc = deslocamentoDaLegenda(s, doc.legendas?.origens, clipes);
  const ps = palavrasDe(s);
  if (!ps.length) return null;
  const meio = (p: PalavraLegenda) => (p.s + Math.max(p.s, p.e)) / 2 + desloc;
  const ini = Number(c.em) || 0;
  const fim = ini + (Number(c.duracao_ms) || 0);
  const min = Math.ceil(ini - meio(ps[0]));
  const max = Math.floor(fim - 1 - meio(ps[ps.length - 1]));
  return min <= max ? {min, max} : {min: 0, max: 0};
};

// ---------- dividir e duplicar clipe de voz (o Som chama; fala-D12) ----------

/** Um id `leg-N` que ainda não existe. */
const idsLivres = (segs: SegmentoLegenda[]) => {
  const usados = new Set(segs.map((s) => s.id));
  let n = segs.length + 1;
  return () => {
    while (usados.has(`leg-${n}`)) n++;
    usados.add(`leg-${n}`);
    return `leg-${n}`;
  };
};
const comOrigemDe = (leg: LegendasCenas, clipe: string, novo: string): OrigemLegendas[] | undefined => {
  const origens = Array.isArray(leg.origens) ? leg.origens : undefined;
  const o = origens?.find((x) => x.clipe === clipe);
  return origens && o ? [...origens.filter((x) => x.clipe !== novo), {...o, clipe: novo}] : origens;
};

/** As legendas depois de dividir o clipe de voz `clipe` em `em_ms` (tempo da tela). O pedaço novo (`novo`, que começa em
 *  em_ms) fica com as legendas cujas palavras caem depois do corte (pelo meio da palavra, como o resolvedor), e a legenda
 *  cortada no meio vira duas. A origem do clipe é copiada para o novo: o "zero do arquivo" dos dois pedaços é o mesmo
 *  (em − corte_ms), então nada muda de lugar e nenhuma palavra some da tela. `clipes`: os clipes como estão ANTES da
 *  divisão. Junto, o Som grava os dois clipes: o de antes com duracao_ms = em_ms − em; o novo com em = em_ms,
 *  corte_ms = corte_ms + (em_ms − em) e o resto da duração. */
export const legendasAoDividirClipe = (leg: LegendasCenas | undefined, o: {clipe: string; novo: string; em_ms: number; clipes: {id: string; em: number; corte_ms?: number}[]}):
  LegendasCenas | undefined => {
  if (!leg || !Array.isArray(leg.segmentos)) return leg;
  const corte = o.em_ms - deslocamentoDaLegenda({clipe: o.clipe}, leg.origens, o.clipes); // o corte no tempo guardado
  const novoId = idsLivres(leg.segmentos);
  const meio = (p: PalavraLegenda) => (p.s + Math.max(p.s, p.e)) / 2;
  const segmentos = leg.segmentos.flatMap((s): SegmentoLegenda[] => {
    if (s?.clipe !== o.clipe) return [s];
    const ps = palavrasDe(s);
    const a = ps.filter((p) => meio(p) < corte);
    const b = ps.filter((p) => meio(p) >= corte);
    if (!b.length) return [s];
    if (!a.length) return [{...s, clipe: o.novo}];
    return [
      {...s, texto: a.map((p) => p.w).join(' '), palavras: a, sai: Math.max(a[a.length - 1].e, Math.min(s.sai, corte))},
      {...s, id: novoId(), clipe: o.novo, texto: b.map((p) => p.w).join(' '), palavras: b, em: Math.max(s.em, Math.min(b[0].s, corte))},
    ];
  }).sort((x, y) => x.em - y.em);
  return {...leg, segmentos, origens: comOrigemDe(leg, o.clipe, o.novo)};
};

/** As legendas depois de duplicar o clipe de voz `clipe` como `novo`: as do clipe ganham uma cópia ligada ao novo (ids
 *  novos), e a origem é copiada. Onde o Som puser a cópia, as legendas dela vão junto (o resolvedor desloca pelo em e
 *  pelo corte do clipe novo). */
export const legendasAoDuplicarClipe = (leg: LegendasCenas | undefined, o: {clipe: string; novo: string}): LegendasCenas | undefined => {
  if (!leg || !Array.isArray(leg.segmentos)) return leg;
  const novoId = idsLivres(leg.segmentos);
  const copias = leg.segmentos.filter((s) => s?.clipe === o.clipe).map((s) => ({...s, id: novoId(), clipe: o.novo,
    ...(Array.isArray(s.palavras) ? {palavras: s.palavras.map((p) => ({...p}))} : {})}));
  return {...leg, segmentos: [...leg.segmentos, ...copias], origens: comOrigemDe(leg, o.clipe, o.novo)};
};

/** Props das legendas, em ms de saída. Segmento que veio de um clipe anda com ele (o clipe mudou de lugar ou foi aparado
 *  depois de gerar) e perde as palavras que o clipe aparado não toca mais; só então a ponta dele é cortada. O que estiver
 *  fora do lugar vira aviso, não erro: o clipe que sumiu, a tomada trocada (a legenda fica no tempo em que nasceu) e a
 *  legenda arrastada para fora do trecho que o clipe toca. `fala`: o áudio do documento, para saber o original da voz
 *  limpa e comparar a tomada. */
export const resolverLegendas = (leg: LegendasCenas | undefined, ctx: {audio?: AudioP; largura: number; altura: number; tema: TemaCenas; duracao_ms: number;
  fala?: AudioCenas}, avisos: string[] = []): LegendasP | undefined => {
  if (!leg || typeof leg !== 'object') return undefined;
  const clipes = new Map((ctx.audio?.faixas ?? []).flatMap((f) => f.clipes.map((c) => [c.id, c] as const)));
  const origens = new Map((Array.isArray(leg.origens) ? leg.origens : []).map((o) => [o.clipe, o]));
  const doDoc = new Map((Array.isArray(ctx.fala?.faixas) ? ctx.fala.faixas : []).flatMap((f) => (Array.isArray(f.clipes) ? f.clipes : []).map((c) => [c?.id, c] as const)));
  const sumidos = new Set<string>();
  const outraTomada = new Set<string>();
  const fora: number[] = [];
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
    const bruto = s.clipe ? doDoc.get(s.clipe) : undefined;
    // tomada trocada: o tempo de antes não vale para o arquivo novo; a legenda fica onde nasceu, com aviso
    const outra = Boolean(c && o && bruto && typeof bruto.arquivo === 'string' && !mesmaTomada(o, bruto));
    if (outra) outraTomada.add(s.clipe!);
    let cortada = false;
    if (c && o && !outra) {
      const delta = (c.em - c.corte_ms) - (o.em - (o.corte_ms ?? 0));
      if (delta) {
        em += delta;
        sai += delta;
        palavras = palavras.map((p) => ({...p, s: p.s + delta, e: p.e + delta}));
      }
      const ini = c.em;
      const fim = c.em + c.duracao_ms;
      const dentro = palavras.filter((p) => palavraNoTrecho(p, ini, fim));
      if (!dentro.length) {
        fora.push(i + 1);
        return;
      }
      // só o clipe aparado corta a legenda: a ponta que a pessoa esticou (para ler antes ou depois da voz) fica
      if (dentro[0] !== palavras[0]) em = Math.max(em, ini);
      if (dentro[dentro.length - 1] !== palavras[palavras.length - 1]) sai = Math.min(sai, Math.max(fim, dentro[dentro.length - 1].e));
      cortada = dentro.length !== palavras.length;
      palavras = dentro;
    }
    if (em >= ctx.duracao_ms) return;
    sai = Math.min(sai, ctx.duracao_ms);
    const texto = cortada ? palavras.map((p) => p.w).join(' ') : s.texto;
    segmentos.push({id: typeof s.id === 'string' ? s.id : `leg-${i + 1}`, em: Math.round(em), sai: Math.round(sai), texto, palavras,
      ...(s.falante ? {falante: s.falante} : {}), origem: `/legendas/segmentos/${i}`});
  });
  if (ruins) avisos.push(`${ruins === 1 ? 'uma legenda está' : `${ruins} legendas estão`} sem começo, fim ou texto e ${ruins === 1 ? 'ficou' : 'ficaram'} de fora`);
  for (const id of sumidos) avisos.push(`as legendas do clipe "${id}" ficaram no tempo em que foram geradas: o clipe não está mais no vídeo`);
  for (const id of outraTomada) {
    avisos.push(`as legendas do clipe "${id}" são de outro arquivo: o clipe trocou de tomada depois delas e elas ficaram no tempo em que nasceram; transcreva e gere de novo`);
  }
  if (fora.length) {
    avisos.push(`${fora.length === 1 ? `a legenda ${fora[0]} ficou` : `as legendas ${fora.join(', ')} ficaram`} fora do trecho que o clipe de voz toca e não `
      + `${fora.length === 1 ? 'aparece' : 'aparecem'}: traga de volta para dentro do clipe ou gere de novo`);
  }
  segmentos.sort((a, b) => a.em - b.em);
  return {segmentos, estilo: resolverEstilo(leg.estilo, ctx.tema), area: areaDaLegenda(ctx.largura, ctx.altura, {no_quadrado: leg.estilo?.no_quadrado}),
    oculto: Boolean(leg.oculto)};
};

/** As legendas para outro tamanho de quadro (um destino da exportação, como o Reels de um vídeo 16:9): a área segura do
 *  destino e, onde a legenda não cabe nas linhas do estilo nesse tamanho, ela dividida em pedaços que cabem, pela mesma
 *  regra da quebra e dentro dela. Nada se junta com a vizinha: o que a pessoa dividiu, juntou ou corrigiu fica. Na mesma
 *  proporção do documento (`doc`), só a área é refeita, para o arquivo sair igual à prévia. */
export const legendasNoDestino = (leg: LegendasP, largura: number, altura: number, doc?: {largura: number; altura: number},
  o: {legendas_youtube?: boolean} = {}): LegendasP => {
  const area = areaDaLegenda(largura, altura, {no_quadrado: leg.estilo.no_quadrado, legendas_youtube: o.legendas_youtube});
  if (doc && Math.abs(largura / altura - doc.largura / doc.altura) < 0.01) return {...leg, area};
  const e = leg.estilo;
  const cap = capacidadeDaLegenda({predefinicao: e.id, tam: e.tam, maiusculas: e.maiusculas, fonte: e.fonte}, largura, altura, {area});
  const quebra: OpcoesQuebra = {max_caracteres: MAX_CARACTERES_LINHA * e.linhas, max_palavras: e.max_palavras, cabe: (ws) => cabeNaLegenda(ws, cap)};
  const cabe = (ps: PalavraLegenda[]) => cabeNaLegenda(ps.map((p) => p.w), cap);
  const segmentos = leg.segmentos.flatMap((s): SegmentoLegendaP[] => {
    if (s.palavras.length < 2 || cabe(s.palavras)) return [s];
    const pedacos = quebrarEmSegmentos(s.palavras, quebra);
    return pedacos.map((x, k) => ({...s, id: k ? `${s.id}.${k + 1}` : s.id, texto: x.texto, palavras: x.palavras ?? [],
      em: k ? Math.max(s.em, x.em) : s.em, sai: k === pedacos.length - 1 ? s.sai : Math.min(s.sai, x.sai)}));
  });
  return {...leg, segmentos, area};
};

/** Quanto andar uma ponta da legenda (ms da tela) para ela cair no quadro vizinho: `passo` −1 ou +1 quadro, encaixando
 *  na grade de quadros do vídeo (o teclado da lista e da faixa: [ e ] no começo, { e } no fim). */
export const passoDeQuadro = (ms: number, fps: number, passo: -1 | 1) => {
  const q = 1000 / (fps > 0 ? fps : 30);
  const atual = ms / q;
  const alvo = passo > 0 ? Math.floor(atual + 1e-6) + 1 : Math.ceil(atual - 1e-6) - 1;
  return Math.round(Math.max(0, alvo) * q - ms);
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
export const linhasDaLegenda = (texto: string, max = MAX_CARACTERES_LINHA): string[] => {
  if (texto.includes('\n')) return texto.split('\n').map((l) => l.trim()).filter(Boolean);
  // no arquivo de legenda a linha se mede em caracteres; a regra do corte é a mesma do vídeo
  return quebrarEmLinhas(tokensDe(texto.trim()), {largura: max, medir: (s) => s.length, max_caracteres: max}).map((l) => l.join(' '));
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
  // o SRT de fora não traz o tempo de cada palavra: ele é repartido pelo tamanho dentro da legenda e marcado como estimado
  return {legendas: {estilo, segmentos: segmentos.map((s, i) => ({id: `leg-${i + 1}`, ...s, palavras: estimarPalavras(s.texto, s.em, s.sai), palavras_estimadas: true}))}, avisos};
};

/** O primeiro nome livre: "Título.srt", senão "Título (2).srt", "Título (3).srt"… (o ".pt_BR" fica junto da extensão).
 *  Exportar de novo não grava por cima do SRT que a pessoa corrigiu fora do app. (fala-D11) */
export const nomeLivreDaLegenda = (nome: string, existe: (nome: string) => boolean) => {
  if (!existe(nome)) return nome;
  const m = /^(.*?)((?:\.[a-z]{2}_[A-Z]{2})?\.(?:srt|vtt))$/i.exec(nome) ?? /^(.*?)(\.[^.]*)?$/.exec(nome)!;
  const [base, ext = ''] = [m[1], m[2]];
  for (let n = 2; n < 1000; n++) {
    const outro = `${base} (${n})${ext}`;
    if (!existe(outro)) return outro;
  }
  return `${base} (${Date.now()})${ext}`;
};

/** Nome do arquivo de legenda em saidas/: o título do vídeo sem o que o Windows não aceita. */
export const nomeDoArquivoDeLegenda = (titulo: string, ext: 'srt' | 'vtt') =>
  `${nomeDeArquivo(titulo.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' '), {vazio: 'legendas'})}.${ext}`; // nome-de-arquivo.ts: CON e NUL do Windows
