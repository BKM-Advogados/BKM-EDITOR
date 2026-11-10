// Narração por IA do vídeo de cenas (docs/narracao.md): o modelo de dados, o dicionário de pronúncia, a chave do cache e
// as contas que a interface, o processo principal e o MCP fazem igual. Puro: sem disco, sem rede, sem node:* (a interface
// importa daqui). A rede fica em narracao-gemini.ts e narracao-cloud-tts.ts; o disco e o documento, em narracao-cenas.ts e
// narracao-servico.ts.
//
// No documento:
//  - `cenas[i].narracao` {texto}: o roteiro falado da cena (diferente do texto da tela);
//  - `narracao` (na raiz) {provedor, modelo, voz, estilo, velocidade, folga_ms, margem_ms, pronuncias}: a configuração e o
//    dicionário de pronúncia, aplicado ao texto antes de qualquer provedor;
//  - no clipe de voz gerado, `narracao_ia` {cena, hash}: de qual cena é a fala e de qual texto e voz (o hash do cache).
// Campo fora do lugar vira aviso no resolvedor, nunca erro: o vídeo sempre toca.
import {duracaoDoTeleprompter} from './gravacao';
import {sha256Texto} from './sha256';

export type ProvedorNarracao = 'gemini' | 'google-tts';
export const PROVEDORES_NARRACAO: ProvedorNarracao[] = ['gemini', 'google-tts'];

export type Pronuncia = {de: string; para: string};
export type NarracaoCena = {texto: string};
export type ConfigNarracao = {
  provedor?: ProvedorNarracao;
  modelo?: string; // só Gemini
  voz?: string; // Gemini: "Kore"; Cloud TTS: "pt-BR-Chirp3-HD-Kore" (o nome curto também vale)
  estilo?: string; // só Gemini: como falar, em linguagem natural ("calmo, didático, sem pressa")
  velocidade?: number; // só Cloud TTS (speakingRate): 0,25 a 2
  folga_ms?: number; // a fala entra quanto depois do começo da cena
  margem_ms?: number; // ajustar as cenas à fala: quanto sobra depois da fala
  pronuncias?: Pronuncia[];
};
/** O que o clipe de voz gerado guarda: a cena e o hash do pedido (texto já com as pronúncias + provedor + modelo + voz + parâmetros). */
export type MarcaNarracaoIA = {cena: string; hash: string};

export const NOMES_PROVEDOR: Record<ProvedorNarracao, string> = {gemini: 'Gemini TTS (Google AI Studio)', 'google-tts': 'Google Cloud TTS (Chirp 3: HD)'};

/** Modelos de voz do Gemini conferidos na doc em 10/11/2026 (aistudio.google.com/docs/speech-generation). */
export const MODELOS_GEMINI_TTS = [
  {id: 'gemini-3.8-flash-tts', nome: 'Gemini 3.8 Flash TTS'},
  {id: 'gemini-3.8-flash-lite-tts', nome: 'Gemini 3.8 Flash-Lite TTS (mais barato)'},
] as const;
export const MODELO_CHIRP = 'chirp3-hd';
export const IDIOMA_NARRACAO = 'pt-BR';

export type VozNarracao = {id: string; nome: string; descricao?: string; genero?: 'feminina' | 'masculina'; idioma?: string};

