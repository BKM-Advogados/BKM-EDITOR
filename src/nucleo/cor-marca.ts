// Cor por referência ao kit de marca. Na imagem, um campo de cor pode dizer "@destaque" em vez de um hexadecimal: o valor
// sai do kit que a imagem guarda em `marca` (documentos.ts), então trocar de kit, ou o kit ganhar outra cor, muda a peça
// sem tocar nas camadas. A prévia, a miniatura e a exportação resolvem a referência antes de pintar (resolverMarcaNoDoc);
// quem lê o documento (inspector, MCP) vê a referência. Também aqui: contraste de cor (WCAG) e as amostras que os campos
// de cor oferecem. Só regras, sem DOM nem disco.
//
// Gramática: "@nome" (nome do kit: fundo, texto, destaque, suave ou uma de apoio, como cobreProfundo), "@nome+N" (N% em
// direção ao branco), "@nome-N" (N% em direção ao preto) e "@nome:outro:N" (N% em direção a outra cor do kit).
// A fonte do texto também: "@titulo", "@texto" e "@mono" (a mono do kit, ou a de texto se ele não tem) leem as fontes
// do kit; nomes de família ("Archivo") seguem valendo e não mudam com o kit.
import {hex, misturar} from './acabamento';
import {ehDocCenas} from './cenas';
import type {CamadaImagem, Degrade, DocImagem, MarcaDoDocumento} from './documentos';
import {MARCA_NEUTRO} from './marca';

const REFERENCIA = /^@([A-Za-z0-9_]+)(?:([+-])(\d{1,3})|:([A-Za-z0-9_]+):(\d{1,3}))?$/;
/** Cor que sobra quando a referência cita um nome que o kit não tem (um cinza que aparece, sem esconder a camada). */
export const COR_SEM_KIT = '#808080';
export const LIMITE_CONTRASTE = 4.5;

export const ehReferenciaCor = (v: unknown): v is string => typeof v === 'string' && REFERENCIA.test(v.trim());

const FONTE_REF = /^@(titulo|texto|mono)$/i;
export const ehReferenciaFonte = (v: unknown): v is string => typeof v === 'string' && FONTE_REF.test(v.trim());

/** "@titulo" → a fonte de título do kit da imagem ("@mono" cai na de texto se o kit não tem mono); sem kit, o neutro. Nome
 *  de família passa como veio. */
export const resolverFonte = (fonte: string, marca?: Pick<MarcaDoDocumento, 'fontes'>): string => {
  const m = FONTE_REF.exec(fonte.trim());
  if (!m) return fonte;
  const f = marca?.fontes ?? MARCA_NEUTRO.fontes;
  const papel = m[1].toLowerCase();
  return papel === 'titulo' ? f.titulo : papel === 'texto' ? f.texto : (f.mono ?? f.texto);
};

type Paleta = Record<string, string>;
const paletaDe = (marca?: Pick<MarcaDoDocumento, 'cores'>): Paleta => ({...MARCA_NEUTRO.cores, ...(marca?.cores ?? {})});
const acharCor = (paleta: Paleta, nome: string) => paleta[nome] ?? paleta[Object.keys(paleta).find((k) => k.toLowerCase() === nome.toLowerCase()) ?? ''];

/** "@destaque" → "#C88155" (o kit da imagem; sem kit, o neutro). Cor que não é referência passa como veio. */
export const resolverCor = (cor: string, marca?: Pick<MarcaDoDocumento, 'cores'>): string => {
  const m = REFERENCIA.exec(cor.trim());
  if (!m) return cor;
  const paleta = paletaDe(marca);
  const base = acharCor(paleta, m[1]);
  if (!base) return COR_SEM_KIT;
  if (m[2]) return misturar(base, m[2] === '+' ? '#FFFFFF' : '#000000', Math.min(100, Number(m[3])) / 100);
  if (m[4]) {
    const outra = acharCor(paleta, m[4]);
    return outra ? misturar(base, outra, Math.min(100, Number(m[5])) / 100) : base;
  }
  return base;
};

// ---------- o documento com as referências resolvidas ----------
// Cada função devolve o mesmo objeto quando não há referência nenhuma: a prévia não refaz o que não mudou.
type Marcas = Pick<MarcaDoDocumento, 'cores' | 'fontes'> | undefined;
const cor = (v: string | undefined, marca: Marcas) => (typeof v === 'string' && ehReferenciaCor(v) ? resolverCor(v, marca) : v);

