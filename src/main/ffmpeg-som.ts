// O ffmpeg do compositor do Remotion (o mesmo binário que o render usa) para o som: decodificar um arquivo do projeto em
// amostras, medir com o loudnorm e regravar o áudio do arquivo exportado. Esse ffmpeg vem enxuto (sem afftdn, highpass
// nem ebur128; com loudnorm, volume, aresample e os codificadores aac, opus e pcm), por isso a limpeza e o medidor da
// tela são feitos em TypeScript (src/nucleo/limpeza-voz.ts e loudness.ts) e aqui só entra o que ele sabe fazer.
// Sem Electron: roda igual no app, no vitest e nos scripts de teste.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import type {CancelSignal} from '@remotion/renderer';
import {getCompositorPackage} from '../nucleo/compositor-package';
import {ambienteDoFfmpeg, executavelDoFfmpeg, opcoesDoFfmpeg} from '../nucleo/ffmpeg-ambiente';

/** Pasta do ffmpeg: a do render quando vem (app empacotado: app.asar.unpacked), senão a do node_modules. */
export const pastaDoFfmpeg = (binariesDirectory?: string | null) => {
  if (binariesDirectory) return binariesDirectory;
  const pacote = getCompositorPackage({arch: process.arch, platform: process.platform});
  const recursos = (process as {resourcesPath?: string}).resourcesPath;
  const candidatos = [
    recursos && path.join(recursos, 'app.asar.unpacked', 'node_modules', pacote),
    typeof __dirname === 'string' && path.resolve(__dirname, '..', '..', 'node_modules', pacote), // .vite/app → raiz, no desenvolvimento
    path.join(process.cwd(), 'node_modules', pacote),
  ].filter((p): p is string => Boolean(p));
  const achada = candidatos.find((p) => existsSync(path.join(p, executavel())));
  if (!achada) throw new Error(`não achei o ffmpeg do Remotion (${pacote}); rode npm install`);
  return achada;
};

const executavel = () => executavelDoFfmpeg();

export {ambienteDoFfmpeg, executavelDoFfmpeg, opcoesDoFfmpeg};

export type Parar = {cancelSignal?: CancelSignal; cancelado?: () => boolean};

/** Roda o ffmpeg e devolve a saída padrão (bytes) e a de erro (texto, onde o loudnorm escreve a medida). */
export const rodarFfmpeg = (args: string[], o: Parar & {binarios?: string | null} = {}) => new Promise<{saida: Buffer; erro: string}>((ok, falha) => {
  const pasta = pastaDoFfmpeg(o.binarios);
  const filho = spawn(path.join(pasta, executavel()), ['-hide_banner', '-nostdin', ...args], opcoesDoFfmpeg(pasta));
  const saida: Buffer[] = [];
  const erro: string[] = [];
  let parado = false;
  const parar = () => {
    parado = true;
    filho.kill();
  };
  o.cancelSignal?.(parar);
  const relogio = o.cancelado ? setInterval(() => o.cancelado!() && parar(), 100) : null;
  filho.stdout.on('data', (d: Buffer) => saida.push(d));
  filho.stderr.on('data', (d: Buffer) => erro.push(d.toString('utf-8')));
  filho.on('error', (e) => {
    if (relogio) clearInterval(relogio);
    falha(e);
  });
  filho.on('close', (codigo) => {
    if (relogio) clearInterval(relogio);
    const texto = erro.join('');
    if (parado) return falha(new Error('cancelado'));
    if (codigo !== 0) return falha(new Error(`o ffmpeg falhou (${codigo}): ${texto.trim().split('\n').slice(-3).join(' | ')}`));
    ok({saida: Buffer.concat(saida), erro: texto});
  });
});

/** Amostras de um WAV PCM (16, 24 ou 32 bits inteiros, ou 32 bits float), canais separados. Aceita o WAV que o ffmpeg
 *  escreve num pipe, com o tamanho do bloco "data" desconhecido. */