// as 30 vozes prontas, com o caráter que a doc do Gemini dá e o gênero da tabela do Chirp 3: HD (as mesmas 30 nos dois)
const VOZES_BASE: [string, string, 'feminina' | 'masculina'][] = [
  ['Achernar', 'suave', 'feminina'], ['Achird', 'amigável', 'masculina'], ['Algenib', 'rouca', 'masculina'], ['Algieba', 'macia', 'masculina'],
  ['Alnilam', 'firme', 'masculina'], ['Aoede', 'leve', 'feminina'], ['Autonoe', 'brilhante', 'feminina'], ['Callirrhoe', 'descontraída', 'feminina'],
  ['Charon', 'informativa', 'masculina'], ['Despina', 'macia', 'feminina'], ['Enceladus', 'sussurrada', 'masculina'], ['Erinome', 'nítida', 'feminina'],
  ['Fenrir', 'empolgada', 'masculina'], ['Gacrux', 'madura', 'feminina'], ['Iapetus', 'nítida', 'masculina'], ['Kore', 'firme', 'feminina'],
  ['Laomedeia', 'animada', 'feminina'], ['Leda', 'jovem', 'feminina'], ['Orus', 'firme', 'masculina'], ['Pulcherrima', 'direta', 'feminina'],
  ['Puck', 'animada', 'masculina'], ['Rasalgethi', 'informativa', 'masculina'], ['Sadachbia', 'viva', 'masculina'], ['Sadaltager', 'entendida', 'masculina'],
  ['Schedar', 'uniforme', 'masculina'], ['Sulafat', 'calorosa', 'feminina'], ['Umbriel', 'descontraída', 'masculina'], ['Vindemiatrix', 'gentil', 'feminina'],
  ['Zephyr', 'clara', 'feminina'], ['Zubenelgenubi', 'casual', 'masculina'],
];
export const VOZES_GEMINI: VozNarracao[] = VOZES_BASE.map(([n, d, g]) => ({id: n, nome: n, descricao: d, genero: g}));
export const PREFIXO_CHIRP = `${IDIOMA_NARRACAO}-Chirp3-HD-`;
export const VOZES_CHIRP: VozNarracao[] = VOZES_BASE.map(([n, , g]) => ({id: `${PREFIXO_CHIRP}${n}`, nome: n, genero: g, idioma: IDIOMA_NARRACAO}));

export const VOZ_PADRAO = 'Charon';
export const FOLGA_PADRAO_MS = 300;
export const MARGEM_PADRAO_MS = 500;
export const FOLGA_MAX_MS = 5000;
export const MARGEM_MAX_MS = 10000;
export const VELOCIDADE_MIN = 0.25;
export const VELOCIDADE_MAX = 2;
export const LIMITE_BYTES_CLOUD_TTS = 5000; // o campo de entrada do text:synthesize (referência REST da v1)
export const TOKENS_POR_SEGUNDO_AUDIO = 25; // o áudio do Gemini custa 25 tokens por segundo (página de preços)
export const PPM_ESTIMATIVA = 150; // a duração estimada antes de gerar: a mesma conta do teleprompter
export const FRASE_AMOSTRA = 'Olá! Esta é a voz que vai narrar o seu vídeo, no ritmo e no tom que você escolheu.';

/** A configuração com os padrões, pronta para usar. */
export type ConfigNarracaoN = {provedor: ProvedorNarracao; modelo: string; voz: string; estilo: string; velocidade: number; folga_ms: number; margem_ms: number;
  pronuncias: Pronuncia[]};

const num = (v: unknown, padrao: number) => (typeof v === 'number' && Number.isFinite(v) ? v : padrao);
const limitar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const ehObjeto = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x);

/** A voz no nome que o provedor espera: no Cloud TTS, "Kore" vira "pt-BR-Chirp3-HD-Kore". */
export const vozDoProvedor = (provedor: ProvedorNarracao, voz: string | undefined) => {
  const v = (voz ?? '').trim() || VOZ_PADRAO;
  if (provedor === 'google-tts') return v.includes('-') ? v : `${PREFIXO_CHIRP}${v}`;
  return v.startsWith(PREFIXO_CHIRP) ? v.slice(PREFIXO_CHIRP.length) : v; // a mesma estrela no Gemini
};

export const pronunciasValidas = (x: unknown): Pronuncia[] =>
  (Array.isArray(x) ? x : []).filter((p): p is Pronuncia => ehObjeto(p) && typeof p.de === 'string' && p.de.trim() !== '' && typeof p.para === 'string')
    .map((p) => ({de: p.de.trim(), para: p.para}));

