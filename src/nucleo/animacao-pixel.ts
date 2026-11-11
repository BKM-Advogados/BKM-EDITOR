// Arte em pixel (docs/animacao.md): a grade de células coloridas das camadas "pixel", no estilo dos protetores de tela.
// Tudo TypeScript puro (sem DOM, sem Remotion, sem programa externo): a conversão de uma imagem em grade (redução por
// média + quantização de cores), a codificação compacta das células, os efeitos de revelação determinísticos por semente
// e a conta de cor. A composição desenha o que este arquivo devolve; a interface edita a grade à mão (lápis, borracha,
// conta-gotas, balde).
export type GradePixel = {
  colunas: number;
  linhas: number;
  paleta: string[]; // cores "#rrggbb"
  celulas: string; // um caractere por célula, linha por linha: "." = vazio, ou o índice da paleta (base 62)
};

export type EfeitoPixel = 'aleatorio' | 'decodificar' | 'varredura' | 'varredura-baixo' | 'meio' | 'chuva';

export const EFEITOS_PIXEL: {id: EfeitoPixel; nome: string}[] = [
  {id: 'aleatorio', nome: 'Aleatório'},
  {id: 'decodificar', nome: 'Decodificar'},
  {id: 'varredura', nome: 'Varredura'},
  {id: 'varredura-baixo', nome: 'Varredura para baixo'},
  {id: 'meio', nome: 'Do meio para fora'},
  {id: 'chuva', nome: 'Chuva (matrix)'},
];

// ---------- codificação das células ----------
export const CHARSET_CELULAS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const VAZIO = '.';
export const MAX_CORES = CHARSET_CELULAS.length; // 62

/** Índices de paleta (ou -1 para vazio) → string compacta (um caractere por célula). */
export const codificarCelulas = (indices: number[]): string =>
  indices.map((i) => (i < 0 || i >= CHARSET_CELULAS.length ? VAZIO : CHARSET_CELULAS[i])).join('');

/** String compacta → índices de paleta (ou -1 para vazio). */
export const decodificarCelulas = (celulas: string): number[] => {
  const out: number[] = new Array(celulas.length);
  for (let i = 0; i < celulas.length; i++) {
    const c = celulas[i];
    if (c === VAZIO) out[i] = -1;
    else {
      const idx = CHARSET_CELULAS.indexOf(c);
      out[i] = idx < 0 ? 0 : idx;
    }
  }
  return out;
};

/** Cor de uma célula (ou null se vazia), já com o índice fora da paleta protegido. */
export const corDaCelula = (grade: GradePixel, indice: number): string | null =>
  indice < 0 ? null : (grade.paleta[indice] ?? grade.paleta[0] ?? '#000000');

// ---------- validação ----------
/** Maior lado de uma grade (colunas ou linhas). O esquema do MCP (pixelizar_imagem) e o normalizador do documento usam o
 *  mesmo teto: acima disso a prévia trava (o laço da revelação e o canvas crescem com colunas × linhas). */
export const MAX_LADO_GRADE = 128;

/** Cor da paleta em "#RRGGBB": "#rgb" é expandida; o que não é cor vira preto, **na mesma posição** (filtrar deslocaria
 *  os índices das células). */