export const lerWav = (dados: Uint8Array): {canais: Float32Array[]; taxa: number} => {
  const v = new DataView(dados.buffer, dados.byteOffset, dados.byteLength);
  const texto = (p: number) => String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3));
  if (dados.byteLength < 12 || texto(0) !== 'RIFF' || texto(8) !== 'WAVE') throw new Error('não é um WAV');
  let p = 12;
  let fmt: {formato: number; nc: number; taxa: number; bits: number} | null = null;
  while (p + 8 <= dados.byteLength) {
    const id = texto(p);
    const tam = v.getUint32(p + 4, true);
    if (id === 'fmt ') {
      let formato = v.getUint16(p + 8, true);
      if (formato === 0xfffe) formato = v.getUint16(p + 8 + 24, true); // WAVE_FORMAT_EXTENSIBLE: o subformato vem no GUID
      fmt = {formato, nc: v.getUint16(p + 10, true), taxa: v.getUint32(p + 12, true), bits: v.getUint16(p + 22, true)};
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV sem bloco "fmt "');
      const {formato, nc, taxa, bits} = fmt;
      const bpa = bits / 8;
      const resto = dados.byteLength - (p + 8);
      const bytes = tam === 0 || tam === 0xffffffff || tam > resto ? resto : tam;
      const n = Math.floor(bytes / (nc * bpa));
      const canais = Array.from({length: nc}, () => new Float32Array(n));
      let q = p + 8;
      const ler = formato === 3 && bits === 32 ? (o: number) => v.getFloat32(o, true)
        : formato === 1 && bits === 16 ? (o: number) => v.getInt16(o, true) / 32768
          : formato === 1 && bits === 24 ? (o: number) => ((v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16)) / 8388608)
            : formato === 1 && bits === 32 ? (o: number) => v.getInt32(o, true) / 2147483648 : null;
      if (!ler) throw new Error(`WAV em formato ${formato} de ${bits} bits não é lido aqui`);
      for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++, q += bpa) canais[c][i] = ler(q);
      return {canais, taxa};
    }
    p += 8 + tam + (tam % 2);
  }
  throw new Error('WAV sem bloco "data"');
};

/** WAV PCM de 16 bits (o Remotion mistura em 16 bits; o ruído de quantização fica em −96 dBFS, longe do que se limpa). */
export const gravarWav = (canais: Float32Array[], taxa: number): Buffer => {
  const nc = canais.length;
  const n = canais[0]?.length ?? 0;
  const buf = Buffer.alloc(44 + n * nc * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(buf.length - 8, 4);
  buf.write('WAVEfmt ', 8, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(nc, 22);
  buf.writeUInt32LE(taxa, 24);
  buf.writeUInt32LE(taxa * nc * 2, 28);
  buf.writeUInt16LE(nc * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(n * nc * 2, 40);
  let p = 44;
  for (let i = 0; i < n; i++) {
    for (const c of canais) {
      buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, c[i])) * 32767), p);
      p += 2;
    }
  }
  return buf;
};

/** O áudio de entrada como o ffmpeg o descreve (a primeira linha "Audio:" da saída de erro): codec, taxa e canais. */
export const lerEntrada = (erro: string) => {
  const m = /Stream #0:\d+\S*: Audio: (\w+)[^\n]*?, (\d+) Hz, ([^,\n]+)/.exec(erro);
  if (!m) return null;
  const canais = m[3] === 'mono' ? 1 : m[3] === 'stereo' ? 2 : Number(/(\d+) channels/.exec(m[3])?.[1]) || (m[3].startsWith('5.1') ? 6 : 2);
  return {codec: m[1], taxa: Number(m[2]), canais};
};

/** A duração (s) que o ffmpeg escreve na saída de erro ("Duration: 00:21:02.67"); null quando ele não sabe (N/A). */
export const lerDuracao = (erro: string) => {
  const m = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(erro);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
};

/** Duração, taxa e canais do áudio de um arquivo, lidos do cabeçalho, sem decodificar nada. */
export const medirEntrada = async (arquivo: string, o: Parar & {binarios?: string | null} = {}) => {
  const {erro} = await rodarFfmpeg(['-i', arquivo, '-map', '0:a:0', '-t', '0', '-f', 'null', '-'], o);
  return {duracao_s: lerDuracao(erro), ...lerEntrada(erro)};
};

/** Amostras por pacote que o ffmpeg entrega desse codec: o WAV vem em blocos de 4096 bytes; os comprimidos, no quadro deles. */
export const amostrasPorPacote = (e: {codec: string; canais: number}) => {
  const pcm = /^pcm_[suf](8|16|24|32|64)/.exec(e.codec);
  if (pcm) return Math.max(1, Math.floor(4096 / ((Number(pcm[1]) / 8) * Math.max(1, e.canais))));
  return ({mp3: 1152, aac: 1024, opus: 960, vorbis: 1024, flac: 4096} as Record<string, number>)[e.codec] ?? 1024;
};

/** Decodifica qualquer áudio (ou o som de um vídeo) que o ffmpeg do Remotion lê. Com `taxa` e `canais`, converte
 *  (como o render faz: 48 kHz e estéreo); sem eles, mantém o que o arquivo tem. `pacote` sai já na taxa devolvida. */
export const decodificarAudio = async (arquivo: string, o: Parar & {binarios?: string | null; taxa?: number; canais?: number} = {}) => {
  const args = ['-i', arquivo, '-vn', '-map', '0:a:0', ...(o.taxa ? ['-ar', String(o.taxa)] : []), ...(o.canais ? ['-ac', String(o.canais)] : []),
    '-c:a', 'pcm_s24le', '-f', 'wav', 'pipe:1'];
  const {saida, erro} = await rodarFfmpeg(args, o);
  const wav = lerWav(saida);
  const entrada = lerEntrada(erro);
  return {...wav, pacote: entrada ? (amostrasPorPacote(entrada) * wav.taxa) / entrada.taxa : undefined};
};

