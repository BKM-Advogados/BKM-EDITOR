// Pesquisa do projeto: fontes baixadas e fatos tirados delas, para ver ao lado do vídeo. É só um VISUALIZADOR (decisão
// do responsável, 06/11/2026): fato é fato, não existe aprovar nem reprovar, nada bloqueia e nada da fonte é censurado,
// apagado ou anonimizado. O que este arquivo faz é medir: o trecho citado existe no texto baixado (exato, parecido ou
// não), os números da afirmação aparecem no trecho, e quais marcas de vigência a fonte traz. Fica tudo em
// pesquisa/pesquisa.json; o texto limpo de cada fonte em pesquisa/fontes/<id>.txt (fora do git).
// Funções puras; só hashTexto usa node:crypto, então a interface importa daqui apenas os tipos (import type).
import {createHash} from 'node:crypto';
import {CATALOGO_FONTES, type FonteCatalogo} from './catalogo-fontes';

export type NivelFonte = 1 | 2 | 0; // 0 = fora do catálogo

/** O que a url devolveu: página HTML, texto puro ou PDF (o texto vem da camada de texto, src/nucleo/pdf-texto.ts). */
export type TipoFonte = 'html' | 'texto' | 'pdf';

export type Fonte = {
  id: string; // f1, f2… (os mesmos do dossiê do skill pesquisa-juridica)
  url: string;
  url_final?: string; // depois dos redirecionamentos
  titulo?: string;
  orgao?: string;
  nivel: NivelFonte;
  catalogo?: string; // id em CATALOGO_FONTES
  acessado_em: string; // ISO
  http?: number;
  bytes?: number;
  tipo?: TipoFonte; // o que veio da url (sem o campo: fonte lida antes de 12/11/2026, HTML ou texto)
  paginas_pdf?: number; // só no PDF: quantas páginas o arquivo tem
  sha256: string; // do texto limpo normalizado (hashTexto)
  arquivo: string; // pesquisa/fontes/<id>.txt
  sinais_vigencia: string[];
  observacao?: string; // a "observação de quem baixou": texto livre, só cresce
  autor: string;
};

export type Achado = 'exato' | 'parecido' | 'nao';

export type Fato = {
  id: string; // F1, F2…
  afirmacao: string;
  fonte_id: string;
  localizador?: string; // "CLT, art. 477, § 6º"
  trecho: string; // literal, como veio de quem registrou
  inicio?: number; // índices no texto da fonte como gravado no arquivo
  fim?: number;
  achado: Achado;
  digitos: {afirmacao: string[]; faltando: string[]};
  vigencia: string[]; // sinais no entorno do trecho
  estado: 'trecho_confere' | 'a_revisar'; // trecho exato e números conferidos; não prova que sustenta a afirmação
  nota?: string;
  criado_em: string;
  autor: string;
};

export type Pesquisa = {formato: 1; fontes: Fonte[]; fatos: Fato[]};

export const ARQUIVO_PESQUISA = 'pesquisa/pesquisa.json';
export const PASTA_FONTES = 'pesquisa/fontes';
export const TAMANHO_PAGINA = 6000; // caracteres por página de texto_da_fonte
export const RAIO_VIGENCIA = 600; // caracteres antes e depois do trecho onde se procuram sinais de vigência

export const pesquisaVazia = (): Pesquisa => ({formato: 1, fontes: [], fatos: []});

/** Lê o JSON gravado sem confiar no formato: o que não for lista vira lista vazia. */
export const lerPesquisa = (json: unknown): Pesquisa => {
  const o = (json && typeof json === 'object' ? json : {}) as {fontes?: unknown; fatos?: unknown};
  const objetos = <T>(x: unknown): T[] => (Array.isArray(x) ? x.filter((i) => i && typeof i === 'object') : []) as T[];
  return {formato: 1, fontes: objetos<Fonte>(o.fontes), fatos: objetos<Fato>(o.fatos)};
};

export const caminhoTextoFonte = (fonteId: string): string => `${PASTA_FONTES}/${fonteId}.txt`;

/** Próximo id livre: f1, f2… para fontes e F1, F2… para fatos. */
export const proximoId = (p: Pesquisa, tipo: 'fonte' | 'fato'): string => {
  const prefixo = tipo === 'fonte' ? 'f' : 'F';
  const lista: {id: string}[] = tipo === 'fonte' ? p.fontes : p.fatos;
  let maior = 0;
  for (const {id} of lista) {
    const m = new RegExp(`^${prefixo}(\\d+)$`).exec(id);
    if (m) maior = Math.max(maior, Number(m[1]));
  }
  return `${prefixo}${maior + 1}`;
};