const corDaPaleta = (c: unknown): string => {
  if (typeof c !== 'string') return '#000000';
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${[...c.slice(1)].map((x) => x + x).join('')}`.toUpperCase();
  return '#000000';
};

/**
 * Lê uma grade vinda do documento (que pode ter sido editado à mão ou por aplicar_patch). Colunas e linhas precisam ser
 * inteiros de 1 a MAX_LADO_GRADE e `celulas` um texto; senão a grade é recusada com o motivo (reformatar embaralharia a
 * imagem, porque as células são lidas linha a linha). Células a menos viram vazio e a mais são cortadas; a paleta é
 * consertada posição a posição. Uma grade válida volta igual.
 */
export const lerGrade = (g: unknown): {grade?: GradePixel; problema?: string} => {
  if (!g || typeof g !== 'object') return {problema: 'não é um objeto'};
  const o = g as Record<string, unknown>;
  const lado = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_LADO_GRADE;
  if (!lado(o.colunas) || !lado(o.linhas)) return {problema: `colunas e linhas precisam ser inteiros de 1 a ${MAX_LADO_GRADE}`};
  if (typeof o.celulas !== 'string') return {problema: 'sem "celulas"'};
  const colunas = o.colunas as number;
  const linhas = o.linhas as number;
  const n = colunas * linhas;
  const paleta = (Array.isArray(o.paleta) ? o.paleta : []).slice(0, MAX_CORES).map(corDaPaleta);
  const celulas = o.celulas.length === n ? o.celulas : o.celulas.slice(0, n).padEnd(n, VAZIO);
  const grade = {colunas, linhas, paleta, celulas};
  if (celulas !== o.celulas) return {grade, problema: `"celulas" com ${o.celulas.length} caracteres em vez de ${n}: completada com vazio ou cortada`};
  if (!Array.isArray(o.paleta)) return {grade, problema: 'sem paleta: as células saem pretas'};
  const crua = o.paleta;
  if (crua.length !== paleta.length || paleta.some((c, i) => c !== crua[i])) return {grade, problema: 'paleta com cores fora de "#rrggbb" (ou mais de 62): consertada na mesma posição'};
  return {grade};
};

// ---------- determinismo (mesma semente, mesma saída) ----------
/** Gerador pseudo-aleatório determinístico (mulberry32). */
export const mulberry32 = (semente: number) => {
  let a = (semente >>> 0) || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Permutação de 0..n-1 determinística pela semente (Fisher–Yates). */
export const ordemAleatoria = (n: number, semente: number): number[] => {
  const rnd = mulberry32(semente);
  const a = Array.from({length: n}, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Quanto do progresso a célula do `decodificar` leva para assentar na cor final, depois de entrar. */
const ASSENTAR = Math.max(0.05, 0.25);

/**
 * Quando (de 0 a 1 do progresso) a célula i, na coluna c e linha l, entra nos efeitos de frente fixa: aleatório e
 * decodificar (pela ordem embaralhada), varredura, varredura para baixo e meio. É o único lugar das fórmulas: revelar e
 * revelarRGBA usam esta função, então mudar a geometria de um efeito é mudar só aqui.
 *
 * Uma regra para todos: a célula entra em `(posição + 0,5) / (alcance + 1)`, com a posição em passos de célula a partir
 * da primeira que entra; é como se a frente revelasse a célula ao passar pelo centro dela. Todo limiar fica dentro de
 * (0, 1): nada aparece em 0, a grade fica cheia antes do último quadro, sem NaN (o denominador é ≥ 1) e com a frente
 * em velocidade constante. No `meio` a posição é a distância ao centro (o raio cresce em ritmo constante). O
 * `decodificar` entra até 3/4 do progresso, para cada célula ter tempo de assentar na cor final antes do fim.
 */
export const limiarDaCelula = (efeito: EfeitoPixel | undefined, i: number, c: number, l: number, colunas: number, linhas: number, ordem: ArrayLike<number>, n: number) => {
  switch (efeito) {
    case 'aleatorio':
      return (ordem[i] + 0.5) / n;
    case 'decodificar':
      return ((ordem[i] + 0.5) / n) * (1 - ASSENTAR);
    case 'varredura':
      return (c + 0.5) / colunas;
    case 'varredura-baixo':
      return (l + 0.5) / linhas;
    case 'meio': {
      const cx = (colunas - 1) / 2;
      const cy = (linhas - 1) / 2;
      const dMin = Math.hypot(colunas % 2 ? 0 : 0.5, linhas % 2 ? 0 : 0.5); // a distância da célula mais perto do centro
      const alcance = Math.hypot(cx, cy) - dMin;
      return (Math.hypot(c - cx, l - cy) - dMin + 0.5) / (alcance + 1);
    }
    default:
      return 0;
  }
};

/** Lados inteiros da grade (grade torta não derruba quem desenha). */
const ladosDe = (grade: GradePixel) => ({
  colunas: Math.max(1, Math.floor(grade.colunas) || 1),
  linhas: Math.max(1, Math.floor(grade.linhas) || 1),
});

// ---------- revelação ----------
/**
 * A cor a desenhar de cada célula no instante `progresso` (0 a 1), determinística pela `semente`. `null` = célula ainda
 * não revelada (transparente). Em 0 nada aparece; em 1 a grade inteira, com as cores finais. Os efeitos:
 * - aleatorio: as células aparecem numa ordem embaralhada;
 * - decodificar: cada célula entra com uma cor trocada e "assenta" na cor final;
 * - varredura / varredura-baixo: uma frente anda da esquerda para a direita / de cima para baixo;
 * - meio: a revelação cresce do centro para fora;
 * - chuva: colunas caem como a chuva do Matrix, com a ponta clara.
 * A composição usa revelarRGBA (a mesma conta, em bytes); esta versão em texto serve à interface e aos testes.
 */
export const revelar = (grade: GradePixel, efeito: EfeitoPixel | undefined, semente: number, progresso: number): (string | null)[] => {
  // defensiva: a grade normalmente já passou por lerGrade, mas quem chama direto não derruba a composição
  const {colunas, linhas} = ladosDe(grade);
  const n = colunas * linhas;
  const celulas = typeof grade.celulas === 'string' ? grade.celulas : '';
  const paleta = Array.isArray(grade.paleta) ? grade.paleta : [];
  const indices = decodificarCelulas(celulas.slice(0, n).padEnd(n, VAZIO));
  const segura = {...grade, paleta};
  const finais = indices.map((i) => corDaCelula(segura, i));
  const p = clamp01(progresso);
  if (p <= 0) return finais.map(() => null);
  if (p >= 1) return finais;
  const rnd = mulberry32(semente * 2654435761 + 7);
  const ordem = ordemAleatoria(n, semente);
  const limiar = (i: number) => limiarDaCelula(efeito, i, i % colunas, Math.floor(i / colunas), colunas, linhas, ordem, n);

  const out: (string | null)[] = new Array(n).fill(null);

  switch (efeito) {
    case 'aleatorio':
    case 'varredura':
    case 'varredura-baixo':
    case 'meio':
      for (let i = 0; i < n; i++) if (limiar(i) <= p) out[i] = finais[i];
      return out;

    case 'decodificar': {
      for (let i = 0; i < n; i++) {
        if (finais[i] === null) continue;
        const lim = limiar(i);
        if (p <= lim) continue;
        const corTrocada = paleta[Math.floor(rnd() * paleta.length)] ?? finais[i];
        // assim que entra, a célula ainda está com a cor trocada; assenta rápido na final
        const local = clamp01((p - lim) / ASSENTAR);
        out[i] = local >= 1 ? finais[i] : misturarCor(corTrocada, finais[i]!, local);
      }
      return out;
    }

    case 'chuva': {
      // cada coluna tem a sua defasagem; a ponta desce e a coluna atrás dela fica preenchida
      for (let c = 0; c < colunas; c++) {
        const atraso = Math.floor(rnd() * linhas);
        const ponta = p * (linhas + atraso) - atraso;
        for (let l = 0; l < linhas; l++) {
          const i = l * colunas + c;
          if (l <= ponta) out[i] = finais[i];
          // a ponta brilha (mais clara) na frente da chuva
          if (l === Math.floor(ponta) && l >= 0 && l < linhas && finais[i]) out[i] = misturarCor(finais[i]!, '#FFFFFF', 0.6);
        }
      }
      return out;
    }

    default:
      return finais;
  }
};

// ---------- revelação em RGBA, para o canvas (ImageData) ----------
// O que não depende do quadro (células decodificadas, cores finais em número, a permutação da semente e os limiares de cada
// célula) fica guardado por grade + semente: a camada de pixel refaz só a comparação com o progresso a cada quadro, e o
// canvas recebe tudo de uma vez (putImageData) em vez de um fillRect por célula. A saída é a mesma de revelar, célula a célula.
type Preparo = {celulas: string; n: number; vazia: Uint8Array; final: Int32Array; paleta: Int32Array; ordem: Int32Array;
  limiares: Map<string, Float64Array>};
const LIMITE_PREPAROS = 16;
const LIMITE_CELULAS_GUARDADAS = 4_000_000; // ~100 MB no pior caso (4 + 4 + 1 + 4 bytes por célula, mais 8 por efeito usado)
const preparos = new Map<string, Preparo>(); // na ordem de uso: o mais antigo sai primeiro
const rgbDe = (c: unknown) => parseInt(corDaPaleta(c).slice(1), 16);

const preparar = (g: GradePixel, colunas: number, linhas: number, semente: number): Preparo => {
  const paletaCrua = Array.isArray(g.paleta) ? g.paleta : [];
  const celulas = typeof g.celulas === 'string' ? g.celulas : '';
  const chave = `${colunas}x${linhas}|${semente}|${paletaCrua.join(',')}`;
  const achado = preparos.get(chave);
  if (achado && achado.celulas === celulas) {
    preparos.delete(chave);
    preparos.set(chave, achado);
    return achado;
  }
  const n = colunas * linhas;
  const indices = decodificarCelulas(celulas.slice(0, n).padEnd(n, VAZIO));
  const paleta = Int32Array.from(paletaCrua.map(rgbDe));
  const vazia = new Uint8Array(n);
  const final = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = indices[i];
    if (k < 0) vazia[i] = 1;
    else final[i] = k < paleta.length ? paleta[k] : paleta.length ? paleta[0] : 0; // como corDaCelula: fora da paleta, a 1ª cor
  }
  const novo: Preparo = {celulas, n, vazia, final, paleta, ordem: Int32Array.from(ordemAleatoria(n, semente)), limiares: new Map()};
  preparos.delete(chave);
  preparos.set(chave, novo);
  let total = 0;
  for (const x of preparos.values()) total += x.n;
  for (const [k, x] of preparos) {
    if (preparos.size <= 1 || (preparos.size <= LIMITE_PREPAROS && total <= LIMITE_CELULAS_GUARDADAS)) break;
    total -= x.n;
    preparos.delete(k);
  }
  return novo;
};

const limiaresDe = (pr: Preparo, efeito: EfeitoPixel, colunas: number, linhas: number) => {
  let lim = pr.limiares.get(efeito);
  if (!lim) {
    lim = new Float64Array(pr.n);
    for (let i = 0; i < pr.n; i++) lim[i] = limiarDaCelula(efeito, i, i % colunas, Math.floor(i / colunas), colunas, linhas, pr.ordem, pr.n);
    pr.limiares.set(efeito, lim);
  }
  return lim;
};

/** Quantos preparos estão guardados (para os testes conferirem o teto). */
export const preparosGuardados = () => ({quantos: preparos.size, celulas: [...preparos.values()].reduce((s, x) => s + x.n, 0)});

const misturarRgb = (a: number, b: number, u: number) => {
  const p = clamp01(u);
  const canal = (s: number) => Math.max(0, Math.min(255, Math.round(((a >> s) & 255) * (1 - p) + ((b >> s) & 255) * p)));
  return (canal(16) << 16) | (canal(8) << 8) | canal(0);
};

/**
 * Como revelar, mas em RGBA (4 bytes por célula, transparente onde não há cor), pronto para `new ImageData(rgba, colunas,
 * linhas)`. O tamanho é sempre colunas × linhas (inteiros): célula que falta fica transparente e a que sobra não entra.
 */
export const revelarRGBA = (grade: GradePixel, efeito: EfeitoPixel | undefined, semente: number, progresso: number): Uint8ClampedArray<ArrayBuffer> => {
  const {colunas, linhas} = ladosDe(grade);
  const px = new Uint8ClampedArray(colunas * linhas * 4);
  const pr = preparar(grade, colunas, linhas, semente);
  const {n, vazia, final, paleta} = pr;
  const pinta = (i: number, v: number) => {
    const o = i * 4;
    px[o] = (v >> 16) & 255;
    px[o + 1] = (v >> 8) & 255;
    px[o + 2] = v & 255;
    px[o + 3] = 255;
  };
  const p = clamp01(progresso);
  if (p <= 0) return px;
  const tudo = () => {
    for (let i = 0; i < n; i++) if (!vazia[i]) pinta(i, final[i]);
    return px;
  };
  if (p >= 1) return tudo();
  const rnd = mulberry32(semente * 2654435761 + 7);
  switch (efeito) {
    case 'aleatorio':
    case 'varredura':
    case 'varredura-baixo':
    case 'meio': {
      const lim = limiaresDe(pr, efeito, colunas, linhas);
      for (let i = 0; i < n; i++) if (!vazia[i] && lim[i] <= p) pinta(i, final[i]);
      return px;
    }
    case 'decodificar': {
      const lim = limiaresDe(pr, efeito, colunas, linhas);
      for (let i = 0; i < n; i++) {
        if (vazia[i] || p <= lim[i]) continue;
        const trocada = paleta[Math.floor(rnd() * paleta.length)];
        const local = clamp01((p - lim[i]) / ASSENTAR);
        pinta(i, local >= 1 ? final[i] : misturarRgb(trocada ?? final[i], final[i], local));
      }
      return px;
    }
    case 'chuva':
      for (let c = 0; c < colunas; c++) {
        const atraso = Math.floor(rnd() * linhas);
        const ponta = p * (linhas + atraso) - atraso;
        for (let l = 0; l < linhas; l++) {
          const i = l * colunas + c;
          if (vazia[i]) continue;
          if (l === Math.floor(ponta)) pinta(i, misturarRgb(final[i], 0xffffff, 0.6));
          else if (l <= ponta) pinta(i, final[i]);
        }
      }
      return px;
    default:
      return tudo();
  }
};

/** Mistura duas cores (hex) na proporção `u` (0 = a, 1 = b), em RGB. */
export const misturarCor = (a: string, b: string, u: number): string => {
  const h = (c: string) => parseInt(c.replace(/^#/, ''), 16);
  const va = h(a);
  const vb = h(b);
  const p = clamp01(u);
  const canal = (shift: number) => Math.round(((va >> shift) & 255) * (1 - p) + ((vb >> shift) & 255) * p);
  const r = canal(16);
  const g = canal(8);
  const bl = canal(0);
  return `#${[r, g, bl].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
};

