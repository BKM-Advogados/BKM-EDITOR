// Animação 2D com quadros-chave e arte em pixel (docs/animacao.md). O documento é um JSON legível na pasta do projeto
// (`animacao/<id>.json`): a pessoa edita na tela, o agente edita pelo MCP (ferramentas criar_animacao, adicionar_camada,
// animar, pixelizar_imagem…), e os dois passam pelo mesmo JSON Patch com diário. Este arquivo é TypeScript puro (sem
// Remotion, sem DOM): tipos, validação com calma, curvas, interpolação de valores (inclusive de cor em OKLab) e a
// resolução do documento para as props da composição. A arte em pixel fica em animacao-pixel.ts.
import type {EfeitoPixel, GradePixel} from './animacao-pixel';

// ---------- tipos ----------
export type ModuloAnimacao = 'animacao';

export type TemaAnimacao = {fundo: string; texto: string; destaque: string; suave: string; fonte: string};

export type TipoCamadaAnimacao = 'forma' | 'texto' | 'imagem' | 'pixel';

/** Propriedades animáveis. Além destas, cada camada tem valores base fixos (largura, altura, texto, fonte…). */
export type PropriedadeAnimavel = 'x' | 'y' | 'escala' | 'rotacao' | 'opacidade' | 'cor' | 'tamanho' | 'tamanho_pixel' | 'progresso';

/** Como o valor sai de um quadro-chave até o próximo. `degrau` segura o valor até o quadro-chave seguinte. */
export type Curva = 'linear' | 'suave' | 'entrada' | 'saida' | 'mola' | 'degrau';

export type QuadroChave = {
  t_ms: number; // tempo no documento, em ms
  valor: number | string; // número; cor em "#rrggbb" ou "@destaque" etc.
  curva?: Curva; // a curva de saída deste quadro-chave (padrão linear)
};

/** `{propriedade: quadros-chave[]}`. A trilha vazia (ou ausente) vale a prop base da camada. */
export type TrilhasAnimacao = Partial<Record<PropriedadeAnimavel, QuadroChave[]>>;

export type CamadaAnimacao = {
  id: string;
  nome: string;
  tipo: TipoCamadaAnimacao;
  visivel?: boolean;
  travada?: boolean;
  // posição e transformação (x, y, escala, rotacao e opacidade são animáveis)
  x: number;
  y: number;
  largura: number;
  altura: number;
  escala?: number; // 1 = tamanho normal
  rotacao?: number; // graus
  opacidade?: number; // 0 a 1
  // forma
  cor?: string; // forma e texto: preenchimento / cor da letra; aceita "#rrggbb" ou "@destaque" etc.
  forma?: 'retangulo' | 'elipse';
  raio?: number; // retangulo: arredondamento dos cantos em px
  // texto
  texto?: string;
  fonte?: string;
  tamanho?: number; // px da letra (animável)
  peso?: number;
  alinhar?: 'esquerda' | 'centro' | 'direita';
  // imagem
  src?: string; // caminho no projeto (midia/…)
  ajuste?: 'cobrir' | 'conter';
  // pixel (animacao-pixel.ts)
  grade?: GradePixel;
  tamanho_pixel?: number; // px por célula (animável: de blocos grandes ao nítido)
  progresso?: number; // 0 a 1, a revelação (animável)
  efeito?: EfeitoPixel; // tipo de revelação
  semente?: number; // semente determinística da revelação
  trilhas?: TrilhasAnimacao;
};

export type DocAnimacao = {
  formato: 1;
  largura: number;
  altura: number;
  fps: number;
  duracao_ms: number;
  fundo: string; // "#rrggbb" ou "@fundo" etc.
  tema?: TemaAnimacao; // cores do kit de marca (aplicar_marca), para resolver @destaque etc.
  camadas: CamadaAnimacao[]; // de baixo para cima
};

export type PropsAnimacao = {
  composicao: 'Animacao';
  duracao_ms: number;
  largura: number;
  altura: number;
  fps: number;
  fundo: string;
  tema: TemaAnimacao;
  camadas: CamadaAnimacao[]; // normalizadas, com os valores base preenchidos
  base_midia?: string;
};

export const TEMA_ANIMACAO_NEUTRO: TemaAnimacao = {fundo: '#111418', texto: '#F2F2F2', destaque: '#70B8FF', suave: '#A3ABB5', fonte: 'Inter'};

