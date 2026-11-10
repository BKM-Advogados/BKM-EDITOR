// Contraste da marca d'água com o fundo onde ela cai (rodada 3, frente C): a marca tem de ler em fundo claro e escuro, pelo
// menos 3:1 (o mínimo do WCAG para elementos gráficos e texto grande). A conta é pura; quem mede os pixels é o processo
// principal (src/main/contraste-marca.ts), que renderiza um quadro do destino sem a marca e outro com ela e acha, na caixa da
// marca, o fundo e a cor que a marca tem de fato na tela (já com a opacidade).
import type {ConfigMarcaDagua, Destino, OpcoesExportarVideo} from './exportacao';

export type RGB = [number, number, number]; // 0 a 255

export const CONTRASTE_MINIMO = 3;

const linear = (v: number) => {
  const c = Math.min(255, Math.max(0, v)) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Luminância relativa (WCAG 2): 0 preto, 1 branco. */
export const luminancia = (c: RGB): number => 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);

/** Razão de contraste entre duas cores, de 1 a 21. */
export const razaoDeContraste = (a: RGB, b: RGB): number => {
  const [la, lb] = [luminancia(a), luminancia(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

export type MedidaContraste = {quadro_ms: number; fundo: RGB; marca: RGB | null; contraste: number | null};
export type AvaliacaoContraste = {contraste: number | null; ok: boolean; quadro_ms: number | null; fundo: RGB | null; marca: RGB | null; medidas: MedidaContraste[]};

/** O pior quadro manda: a marca tem de ler em todos. `ok` quando o menor contraste chega a `minimo`; sem medida (marca que
 *  não apareceu, opacidade zero), contraste null e ok falso. */
export const avaliarContraste = (medidas: MedidaContraste[], minimo = CONTRASTE_MINIMO): AvaliacaoContraste => {
  const com = medidas.filter((m): m is MedidaContraste & {contraste: number} => m.contraste !== null);
  if (!com.length) return {contraste: null, ok: false, quadro_ms: null, fundo: null, marca: null, medidas};
  const pior = com.reduce((a, b) => (b.contraste < a.contraste ? b : a));
  return {contraste: pior.contraste, ok: pior.contraste >= minimo, quadro_ms: pior.quadro_ms, fundo: pior.fundo, marca: pior.marca, medidas};
};

export const PLACAS = {escura: '#171A19', clara: '#F4F0EA'} as const; // um grafite quase preto e um branco quente
export type CorDaPlaca = keyof typeof PLACAS;

const hexParaRgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** A placa atrás da marca que dá mais contraste com a cor dela: escura para marca clara, clara para marca escura. */
export const placaParaMarca = (marca: RGB): CorDaPlaca =>
  razaoDeContraste(marca, hexParaRgb(PLACAS.escura)) >= razaoDeContraste(marca, hexParaRgb(PLACAS.clara)) ? 'escura' : 'clara';

/** Quadros onde medir: três pontos do vídeo (25%, 50% e 75% do trecho), em ms. Trecho curtíssimo: um só, no meio. */
export const quadrosParaMedir = (duracaoMs: number, trecho?: {de_ms: number; ate_ms: number} | null): number[] => {
  const de = trecho ? trecho.de_ms : 0;
  const ate = trecho ? trecho.ate_ms : duracaoMs;
  const dur = Math.max(0, ate - de);
  if (dur < 600) return [Math.round(de + dur / 2)];
  return [0.25, 0.5, 0.75].map((f) => Math.round(de + dur * f));
};

/** Média dos pixels (rgb24) de dois buffers de mesmo tamanho: o fundo (todos os pixels de `sem`) e a cor da marca (só os pixels
 *  em que `com` difere de `sem` além do limiar, e do lado em que a maioria deles difere: mais clara ou mais escura que o fundo;
 *  a sombra do texto não puxa a média). */
export const medirNaCaixa = (sem: Uint8Array, com: Uint8Array, limiar = 3): {fundo: RGB; marca: RGB | null} => {
  const n = Math.floor(Math.min(sem.length, com.length) / 3);
  const soma: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) soma[k] += sem[i * 3 + k];
  const fundo: RGB = n ? [soma[0] / n, soma[1] / n, soma[2] / n] : [0, 0, 0];
  const lum = (b: Uint8Array, i: number) => luminancia([b[i * 3], b[i * 3 + 1], b[i * 3 + 2]]);
  const candidatos: {i: number; lado: number}[] = [];
  for (let i = 0; i < n; i++) {
    const d = Math.max(Math.abs(com[i * 3] - sem[i * 3]), Math.abs(com[i * 3 + 1] - sem[i * 3 + 1]), Math.abs(com[i * 3 + 2] - sem[i * 3 + 2]));
    if (d > limiar) candidatos.push({i, lado: Math.sign(lum(com, i) - lum(sem, i))});
  }
  if (!candidatos.length) return {fundo, marca: null};
  const claros = candidatos.filter((c) => c.lado > 0).length;
  const lado = claros * 2 >= candidatos.length ? 1 : -1;
  const usados = candidatos.filter((c) => c.lado === lado);
  const m: [number, number, number] = [0, 0, 0];
  for (const {i} of usados) for (let k = 0; k < 3; k++) m[k] += com[i * 3 + k];
  return {fundo, marca: [m[0] / usados.length, m[1] / usados.length, m[2] / usados.length]};
};

// ---------- o pedido e o resultado da medida, e quem mede ----------
// O diálogo de exportar (IPC) e o MCP (medir_contraste_marca) pedem a mesma medida; quem renderiza os quadros é o processo principal,
// que se registra aqui ao subir, como o removedor de fundo (src/nucleo/remover-fundo.ts). Fora do app não há quem meça.

export type PedidoContrasteDestino = {
  destino: Destino;
  config: ConfigMarcaDagua;
  proporcao_logo?: number;
  proporcao_texto?: number;
  trecho?: OpcoesExportarVideo['trecho'];
};
export type ResultadoContraste = {ok: true; avaliacao: AvaliacaoContraste} | {ok: false; mensagem: string};
export type MedidorDeContraste = (documento: string, pedido: PedidoContrasteDestino) => Promise<ResultadoContraste>;

let medidor: MedidorDeContraste | null = null;
export const definirMedidorDeContraste = (f: MedidorDeContraste | null) => {
  medidor = f;
};
export const medidorDeContraste = () => medidor;

const br = (n: number, casas = 1) => n.toFixed(casas).replace('.', ',');

/** A medida em texto curto para quem lê pelo MCP: o pior quadro, cada quadro e, se ficou abaixo do mínimo, o que fazer. */
export const textoDoContraste = (a: AvaliacaoContraste, destino: string, placaAtual?: CorDaPlaca, minimo = CONTRASTE_MINIMO): string => {
  if (a.contraste === null) {
    return `Contraste da marca em ${destino}: não deu para medir, a marca não apareceu nos quadros medidos. Confira a opacidade e se o kit tem logo ou assinatura.`;
  }
  const linhas = [
    `Contraste da marca em ${destino}: ${br(a.contraste)}:1 no pior quadro (${br((a.quadro_ms ?? 0) / 1000)} s); o mínimo é ${minimo}:1, ${a.ok ? 'passa' : 'NÃO passa'}.`,
    ...a.medidas.map((m) => `  ${br(m.quadro_ms / 1000)} s: ${m.contraste === null ? 'a marca não apareceu' : `${br(m.contraste)}:1`}`),
  ];
  if (!a.ok) {
    const sugerida = a.marca ? placaParaMarca(a.marca) : 'escura';
    linhas.push(placaAtual
      ? `Mesmo com a placa ${placaAtual}, ficou abaixo: troque a placa para "${placaAtual === 'escura' ? 'clara' : 'escura'}", ou use a outra opção de conteúdo (logo ou assinatura).`
      : `Para passar: marca_dagua com placa "${sugerida}" (uma placa ${sugerida} atrás da marca) ou outro canto.`);
  }
  return linhas.join('\n');
};