/** 'trecho_confere' só quando o trecho existe tal e qual e todos os números da afirmação estão nele; senão 'a_revisar'.
 * Trecho confere = trecho exato e números conferidos; não quer dizer que o trecho sustenta a afirmação (isso fica para
 * quem lê e, na fase 3, para o juiz). */
export const estadoDoFato = (achado: Achado, faltando: string[]): Fato['estado'] =>
  achado === 'exato' && faltando.length === 0 ? 'trecho_confere' : 'a_revisar';

// ---------- normalização com mapa de índices ----------

// Texto normalizado e, para cada unidade dele, de onde veio no original (início e fim): é assim que um trecho achado
// no texto normalizado volta a apontar para o arquivo gravado.
type Indexado = {s: string; ini: number[]; fim: number[]};

const ESPACOS = /[\t\v\f\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/;
const INVISIVEIS = /[\r\u200b-\u200d\u2060\ufeff]/;
const ASPAS_DUPLAS = /[\u201c-\u201f\u2033]/;
const ASPAS_SIMPLES = /[\u2018-\u201b\u2032]/;
const MARCA = /\p{M}/u;

/** O que um caractere (já em NFC) vira: '' some, ' ' é espaço, aspas tipográficas viram retas; o resto fica. */
const trocarCaractere = (c: string): string => {
  if (INVISIVEIS.test(c)) return '';
  if (ESPACOS.test(c)) return ' ';
  if (ASPAS_DUPLAS.test(c)) return '"';
  if (ASPAS_SIMPLES.test(c)) return "'";
  return c;
};

// Percorre o texto por grupos (caractere base mais as marcas que o seguem: o NFC de um grupo não mistura índices de
// grupos vizinhos). O ASCII sem marca, que é quase todo o texto de uma lei, passa direto, sem NFC nem expressão
// regular: na CLT inteira (657 mil caracteres) isso é a diferença entre um terço de segundo e alguns centésimos.
// Sem `comIndices`, só monta o texto (o hashTexto não precisa do mapa).
const indexarExato = (texto: string, comIndices = true): Indexado => {
  const s: string[] = [];
  const ini: number[] = [];
  const fim: number[] = [];
  const tirarEspacoDoFim = (tambemQuebra = false) => {
    while (s.length && (s[s.length - 1] === ' ' || (tambemQuebra && s[s.length - 1] === '\n'))) {
      s.pop();
      if (comIndices) { ini.pop(); fim.pop(); }
    }
  };
  const por = (c: string, i: number, f: number) => {
    if (!c) return; // invisível (retorno de carro, espaço de largura zero): some
    if (c === ' ') {
      const antes = s[s.length - 1];
      if (antes === undefined || antes === ' ' || antes === '\n') return; // espaços repetidos viram um; nada no começo da linha
    } else if (c === '\n') {
      if (s.length === 0) return; // nem quebra no começo do texto
      tirarEspacoDoFim(); // nem espaço no fim da linha
    }
    s.push(c);
    if (comIndices) { ini.push(i); fim.push(f); }
  };
  const n = texto.length;
  let i = 0;
  while (i < n) {
    const cod = texto.charCodeAt(i);
    let j = i + (cod >= 0xd800 && cod <= 0xdbff && i + 1 < n ? 2 : 1);
    // marcas que seguem o caractere (nenhuma marca combinante vem antes de U+0300)
    while (j < n && texto.charCodeAt(j) >= 0x300) {
      const cp = String.fromCodePoint(texto.codePointAt(j)!);
      if (!MARCA.test(cp)) break;
      j += cp.length;
    }
    if (j === i + 1 && cod < 0x80) {
      por(cod === 0x0d ? '' : cod === 0x09 || cod === 0x0b || cod === 0x0c ? ' ' : texto[i], i, j);
    } else {
      for (const cp of texto.slice(i, j).normalize('NFC')) {
        for (const u of trocarCaractere(cp).split('')) por(u, i, j);
      }
    }
    i = j;
  }
  tirarEspacoDoFim(true);
  return {s: s.join(''), ini, fim};
};

// Comparação solta: sem caixa, sem acento, pontuação e quebras de linha viram um espaço só. Parte do texto já
// indexado (o acharTrecho não indexa o texto da fonte duas vezes); o ASCII também passa direto aqui.
const indexarSolto = (base: Indexado): Indexado => {
  const s: string[] = [];
  const ini: number[] = [];
  const fim: number[] = [];
  const por = (u: string, letra: boolean, k: number) => {
    if (!letra && (s.length === 0 || s[s.length - 1] === ' ')) return;
    s.push(letra ? u : ' ');
    ini.push(base.ini[k]);
    fim.push(base.fim[k]);
  };
  for (let k = 0; k < base.s.length; k++) {
    const cod = base.s.charCodeAt(k);
    if (cod < 0x80) {
      const minuscula = cod >= 0x41 && cod <= 0x5a ? cod + 32 : cod;
      por(String.fromCharCode(minuscula), (minuscula >= 0x61 && minuscula <= 0x7a) || (cod >= 0x30 && cod <= 0x39), k);
      continue;
    }
    const c = base.s[k].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace('º', 'o').replace('ª', 'a');
    for (const u of c.split('')) por(u, /[\p{L}\p{N}]/u.test(u), k);
  }
  while (s.length && s[s.length - 1] === ' ') { s.pop(); ini.pop(); fim.pop(); }
  return {s: s.join(''), ini, fim};
};

/** NFC, U+00A0 e outros espaços viram espaço, espaços repetidos viram um (e somem nas pontas das linhas), aspas
 * tipográficas viram retas. As quebras de linha ficam, menos as das pontas do texto. */
export const normalizar = (s: string): string => indexarExato(s, false).s;

const semAcento = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '');

