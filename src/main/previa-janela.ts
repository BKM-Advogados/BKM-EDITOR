// O serviço das prévias desenhadas pela janela (src/nucleo/mcp-previa-janela.ts: ver_imagem e ver_cena_3d): o processo
// principal manda o documento lido do disco à janela pela ponte (ponte-janela.ts) e recebe o PNG e a miniatura em bytes.
// A janela atende em src/renderer/previas-janela.ts. Sem janela, ou com ela noutro projeto, a resposta vem com ok: false
// e a mensagem chega ao agente pedindo para abrir o projeto no Estúdio.
import type {QuadroDaJanela, ServicoPreviaJanela} from '../nucleo/mcp-previa-janela';
import {SEM_JANELA} from '../nucleo/mcp-previa-janela';
import type {PedirAJanela} from './ponte-janela';

export const ACAO_PREVIA_IMAGEM = 'previa:imagem';
export const ACAO_PREVIA_CENA3D = 'previa:cena3d';
const TEMPO_MS = 120_000; // a imagem grande com muitas fotos e efeitos leva segundos; o 3D, menos

const bytes = (x: unknown): Uint8Array | null => (x instanceof Uint8Array ? x : x instanceof ArrayBuffer ? new Uint8Array(x) : null);

/** O que a janela devolveu, conferido; lança com a mensagem dela (ou a de sem janela). */
export const quadroDaResposta = (r: {ok: boolean; dados?: unknown; mensagem?: string}): QuadroDaJanela => {
  if (!r.ok) throw new Error(/sem janela|não atende/.test(r.mensagem ?? '') ? SEM_JANELA : `a janela do Estúdio não desenhou a prévia: ${r.mensagem ?? 'sem resposta'}`);
  const d = (r.dados ?? {}) as Record<string, unknown>;
  const png = bytes(d.png);
  if (!png?.byteLength || typeof d.largura !== 'number' || typeof d.altura !== 'number') throw new Error('a janela do Estúdio devolveu uma prévia vazia');
  return {png, miniatura: bytes(d.miniatura), largura: d.largura, altura: d.altura, ...(Array.isArray(d.faltaram) ? {faltaram: d.faltaram.map(String)} : {})};
};

export const servicoDePreviaJanela = (pedir: PedirAJanela): ServicoPreviaJanela => ({
  imagem: async (projeto, p) => quadroDaResposta(await pedir(ACAO_PREVIA_IMAGEM, {raiz: projeto.raiz, ...p}, {tempo_ms: TEMPO_MS})),
  cena3d: async (projeto, p) => quadroDaResposta(await pedir(ACAO_PREVIA_CENA3D, {raiz: projeto.raiz, ...p}, {tempo_ms: TEMPO_MS})),
});