/** Decodifica um áudio (ou o som de um vídeo) em pedaços, sem juntar o arquivo inteiro: `aoPedaco` recebe um vetor por canal, na
 *  taxa e nos canais que o arquivo tem (som-D8: uma live de uma hora não cabe decodificada na memória). O ffmpeg escreve um WAV
 *  de 24 bits no pipe; o cabeçalho é lido à medida que chega e o resto são amostras. Devolve a taxa, os canais e o total. */
export const decodificarEmPedacos = (arquivo: string, aoPedaco: (canais: Float32Array[], taxa: number) => void, o: Parar & {binarios?: string | null} = {}) =>
  new Promise<{taxa: number; canais: number; amostras: number}>((ok, falha) => {
    const pasta = pastaDoFfmpeg(o.binarios);
    const filho = spawn(path.join(pasta, executavel()), ['-hide_banner', '-nostdin', '-i', arquivo, '-vn', '-map', '0:a:0', '-c:a', 'pcm_s24le', '-f', 'wav', 'pipe:1'],
      opcoesDoFfmpeg(pasta));
    let pendente: Buffer = Buffer.alloc(0);
    let formato: {nc: number; taxa: number} | null = null;
    let amostras = 0;
    let parado = false;
    let falhou: Error | null = null;
    const erro: string[] = [];
    const parar = () => {
      parado = true;
      filho.kill();
    };
    o.cancelSignal?.(parar);
    const relogio = o.cancelado ? setInterval(() => o.cancelado!() && parar(), 100) : null;
    const lerCabecalho = (): boolean => {
      // RIFF/WAVE e os blocos até o "data"; o tamanho do data pode vir como 0xFFFFFFFF (pipe), e só o que vem depois importa
      if (pendente.length < 12) return false;
      let p = 12;
      let fmt: {nc: number; taxa: number; bits: number} | null = null;
      for (;;) {
        if (pendente.length < p + 8) return false;
        const id = pendente.toString('latin1', p, p + 4);
        const tam = pendente.readUInt32LE(p + 4);
        if (id === 'data') {
          if (!fmt) throw new Error('WAV sem bloco "fmt "');
          if (fmt.bits !== 24) throw new Error(`o ffmpeg devolveu ${fmt.bits} bits em vez de 24`);
          formato = {nc: fmt.nc, taxa: fmt.taxa};
          pendente = pendente.subarray(p + 8);
          return true;
        }
        if (pendente.length < p + 8 + tam) return false;
        if (id === 'fmt ') fmt = {nc: pendente.readUInt16LE(p + 10), taxa: pendente.readUInt32LE(p + 12), bits: pendente.readUInt16LE(p + 22)};
        p += 8 + tam + (tam % 2);
      }
    };
    const processar = () => {
      if (!formato) return;
      const quadro = formato.nc * 3;
      const quadros = Math.floor(pendente.length / quadro);
      if (!quadros) return;
      const canais = Array.from({length: formato.nc}, () => new Float32Array(quadros));
      for (let i = 0; i < quadros; i++) {
        for (let c = 0; c < formato.nc; c++) {
          const b = i * quadro + c * 3;
          canais[c][i] = (((pendente[b] | (pendente[b + 1] << 8) | (pendente[b + 2] << 16)) << 8) >> 8) / 8388608;
        }
      }
      pendente = pendente.subarray(quadros * quadro);
      amostras += quadros;
      aoPedaco(canais, formato.taxa);
    };
    filho.stdout.on('data', (d: Buffer) => {
      if (falhou || parado) return;
      try {
        pendente = pendente.length ? Buffer.concat([pendente, d]) : d;
        if (!formato && !lerCabecalho()) return;
        processar();
      } catch (e) {
        falhou = e as Error;
        parar();
      }
    });
    filho.stderr.on('data', (d: Buffer) => erro.push(d.toString('utf-8')));
    filho.on('error', (e) => {
      if (relogio) clearInterval(relogio);
      falha(e);
    });
    filho.on('close', (codigo) => {
      if (relogio) clearInterval(relogio);
      if (falhou) return falha(falhou);
      if (parado) return falha(new Error('cancelado'));
      if (codigo !== 0) return falha(new Error(`o ffmpeg falhou (${codigo}): ${erro.join('').trim().split('\n').slice(-3).join(' | ')}`));
      const f = formato as {nc: number; taxa: number} | null;
      if (!f) return falha(new Error('o ffmpeg não devolveu áudio'));
      ok({taxa: f.taxa, canais: f.nc, amostras});
    });
  });
