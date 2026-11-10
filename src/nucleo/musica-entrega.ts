// A música em arquivo (item 23), em TypeScript puro: a mistura no alvo de loudness (o do documento, padrão −14 LUFS
// integrado e pico verdadeiro até −1 dBTP), os stems e o WAV de 24 bits. A mesma conta no Web Worker da janela e no
// processo principal (sem janela); a codificação em M4A e Opus fica no processo principal, pelo ffmpeg do Remotion.
// O ganho que leva ao alvo vale para tudo; o limitador da entrega só segura o pico da mistura. Os stems levam o mesmo
// ganho, sem limitador: somados, dão a mistura antes dele. Ver docs/musica.md, "Exportar".
import {medirAmostras, type FonteAudio} from './loudness';
import {resolverMusica, type DocMusica} from './musica';
import {ganhoDaAutomacao, limitarNoLugar, renderizarMusica, TAXA_MUSICA, type CacheSom} from './musica-som';

export const ALVO_LUFS_MUSICA = -14;
export const PICO_DBTP_MUSICA = -1;
const TOLERANCIA_LU = 0.3;

export type MedidaEntrega = {alvo_lufs: number; pico_dbtp_alvo: number; antes_lufs: number | null; antes_pico_dbtp: number | null; lufs: number | null; pico_dbtp: number | null;
  ganho_db: number; limitador_db: number; no_alvo: boolean};

const r1 = (x: number) => Math.round(x * 10) / 10;

/** Leva a mistura ao alvo: ganho pelo integrado e limitador no teto de amostra, que desce até o pico verdadeiro (4×)
 *  caber. `folga_db` é o espaço para o codificador (M4A e Opus sobem um pouco o pico). Não mexe em `canais`. */
export const masterizar = (canais: Float32Array[], taxa: number, o: {alvo_lufs?: number; pico_dbtp?: number; folga_db?: number} = {}) => {
  const alvo = o.alvo_lufs ?? ALVO_LUFS_MUSICA;
  const pico = (o.pico_dbtp ?? PICO_DBTP_MUSICA) - (o.folga_db ?? 0);
  const antes = medirAmostras(canais, taxa, {pico: true});
  const base = {alvo_lufs: alvo, pico_dbtp_alvo: o.pico_dbtp ?? PICO_DBTP_MUSICA, antes_lufs: antes.integrado_lufs, antes_pico_dbtp: antes.pico_dbtp};
  if (antes.integrado_lufs === null) {
    return {canais: canais.map((c) => Float32Array.from(c)), ganho: 1, medida: {...base, lufs: null, pico_dbtp: antes.pico_dbtp, ganho_db: 0, limitador_db: 0, no_alvo: false} as MedidaEntrega};
  }
  let ganho_db = alvo - antes.integrado_lufs;
  let teto = pico - 0.3; // o pico entre amostras passa um pouco do de amostra
  let melhor: {canais: Float32Array[]; medida: MedidaEntrega; ganho: number} | null = null;
  let antes_: {ganho_db: number; lufs: number} | null = null;
  for (let k = 0; k < 8; k++) {
    const g = Math.pow(10, ganho_db / 20);
    const out = canais.map((c) => c.map((v) => v * g));
    const limitador_db = limitarNoLugar(out, teto, 60, taxa);
    const m = medirAmostras(out, taxa, {pico: true});
    const lufs = m.integrado_lufs ?? alvo;
    const tp = m.pico_dbtp ?? -120;
    const no_alvo = Math.abs(lufs - alvo) <= TOLERANCIA_LU && tp <= pico + 0.05;
    const medida: MedidaEntrega = {...base, lufs: m.integrado_lufs, pico_dbtp: m.pico_dbtp, ganho_db: r1(ganho_db), limitador_db, no_alvo};
    const erro = Math.abs(lufs - alvo) + Math.max(0, tp - pico) * 2;
    if (!melhor || erro < Math.abs((melhor.medida.lufs ?? alvo) - alvo) + Math.max(0, (melhor.medida.pico_dbtp ?? -120) - pico) * 2) melhor = {canais: out, medida, ganho: g};
    if (no_alvo) break;
    if (tp > pico) teto -= tp - pico + 0.1;
    // o limitador tira parte do integrado: com duas voltas, o passo segue a inclinação medida (secante), que com o
    // limitador trabalhando é menor que 1 LU por dB
    const inclinacao = antes_ && Math.abs(ganho_db - antes_.ganho_db) > 1e-3 ? (lufs - antes_.lufs) / (ganho_db - antes_.ganho_db) : 1;
    antes_ = {ganho_db, lufs};
    ganho_db += Math.max(-6, Math.min(6, (alvo - lufs) / Math.max(0.2, Math.min(1.2, inclinacao))));
  }
  return melhor!;
};