// Na comparação, quebra de linha vale espaço, e quebras seguidas (a linha em branco entre parágrafos, comum em texto puro
// e PDF) valem um espaço só: um trecho de dois parágrafos copiado com espaço no lugar das quebras (como fazem a pessoa e o
// modelo) continua exato. Vale dos dois lados, texto e trecho; o mapa de índices acompanha.
const quebraComoEspaco = (x: Indexado): Indexado => {
  const s: string[] = [];
  const ini: number[] = [];
  const fim: number[] = [];
  for (let k = 0; k < x.s.length; k++) {
    const c = x.s[k] === '\n' ? ' ' : x.s[k];
    if (c === ' ' && s[s.length - 1] === ' ') continue;
    s.push(c);
    ini.push(x.ini[k]);
    fim.push(x.fim[k]);
  }
  return {s: s.join(''), ini, fim};
};

/** Onde o trecho está no texto: 'exato' depois de normalizar os dois (quebra de linha vale espaço); 'parecido'
 * ignorando caixa, acentos e pontuação; senão 'nao'. inicio e fim são índices no texto como gravado no arquivo. */
export const acharTrecho = (texto: string, trecho: string): {achado: Achado; inicio?: number; fim?: number} => {
  const tx = indexarExato(trecho);
  if (!tx.s) return {achado: 'nao'};
  const ix = indexarExato(texto);
  const ex = quebraComoEspaco(ix);
  const et = quebraComoEspaco(tx).s;
  const p = ex.s.indexOf(et);
  if (p >= 0) return {achado: 'exato', inicio: ex.ini[p], fim: ex.fim[p + et.length - 1]};
  const ts = indexarSolto(tx).s;
  if (!ts) return {achado: 'nao'};
  const sx = indexarSolto(ix);
  const q = sx.s.indexOf(ts);
  return q >= 0 ? {achado: 'parecido', inicio: sx.ini[q], fim: sx.fim[q + ts.length - 1]} : {achado: 'nao'};
};

/** Recorte do texto em volta de [inicio, fim), com `raio` caracteres de cada lado. */
export const entorno = (texto: string, inicio: number, fim: number, raio = RAIO_VIGENCIA): string =>
  texto.slice(Math.max(0, inicio - raio), Math.min(texto.length, fim + raio));

/** Página `pagina` (começa em 1) do texto, em fatias de TAMANHO_PAGINA caracteres. */
export const paginar = (texto: string, pagina = 1): {texto: string; pagina: number; paginas: number} => {
  const paginas = Math.max(1, Math.ceil(texto.length / TAMANHO_PAGINA));
  const p = Math.min(Math.max(1, Math.floor(pagina)), paginas);
  return {texto: texto.slice((p - 1) * TAMANHO_PAGINA, p * TAMANHO_PAGINA), pagina: p, paginas};
};

// ---------- números ----------

const EXTENSO: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezasseis: 16, dezessete: 17,
  dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70,
  oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300,
  quatrocentos: 400, quatrocentas: 400, quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600,
  setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900, mil: 1000,
};

// Ordinais por extenso, no masculino e no feminino; em sequência somam ("décimo terceiro" = 13, "vigésimo primeiro" = 21).
const ORDINAL: Record<string, number> = Object.fromEntries(
  ([['primeir', 1], ['segund', 2], ['terceir', 3], ['quart', 4], ['quint', 5], ['sext', 6], ['setim', 7], ['oitav', 8],
    ['non', 9], ['decim', 10], ['vigesim', 20], ['trigesim', 30]] as const).flatMap(([raiz, n]) => [[`${raiz}o`, n], [`${raiz}a`, n]]),
);