// ---------- conversão de imagem → grade ----------
export type DadosImagem = {largura: number; altura: number; dados: Uint8ClampedArray}; // RGBA

/** Pixel médio de uma área (com o peso do alfa): ignora o que é transparente. */
const mediaArea = (img: DadosImagem, x0: number, y0: number, x1: number, y1: number): {r: number; g: number; b: number; a: number} => {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * img.largura + x) * 4;
    const alfa = img.dados[i + 3] / 255;
    if (alfa <= 0) continue;
    r += img.dados[i] * alfa;
    g += img.dados[i + 1] * alfa;
    b += img.dados[i + 2] * alfa;
    a += alfa;
    n++;
  }
  if (n === 0) return {r: 0, g: 0, b: 0, a: 0};
  return {r: r / a, g: g / a, b: b / a, a: a / n};
};

const hexDe = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/** Distância euclidiana entre duas cores RGB (o suficiente para achar a mais próxima). */
const distanciaRgb = (a: [number, number, number], b: [number, number, number]) => {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
};

/** Quantização por median-cut determinística: a imagem em nCores (≤ 62). Devolve paleta e índice por pixel. */
export const quantizar = (pixels: {r: number; g: number; b: number; a: number}[], nCores: number, paletaAlvo?: string[]): {paleta: string[]; indices: number[]} => {
  const alvo = paletaAlvo?.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, MAX_CORES).map((c) => c.toUpperCase());
  if (alvo && alvo.length) {
    const rgb = alvo.map((c) => {
      const v = parseInt(c.slice(1), 16);
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255] as [number, number, number];
    });
    const indices = pixels.map((p) => {
      if (p.a < 0.5) return -1;
      let melhor = 0;
      let d = Infinity;
      rgb.forEach((c, i) => {
        const dd = distanciaRgb([p.r, p.g, p.b], c);
        if (dd < d) {
          d = dd;
          melhor = i;
        }
      });
      return melhor;
    });
    return {paleta: alvo, indices};
  }

  const opacos = pixels.map((p, i) => ({...p, i})).filter((p) => p.a >= 0.5);
  const k = Math.max(1, Math.min(MAX_CORES, Math.floor(nCores)));
  const minMax = (px: typeof opacos) => [0, 1, 2].map((cc) => [
    Math.min(...px.map((p) => (cc === 0 ? p.r : cc === 1 ? p.g : p.b))),
    Math.max(...px.map((p) => (cc === 0 ? p.r : cc === 1 ? p.g : p.b))),
  ]);
  const caixaDe = (px: typeof opacos) => {
    const mm = minMax(px);
    return {px, min: mm.map((m) => m[0]), max: mm.map((m) => m[1])};
  };
  const caixas: {px: typeof opacos; min: number[]; max: number[]}[] = opacos.length ? [caixaDe(opacos)] : [];
  // median-cut: divide a caixa com mais alcance pelo canal de maior variação, na mediana. Caixa de uma cor só (alcance 0)
  // não se divide: daria cores repetidas na paleta.
  while (caixas.length < k) {
    let alvoI = -1;
    let alcance = -1;
    caixas.forEach((c, i) => {
      const spread = (c.max[0] - c.min[0]) + (c.max[1] - c.min[1]) + (c.max[2] - c.min[2]);
      if (spread > 0 && spread > alcance && c.px.length > 1) {
        alcance = spread;
        alvoI = i;
      }
    });
    if (alvoI < 0) break;
    const cx = caixas[alvoI];
    const canais = [0, 1, 2].map((ch) => ({
      ch,
      span: cx.max[ch] - cx.min[ch],
      variancia: (() => {
        const m = cx.px.reduce((s, p) => s + (ch === 0 ? p.r : ch === 1 ? p.g : p.b), 0) / cx.px.length;
        return cx.px.reduce((s, p) => s + ((ch === 0 ? p.r : ch === 1 ? p.g : p.b) - m) ** 2, 0);
      })(),
    }));
    const ch = canais.sort((a, b) => b.variancia - a.variancia)[0].ch;
    const ordenado = [...cx.px].sort((a, b) => (ch === 0 ? a.r - b.r : ch === 1 ? a.g - b.g : a.b - b.b));
    const meio = Math.floor(ordenado.length / 2);
    const a = ordenado.slice(0, meio);
    const b = ordenado.slice(meio);
    caixas[alvoI] = caixaDe(a);
    caixas.push(caixaDe(b));
  }
  // a mediana pode cair no meio de pixels iguais e deixar a mesma cor em duas caixas: a paleta fica sem repetição (os
  // índices vêm da cor mais próxima logo abaixo)
  const paleta = [...new Set(caixas.map((c) => {
    const n = c.px.length || 1;
    return hexDe(c.px.reduce((s, p) => s + p.r, 0) / n, c.px.reduce((s, p) => s + p.g, 0) / n, c.px.reduce((s, p) => s + p.b, 0) / n);
  }))];
  const rgb = paleta.map((c) => {
    const v = parseInt(c.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255] as [number, number, number];
  });
  const indices = pixels.map((p) => {
    if (p.a < 0.5) return -1;
    let melhor = 0;
    let d = Infinity;
    rgb.forEach((c, i) => {
      const dd = distanciaRgb([p.r, p.g, p.b], c);
      if (dd < d) {
        d = dd;
        melhor = i;
      }
    });
    return melhor;
  });
  return {paleta, indices};
};