/** WAV PCM de 16 ou 24 bits (a entrega sai em 24). */
export const codificarWav = (canais: Float32Array[], taxa: number, bits: 16 | 24 = 24): Uint8Array<ArrayBuffer> => {
  const nc = canais.length;
  const n = canais[0]?.length ?? 0;
  const bpa = bits / 8;
  const buf = new ArrayBuffer(44 + n * nc * bpa);
  const v = new DataView(buf);
  const t = (p: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i));
  };
  t(0, 'RIFF');
  v.setUint32(4, buf.byteLength - 8, true);
  t(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nc, true);
  v.setUint32(24, taxa, true);
  v.setUint32(28, taxa * nc * bpa, true);
  v.setUint16(32, nc * bpa, true);
  v.setUint16(34, bits, true);
  t(36, 'data');
  v.setUint32(40, n * nc * bpa, true);
  const max = bits === 24 ? 8388607 : 32767;
  let p = 44;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < nc; k++) {
      const x = Math.max(-1, Math.min(1, canais[k][i]));
      const q = Math.round(x * max);
      if (bits === 24) {
        v.setUint8(p, q & 0xff);
        v.setUint8(p + 1, (q >> 8) & 0xff);
        v.setUint8(p + 2, (q >> 16) & 0xff);
      } else v.setInt16(p, q, true);
      p += bpa;
    }
  }
  return new Uint8Array(buf);
};

export type PedidoEntrega = {stems?: boolean; alvo_lufs?: number; pico_dbtp?: number; folga_db?: number};
/** `stems`: nome do arquivo (sem extensão) → som. Os retornos entram como "Retorno reverb" e "Retorno delay". */
export type ResultadoEntrega = {mistura: Float32Array[]; taxa: number; duracao_s: number; medida: MedidaEntrega; stems?: {nome: string; canais: Float32Array[]}[]; avisos: string[]};

/** O que vai para o arquivo: a música inteira renderizada, masterizada no alvo, e os stems se pedidos. */
export const entregaDaMusica = (doc: DocMusica, fontes: Record<string, FonteAudio | undefined>, o: PedidoEntrega & {cache?: CacheSom} = {}): ResultadoEntrega => {
  const taxa = TAXA_MUSICA;
  const som = renderizarMusica(doc, fontes, {taxa, cache: o.cache, porFaixa: o.stems});
  const alvo_lufs = o.alvo_lufs ?? (typeof doc.alvo_lufs === 'number' ? doc.alvo_lufs : ALVO_LUFS_MUSICA);
  const pico_dbtp = o.pico_dbtp ?? (typeof doc.pico_dbtp === 'number' ? doc.pico_dbtp : PICO_DBTP_MUSICA);
  const {canais, ganho, medida} = masterizar(som.canais, taxa, {alvo_lufs, pico_dbtp, folga_db: o.folga_db});
  const avisos = [...som.avisos];
  if (!medida.no_alvo && medida.lufs !== null) avisos.push(`a música saiu em ${medida.lufs} LUFS e ${medida.pico_dbtp} dBTP (alvo ${alvo_lufs} LUFS, até ${pico_dbtp} dBTP)`);
  if (medida.lufs === null) avisos.push('a música está em silêncio: o arquivo sai sem ajuste de loudness');
  if (medida.limitador_db > 6) avisos.push(`o limitador da entrega tirou ${medida.limitador_db} dB dos picos: baixe a bateria ou o master se soar esmagado`);
  let stems: ResultadoEntrega['stems'];
  if (o.stems && som.faixas) {
    const {musica: m} = resolverMusica(doc);
    const g = ganho * (m.automacoes.master ? 1 : Math.pow(10, m.master.volume_db / 20));
    const curva = m.automacoes.master ? ganhoDaAutomacao(m.automacoes.master, som.canais[0].length, taxa) : null; // a automação do master vale para os stems
    const usados = new Set<string>();
    const nomeLivre = (nome: string) => {
      let x = nome.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'faixa';
      for (let i = 2; usados.has(x.toLowerCase()); i++) x = `${nome} (${i})`;
      usados.add(x.toLowerCase());
      return x;
    };
    const comGanho = (c: Float32Array[]) => c.map((x) => x.map((v, i) => v * g * (curva ? curva[i] : 1)));
    stems = [
      ...m.faixas.filter((f) => som.faixas![f.id]).map((f) => ({nome: nomeLivre(f.nome), canais: comGanho(som.faixas![f.id])})),
      ...(som.retornos?.reverb ? [{nome: nomeLivre('Retorno reverb'), canais: comGanho(som.retornos.reverb)}] : []),
      ...(som.retornos?.delay ? [{nome: nomeLivre('Retorno delay'), canais: comGanho(som.retornos.delay)}] : []),
    ];
  }
  return {mistura: canais, taxa, duracao_s: som.duracao_s, medida, ...(stems ? {stems} : {}), avisos};
};

/** A entrega já em bytes (WAV de 24 bits), para atravessar a ponte com a janela ou ir direto ao disco. */
export type EntregaEmBytes = {mistura: Uint8Array<ArrayBuffer>; stems?: {nome: string; wav: Uint8Array<ArrayBuffer>}[]; medida: MedidaEntrega; avisos: string[]; duracao_s: number};
export const entregaEmBytes = (doc: DocMusica, fontes: Record<string, FonteAudio | undefined>, o: PedidoEntrega & {cache?: CacheSom} = {}): EntregaEmBytes => {
  const r = entregaDaMusica(doc, fontes, o);
  return {mistura: codificarWav(r.mistura, r.taxa, 24), ...(r.stems ? {stems: r.stems.map((s) => ({nome: s.nome, wav: codificarWav(s.canais, r.taxa, 24)}))} : {}),
    medida: r.medida, avisos: r.avisos, duracao_s: r.duracao_s};
};