// Adjetivos de prazo: "prescrição quinquenal" é de 5 anos, "anual" é de 1. Mensal, semanal e diário dizem a frequência,
// não um número, e ficam de fora.
const ADJETIVO_DE_PRAZO: Record<string, number> = {
  anual: 1, anuais: 1, bienal: 2, bienais: 2, trienal: 3, trienais: 3, quadrienal: 4, quadrienais: 4,
  quinquenal: 5, quinquenais: 5, decenal: 10, decenais: 10,
};

// "um"/"uma" antes destas palavras é o número 1 ("um ano", "uma vez", "um salário", "um terço"); antes do resto, artigo.
const UNIDADE_DO_UM = new Set(['ano', 'anos', 'mes', 'meses', 'dia', 'dias', 'hora', 'horas', 'semana', 'salario', 'parcela', 'vez', 'terco', 'metade', 'dobro']);

// Ordinal só é quantidade antes de unidade de tempo ("7º dia", "vigésimo dia", "quinto dia útil"). No resto é nome
// ("13º salário", "o décimo terceiro", "1º grau", "segunda vez") ou nem é número ("segundo o art. 7º").
const UNIDADE_DE_TEMPO = new Set(['dia', 'dias', 'mes', 'meses', 'ano', 'anos', 'hora', 'horas', 'semana', 'semanas', 'minuto', 'minutos']);

const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Multiplicadores depois de algarismo: "5 mil" é 5000, "1,5 milhão" é 1500000.
const MULTIPLICADOR: Record<string, number> = {mil: 1e3, milhao: 1e6, milhoes: 1e6, bilhao: 1e9, bilhoes: 1e9};

// Palavras que fazem do número seguinte um identificador de norma ou de dispositivo ("art. 477", "§ 6º", "Súmula 51",
// "Lei nº 13.467", "Emenda 141", "MP 1.045", "SUM-429", "OJ 394 da SBDI-1", "Tema 152"), e não um número da afirmação.
const IDENTIFICADOR = new Set([
  'art', 'arts', 'artigo', 'artigos', '§', '§§', 'paragrafo', 'paragrafos', 'inciso', 'incisos', 'alinea', 'alineas',
  'lei', 'leis', 'lc', 'decreto', 'decretos', 'emenda', 'emendas', 'ec', 'mp', 'pec', 'pl', 'resolucao', 'res', 'portaria', 'nr',
  'sumula', 'sumulas', 'sum', 'oj', 'tema', 'temas', 'precedente', 'sdi', 'sbdi',
  // a segunda palavra dos nomes compostos: "Emenda Constitucional 141", "Medida Provisória 1.045", "Lei Complementar 150",
  // "Orientação Jurisprudencial 394", "Precedente Normativo 119", "Súmula Vinculante 13"
  'constitucional', 'provisoria', 'complementar', 'jurisprudencial', 'normativo', 'normativa', 'vinculante',
]);
// O que pode vir entre a palavra e o número: o "nº" (lido como "n" e "º"), o "no" do Planalto ("Lei no 8.036"), "número".
const ENTRE_IDENTIFICADOR_E_NUMERO = new Set(['n', 'no', 'numero', 'º', '°', 'ª']);

// "13.467" → "13467", "1.500,00" → "1500", "05" → "5"; decimais ficam como estão ("3,4").
const algarismo = (t: string): string => {
  let n = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? t.replace(/\./g, '') : t;
  n = n.replace(/,0+$/, '');
  return /^\d+$/.test(n) ? n.replace(/^0+(?=\d)/, '') : n;
};

const doisDigitos = (n: number) => String(n).padStart(2, '0');
/** "dd/mm/aaaa", ou undefined se dia ou mês não existem. */
const dataNormal = (dia: number, mes: number, ano: string): string | undefined =>
  dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 ? `${doisDigitos(dia)}/${doisDigitos(mes)}/${ano}` : undefined;
// mesmo separador nos dois lugares; ano de dois dígitos só com barra ("11/11/17"), porque "1.10.20" pode ser outra coisa
const DATA = /^(\d{1,2})([./-])(\d{1,2})\2(\d{4}|\d{2})$/;
const EH_DATA = /^\d{2}\/\d{2}\/(\d{4}|\d{2})$/;

type Token = {t: string; num?: boolean; ordinal?: boolean; data?: boolean};

/** Palavras, números, datas e sinais do texto, sem acento e em minúsculas. O número leva junto o sufixo de ordinal
 * colado ("13º", "1o", "2ª", "1.º"); a data é um token só, em dd/mm/aaaa ("11.11.2017", "11/11/2017" e "11 de
 * novembro de 2017" dão "11/11/2017"); "13.467/2017" vira "13467", "/", "2017". */