/** A configuração do documento com os padrões (Gemini 3.8 Flash TTS, voz Charon, folga 300 ms, margem 500 ms). */
export const configDaNarracao = (x: unknown): ConfigNarracaoN => {
  const o = ehObjeto(x) ? x : {};
  const provedor: ProvedorNarracao = o.provedor === 'google-tts' ? 'google-tts' : 'gemini';
  const modelo = provedor === 'gemini' ? (typeof o.modelo === 'string' && o.modelo.trim() ? o.modelo.trim() : MODELOS_GEMINI_TTS[0].id) : MODELO_CHIRP;
  return {
    provedor,
    modelo,
    voz: vozDoProvedor(provedor, typeof o.voz === 'string' ? o.voz : undefined),
    estilo: typeof o.estilo === 'string' ? o.estilo.trim() : '',
    velocidade: Math.round(limitar(num(o.velocidade, 1), VELOCIDADE_MIN, VELOCIDADE_MAX) * 100) / 100,
    folga_ms: Math.round(limitar(num(o.folga_ms, FOLGA_PADRAO_MS), 0, FOLGA_MAX_MS)),
    margem_ms: Math.round(limitar(num(o.margem_ms, MARGEM_PADRAO_MS), 0, MARGEM_MAX_MS)),
    pronuncias: pronunciasValidas(o.pronuncias),
  };
};

const CAMPOS_CONFIG = new Set(['provedor', 'modelo', 'voz', 'estilo', 'velocidade', 'folga_ms', 'margem_ms', 'pronuncias']);
const CAMPOS_CENA = new Set(['texto']);

type DocComNarracao = {narracao?: unknown; cenas?: {id?: string; narracao?: unknown}[]; audio?: {faixas?: {clipes?: {id?: string; narracao_ia?: unknown}[]}[]}};

