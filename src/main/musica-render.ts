// Render da música para o vídeo, no Node (processo principal e MCP por stdio, sem Electron): decodifica os áudios que
// o documento usa a 48 kHz (WAV direto; o resto pelo ffmpeg do Remotion), soma com src/nucleo/musica-som.ts (a mesma
// conta da prévia da janela), grava midia/musica/<id>.<código>.wav, a medida ao lado (.json) e o envelope (o ducking e
// a linha do tempo do vídeo já o veem sem medir de novo). O mesmo documento dá o mesmo código: o render se reaproveita.
// Na abertura do projeto, apagarRendersSemUso tira os que nenhum vídeo nem o diário citam. Exportar (item 23) grava em
// saidas/: a conta (alvo de loudness, stems) vem do worker da janela ou é feita aqui, e o ffmpeg só codifica M4A e Opus.
// Ver docs/musica.md.
import {nomeDeArquivo} from '../nucleo/nome-de-arquivo'; // portes: nomes reservados do Windows
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
import {decodificarAudio, gravarWav, lerWav, rodarFfmpeg} from './ffmpeg-som';
import {medirArquivo} from './loudness';
import {entregaEmBytes, type EntregaEmBytes} from '../nucleo/musica-entrega';
import {musicaParaMidi} from '../nucleo/musica-midi';
import type {PedidoExportarMusica, ResultadoExportarMusica} from '../nucleo/musica-projeto';
import {hashesDaMusica} from '../nucleo/musica-projeto';
import {comprovanteDeLicencas, licencasDaMusica, textoDosCreditos} from '../nucleo/musica-licencas';
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
  exportar: (p, id, pedido) => exportarMusica(p, id, pedido, o),
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

/** Nome de arquivo a partir do título (sem os caracteres que o Windows recusa). */
export const nomeDeSaida = (titulo: string) => nomeDeArquivo(titulo.replace(/\.(wav|mp3|m4a|opus|ogg|flac|mid)$/i, '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-'), {vazio: 'musica'});

/** Codificação de cada formato com perda: AAC no M4A (o mesmo codificador da exportação do vídeo) e Opus. */
const CODIFICAR: Record<'m4a' | 'opus', string[]> = {m4a: ['-c:a', 'libfdk_aac', '-b:a', '256k', '-movflags', '+faststart', '-f', 'mp4'] /* o ffmpeg do Remotion não tem o ipod */, opus: ['-c:a', 'libopus', '-b:a', '192k']};

/** A música em arquivo em saidas/ (item 23). */
export const exportarMusica = async (p: Projeto, id: string, pedido: PedidoExportarMusica,
  o: {binarios?: () => string | null | undefined; janela?: PedirAJanela} = {}): Promise<ResultadoExportarMusica> => {
  const doc = lerMusica(p, id);
  const titulo = nomeDeSaida(pedido.nome?.trim() || p.manifesto().documentos.find((d) => d.id === id)?.titulo || doc.titulo || id);
  const base = `saidas/${titulo}`;
  if (pedido.formato === 'mid') {
    const r = musicaParaMidi(doc);
    gravarBinario(p, `${base}.mid`, Buffer.from(r.bytes));
    return {arquivos: [`${base}.mid`], avisos: r.avisos, feito_por: 'processo', trilhas: r.trilhas, notas: r.notas};
  }
  const folga_db = pedido.formato === 'wav' ? 0 : 0.5; // o codificador sobe um pouco o pico verdadeiro
  const entregaPedido = {stems: pedido.stems, alvo_lufs: pedido.alvo_lufs, folga_db};
  const daJanela = o.janela ? await o.janela('musica:exportar', {doc, pedido: entregaPedido}, {tempo_ms: 300_000}) : null;
  const e: EntregaEmBytes = daJanela?.ok && daJanela.dados ? (daJanela.dados as EntregaEmBytes)
    : entregaEmBytes(doc, await fontesDe(p, doc, o.binarios?.()), entregaPedido);
  const buf = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  const arquivos: string[] = [];
  const avisos = [...e.avisos];
  let medidaArquivo: {arquivo_lufs?: number; arquivo_dbtp?: number} = {};
  if (pedido.formato === 'wav') {
    gravarBinario(p, `${base}.wav`, buf(e.mistura));
    arquivos.push(`${base}.wav`);
  } else {
    const tmp = p.caminho(`${base}.${process.pid}.tmp.wav`);
    gravarBinario(p, `${base}.${process.pid}.tmp.wav`, buf(e.mistura));
    const destino = `${base}.${pedido.formato}`;
    try {
      await rodarFfmpeg(['-y', '-i', tmp, ...CODIFICAR[pedido.formato], p.caminho(destino)], {binarios: o.binarios?.()});
    } finally {
      rmSync(tmp, {force: true});
    }
    arquivos.push(destino);
    const m = await medirArquivo(p.caminho(destino), {binarios: o.binarios?.()}).catch(() => null);
    if (m) medidaArquivo = {arquivo_lufs: Math.round(m.i * 10) / 10, arquivo_dbtp: Math.round(m.tp * 10) / 10};
  }
  for (const s of e.stems ?? []) {
    const rel = `${base} - stems/${nomeDeSaida(s.nome)}.wav`;
    gravarBinario(p, rel, buf(s.wav));
    arquivos.push(rel);
  }
  if (e.stems?.length) avisos.push('os stems saem em WAV, com o mesmo ganho da mistura e sem o limitador: somados, dão a mistura');
  // créditos e comprovante (item 24): o comprovante sempre; o texto dos créditos quando algum som pede crédito
  const lic = licencasDaMusica(doc, {hashes: hashesDaMusica(p, doc)});
  const comprovante = `${base}.licencas.json`;
  p.gravarTexto(comprovante, serializar(comprovanteDeLicencas({musica: id, titulo, arquivo: arquivos[0], licencas: lic, gerado_em: new Date().toISOString()})));
  arquivos.push(comprovante);
  if (lic.creditos.length) {
    const rel = `${base} - créditos.txt`;
    p.gravarTexto(rel, textoDosCreditos(titulo, lic));
    arquivos.push(rel);
    avisos.push(`${lic.creditos.length} ${lic.creditos.length === 1 ? 'som pede' : 'sons pedem'} crédito: o texto está em ${rel}`);
  }
  for (const x of lic.impede) avisos.push(`antes de publicar: ${x}`);
  return {arquivos, avisos, feito_por: daJanela?.ok ? 'janela' : 'processo', duracao_s: Math.round(e.duracao_s * 1000) / 1000, medida: e.medida, ...medidaArquivo,
    pode_publicar: lic.pode_publicar, creditos: lic.creditos};
};

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
