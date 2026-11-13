// Web Worker do som da música: a mesma conta de src/nucleo/musica-som.ts, fora da thread da interface. Guarda os áudios
// decodificados (a janela manda cada um uma vez) e o cache por camada (canal seco, faixa processada, reverb), então a
// prévia e o render que vai para o vídeo, feitos do mesmo documento, reaproveitam um ao outro. Para o vídeo, devolve
// também o WAV, a medida (LUFS e pico) e o envelope, prontos para o processo principal gravar.
import {envelopeDeAmostras, type Envelope} from '../../../nucleo/audio';
import {medirAmostras, type FonteAudio} from '../../../nucleo/loudness';
import type {DocMusica} from '../../../nucleo/musica';
import {codificarWav16, renderizarMusica, type CacheSom} from '../../../nucleo/musica-som';
import {entregaEmBytes, type EntregaEmBytes, type PedidoEntrega} from '../../../nucleo/musica-entrega';
import {hashDoPcm} from '../../../nucleo/musica-hash';

export type PedidoRender =
  | {id: number; tipo: 'fonte'; arquivo: string; canais: Float32Array[]; taxa: number}
  | {id: number; tipo: 'esquecer'; arquivo?: string}
  | {id: number; tipo: 'render'; doc: DocMusica; taxa: number; paraVideo?: boolean; porFaixa?: boolean; hash?: boolean}
  | {id: number; tipo: 'entrega'; doc: DocMusica; pedido: PedidoEntrega};
export type MedidaSom = {integrado_lufs: number | null; pico_dbtp: number | null};
export type RespostaRender =
  | {id: number; ok: true; canais?: Float32Array[]; duracao_s?: number; avisos?: string[]; faltando?: string[]; ms?: number; medida?: MedidaSom;
    faixas?: Record<string, MedidaSom>; envelope?: Envelope; wav?: Uint8Array; niveis?: NiveisSom; entrega?: EntregaEmBytes; limitador_db?: number;
    pcm_sha256?: string; amostras?: number}
  | {id: number; ok: false; mensagem: string};

/** Pico em dBFS a cada 50 ms, por faixa do mixer (depois do volume e do pan) e do master: o medidor ao vivo lê na cabeça. */
export type NiveisSom = {janela_s: number; faixas: Record<string, Float32Array>; master: Float32Array};
const JANELA_NIVEL_S = 0.05;
const picos = (canais: Float32Array[], taxa: number) => {
  const passo = Math.max(1, Math.round(taxa * JANELA_NIVEL_S));
  const n = Math.ceil((canais[0]?.length ?? 0) / passo);
  const out = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    let p = 0;
    for (const c of canais) for (let i = j * passo, f = Math.min(c.length, i + passo); i < f; i++) p = Math.max(p, Math.abs(c[i]));
    out[j] = p > 0 ? 20 * Math.log10(p) : -100;
  }
  return out;
};

const fontes = new Map<string, FonteAudio>();
const cache: CacheSom = new Map();
const responder = (r: RespostaRender, transferir: Transferable[] = []) => (self as unknown as Worker).postMessage(r, transferir);

self.addEventListener('message', (e: MessageEvent<PedidoRender>) => {
  const p = e.data;
  try {
    if (p.tipo === 'fonte') {
      fontes.set(p.arquivo, {canais: p.canais, taxa: p.taxa});
      return responder({id: p.id, ok: true});
    }
    if (p.tipo === 'esquecer') {
      if (p.arquivo) fontes.delete(p.arquivo);
      else fontes.clear();
      cache.clear();
      return responder({id: p.id, ok: true});
    }
    const t0 = performance.now();
    if (p.tipo === 'entrega') {
      // a música em arquivo (item 23): no alvo de loudness, com os stems; os bytes vão transferidos
      const entrega = entregaEmBytes(p.doc, Object.fromEntries(fontes), {...p.pedido, cache});
      return responder({id: p.id, ok: true, entrega, ms: Math.round(performance.now() - t0)}, [entrega.mistura.buffer, ...(entrega.stems ?? []).map((x) => x.wav.buffer)]);
    }
    const r = renderizarMusica(p.doc, Object.fromEntries(fontes), {taxa: p.taxa, cache, porFaixa: p.porFaixa || !p.paraVideo});
    const ms = Math.round(performance.now() - t0);
    const medir = (c: Float32Array[]) => {
      const m = medirAmostras(c, p.taxa);
      return {integrado_lufs: m.integrado_lufs, pico_dbtp: m.pico_dbtp};
    };
    if (p.paraVideo) {
      const wav = codificarWav16(r.canais, p.taxa);
      return responder({id: p.id, ok: true, duracao_s: r.duracao_s, avisos: r.avisos, faltando: r.faltando, ms, medida: medir(r.canais),
        envelope: envelopeDeAmostras(r.canais, p.taxa), wav, ...(p.hash ? {pcm_sha256: hashDoPcm(r.canais), amostras: r.canais[0].length} : {}), ...(r.faixas ? {faixas: Object.fromEntries(Object.entries(r.faixas).map(([k, c]) => [k, medir(c)]))} : {})},
      [wav.buffer]);
    }
    // a mistura é nova a cada render (o cache guarda as camadas, não ela): vai transferida, sem cópia
    const canais = r.canais;
    const niveis: NiveisSom = {janela_s: JANELA_NIVEL_S, master: picos(canais, p.taxa),
      faixas: Object.fromEntries(Object.entries(r.faixas ?? {}).map(([k, c]) => [k, picos(c, p.taxa)]))};
    return responder({id: p.id, ok: true, canais, duracao_s: r.duracao_s, avisos: r.avisos, faltando: r.faltando, ms, niveis, ...(r.limitador_db !== undefined ? {limitador_db: r.limitador_db} : {})},
      canais.map((c) => c.buffer));
  } catch (erro) {
    return responder({id: p.id, ok: false, mensagem: String((erro as Error)?.message ?? erro)});
  }
});