/** O que está fora do lugar na narração, em avisos para o resolvedor (src/nucleo/cenas.ts). Nada aqui impede o vídeo de tocar. */
export const problemasDaNarracao = (doc: DocComNarracao): string[] => {
  const avisos: string[] = [];
  const n = doc.narracao;
  if (n !== undefined) {
    if (!ehObjeto(n)) avisos.push('Narração: "narracao" na raiz é a configuração {provedor, modelo, voz, estilo, velocidade, folga_ms, margem_ms, pronuncias}; ficou com os padrões');
    else {
      for (const k of Object.keys(n)) if (!CAMPOS_CONFIG.has(k)) avisos.push(`Narração: campo desconhecido "${k}" na configuração (fica de fora)`);
      if (n.provedor !== undefined && !PROVEDORES_NARRACAO.includes(n.provedor as ProvedorNarracao)) avisos.push(`Narração: o provedor "${String(n.provedor)}" não existe (vale gemini ou google-tts); fica gemini`);
      if (n.modelo !== undefined && (typeof n.modelo !== 'string' || (n.provedor !== 'google-tts' && !MODELOS_GEMINI_TTS.some((m) => m.id === n.modelo)))) {
        avisos.push(`Narração: o modelo "${String(n.modelo)}" não está na lista conferida (${MODELOS_GEMINI_TTS.map((m) => m.id).join(', ')}); vai como está`);
      }
      if (n.voz !== undefined && typeof n.voz !== 'string') avisos.push('Narração: "voz" é o nome da voz (texto); fica a padrão');
      if (typeof n.voz === 'string' && n.provedor === 'google-tts' && n.voz.includes('-') && !n.voz.startsWith(PREFIXO_CHIRP)) {
        avisos.push(`Narração: a voz "${n.voz}" não é uma voz Chirp 3: HD em português (${PREFIXO_CHIRP}<Nome>)`);
      }
      if (n.estilo !== undefined && typeof n.estilo !== 'string') avisos.push('Narração: "estilo" é um texto (como falar); ficou de fora');
      const faixa = (k: string, min: number, max: number, unidade: string) => {
        const v = n[k];
        if (v === undefined) return;
        if (typeof v !== 'number' || !Number.isFinite(v)) avisos.push(`Narração: "${k}" é um número; fica o padrão`);
        else if (v < min || v > max) avisos.push(`Narração: "${k}" ${v} fora de ${min} a ${max}${unidade}; vai com ${limitar(v, min, max)}`);
      };
      faixa('velocidade', VELOCIDADE_MIN, VELOCIDADE_MAX, '');
      faixa('folga_ms', 0, FOLGA_MAX_MS, ' ms');
      faixa('margem_ms', 0, MARGEM_MAX_MS, ' ms');
      if (n.pronuncias !== undefined) {
        if (!Array.isArray(n.pronuncias)) avisos.push('Narração: "pronuncias" é uma lista de {de, para}; ficou de fora');
        else {
          const ruins = n.pronuncias.filter((p) => !(ehObjeto(p) && typeof p.de === 'string' && p.de.trim() && typeof p.para === 'string')).length;
          if (ruins) avisos.push(`Narração: ${ruins} ${ruins === 1 ? 'pronúncia sem' : 'pronúncias sem'} "de" e "para" (texto); ${ruins === 1 ? 'ficou' : 'ficaram'} de fora`);
        }
      }
    }
  }
  const provedor = configDaNarracao(n).provedor;
  const ids = new Set<string>();
  (Array.isArray(doc.cenas) ? doc.cenas : []).forEach((c, i) => {
    if (typeof c?.id === 'string') ids.add(c.id);
    const f = c?.narracao;
    if (f === undefined) return;
    if (!ehObjeto(f)) {
      avisos.push(`Narração: a narração da cena ${i + 1} é {texto}; ficou sem fala`);
      return;
    }
    for (const k of Object.keys(f)) if (!CAMPOS_CENA.has(k)) avisos.push(`Narração: campo desconhecido "${k}" na narração da cena ${i + 1} (fica de fora)`);
    if (f.texto !== undefined && typeof f.texto !== 'string') avisos.push(`Narração: o texto da narração da cena ${i + 1} não é texto; ficou sem fala`);
    if (provedor === 'google-tts' && typeof f.texto === 'string' && new TextEncoder().encode(f.texto).length > LIMITE_BYTES_CLOUD_TTS) {
      avisos.push(`Narração: a fala da cena ${i + 1} passa de ${LIMITE_BYTES_CLOUD_TTS} bytes, o limite do Google Cloud TTS por pedido; divida a cena`);
    }
  });
  for (const f of Array.isArray(doc.audio?.faixas) ? doc.audio!.faixas! : []) {
    for (const c of Array.isArray(f?.clipes) ? f.clipes : []) {
      const m = c?.narracao_ia;
      if (m === undefined) continue;
      if (!ehObjeto(m) || typeof m.cena !== 'string' || typeof m.hash !== 'string') avisos.push(`Narração: o clipe ${String(c.id)} tem "narracao_ia" sem {cena, hash}`);
      else if (!ids.has(m.cena)) avisos.push(`Narração: o clipe ${String(c.id)} é a fala da cena "${m.cena}", que não existe mais`);
    }
  }
  return avisos;
};

// ---------- texto: pronúncias e pausas ----------

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LETRA = /[\p{L}\p{N}]/u;

/** Troca as palavras do dicionário, palavra inteira, numa passada só (o que já foi trocado não é trocado de novo; a mais longa
 *  ganha). Com maiúscula no "de" (sigla: "RH", "PIN"), só casa a mesma caixa; todo em minúsculas, casa qualquer caixa. */