const tokens = (texto: string): Token[] => {
  const saida: Token[] = [];
  const base = semAcento(texto).toLowerCase();
  const re = /(\d+(?:[.,/-]\d+)*)([º°ª]|[oa](?![a-z]))?|[a-z]+|%|§+|\(|\)|[º°ª]/g;
  for (let m = re.exec(base); m; m = re.exec(base)) {
    const [todo, numeros, sufixo] = m;
    if (numeros === undefined) {
      const ultimo = saida[saida.length - 1];
      if (/^[º°ª]$/.test(todo) && ultimo?.num && !ultimo.data) ultimo.ordinal = true; // "1.º"
      else saida.push({t: todo});
      continue;
    }
    const d = DATA.exec(numeros);
    const data = d && (d[4].length === 4 || d[2] === '/') ? dataNormal(Number(d[1]), Number(d[3]), d[4]) : undefined;
    if (data) {
      saida.push({t: data, num: true, data: true});
      continue;
    }
    for (const p of numeros.split(/([/-])/)) {
      if (p === '/') saida.push({t: '/'});
      else if (p && p !== '-') saida.push({t: algarismo(p), num: true}); // o hífen entre números só separa
    }
    if (sufixo) saida[saida.length - 1].ordinal = true;
  }
  // "24 de julho de 1991" e "1º de maio de 1943" viram uma data só
  for (let k = 0; k + 4 < saida.length; k++) {
    const [dia, de, mes, de2, ano] = saida.slice(k, k + 5);
    if (!dia.num || dia.data || de.t !== 'de' || de2.t !== 'de' || !ano.num || !/^\d{4}$/.test(ano.t)) continue;
    const data = dataNormal(Number(dia.t), MESES.indexOf(mes.t) + 1, ano.t);
    if (data) saida.splice(k, 5, {t: data, num: true, data: true});
  }
  return saida;
};

// valor: quantidade que a afirmação diz; identificador: aponta norma ou dispositivo ("art. 477", "Emenda 141, de 2026");
// nome: ordinal com símbolo que não é quantidade ("13º salário", "1º grau")
type Numero = {valor: string; tipo: 'valor' | 'identificador' | 'nome'};

const lerNumeros = (texto: string): Numero[] => {
  const tk = tokens(texto);
  const t = (k: number): string => tk[k]?.t ?? '';
  const palavra = (k: number): string => (tk[k] && !tk[k].num ? tk[k].t : '');
  const ehExtenso = (k: number) => Object.hasOwn(EXTENSO, palavra(k)) && !(palavra(k) === 'cento' && t(k - 1) === 'por');
  const porCento = (k: number) => t(k) === '%' || (t(k) === 'por' && t(k + 1) === 'cento');
  const percentual = (k: number): boolean => {
    if (porCento(k)) return true;
    if (t(k) !== '(') return false;
    const fecha = tk.findIndex((x, i) => i > k && x.t === ')');
    return fecha > k && fecha - k <= 8 && porCento(fecha + 1);
  };
  const identificados = new Set<number>(); // índices, em tk, dos números que são identificador
  const identificador = (k: number): boolean => {
    let j = k - 1;
    while (j >= 0 && ENTRE_IDENTIFICADOR_E_NUMERO.has(palavra(j))) j--;
    if (IDENTIFICADOR.has(palavra(j))) return true;
    // o ano logo depois do identificador: "Emenda 141, de 2026", "Lei 13.467/2017", "Lei 8.213, de 24 de julho de 1991"
    const ano = tk[k].data || /^\d{4}$/.test(t(k)) || (t(k - 1) === '/' && /^\d{2}$/.test(t(k)));
    if (ano && (t(k - 1) === 'de' || t(k - 1) === '/') && identificados.has(k - 2)) return true;
    // "Reforma da Previdência de 2019", "Reforma Trabalhista de 2017"
    if (/^(19|20)\d{2}$/.test(t(k)) && t(k - 1) === 'de') {
      for (let r = k - 2; r >= Math.max(0, k - 5); r--) if (t(r) === 'reforma') return true;
    }
    return false;
  };
  const saida: Numero[] = [];
  let k = 0;
  while (k < tk.length) {
    const tok = tk[k];
    let valor: string | undefined;
    let tipo: Numero['tipo'] = 'valor';
    let depois = k + 1;
    if (tok.num) {
      valor = tok.t;
      const mult = tok.data || tok.ordinal ? undefined : MULTIPLICADOR[t(k + 1)];
      const base = Number(valor.replace(',', '.'));
      if (mult && /^\d+(,\d+)?$/.test(valor) && Number.isFinite(base)) {
        valor = String(Math.round(base * mult));
        depois = k + 2;
      }
      if (identificador(k)) {
        tipo = 'identificador';
        identificados.add(k);
      } else if (tok.ordinal && !UNIDADE_DE_TEMPO.has(t(k + 1))) tipo = 'nome';
    } else if (Object.hasOwn(ORDINAL, tok.t)) {
      let total = 0;
      let j = k;
      for (; Object.hasOwn(ORDINAL, palavra(j)); j++) total += ORDINAL[palavra(j)];
      depois = j;
      // por extenso, fora da unidade de tempo, nem como nome entra: "segundo" também é "conforme"
      if (UNIDADE_DE_TEMPO.has(t(j))) valor = String(total);
    } else if (Object.hasOwn(ADJETIVO_DE_PRAZO, tok.t)) {
      valor = String(ADJETIVO_DE_PRAZO[tok.t]);
    } else if (ehExtenso(k)) {
      let total = 0;
      let atual = 0;
      let lidas = 0;
      let j = k;
      while (j < tk.length && ehExtenso(j)) {
        const v = EXTENSO[palavra(j)];
        if (v === 1000) { total += (atual || 1) * 1000; atual = 0; } else atual += v;
        lidas++;
        j++;
        if (t(j) === 'e' && ehExtenso(j + 1)) j++;
        else if (t(j) !== 'mil' && !(v === 1000 && ehExtenso(j))) break; // "mil quatrocentos e doze" segue sem o "e"
      }
      depois = j;
      const artigo = lidas === 1 && (tok.t === 'um' || tok.t === 'uma') && t(k - 1) !== '(' && !porCento(j) && !UNIDADE_DO_UM.has(t(j));
      if (!artigo) valor = String(total + atual);
    }
    if (valor !== undefined) saida.push({valor: percentual(depois) ? `${valor}%` : valor, tipo});
    k = depois;
  }
  return saida;
};

