// Texto de um PDF para a pesquisa (docs/pesquisa.md): lê a CAMADA DE TEXTO do arquivo, sem OCR. PDF digitalizado (só
// imagem) não tem texto e dá erro claro. O texto sai com uma linha por linha do PDF, uma linha em branco onde o
// espaço entre linhas sugere parágrafo novo e um "\f" (quebra de página, como no pdftotext) entre as páginas. Na
// conferência do trecho (acharTrecho) quebra de linha, linha em branco e "\f" valem um espaço só, então um trecho que
// atravessa linha ou página continua exato. Arrumações, todas para o trecho copiado do PDF casar com o texto:
//  - palavra partida no fim da linha ("conti-" + "nuidade") volta inteira; se o próprio documento escreve a palavra
//    com hífen em outro lugar ("auxílio-doença" numa linha só), o hífen fica;
//  - cabeçalho e rodapé repetidos (a mesma linha no alto ou no pé de pelo menos metade das páginas, com os números
//    trocados por "#", a partir de 3 páginas) ficam uma vez só: o cabeçalho na primeira página, o rodapé na última.
// Usa o unpdf (o pdf.js da Mozilla num arquivo só, sem worker e sem binário nativo), que roda no processo principal e
// no MCP por stdio. Só este arquivo importa o unpdf; a interface não o importa.
import {getDocumentProxy} from 'unpdf';

/** Um pedaço de texto de uma página como o pdf.js entrega (getTextContent). */
export type ItemPdf = {str: string; hasEOL?: boolean; transform?: number[]; height?: number};

export type TextoPdf = {
  texto: string;
  paginas: number;
  titulo?: string;
  /** cabeçalhos e rodapés repetidos que ficaram uma vez só (um exemplo de cada) */
  repetidos: string[];
  /** páginas (a partir de 1) sem texto nenhum: imagem, digitalizada, que não foi lida */
  sem_texto: number[];
};

/** O PDF não deu texto: sem camada de texto (digitalizado), protegido por senha ou estragado. */
export class ErroPdf extends Error {}

type Linha = {texto: string; y?: number; altura?: number; paragrafo?: boolean};

const HIFEN_NO_FIM = /([\p{L}\p{M}]+)[-‐­]$/u;
const COMECO_MINUSCULO = /^([\p{Ll}][\p{L}\p{M}]*)/u;

/** As linhas de uma página: o pdf.js marca o fim de cada linha (hasEOL) e já põe os espaços entre as palavras. */
export const linhasDaPagina = (itens: ItemPdf[]): Linha[] => {
  const linhas: Linha[] = [];
  let atual = '';
  let y: number | undefined;
  let altura: number | undefined;
  const fechar = () => {
    const texto = atual.replace(/\u0000/g, '').replace(/[ \t ]+$/u, '').replace(/^[ \t]+/, '');
    if (texto) linhas.push({texto, y, altura});
    atual = '';
    y = undefined;
    altura = undefined;
  };
  for (const it of itens) {
    if (typeof it.str !== 'string') continue;
    if (it.str && y === undefined && it.transform) {
      y = it.transform[5];
      altura = Math.abs(it.height || it.transform[3] || 0) || undefined;
    }
    atual += it.str;
    if (it.hasEOL) fechar();
  }
  fechar();
  // parágrafo novo: a distância até a linha de cima passa de 1,6 vez a distância mais comum entre linhas da página
  const passos = linhas.slice(1).map((l, i) => (l.y !== undefined && linhas[i].y !== undefined ? linhas[i].y! - l.y : NaN)).filter((d) => d > 0);
  if (passos.length >= 2) {
    const ordenados = [...passos].sort((a, b) => a - b);
    const comum = ordenados[Math.floor(ordenados.length / 2)];
    for (let i = 1; i < linhas.length; i++) {
      const d = linhas[i - 1].y !== undefined && linhas[i].y !== undefined ? linhas[i - 1].y! - linhas[i].y! : NaN;
      if (d > comum * 1.6) linhas[i].paragrafo = true;
    }
  }
  return linhas;
};

const chaveRepetida = (s: string) => s.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
const ZONA = 2; // linhas do alto e do pé de cada página onde se procura cabeçalho e rodapé
const MAX_REPETIDA = 160; // linha mais longa que isso é texto, não cabeçalho

/** Tira cabeçalho e rodapé repetidos (deixa o cabeçalho na primeira página e o rodapé na última). A linha que tem a
 *  mesma cara no meio das páginas ("Art. 5º …", uma lista numerada) é texto, não cabeçalho, e fica. */
const tirarRepetidos = (paginas: Linha[][]): string[] => {
  if (paginas.length < 3) return [];
  const noMeio = new Map<string, number>();
  for (const p of paginas) for (const k of new Set(p.slice(ZONA, -ZONA).map((l) => chaveRepetida(l.texto)))) noMeio.set(k, (noMeio.get(k) ?? 0) + 1);
  const contar = (zona: (p: Linha[]) => Linha[]) => {
    const n = new Map<string, number>();
    for (const p of paginas) for (const k of new Set(zona(p).filter((l) => l.texto.length <= MAX_REPETIDA).map((l) => chaveRepetida(l.texto)))) n.set(k, (n.get(k) ?? 0) + 1);
    return new Set([...n].filter(([k, v]) => k && v >= Math.max(3, Math.ceil(paginas.length / 2)) && (noMeio.get(k) ?? 0) < 2).map(([k]) => k));
  };
  const alto = contar((p) => p.slice(0, ZONA));
  const pe = contar((p) => p.slice(-ZONA));
  const exemplos = new Map<string, string>();
  paginas.forEach((p, i) => {
    const tirar = new Set<Linha>();
    if (i > 0) for (const l of p.slice(0, ZONA)) if (alto.has(chaveRepetida(l.texto))) tirar.add(l);
    if (i < paginas.length - 1) for (const l of p.slice(-ZONA)) if (pe.has(chaveRepetida(l.texto))) tirar.add(l);
    for (const l of tirar) if (!exemplos.has(chaveRepetida(l.texto))) exemplos.set(chaveRepetida(l.texto), l.texto);
    const sobra = p.filter((l) => !tirar.has(l));
    if (sobra.length && tirar.has(p[0])) sobra[0] = {...sobra[0], paragrafo: false};
    p.splice(0, p.length, ...sobra);
  });
  return [...exemplos.values()];
};