// ---------- cores ----------
export const ehCorReferencia = (cor: string) => /^@[a-z_]+$/i.test(cor);

/** "@destaque" → a cor do tema; qualquer outra cor volta como está. O mesmo jeito do resto do app (o `tema`). */
export const resolverCor = (cor: string, tema: TemaAnimacao): string => {
  switch (cor) {
    case '@fundo': return tema.fundo;
    case '@texto': return tema.texto;
    case '@destaque': return tema.destaque;
    case '@suave': return tema.suave;
    default: return cor;
  }
};

const canalHex = (h: string, de: number) => parseInt(h.slice(de, de + 2), 16);

/** "#rrggbb" → [r, g, b] 0..255 (hex inválido vira 0, para nunca derrubar o render). */
export const hexParaRgb = (cor: string): [number, number, number] => {
  const h = cor.replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return [0, 0, 0];
  return [canalHex(h, 0), canalHex(h, 2), canalHex(h, 4)];
};

export const rgbParaHex = (r: number, g: number, b: number): string => {
  const v = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${v(r)}${v(g)}${v(b)}`.toUpperCase();
};

const linearDe = (c: number) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
};
const gammaDe = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);

/** sRGB → OKLab (espaço perceptualmente uniforme, para interpolar cor sem passar por tons de cinza). */
export const rgbParaOklab = (r: number, g: number, b: number): [number, number, number] => {
  const lr = linearDe(r);
  const lg = linearDe(g);
  const lb = linearDe(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
};

/** OKLab → sRGB. */
export const oklabParaRgb = (L: number, a: number, b: number): [number, number, number] => {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b2 = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  return [gammaDe(r) * 255, gammaDe(g) * 255, gammaDe(b2) * 255];
};

/** Duas cores em OKLab (hex ou @ref, já resolvidas), na proporção `u` de 0 a 1. */
export const interpolarCor = (a: string, b: string, u: number): string => {
  const [r1, g1, b1] = hexParaRgb(a);
  const [r2, g2, b2] = hexParaRgb(b);
  const [L1, a1, b1_] = rgbParaOklab(r1, g1, b1);
  const [L2, a2, b2_] = rgbParaOklab(r2, g2, b2);
  const [R, G, B] = oklabParaRgb(L1 + (L2 - L1) * u, a1 + (a2 - a1) * u, b1_ + (b2_ - b1_) * u);
  return rgbParaHex(R, G, B);
};

// ---------- curvas ----------
/** A curva aplicada ao progresso `u` (0 a 1) entre dois quadros-chave. */
export const aliviar = (curva: Curva, u: number): number => {
  switch (curva) {
    case 'linear': return u;
    case 'suave': return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    case 'entrada': return u * u * u;
    case 'saida': return 1 - Math.pow(1 - u, 3);
    case 'mola': {
      // ease-out-back: sobe com um "pulo" (overshoot) característico de mola
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
    }
    case 'degrau': return 0; // segura o valor do quadro-chave anterior até o seguinte
  }
};

export const CURVAS: {id: Curva; nome: string}[] = [
  {id: 'linear', nome: 'Linear'},
  {id: 'suave', nome: 'Suave'},
  {id: 'entrada', nome: 'Entrada'},
  {id: 'saida', nome: 'Saída'},
  {id: 'mola', nome: 'Mola'},
  {id: 'degrau', nome: 'Degrau'},
];

// ---------- valores ----------
const num = (v: unknown, padrao: number) => (typeof v === 'number' && Number.isFinite(v) ? v : padrao);

/** Valor base de uma propriedade numa camada (o que vale sem trilha). */
export const valorBase = (camada: CamadaAnimacao, prop: PropriedadeAnimavel): number | string => {
  switch (prop) {
    case 'x': return num(camada.x, 0);
    case 'y': return num(camada.y, 0);
    case 'escala': return num(camada.escala, 1);
    case 'rotacao': return num(camada.rotacao, 0);
    case 'opacidade': return num(camada.opacidade, 1);
    case 'cor': return camada.cor ?? '#FFFFFF';
    case 'tamanho': return num(camada.tamanho, 40);
    case 'tamanho_pixel': return num(camada.tamanho_pixel, 8);
    case 'progresso': return num(camada.progresso, 1);
  }
};

/** Interpola dois valores de quadro-chave na proporção `e` (0 a 1). Números interpolam em linha; cores, em OKLab. */
export const interpolar = (a: number | string, b: number | string, e: number): number | string => {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * e;
  return interpolarCor(String(a), String(b), e);
};

/**
 * Valor de uma propriedade no instante `t_ms`. Sem trilha (ou trilha vazia), vale a prop base. Antes do primeiro
 * quadro-chave vale o dele; depois do último, o dele. Entre dois, interpola pela curva do quadro-chave de saída.
 */
export const valorEm = (camada: CamadaAnimacao, prop: PropriedadeAnimavel, t_ms: number): number | string => {
  const base = valorBase(camada, prop);
  const trilha = camada.trilhas?.[prop];
  if (!trilha || !trilha.length) return base;
  const ks = [...trilha].sort((a, b) => a.t_ms - b.t_ms);
  const primeiro = ks[0];
  const ultimo = ks[ks.length - 1];
  if (t_ms <= primeiro.t_ms) return primeiro.valor;
  if (t_ms >= ultimo.t_ms) return ultimo.valor;
  let i = 0;
  while (i < ks.length - 1 && ks[i + 1].t_ms <= t_ms) i++;
  const a = ks[i];
  const b = ks[i + 1];
  if (b.t_ms <= a.t_ms) return b.valor;
  const u = (t_ms - a.t_ms) / (b.t_ms - a.t_ms);
  return interpolar(a.valor, b.valor, aliviar(a.curva ?? 'linear', u));
};

// ---------- normalização e resolução ----------
const LIMITE = {largura: 7680, altura: 7680, fps: 120, duracao: 60 * 60 * 1000};

/** Lê um documento com calma: campo fora do lugar volta ao padrão, nunca derruba o app. */
export const normalizarAnimacao = (x: unknown): DocAnimacao => {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const menor = Math.min(num(o.largura, 1920), LIMITE.largura);
  const camadas = (Array.isArray(o.camadas) ? o.camadas : []).map((c): CamadaAnimacao => {
    const l = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
    const tipo: TipoCamadaAnimacao = ['forma', 'texto', 'imagem', 'pixel'].includes(l.tipo as string) ? (l.tipo as TipoCamadaAnimacao) : 'forma';
    const trilhas: TrilhasAnimacao = {};
    if (l.trilhas && typeof l.trilhas === 'object') {
      for (const [p, lista] of Object.entries(l.trilhas as Record<string, unknown>)) {
        if (!(Array.isArray(lista))) continue;
        trilhas[p as PropriedadeAnimavel] = lista.map((q): QuadroChave => {
          const k = (q && typeof q === 'object' ? q : {}) as Record<string, unknown>;
          return {t_ms: num(k.t_ms, 0), valor: (typeof k.valor === 'number' || typeof k.valor === 'string') ? k.valor : 0,
            ...(typeof k.curva === 'string' && CURVAS.some((c) => c.id === k.curva) ? {curva: k.curva as Curva} : {})};
        });
      }
    }
    return {
      id: typeof l.id === 'string' ? l.id : 'camada',
      nome: typeof l.nome === 'string' ? l.nome : 'Camada',
      tipo,
      ...(l.visivel === false ? {visivel: false} : {}),
      ...(l.travada === true ? {travada: true} : {}),
      x: num(l.x, 0),
      y: num(l.y, 0),
      largura: num(l.largura, 100),
      altura: num(l.altura, 100),
      ...(l.escala !== undefined ? {escala: num(l.escala, 1)} : {}),
      ...(l.rotacao !== undefined ? {rotacao: num(l.rotacao, 0)} : {}),
      ...(l.opacidade !== undefined ? {opacidade: num(l.opacidade, 1)} : {}),
      ...(typeof l.cor === 'string' ? {cor: l.cor} : {}),
      ...(l.forma === 'elipse' ? {forma: 'elipse' as const} : {}),
      ...(l.raio !== undefined ? {raio: num(l.raio, 0)} : {}),
      ...(typeof l.texto === 'string' ? {texto: l.texto} : {}),
      ...(typeof l.fonte === 'string' ? {fonte: l.fonte} : {}),
      ...(l.tamanho !== undefined ? {tamanho: num(l.tamanho, 40)} : {}),
      ...(l.peso !== undefined ? {peso: num(l.peso, 400)} : {}),
      ...(l.alinhar === 'esquerda' || l.alinhar === 'direita' ? {alinhar: l.alinhar} : {}),
      ...(typeof l.src === 'string' ? {src: l.src} : {}),
      ...(l.ajuste === 'cobrir' ? {ajuste: 'cobrir' as const} : {}),
      ...(l.grade && typeof l.grade === 'object' ? {grade: l.grade as GradePixel} : {}),
      ...(l.tamanho_pixel !== undefined ? {tamanho_pixel: num(l.tamanho_pixel, 8)} : {}),
      ...(l.progresso !== undefined ? {progresso: num(l.progresso, 1)} : {}),
      ...(typeof l.efeito === 'string' ? {efeito: l.efeito as EfeitoPixel} : {}),
      ...(l.semente !== undefined ? {semente: num(l.semente, 1)} : {}),
      ...(Object.keys(trilhas).length ? {trilhas} : {}),
    };
  });
  return {
    formato: 1,
    largura: Math.max(16, Math.round(num(o.largura, 1920))),
    altura: Math.max(16, Math.round(num(o.altura, 1080))),
    fps: Math.max(1, Math.min(LIMITE.fps, Math.round(num(o.fps, 30)))),
    duracao_ms: Math.max(100, Math.min(LIMITE.duracao, num(o.duracao_ms, 3000))),
    fundo: typeof o.fundo === 'string' ? o.fundo : TEMA_ANIMACAO_NEUTRO.fundo,
    ...(o.tema && typeof o.tema === 'object' ? {tema: o.tema as TemaAnimacao} : {}),
    camadas,
    ...(menor < 16 ? {} : {}),
  };
};

/** Props da composição Animacao, com o tema resolvido e avisos. Valores fora do lugar viram aviso, nunca erro. */
export const resolverAnimacao = (doc: DocAnimacao, base_midia?: string): {props: PropsAnimacao; avisos: string[]} => {
  const avisos: string[] = [];
  const d = normalizarAnimacao(doc);
  const tema = {...TEMA_ANIMACAO_NEUTRO, ...(d.tema ?? {})};
  if (d.camadas.some((c) => !c.id || c.id === 'camada')) avisos.push('há camadas sem id: dê um id único a cada uma');
  return {
    props: {
      composicao: 'Animacao',
      duracao_ms: d.duracao_ms,
      largura: d.largura,
      altura: d.altura,
      fps: d.fps,
      fundo: d.fundo,
      tema,
      camadas: d.camadas,
      ...(base_midia ? {base_midia} : {}),
    },
    avisos,
  };
};

// ---------- criação ----------
export const idLivreAnimacao = (doc: DocAnimacao, base: string): string => {
  const usados = new Set(doc.camadas.map((c) => c.id));
  let n = 1;
  while (usados.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
};

/** Documento novo "em branco" (16:9 ou 9:16), com uma forma de exemplo centrada para a pessoa ver a animação de cara. */
export const novaAnimacao = (largura: number, altura: number, fps = 30): DocAnimacao => {
  const menor = Math.min(largura, altura);
  const lado = Math.round(menor * 0.3);
  return {
    formato: 1,
    largura,
    altura,
    fps,
    duracao_ms: 3000,
    fundo: TEMA_ANIMACAO_NEUTRO.fundo,
    camadas: [{
      id: 'forma-1',
      nome: 'Forma',
      tipo: 'forma',
      x: Math.round((largura - lado) / 2),
      y: Math.round((altura - lado) / 2),
      largura: lado,
      altura: lado,
      forma: 'retangulo',
      cor: '@destaque',
      raio: Math.round(lado * 0.12),
    }],
  };
};

export const novaCamadaAnimacao = (tipo: TipoCamadaAnimacao, id: string): CamadaAnimacao => {
  const base: CamadaAnimacao = {id, nome: tipo[0].toUpperCase() + tipo.slice(1), tipo, x: 100, y: 100, largura: 200, altura: 120};
  switch (tipo) {
    case 'forma': return {...base, cor: '@destaque', forma: 'retangulo', raio: 12};
    case 'texto': return {...base, texto: 'Seu texto', fonte: 'Inter', tamanho: 48, peso: 700, cor: '#FFFFFF', alinhar: 'centro'};
    case 'imagem': return {...base, ajuste: 'conter'};
    case 'pixel': return {...base, tamanho_pixel: 8, progresso: 1, efeito: 'aleatorio', semente: 1};
  }
};

export type {EfeitoPixel};