export const aplicarPronuncias = (texto: string, lista: Pronuncia[]): {texto: string; trocas: {de: string; para: string; vezes: number}[]} => {
  const validas = pronunciasValidas(lista).sort((a, b) => b.de.length - a.de.length);
  if (!validas.length || !texto) return {texto, trocas: []};
  const padrao = (de: string) => `${LETRA.test(de[0]) ? '(?<![\\p{L}\\p{N}])' : ''}${escapar(de)}${LETRA.test(de[de.length - 1]) ? '(?![\\p{L}\\p{N}])' : ''}`;
  const re = new RegExp(validas.map((p) => padrao(p.de)).join('|'), 'giu');
  const vezes = new Map<string, number>();
  const novo = texto.replace(re, (achado) => {
    const p = validas.find((x) => (x.de === x.de.toLowerCase() ? x.de.toLowerCase() === achado.toLowerCase() : x.de === achado));
    if (!p) return achado;
    vezes.set(p.de, (vezes.get(p.de) ?? 0) + 1);
    return p.para;
  });
  return {texto: novo, trocas: validas.filter((p) => vezes.has(p.de)).map((p) => ({de: p.de, para: p.para, vezes: vezes.get(p.de)!}))};
};

// pausas neutras no roteiro ([pausa], [pausa curta], [pausa longa]) e as de cada provedor, trocadas para o provedor da vez
const PAUSA_NEUTRA = /\[\s*pausa(?:\s+(curta|longa))?\s*\]/giu;
const PAUSA_CHIRP = /\[\s*pause(?:\s+(short|long))?\s*\]/giu;
const PAUSA_GEMINI = /<\s*(short|long)\s+pause\s*>/giu;
const TAG_GEMINI = /<\s*[a-z][a-z ]{0,30}>/giu; // <laugh>, <sigh>…: o Cloud TTS leria em voz alta

/** O texto como vai ao provedor: espaços normalizados, pronúncias aplicadas e as pausas no formato dele. */
export const textoFalado = (texto: string, c: Pick<ConfigNarracaoN, 'provedor' | 'pronuncias'>): string => {
  const limpo = String(texto ?? '').replace(/\r\n?/g, '\n').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const t = aplicarPronuncias(limpo, c.pronuncias).texto;
  if (c.provedor === 'gemini') {
    return t.replace(PAUSA_NEUTRA, (_m, tipo?: string) => (tipo?.toLowerCase() === 'longa' ? '<long pause>' : '<short pause>'))
      .replace(PAUSA_CHIRP, (_m, tipo?: string) => (tipo?.toLowerCase() === 'long' ? '<long pause>' : '<short pause>'));
  }
  return t.replace(PAUSA_NEUTRA, (_m, tipo?: string) => (tipo?.toLowerCase() === 'longa' ? '[pause long]' : '[pause short]'))
    .replace(PAUSA_GEMINI, (_m, tipo: string) => `[pause ${tipo.toLowerCase()}]`)
    .replace(TAG_GEMINI, '').replace(/ {2,}/g, ' ').trim();
};

/** O texto sem as marcas de pausa nem as tags, para contar palavras e estimar o tempo. */
export const textoSemMarcas = (t: string) => t.replace(PAUSA_CHIRP, ' ').replace(TAG_GEMINI, ' ').replace(/\s+/g, ' ').trim();

// ---------- cache ----------

/** O hash do pedido: texto já com as pronúncias + provedor + modelo + voz + os parâmetros que mudam o som. Muda o estilo no
 *  Gemini, ou a velocidade no Cloud TTS, e a cena fica desatualizada; mudar o que o provedor não usa não mexe em nada. */
export const hashDaFala = (texto_final: string, c: Pick<ConfigNarracaoN, 'provedor' | 'modelo' | 'voz' | 'estilo' | 'velocidade'>) => {
  const partes = c.provedor === 'gemini'
    ? ['narracao-1', 'gemini', c.modelo, c.voz, c.estilo, texto_final]
    : ['narracao-1', 'google-tts', MODELO_CHIRP, c.voz, String(c.velocidade), texto_final];
  return sha256Texto(JSON.stringify(partes)).slice(0, 20);
};