/** Números do texto, sem repetição e na ordem em que aparecem: algarismo ou extenso ("dez dias" = "10"; "5 mil" =
 * "5000"), percentuais ("40%", "quarenta por cento", "40 (quarenta) por cento" = "40%"), datas em dd/mm/aaaa, adjetivos
 * de prazo ("quinquenal" = "5") e ordinais antes de unidade de tempo ("vigésimo dia" = "20"). Entram os identificadores
 * ("Lei nº 13.467" = "13467"); não entram os ordinais que só nomeiam ("13º salário", "1º grau"). "um"/"uma" só contam
 * antes de unidade ("um ano", "uma vez"), entre parênteses, em composição ("vinte e um", "um mil") ou antes de "por
 * cento"; no resto são artigo ("uma multa"). */
export const numerosDe = (texto: string): string[] => [...new Set(lerNumeros(texto).filter((n) => n.tipo !== 'nome').map((n) => n.valor))];

/** Cada número da afirmação precisa aparecer no trecho, em algarismo ou por extenso; percentual só casa com percentual.
 * Não entram na conta da afirmação os que só identificam a norma ou o dispositivo: os do localizador ("CLT, art. 477,
 * § 6º"), os que vêm logo depois de "art.", "§", "Súmula", "Lei nº", "Emenda", "MP", "Tema"… e o ano que os segue ("Emenda
 * 141, de 2026", "Lei 13.467/2017", "Reforma da Previdência de 2019"), além dos ordinais que nomeiam ("13º salário").
 * No trecho vale tudo o que está escrito, inclusive identificadores, ordinais e o ano de cada data. */
export const conferirDigitos = (afirmacao: string, trecho: string, localizador?: string): {afirmacao: string[]; faltando: string[]} => {
  const doLocalizador = new Set(localizador ? numerosDe(localizador) : []);
  const lidos = lerNumeros(afirmacao);
  // o mesmo número usado como valor em outro ponto da afirmação ("art. 10 … 10 dias") continua contando
  const comoValor = new Set(lidos.filter((n) => n.tipo === 'valor').map((n) => n.valor));
  const daAfirmacao = [...new Set(lidos.map((n) => n.valor))].filter((v) => comoValor.has(v) && !doLocalizador.has(v));
  const noTrecho = new Set<string>();
  for (const {valor} of lerNumeros(trecho)) {
    noTrecho.add(valor);
    const ano = EH_DATA.exec(valor)?.[1];
    if (ano?.length === 4) noTrecho.add(ano); // "em 2017" acha "11.11.2017"
  }
  const faltando = daAfirmacao.filter((n) => !(noTrecho.has(n) || (!n.endsWith('%') && noTrecho.has(`${n}%`))));
  return {afirmacao: daAfirmacao, faltando};
};

// ---------- vigência ----------

export const SINAIS_VIGENCIA = ['(Revogad', 'Redação dada pela', '(Incluído', '(Vide', 'cancelad', 'convertid', 'superad', 'em vigor', 'DOU de', 'Vigência'];