export const resolverDegrade = (d: Degrade | undefined, marca: Marcas): Degrade | undefined => {
  if (!d || !Array.isArray(d.paradas) || !d.paradas.some((p) => ehReferenciaCor(p?.cor))) return d;
  return {...d, paradas: d.paradas.map((p) => (p && ehReferenciaCor(p.cor) ? {...p, cor: resolverCor(p.cor, marca)} : p))};
};

export const resolverCamada = (c: CamadaImagem, marca: Marcas): CamadaImagem => {
  if (!c) return c;
  const fonte = ehReferenciaFonte(c.fonte) ? resolverFonte(c.fonte, marca) : c.fonte;
  const feita = cor(c.cor, marca);
  const preenchimento = cor(c.preenchimento, marca);
  const sombra = c.sombra && ehReferenciaCor(c.sombra.cor) ? {...c.sombra, cor: resolverCor(c.sombra.cor, marca)} : c.sombra;
  const contorno = c.contorno && ehReferenciaCor(c.contorno.cor) ? {...c.contorno, cor: resolverCor(c.contorno.cor, marca)} : c.contorno;
  const grad = resolverDegrade(c.degrade, marca);
  if (fonte === c.fonte && feita === c.cor && preenchimento === c.preenchimento && sombra === c.sombra && contorno === c.contorno && grad === c.degrade) return c;
  return {...c, ...(fonte !== c.fonte ? {fonte} : {}), ...(feita !== c.cor ? {cor: feita} : {}), ...(preenchimento !== c.preenchimento ? {preenchimento} : {}),
    ...(sombra !== c.sombra ? {sombra} : {}), ...(contorno !== c.contorno ? {contorno} : {}), ...(grad !== c.degrade ? {degrade: grad} : {})};
};

export const resolverCamadas = (camadas: CamadaImagem[], marca: Marcas): CamadaImagem[] => {
  const feitas = camadas.map((c) => resolverCamada(c, marca));
  return feitas.some((c, i) => c !== camadas[i]) ? feitas : camadas;
};

/** O documento com toda referência (de cor e de fonte) trocada pelo valor do kit dele: fundo, degradê do fundo e camadas (da raiz e de cada
 *  página). Quem desenha (prévia, miniatura, PNG, PDF) passa por aqui. A cor do efeito de tom é sempre hexadecimal. */
export const resolverMarcaNoDoc = (doc: DocImagem): DocImagem => {
  const marca = doc.marca;
  const fundo = cor(doc.fundo, marca) ?? doc.fundo;
  const fundoDegrade = resolverDegrade(doc.fundo_degrade, marca);
  const camadas = Array.isArray(doc.camadas) ? resolverCamadas(doc.camadas, marca) : doc.camadas;
  const paginas = doc.paginas?.map((p) => {
    const cs = Array.isArray(p.camadas) ? resolverCamadas(p.camadas, marca) : p.camadas;
    const pf = typeof p.fundo === 'string' ? cor(p.fundo, marca) ?? p.fundo : p.fundo;
    const pd = resolverDegrade(p.fundo_degrade, marca);
    if (cs === p.camadas && pf === p.fundo && pd === p.fundo_degrade) return p;
    return {...p, camadas: cs, ...(pf !== p.fundo ? {fundo: pf} : {}), ...(pd !== p.fundo_degrade ? {fundo_degrade: pd} : {})};
  });
  const paginasIguais = !paginas || paginas.every((p, i) => p === doc.paginas![i]);
  if (fundo === doc.fundo && fundoDegrade === doc.fundo_degrade && camadas === doc.camadas && paginasIguais) return doc;
  return {...doc, fundo, ...(fundoDegrade !== doc.fundo_degrade ? {fundo_degrade: fundoDegrade} : {}), camadas, ...(paginasIguais ? {} : {paginas})};
};

// ---------- contraste (WCAG 2.2) ----------
const canal = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminancia = (c: {r: number; g: number; b: number}) => 0.2126 * canal(c.r) + 0.7152 * canal(c.g) + 0.0722 * canal(c.b);

/** Razão de contraste de 1 a 21 entre duas cores (hexadecimal ou rgb()); `frente` com transparência é misturada sobre o
 *  `fundo` antes. null se alguma não se lê (nome de cor, referência). */