export const PASTA_NARRACAO = 'midia/narracao';
export const arquivoDaNarracao = (hash: string) => `${PASTA_NARRACAO}/${hash}.wav`;
export const ehArquivoDeNarracao = (rel: string) => /^midia\/narracao\/[0-9a-f]{20}\.wav$/.test(rel);

// ---------- medida e custo estimado ----------

/** O que o pedido mede antes de gerar: caracteres (o Cloud TTS cobra por eles), bytes (o limite dele), tokens de texto e de
 *  áudio estimados (o Gemini cobra por eles: 25 por segundo de áudio) e a duração estimada pela conta do teleprompter. */
export type MedidaFala = {caracteres: number; bytes: number; palavras: number; segundos: number; tokens_entrada: number; tokens_saida: number};

export const medirFala = (texto_final: string, c: Pick<ConfigNarracaoN, 'provedor' | 'velocidade' | 'estilo'>): MedidaFala => {
  const limpo = textoSemMarcas(texto_final);
  const ritmo = c.provedor === 'google-tts' ? c.velocidade : 1;
  const segundos = Math.round((duracaoDoTeleprompter(limpo, PPM_ESTIMATIVA) / 1000 / ritmo) * 10) / 10;
  const caracteres = [...texto_final].length;
  const estilo = c.provedor === 'gemini' ? [...c.estilo].length : 0;
  return {caracteres, bytes: new TextEncoder().encode(texto_final).length, palavras: limpo ? limpo.split(' ').length : 0, segundos,
    tokens_entrada: Math.ceil((caracteres + estilo) / 4), tokens_saida: Math.ceil(segundos * TOKENS_POR_SEGUNDO_AUDIO)};
};

/** O custo estimado de um pedido, pela tabela de preços do app (src/main/ia/precos.ts), com a data dela. */
export type CustoNarracao = {usd: number; tabela: string; fonte: string; nota?: string};

// ---------- erros em pt-BR ----------

export type TipoErroNarracao = 'sem_chave' | 'chave' | 'desativada' | 'cota' | 'voz' | 'modelo' | 'texto' | 'rede' | 'servico' | 'sem_audio' | 'cancelado';
export class ErroNarracao extends Error {
  constructor(message: string, readonly tipo: TipoErroNarracao, readonly status?: number) {
    super(message);
  }
}

const NOME_API: Record<ProvedorNarracao, string> = {gemini: 'Generative Language API (Gemini)', 'google-tts': 'Cloud Text-to-Speech API'};
const LINK_API: Record<ProvedorNarracao, string> = {gemini: 'console.cloud.google.com/apis/library/generativelanguage.googleapis.com',
  'google-tts': 'console.cloud.google.com/apis/library/texttospeech.googleapis.com'};
const NOME_CHAVE: Record<ProvedorNarracao, string> = {gemini: 'a chave do Gemini', 'google-tts': 'a chave do Google Cloud TTS'};