/** Marcas de vigência que aparecem no texto (sem caixa nem acento), na ordem de SINAIS_VIGENCIA. */
export const sinaisDeVigencia = (texto: string): string[] => {
  const base = semAcento(texto).toLowerCase();
  return SINAIS_VIGENCIA.filter((s) => base.includes(semAcento(s).toLowerCase()));
};

// ---------- HTML ----------

// Entidades HTML 4 de U+00A0 a U+00FF, na ordem dos códigos.
const LATIN1 = ('nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 '
  + 'acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring '
  + 'AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times '
  + 'Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute '
  + 'ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc '
  + 'uuml yacute thorn yuml').split(' ');
const ENTIDADES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  ...Object.fromEntries(LATIN1.map((nome, i) => [nome, String.fromCharCode(0xa0 + i)])),
};
// Essas os navegadores aceitam sem ponto e vírgula; as demais só com ele.
const MAIS_ENTIDADES: Record<string, string> = {
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', hellip: '…',
  bull: '•', middot: '·', euro: '€', trade: '™', laquo: '«', raquo: '»', ensp: '\u2002', emsp: '\u2003',
  thinsp: '\u2009', zwnj: '\u200c', zwj: '\u200d', lrm: '\u200e', rlm: '\u200f', OElig: 'Œ', oelig: 'œ',
  Scaron: 'Š', scaron: 'š', Yuml: 'Ÿ', fnof: 'ƒ', circ: 'ˆ', tilde: '˜', dagger: '†', Dagger: '‡', permil: '‰',
};

const CP1252 = new TextDecoder('windows-1252');

const decodificarEntidades = (s: string): string =>
  s.replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*)(;?)/gi, (todo, nome: string, pv: string) => {
    if (nome[0] === '#') {
      const n = nome[1] === 'x' || nome[1] === 'X' ? parseInt(nome.slice(2), 16) : parseInt(nome.slice(1), 10);
      if (n >= 0x80 && n <= 0x9f) return CP1252.decode(Uint8Array.of(n)); // como os navegadores: &#150; é "–"
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '�';
    }
    if (nome in ENTIDADES) return ENTIDADES[nome];
    if (pv && nome in MAIS_ENTIDADES) return MAIS_ENTIDADES[nome];
    return todo;
  });

const QUEBRA_ABRE = new Set(['p', 'div', 'li', 'tr', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'dl', 'dt', 'dd']);
const QUEBRA_FECHA = new Set([...QUEBRA_ABRE]);
const VAZIAS = new Set(['br', 'img', 'hr', 'meta', 'link', 'input', 'col', 'area', 'base', 'wbr', 'source']);

/** Texto do HTML para ler e citar. Tira <head>, <script>, <style> e comentários (inclusive o <script id="f5_cspm"> que
 * o Planalto injeta); <br> e o fim de parágrafo, div, item, linha de tabela e título viram quebra de linha; entidades
 * decodificadas; U+00A0 preservado. O texto riscado (<strike>, <s>, <del>, style com line-through) FICA, entre
 * "[riscado: " e "]": nada da fonte é apagado. */
export const limparHtml = (html: string): string => {
  const semRuido = html
    .replace(/<!--[\s\S]*?(-->|$)/g, '')
    .replace(/<head[\s>][\s\S]*?<\/head\s*>/gi, '')
    .replace(/<script\b[\s\S]*?(<\/script\s*>|$)/gi, '')
    .replace(/<style\b[\s\S]*?(<\/style\s*>|$)/gi, '');
  const partes: string[] = [];
  // riscados abertos: a tag e quantas dela estão abertas desde o riscado (para achar o fechamento certo)
  const riscados: {nome: string; prof: number}[] = [];
  let marcador = -1; // posição do '[riscado: ' aberto em partes
  const fecharRiscado = () => {
    // riscado vazio (só tags ou espaço) não vira marcador
    if (partes.slice(marcador + 1).join('').trim() === '') partes[marcador] = '';
    else partes.push(']');
  };
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|[^<]+|</g;
  for (let m = re.exec(semRuido); m; m = re.exec(semRuido)) {
    if (m[2] === undefined) {
      partes.push(decodificarEntidades(m[0].replace(/[ \t\r\n\f]+/g, ' ')));
      continue;
    }
    const fecha = m[1] === '/';
    const nome = m[2].toLowerCase();
    const atributos = m[3];
    if (!fecha) {
      if (nome === 'br') partes.push('\n');
      if (QUEBRA_ABRE.has(nome)) partes.push('\n');
      if (VAZIAS.has(nome) || atributos.trimEnd().endsWith('/')) continue;
      for (const r of riscados) if (r.nome === nome) r.prof++;
      if (['strike', 's', 'del'].includes(nome) || /line-through/i.test(atributos)) {
        if (riscados.length === 0) marcador = partes.push('[riscado: ') - 1;
        riscados.push({nome, prof: 1});
      }
    } else {
      if (riscados.some((r) => r.nome === nome)) {
        for (const r of riscados) if (r.nome === nome) r.prof--;
        for (let k = riscados.length - 1; k >= 0; k--) if (riscados[k].prof <= 0) riscados.splice(k, 1);
        if (riscados.length === 0) fecharRiscado();
      }
      if (QUEBRA_FECHA.has(nome)) partes.push('\n');
      else if (nome === 'td' || nome === 'th') partes.push(' ');
    }
  }
  if (riscados.length) fecharRiscado();
  return partes.join('')
    .split('\n')
    .map((linha) => linha.replace(/ {2,}/g, ' ').replace(/^ +| +$/g, ''))
    .filter((linha) => /\S/.test(linha)) // \S já conta U+00A0 como espaço: linha só de U+00A0 sai
    .join('\n');
};