/** Palavras com hífen escritas numa linha só ("auxílio-doença"), em minúsculas: dizem se o hífen do fim da linha é da palavra. */
const compostosDoTexto = (paginas: Linha[][]): Set<string> => {
  const s = new Set<string>();
  for (const p of paginas) for (const l of p) for (const m of l.texto.matchAll(/[\p{L}\p{M}]+(?:[-‐][\p{L}\p{M}]+)+/gu)) s.add(m[0].toLowerCase().replace(/‐/g, '-'));
  return s;
};

/** Junta a palavra partida no fim da linha com o começo da linha seguinte (também de uma página para a outra). */
const juntarHifens = (paginas: Linha[][]) => {
  const compostos = compostosDoTexto(paginas);
  const todas = paginas.flatMap((p, pi) => p.map((l, li) => ({l, pi, li})));
  for (let k = 0; k < todas.length - 1; k++) {
    const atual = todas[k].l;
    const prox = todas[k + 1].l;
    if (prox.paragrafo && todas[k + 1].pi === todas[k].pi) continue; // linha em branco no meio: não é palavra partida
    const h = HIFEN_NO_FIM.exec(atual.texto);
    const c = COMECO_MINUSCULO.exec(prox.texto);
    if (!h || !c) continue;
    const hifen = atual.texto.slice(-1);
    const fica = hifen !== '­' && compostos.has(`${h[1]}-${c[1]}`.toLowerCase());
    // a palavra inteira vai para a linha de cima, com a pontuação colada nela
    const resto = prox.texto.slice(c[1].length);
    const cola = /^[^\s]*/u.exec(resto)![0];
    atual.texto = `${atual.texto.slice(0, -1)}${fica ? '-' : ''}${c[1]}${cola}`;
    prox.texto = resto.slice(cola.length).replace(/^\s+/, '');
  }
  for (const p of paginas) {
    const sobra = p.filter((l) => l.texto);
    p.splice(0, p.length, ...sobra);
  }
};

/** Monta o texto das páginas (cada uma, a lista de itens do pdf.js). Puro: o teste chama sem PDF. */
export const montarTextoPdf = (paginasItens: ItemPdf[][]): {texto: string; repetidos: string[]} => {
  const paginas = paginasItens.map(linhasDaPagina);
  const repetidos = tirarRepetidos(paginas);
  juntarHifens(paginas);
  const texto = paginas
    .map((p) => p.map((l, i) => (i > 0 && l.paragrafo ? `\n${l.texto}` : l.texto)).join('\n').replace(/­/g, ''))
    .join('\n\f\n')
    .replace(/^[\s\f]+|[\s\f]+$/g, '');
  return {texto, repetidos};
};

/** Lê o texto de um PDF. Erro (ErroPdf) quando o PDF não abre, pede senha ou não tem texto nenhum (só imagem). */
export const textoDoPdf = async (bytes: Uint8Array): Promise<TextoPdf> => {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // cópia: o pdf.js toma posse do buffer que recebe; verbosity 0 porque o pdf.js avisa por console.log, e no MCP
    // por stdio a saída padrão é o canal do protocolo
    pdf = await getDocumentProxy(new Uint8Array(bytes), {verbosity: 0, useSystemFonts: false, stopAtErrors: false});
  } catch (e) {
    const nome = (e as {name?: string}).name ?? '';
    if (nome === 'PasswordException') throw new ErroPdf('o PDF é protegido por senha e o Estúdio não abre PDF com senha: procure outra cópia da mesma norma ou decisão');
    throw new ErroPdf(`o arquivo diz ser PDF, mas não abriu (${(e as Error).message}): procure outra cópia da mesma norma ou decisão`);
  }
  try {
    const paginasItens: ItemPdf[][] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const pagina = await pdf.getPage(n);
      const conteudo = await pagina.getTextContent();
      paginasItens.push(conteudo.items.filter((it): it is ItemPdf & typeof it => 'str' in it) as ItemPdf[]);
      pagina.cleanup();
    }
    const {texto, repetidos} = montarTextoPdf(paginasItens);
    const semTexto = paginasItens.flatMap((itens, i) => (itens.some((it) => /[\p{L}\p{N}]/u.test(it.str)) ? [] : [i + 1]));
    if (!/[\p{L}\p{N}]/u.test(texto)) {
      throw new ErroPdf(`o PDF tem ${pdf.numPages === 1 ? '1 página' : `${pdf.numPages} páginas`} e nenhum texto: parece digitalizado (só imagem), e o Estúdio não faz OCR. Procure a versão em texto (HTML ou PDF com texto) da mesma norma ou decisão`);
    }
    let titulo: string | undefined;
    try {
      const meta = await pdf.getMetadata();
      const t = (meta.info as {Title?: unknown} | undefined)?.Title;
      titulo = typeof t === 'string' && t.trim() ? t.replace(/\s+/g, ' ').trim() : undefined;
    } catch {
      titulo = undefined;
    }
    return {texto, paginas: pdf.numPages, ...(titulo ? {titulo} : {}), repetidos, sem_texto: semTexto};
  } finally {
    await pdf.loadingTask.destroy();
  }
};