/** O erro do Google (o corpo `{error: {code, message, status, details}}`) em pt-BR claro, sem a chave no texto. */
export const erroDoGoogle = (status: number, corpo: string, o: {provedor: ProvedorNarracao; voz?: string; modelo?: string; chave?: string}): ErroNarracao => {
  let msg = corpo.slice(0, 300);
  let razao = '';
  let estado = '';
  try {
    const j = JSON.parse(corpo) as {error?: {message?: string; status?: string; details?: {reason?: string}[]}};
    msg = String(j.error?.message ?? msg).slice(0, 300);
    estado = String(j.error?.status ?? '');
    razao = (j.error?.details ?? []).map((d) => d?.reason ?? '').filter(Boolean).join(',');
  } catch {
    /* texto puro */
  }
  if (o.chave) msg = msg.replaceAll(o.chave, '…');
  const quem = NOME_CHAVE[o.provedor];
  if (/API_KEY_INVALID|API key not valid|API key expired/i.test(`${razao} ${msg}`) || status === 401) {
    return new ErroNarracao(`${quem} foi recusada pelo Google (${status}): confira em Configurações › IA. ${msg}`.trim(), 'chave', status);
  }
  if (status === 403 && /SERVICE_DISABLED|has not been used|is disabled|not been enabled/i.test(`${razao} ${msg}`)) {
    return new ErroNarracao(`a ${NOME_API[o.provedor]} não está ativada no projeto do Google Cloud desta chave: ative em ${LINK_API[o.provedor]} e tente de novo (403)`, 'desativada', status);
  }
  if (status === 403) return new ErroNarracao(`${quem} não tem permissão para a ${NOME_API[o.provedor]} (403): ${msg}`, 'chave', status);
  if (status === 429 || estado === 'RESOURCE_EXHAUSTED') {
    return new ErroNarracao(`cota ou limite de uso do Google atingido (429): espere um pouco, ou confira a cota e o faturamento do projeto. ${msg}`.trim(), 'cota', status);
  }
  if (status === 404) {
    return o.provedor === 'gemini' ? new ErroNarracao(`o modelo "${o.modelo ?? '?'}" não foi achado no Gemini (404): confira o nome. ${msg}`.trim(), 'modelo', status)
      : new ErroNarracao(`endereço não achado no Google Cloud TTS (404): ${msg}`, 'servico', status);
  }
  if (status === 400 && /voice|voz|speaker/i.test(msg)) {
    return new ErroNarracao(`a voz "${o.voz ?? '?'}" não existe ${o.provedor === 'google-tts' ? 'no Google Cloud TTS em português' : 'no Gemini'}: escolha outra na lista de vozes (400). ${msg}`.trim(), 'voz', status);
  }
  if (status === 400) return new ErroNarracao(`o Google recusou o pedido (400): ${msg}`, 'texto', status);
  if (status >= 500) return new ErroNarracao(`o serviço do Google respondeu ${status}; tente de novo em instantes. ${msg}`.trim(), 'servico', status);
  return new ErroNarracao(`o Google respondeu ${status}: ${msg}`, 'servico', status);
};

/** Falha de rede (sem internet, DNS, tempo esgotado) em pt-BR, sem a chave. */
export const erroDeRede = (e: unknown, o: {provedor: ProvedorNarracao; chave?: string; sinal?: AbortSignal}): ErroNarracao => {
  if (o.sinal?.aborted) return new ErroNarracao('cancelado', 'cancelado');
  let m = String((e as Error)?.message ?? e);
  const causa = (e as {cause?: {message?: string}})?.cause?.message;
  if (causa) m += ` (${causa})`;
  if (o.chave) m = m.replaceAll(o.chave, '…');
  return new ErroNarracao(`não deu para falar com o ${o.provedor === 'gemini' ? 'Gemini' : 'Google Cloud TTS'} agora (sem internet?): ${m}`, 'rede');
};

// ---------- áudio: base64, PCM 16 bits e WAV ----------

