// Medidas do som pelo núcleo (frente 3 do MCP): envelope, loudness da mistura e limpeza de voz. A conta pesada (decodificar
// com o ffmpeg do Remotion, a limpeza em TypeScript) mora no processo principal (src/main/medidas.ts), sem Electron, e é
// injetada aqui por definirServicoMedidas, como as prévias: o app liga o dele no main.ts e o MCP por stdio (mcp/nucleo.ts,
// mcp/desktop.ts) liga o mesmo, com o ffmpeg do node_modules ou do app instalado. Assim o áudio posto pelo agente com o
// app fechado já ganha duração, forma de onda e ducking, sem esperar a tela abrir.
// Aqui também ficam os patches da limpeza de voz num clipe (trocar o arquivo pelo limpo, voltar ao original), os mesmos
// da tela (src/renderer/modulos/video/acoes-audio.ts) e do limpar_voz do MCP.
import type {Envelope, IntensidadeLimpeza, LimpezaClipe} from './audio';
import type {OperacaoPatch} from './documentos';
import type {MedidasLoudness} from './loudness';
import type {Projeto} from './projeto';

export type ResultadoLimpeza = {arquivo: string; medidas: LimpezaClipe; duracao_ms: number};

export type ServicoMedidas = {
  /** Mede o envelope de um áudio do projeto e grava midia/<arquivo>.envelope.json ao lado, carimbado; devolve-o. */
  envelope: (projeto: Projeto, arquivo: string) => Promise<Envelope>;
  /** Loudness BS.1770 da mistura do vídeo, da voz e de cada faixa, como o medidor da tela; `erro` se não houver som. */
  loudness: (projeto: Projeto, documento: string) => Promise<MedidasLoudness | {erro: string}>;
  /** Limpa a voz de um áudio do projeto em <arquivo>.limpo*.wav (o original fica intacto) e grava o envelope do limpo. */
  limparVoz: (projeto: Projeto, arquivo: string, intensidade: IntensidadeLimpeza, aoProgresso?: (fracao: number) => void) => Promise<ResultadoLimpeza>;
};

let servico: ServicoMedidas | null = null;
export const definirServicoMedidas = (s: ServicoMedidas | null) => {
  servico = s;
};
export const servicoMedidas = () => servico;
export const exigirServicoMedidas = () => {
  if (!servico) throw new Error('as medidas do som precisam do ffmpeg do Estúdio, que não está disponível neste servidor MCP');
  return servico;
};

/** Mede o envelope (duração e forma de onda) de um áudio do projeto e grava o .envelope.json ao lado; devolve o envelope.
 *  Para quem traz áudio ao projeto (importar mídia, trilha, narração): sem ele o clipe fica sem duração e sem ducking até
 *  a tela abrir. Lança se o serviço não estiver ligado ou o arquivo não abrir; quem só quer tentar põe um catch. */
export const medirEnvelopeDoAudio = async (projeto: Projeto, arquivo: string): Promise<Envelope> => exigirServicoMedidas().envelope(projeto, arquivo);

// ---------- limpeza de voz num clipe: os patches da tela e do MCP ----------
type ClipeComLimpeza = {id?: unknown; arquivo: string; original?: string; limpeza?: LimpezaClipe};

const valorEm = (doc: unknown, caminho: string): unknown =>
  caminho.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~')).reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), doc);

/** Troca um valor conferindo o antigo (test), como o patchTrocar da tela; undefined remove. */
const trocar = (doc: unknown, caminho: string, valor: unknown): OperacaoPatch[] => {
  const antigo = valorEm(doc, caminho);
  if (antigo === undefined) return valor === undefined ? [] : [{op: 'add', path: caminho, value: valor}];
  if (valor === undefined) return [{op: 'test', path: caminho, value: antigo}, {op: 'remove', path: caminho}];
  return [{op: 'test', path: caminho, value: antigo}, {op: 'replace', path: caminho, value: valor}];
};
const testeId = (caminho: string, id: unknown): OperacaoPatch[] => (typeof id === 'string' ? [{op: 'test', path: `${caminho}/id`, value: id}] : []);

/** O arquivo de onde a limpeza parte: sempre o da pessoa, nunca o já limpo. */
export const origemDaLimpeza = (c: ClipeComLimpeza) => c.original ?? c.arquivo;

/** O clipe em `caminho` passa a tocar o arquivo limpo, guardando o original e as medidas. Corte e duração ficam: o WAV
 *  limpo tem o mesmo tamanho. */
export const patchLimpezaDoClipe = (doc: unknown, caminho: string, c: ClipeComLimpeza, r: {arquivo: string; medidas: LimpezaClipe}): OperacaoPatch[] => [
  ...testeId(caminho, c.id), ...trocar(doc, `${caminho}/arquivo`, r.arquivo), ...trocar(doc, `${caminho}/original`, origemDaLimpeza(c)),
  ...trocar(doc, `${caminho}/limpeza`, r.medidas),
];

/** O clipe volta a tocar o arquivo da pessoa; o limpo fica em midia/. Vazio se o clipe já está no original. */
export const patchVoltarAoOriginalDoClipe = (doc: unknown, caminho: string, c: ClipeComLimpeza): OperacaoPatch[] =>
  c.original ? [...testeId(caminho, c.id), ...trocar(doc, `${caminho}/arquivo`, c.original), ...trocar(doc, `${caminho}/original`, undefined),
    ...trocar(doc, `${caminho}/limpeza`, undefined)] : [];