/** O <title> do HTML, decodificado e numa linha só. */
export const tituloDoHtml = (html: string): string | undefined => {
  const m = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  const t = m ? decodificarEntidades(m[1]).replace(/\s+/g, ' ').trim() : '';
  return t || undefined;
};

/** sha256 (hex) do texto limpo normalizado: o mesmo texto dá o mesmo hash, venha com o token aleatório do F5 ou não. */
export const hashTexto = (texto: string): string => createHash('sha256').update(normalizar(texto), 'utf8').digest('hex');

const decodificador = (rotulo: string, fatal = false): TextDecoder | undefined => {
  try { return new TextDecoder(rotulo.trim().toLowerCase(), {fatal}); } catch { return undefined; }
};

/** Bytes para texto, com um aviso quando o charset declarado não confere com os bytes. Ordem: BOM; charset do
 * Content-Type; <meta charset> ou <meta http-equiv content-type> nos primeiros 4 KB; UTF-8 se os bytes forem UTF-8
 * válido; senão windows-1252 (padrão dos sites antigos de governo, como o Planalto, que não declara nada). Site de
 * governo que declara UTF-8 e manda windows-1252 é comum: aí o UTF-8 é lido estrito e, se falhar, vale o
 * windows-1252, com aviso; lido solto, cada acento viraria U+FFFD e o dado da fonte se perderia em silêncio. */
export const decodificarComAviso = (bytes: Uint8Array, contentType?: string): {texto: string; aviso?: string} => {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return {texto: new TextDecoder('utf-8').decode(bytes)};
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return {texto: new TextDecoder('utf-16le').decode(bytes)};
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return {texto: new TextDecoder('utf-16be').decode(bytes)};
  const doCabecalho = contentType ? /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)?.[1] : undefined;
  const doMeta = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(CP1252.decode(bytes.subarray(0, 4096)))?.[1];
  const declarados: [string | undefined, string][] = [[doCabecalho, 'o cabeçalho HTTP'], [doMeta, 'o <meta charset> da página']];
  for (const [rotulo, onde] of declarados) {
    const d = rotulo ? decodificador(rotulo) : undefined;
    if (!d) continue;
    if (d.encoding !== 'utf-8') return {texto: d.decode(bytes)};
    try {
      return {texto: new TextDecoder('utf-8', {fatal: true}).decode(bytes)};
    } catch {
      return {texto: CP1252.decode(bytes), aviso: `${onde} diz UTF-8, mas o texto não é UTF-8 válido; foi lido como windows-1252: confira os acentos em texto_da_fonte`};
    }
  }
  try { return {texto: new TextDecoder('utf-8', {fatal: true}).decode(bytes)}; } catch { return {texto: CP1252.decode(bytes)}; }
};

/** Bytes para texto (decodificarComAviso sem o aviso). */
export const decodificar = (bytes: Uint8Array, contentType?: string): string => decodificarComAviso(bytes, contentType).texto;

// ---------- catálogo ----------

/** Nível da fonte pelo host do endereço (sufixo de domínio; o host mais específico do catálogo vence). */
export const nivelDe = (url: string, catalogo: FonteCatalogo[] = CATALOGO_FONTES): {nivel: NivelFonte; catalogo?: string} => {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase().replace(/\.$/, ''); } catch { return {nivel: 0}; }
  let melhor: {fonte: FonteCatalogo; tamanho: number} | undefined;
  for (const fonte of catalogo) {
    for (const h of fonte.hosts) {
      const casa = host === h || host.endsWith(`.${h}`);
      if (casa && (!melhor || h.length > melhor.tamanho)) melhor = {fonte, tamanho: h.length};
    }
  }
  return melhor ? {nivel: melhor.fonte.nivel, catalogo: melhor.fonte.id} : {nivel: 0};
};