/** Bytes de um texto em base64 (a resposta JSON dos dois provedores). */
export const bytesDeBase64 = (b64: string): Uint8Array => {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const tag = (v: DataView, pos: number, t: string) => {
  for (let i = 0; i < 4; i++) v.setUint8(pos + i, t.charCodeAt(i));
};

/** WAV PCM 16 bits em volta de amostras cruas (little-endian), sem copiar o som para outro formato. */
export const wavDePcm16 = (pcm: Uint8Array, taxa: number, canais = 1): Uint8Array => {
  const dados = pcm.byteLength - (pcm.byteLength % (2 * canais));
  const out = new Uint8Array(44 + dados);
  const v = new DataView(out.buffer);
  tag(v, 0, 'RIFF');
  v.setUint32(4, 36 + dados, true);
  tag(v, 8, 'WAVE');
  tag(v, 12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, canais, true);
  v.setUint32(24, taxa, true);
  v.setUint32(28, taxa * canais * 2, true);
  v.setUint16(32, canais * 2, true);
  v.setUint16(34, 16, true);
  tag(v, 36, 'data');
  v.setUint32(40, dados, true);
  out.set(pcm.subarray(0, dados), 44);
  return out;
};

export type SomPcm16 = {taxa: number; canais: number; inicio: number; bytes: number};

/** Onde estão as amostras de um WAV PCM 16 bits; null se não for um. O tamanho do bloco `data` pode vir 0 ou 0xFFFFFFFF
 *  (gravado em fluxo): aí vale até o fim do arquivo. */
export const lerWav16 = (b: Uint8Array): SomPcm16 | null => {
  if (b.length < 44) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const id = (pos: number) => String.fromCharCode(b[pos], b[pos + 1], b[pos + 2], b[pos + 3]);
  if (id(0) !== 'RIFF' || id(8) !== 'WAVE') return null;
  let fmt: {formato: number; canais: number; taxa: number; bits: number} | null = null;
  for (let pos = 12; pos + 8 <= b.length;) {
    const nome = id(pos);
    const tam = v.getUint32(pos + 4, true);
    if (nome === 'fmt ' && pos + 24 <= b.length) fmt = {formato: v.getUint16(pos + 8, true), canais: v.getUint16(pos + 10, true), taxa: v.getUint32(pos + 12, true), bits: v.getUint16(pos + 22, true)};
    if (nome === 'data') {
      if (!fmt || fmt.formato !== 1 || fmt.bits !== 16 || fmt.canais < 1) return null;
      const resto = b.length - (pos + 8);
      const util = tam === 0 || tam > resto ? resto : tam;
      return {taxa: fmt.taxa, canais: fmt.canais, inicio: pos + 8, bytes: util - (util % (2 * fmt.canais))};
    }
    pos += 8 + tam + (tam % 2);
  }
  return null;
};

/** O que veio do provedor, como WAV PCM 16 bits: o WAV com cabeçalho (Gemini 3.8 e Cloud TTS LINEAR16) fica como está; o PCM
 *  cru (audio/L16, o padrão dos modelos anteriores do Gemini) ganha o cabeçalho, com a taxa do mimeType (padrão 24 kHz). */
export const wavDaResposta = (bytes: Uint8Array, mime?: string): {wav: Uint8Array; taxa: number; canais: number; duracao_ms: number} => {
  const w = lerWav16(bytes);
  if (w) return {wav: bytes, taxa: w.taxa, canais: w.canais, duracao_ms: Math.round((w.bytes / (2 * w.canais) / w.taxa) * 1000)};
  if (/wav/i.test(mime ?? '') || (bytes.length >= 4 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF')) {
    throw new ErroNarracao('o provedor mandou um WAV que não é PCM de 16 bits', 'sem_audio');
  }
  const taxa = Number(/rate=(\d+)/i.exec(mime ?? '')?.[1]) || 24000;
  const canais = Number(/channels=(\d+)/i.exec(mime ?? '')?.[1]) || 1;
  const wav = wavDePcm16(bytes, taxa, canais);
  const r = lerWav16(wav)!;
  return {wav, taxa, canais, duracao_ms: Math.round((r.bytes / (2 * canais) / taxa) * 1000)};
};

/** As amostras de um WAV 16 bits em ponto flutuante, por canal (para o envelope de loudness, audio.ts). */
export const amostrasDoWav16 = (wav: Uint8Array): {canais: Float32Array[]; taxa: number} | null => {
  const w = lerWav16(wav);
  if (!w) return null;
  const n = w.bytes / (2 * w.canais);
  const v = new DataView(wav.buffer, wav.byteOffset + w.inicio, w.bytes);
  const canais = Array.from({length: w.canais}, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < w.canais; c++) canais[c][i] = v.getInt16((i * w.canais + c) * 2, true) / 32768;
  return {canais, taxa: w.taxa};
};