/**
 * Imagem (RGBA) → grade de células. Reduz para `colunas × linhas` por média de área e quantiza para `cores` (ou para a
 * `paleta` dada, ex. o kit de marca). Célula quase toda transparente vira vazio (".").
 */
export const gradeDeImagem = (img: DadosImagem, o: {colunas: number; linhas: number; cores?: number; paleta?: string[]}): GradePixel => {
  const colunas = Math.max(1, Math.round(o.colunas));
  const linhas = Math.max(1, Math.round(o.linhas));
  const pixels: {r: number; g: number; b: number; a: number}[] = new Array(colunas * linhas);
  for (let l = 0; l < linhas; l++) {
    const y0 = Math.floor((l * img.altura) / linhas);
    const y1 = Math.max(y0 + 1, Math.floor(((l + 1) * img.altura) / linhas));
    for (let c = 0; c < colunas; c++) {
      const x0 = Math.floor((c * img.largura) / colunas);
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * img.largura) / colunas));
      pixels[l * colunas + c] = mediaArea(img, x0, y0, x1, y1);
    }
  }
  const {paleta, indices} = quantizar(pixels, o.cores ?? 8, o.paleta);
  return {colunas, linhas, paleta, celulas: codificarCelulas(indices)};
};

/** Grade vazia (tudo transparente), para começar a desenhar à mão. */
export const gradeVazia = (colunas: number, linhas: number, paleta: string[] = ['#000000', '#FFFFFF']): GradePixel => ({
  colunas,
  linhas,
  paleta,
  celulas: codificarCelulas(new Array(colunas * linhas).fill(-1)),
});
