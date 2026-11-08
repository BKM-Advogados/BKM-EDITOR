// Render da música para o vídeo, no Node (processo principal e MCP por stdio, sem Electron): decodifica os áudios que
// o documento usa a 48 kHz (WAV direto; o resto pelo ffmpeg do Remotion), soma com src/nucleo/musica-som.ts (a mesma
// conta da prévia da janela), grava midia/musica/<id>.<código>.wav, a medida ao lado (.json) e o envelope (o ducking e
// a linha do tempo do vídeo já o veem sem medir de novo). O mesmo documento dá o mesmo código: o render se reaproveita.
// Na abertura do projeto, apagarRendersSemUso tira os que nenhum vídeo nem o diário citam. Ver docs/musica.md.
import {mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {envelopeDeAmostras, type Envelope} from '../nucleo/audio';
import type {PedirAJanela} from './ponte-janela';
import {medirAmostras, type FonteAudio} from '../nucleo/loudness';
import {audiosDaMusica, ehDocMusica, type DocMusica} from '../nucleo/musica';
import {naTaxa, renderizarMusica, TAXA_MUSICA} from '../nucleo/musica-som';
import {ehRenderDeMusica, medidaDoRender, renderDaMusica} from '../nucleo/musica-video';
import {assinaturaDe, atualizarLigados, garantirMusicaForaDoGit, ligacoesDe, type MedidaMusica, type MedidaRender, type ServicoMusica} from '../nucleo/musica-projeto';
import {serializar, type Projeto} from '../nucleo/projeto';
import {decodificarAudio, gravarWav, lerWav} from './ffmpeg-som';
import {gravarEnvelope} from './ipc-audio';

const lerMusica = (p: Projeto, id: string) => {
  const {doc} = p.lerJson<unknown>(p.arquivoDoDocumento(id));
  if (!ehDocMusica(doc)) throw new Error(`${id} não é um documento de música`);
  return doc as DocMusica;
};

/** Um áudio do projeto a 48 kHz: WAV lido direto (reamostrado pelo ffmpeg se vier noutra taxa), o resto pelo ffmpeg.
 *  Sem ffmpeg, o WAV de outra taxa vai por interpolação linear. */
export const decodificarParaMusica = async (p: Projeto, arquivo: string, binarios?: string | null): Promise<FonteAudio> => {
  const abs = p.caminho(arquivo);
  if (/\.wav$/i.test(arquivo)) {
    const wav = lerWav(readFileSync(abs));
    if (wav.taxa === TAXA_MUSICA) return wav;
    try {
      return await decodificarAudio(abs, {taxa: TAXA_MUSICA, binarios});
    } catch {
      return {canais: naTaxa(wav, TAXA_MUSICA), taxa: TAXA_MUSICA};
    }
  }
  return decodificarAudio(abs, {taxa: TAXA_MUSICA, binarios});
};

const fontesDe = async (p: Projeto, doc: DocMusica, binarios?: string | null) => {
  const fontes: Record<string, FonteAudio | undefined> = {};
  for (const a of audiosDaMusica(doc)) {
    try {
      fontes[a] = await decodificarParaMusica(p, a, binarios);
    } catch {
      fontes[a] = undefined; // vira aviso no render ("não foi lido")
    }
  }
  return fontes;
};

const gravarBinario = (p: Projeto, rel: string, dados: Buffer) => {
  const abs = p.caminho(rel);
  mkdirSync(path.dirname(abs), {recursive: true});
  const tmp = `${abs}.${process.pid}.tmp`;
  writeFileSync(tmp, dados);
  renameSync(tmp, abs);
};

/** O que a janela devolve ao pedido "musica:render" (o Web Worker dela fez a conta). */
type RenderDaJanela = {wav?: Uint8Array; duracao_s?: number; avisos?: string[]; faltando?: string[]; medida?: {integrado_lufs: number | null; pico_dbtp: number | null};
  faixas?: Record<string, {integrado_lufs: number | null; pico_dbtp: number | null}>; envelope?: Envelope};

/** O serviço que o MCP e o IPC usam (definirServicoMusica). Com a janela (o app aberto), o som é feito no Web Worker
 *  dela, com o cache da prévia, e o processo principal só grava: nada pesado na thread que atende a janela. Sem janela
 *  (MCP por stdio, janela fechada ou ocupada), a conta é feita aqui. */
export const servicoDeRender = (o: {binarios?: () => string | null | undefined; janela?: PedirAJanela} = {}): ServicoMusica => ({
  renderizar: async (p, id) => {
    const doc = lerMusica(p, id);
    const alvo = renderDaMusica(id, doc, assinaturaDe(p));
    const rotuloMedida = medidaDoRender(alvo.arquivo);
    if (p.existe(alvo.arquivo) && p.existe(rotuloMedida)) {
      return {...alvo, novo: false, medida: p.lerJson<MedidaRender>(rotuloMedida).doc};
    }
    // a janela recebe o documento lido aqui (o mesmo que deu o nome do arquivo), não o que ela tiver na tela
    const daJanela = o.janela ? await o.janela('musica:render', {doc}, {tempo_ms: 120_000}) : null;
    const r = daJanela?.ok ? (daJanela.dados as RenderDaJanela) : null;
    let canais: Float32Array[] | null = null;
    let som: {avisos: string[]; faltando: string[]};
    let m: {integrado_lufs: number | null; pico_dbtp: number | null};
    let envelope: Envelope | undefined;
    garantirMusicaForaDoGit(p);
    if (r?.wav && r.medida) {
      gravarBinario(p, alvo.arquivo, Buffer.from(r.wav.buffer, r.wav.byteOffset, r.wav.byteLength));
      som = {avisos: r.avisos ?? [], faltando: r.faltando ?? []};
      m = r.medida;
      envelope = r.envelope;
    } else {
      const feito = renderizarMusica(doc, await fontesDe(p, doc, o.binarios?.()), {taxa: TAXA_MUSICA});
      canais = feito.canais;
      gravarBinario(p, alvo.arquivo, gravarWav(feito.canais, feito.taxa));
      som = feito;
      const x = medirAmostras(feito.canais, feito.taxa);
      m = {integrado_lufs: x.integrado_lufs, pico_dbtp: x.pico_dbtp};
    }
    const medida: MedidaRender = {formato: 1, musica: id, duracao_ms: alvo.duracao_ms, integrado_lufs: m.integrado_lufs, pico_dbtp: m.pico_dbtp,
      avisos: som.avisos, faltando: som.faltando, feito_em: new Date().toISOString(), feito_por: r ? 'janela' : 'processo'};
    p.gravarTexto(rotuloMedida, serializar(medida));
    try {
      gravarEnvelope(p, alvo.arquivo, envelope ?? envelopeDeAmostras(canais!, TAXA_MUSICA));
    } catch {
      /* o envelope é conveniência: sem ele, a linha do tempo mede */
    }
    return {...alvo, novo: true, medida};
  },
  medir: async (p, id, opcoes = {}): Promise<MedidaMusica> => {
    const doc = lerMusica(p, id);
    const daJanela = o.janela ? await o.janela('musica:render', {doc, porFaixa: opcoes.porFaixa, sohMedir: true}, {tempo_ms: 120_000}) : null;
    if (daJanela?.ok) {
      const r = daJanela.dados as RenderDaJanela;
      if (r.medida) return {...r.medida, duracao_ms: Math.round((r.duracao_s ?? 0) * 1000), ...(r.faixas ? {faixas: r.faixas} : {}), avisos: r.avisos ?? []};
    }
    const som = renderizarMusica(doc, await fontesDe(p, doc, o.binarios?.()), {taxa: TAXA_MUSICA, porFaixa: opcoes.porFaixa});
    const m = medirAmostras(som.canais, som.taxa);
    const faixas = som.faixas
      ? Object.fromEntries(Object.entries(som.faixas).map(([f, c]) => {
        const x = medirAmostras(c, som.taxa);
        return [f, {integrado_lufs: x.integrado_lufs, pico_dbtp: x.pico_dbtp}];
      }))
      : undefined;
    return {integrado_lufs: m.integrado_lufs, pico_dbtp: m.pico_dbtp, duracao_ms: Math.round(som.duracao_s * 1000), ...(faixas ? {faixas} : {}), avisos: som.avisos};
  },
});

/** Renders em midia/musica/ que nenhum vídeo toca agora. O render se refaz pelo documento (o mesmo documento dá o mesmo
 *  nome), então o Ctrl+Z na música não precisa do arquivo de antes: guardar cada versão encheria a pasta a cada edição.
 *  Fica também o render de agora de cada música (`manter`), para quem a for pôr no vídeo em seguida. */
export const apagarRendersSemUso = (p: Projeto, manter: string[] = []): string[] => {
  let nomes: string[];
  try {
    nomes = readdirSync(p.caminho('midia/musica'));
  } catch {
    return [];
  }
  const citados = new Set<string>(manter);
  for (const d of p.manifesto().documentos.filter((x) => x.modulo === 'video')) {
    try {
      const texto = p.lerTexto(d.caminho);
      for (const m of texto.matchAll(/midia\/musica\/[^"\\]+\.wav/g)) citados.add(m[0]);
    } catch {
      /* ilegível: segue */
    }
  }
  const apagados: string[] = [];
  for (const nome of nomes) {
    const rel = `midia/musica/${nome}`;
    const wav = rel.endsWith('.wav.envelope.json') ? rel.slice(0, -'.envelope.json'.length) : rel.replace(/\.json$/, '.wav');
    if (!ehRenderDeMusica(wav) || citados.has(wav)) continue;
    rmSync(p.caminho(rel), {force: true});
    apagados.push(rel);
  }
  return apagados;
};

/** Na abertura (e depois de mudar uma música): os clipes ligados tocam o render de agora, os que faltam no disco (pasta
 *  clonada: midia/musica/ fica fora do git) são gravados, e as sobras saem. Nunca lança. */
export const acertarRenders = async (p: Projeto, s: ServicoMusica): Promise<{renderizados: string[]; apagados: string[]; avisos: string[]}> => {
  const renderizados: string[] = [];
  const avisos: string[] = [];
  const manter: string[] = [];
  let musicas: string[] = [];
  try {
    musicas = p.manifesto().documentos.filter((d) => d.modulo === 'musica').map((d) => d.id);
  } catch {
    return {renderizados, apagados: [], avisos};
  }
  for (const id of musicas) {
    try {
      const {render} = atualizarLigados(p, id);
      manter.push(render.arquivo);
      if (!ligacoesDe(p, id).length) continue;
      const r = await s.renderizar(p, id);
      if (r.novo) renderizados.push(r.arquivo);
    } catch (e) {
      avisos.push(`${id}: ${(e as Error).message}`);
    }
  }
  return {renderizados, apagados: apagarRendersSemUso(p, manter), avisos};
};