export const contraste = (frente: string, fundo: string): number | null => {
  const f = hex(frente);
  const b = hex(fundo);
  if (!f || !b) return null;
  const mistura = (p: number, q: number) => Math.round(q + (p - q) * f.a);
  const sobre = {r: mistura(f.r, b.r), g: mistura(f.g, b.g), b: mistura(f.b, b.b)};
  const l1 = luminancia(sobre);
  const l2 = luminancia(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/** O aviso que o campo de cor mostra quando o texto não se lê sobre o fundo (menos de 4,5:1); null se lê, ou se não dá
 *  para medir. Cores por referência são resolvidas pelo kit. */
export const avisoDeContraste = (frente: string, fundo: string, marca?: Marcas): string | null => {
  const r = contraste(resolverCor(frente, marca), resolverCor(fundo, marca));
  if (r === null || r >= LIMITE_CONTRASTE) return null;
  return `Contraste ${r.toFixed(1).replace('.', ',')}:1 com o fundo: abaixo do mínimo de ${String(LIMITE_CONTRASTE).replace('.', ',')}:1 para ler`;
};

// ---------- amostras ----------
export type AmostraDeCor = {nome: string; rotulo: string; valor: string; referencia: string};

const ROTULOS: Record<string, string> = {fundo: 'Fundo', texto: 'Texto', destaque: 'Destaque', suave: 'Suave'};
/** "cobreProfundo" → "Cobre profundo". */
export const rotuloDeCor = (nome: string) => {
  const frase = nome.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return ROTULOS[nome] ?? frase.charAt(0).toUpperCase() + frase.slice(1);
};

/** As cores do kit como amostras com nome, as quatro de sempre primeiro; `referencia` é o que vai no campo ("@destaque"). */
export const amostrasDaMarca = (marca?: Pick<MarcaDoDocumento, 'cores'>): AmostraDeCor[] => {
  const cores = marca?.cores ?? {};
  const nomes = ['fundo', 'texto', 'destaque', 'suave', ...Object.keys(cores).filter((k) => !(k in ROTULOS))];
  return nomes.filter((n) => cores[n]).map((nome) => ({nome, rotulo: rotuloDeCor(nome), valor: cores[nome], referencia: `@${nome}`}));
};

/** Nome da amostra do kit que tem esta cor (ou esta referência), para o campo mostrar "Destaque" em vez do hexadecimal. */
export const nomeDaCor = (valor: string, marca?: Pick<MarcaDoDocumento, 'cores'>): string | null => {
  const t = valor.trim();
  if (ehReferenciaCor(t)) return rotuloDeCor(REFERENCIA.exec(t)![1]) + (t.includes('+') || t.includes('-') || t.includes(':') ? ' (variação)' : '');
  const alvo = hex(t);
  if (!alvo) return null;
  const a = amostrasDaMarca(marca).find((x) => {
    const c = hex(x.valor);
    return c && c.r === alvo.r && c.g === alvo.g && c.b === alvo.b && c.a === alvo.a;
  });
  return a?.rotulo ?? null;
};

// ---------- a paleta do documento aberto ----------
/** As cores que os campos de cor oferecem como amostras: as do kit do documento. `referencia`: a amostra grava
 *  "@destaque" (a imagem lê do kit dela); sem ela, grava o hexadecimal (o vídeo copia o tema, o efeito de tom é hex). */
export type PaletaAtiva = {cores: Record<string, string>; referencia: boolean; marca?: MarcaDoDocumento};

/** Imagem com kit: as cores dele, por referência. Vídeo de cenas: as quatro do tema, por valor. O resto: nada. */
export const paletaDoDocumento = (doc: unknown, porReferencia = true): PaletaAtiva | undefined => {
  const d = doc as {marca?: MarcaDoDocumento; tema?: {fundo?: string; texto?: string; destaque?: string; suave?: string}} | null;
  if (d?.marca && typeof d.marca === 'object' && d.marca.cores) return {cores: d.marca.cores, referencia: porReferencia, marca: d.marca};
  if (ehDocCenas(doc)) {
    const t = {...MARCA_NEUTRO.cores, ...(doc.tema ?? {})};
    return {cores: {fundo: t.fundo, texto: t.texto, destaque: t.destaque, suave: t.suave}, referencia: false};
  }
  return undefined;
};
