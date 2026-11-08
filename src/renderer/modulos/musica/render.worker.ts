// Web Worker do som da música: a mesma conta de src/nucleo/musica-som.ts, fora da thread da interface. Guarda os áudios
// decodificados (a janela manda cada um uma vez) e o cache por camada (canal seco, faixa processada, reverb), então a
// prévia e o render que vai para o vídeo, feitos do mesmo documento, reaproveitam um ao outro. Para o vídeo, devolve
// também o WAV, a medida (LUFS e pico) e o envelope, prontos para o processo principal gravar.
import {envelopeDeAmostras, type Envelope} from '../../../nucleo/audio';
import {medirAmostras, type FonteAudio} from '../../../nucleo/loudness';
import type {DocMusica} from '../../../nucleo/musica';
import {codificarWav16, renderizarMusica, type CacheSom} from '../../../nucleo/musica-som';

export type PedidoRender =
  | {id: number; tipo: 'fonte'; arquivo: string; canais: Float32Array[]; taxa: number}
  | {id: number; tipo: 'esquecer'; arquivo?: string}
  | {id: number; tipo: 'render'; doc: DocMusica; taxa: number; paraVideo?: boolean; porFaixa?: boolean};
export type MedidaSom = {integrado_lufs: number | null; pico_dbtp: number | null};
export type RespostaRender =
  | {id: number; ok: true; canais?: Float32Array[]; duracao_s?: number; avisos?: string[]; faltando?: string[]; ms?: number; medida?: MedidaSom;
    faixas?: Record<string, MedidaSom>; envelope?: Envelope; wav?: Uint8Array}
  | {id: number; ok: false; mensagem: string};

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
    const r = renderizarMusica(p.doc, Object.fromEntries(fontes), {taxa: p.taxa, cache, porFaixa: p.porFaixa});
    const ms = Math.round(performance.now() - t0);
    const medir = (c: Float32Array[]) => {
      const m = medirAmostras(c, p.taxa);
      return {integrado_lufs: m.integrado_lufs, pico_dbtp: m.pico_dbtp};
    };
    if (p.paraVideo) {
      const wav = codificarWav16(r.canais, p.taxa);
      return responder({id: p.id, ok: true, duracao_s: r.duracao_s, avisos: r.avisos, faltando: r.faltando, ms, medida: medir(r.canais),
        envelope: envelopeDeAmostras(r.canais, p.taxa), wav, ...(r.faixas ? {faixas: Object.fromEntries(Object.entries(r.faixas).map(([k, c]) => [k, medir(c)]))} : {})},
      [wav.buffer]);
    }
    // a mistura é nova a cada render (o cache guarda as camadas, não ela): vai transferida, sem cópia
    const canais = r.canais;
    return responder({id: p.id, ok: true, canais, duracao_s: r.duracao_s, avisos: r.avisos, faltando: r.faltando, ms}, canais.map((c) => c.buffer));
  } catch (erro) {
    return responder({id: p.id, ok: false, mensagem: String((erro as Error)?.message ?? erro)});
  }
});
