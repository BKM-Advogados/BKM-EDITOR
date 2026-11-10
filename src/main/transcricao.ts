// Transcrição local da fala (docs/legendas.md): o whisper.cpp roda no próprio PC, sem serviço externo. O binário e o
// modelo não vêm no instalador: baixam no primeiro uso para ~/Estudio/modelos/whisper/ (%USERPROFILE% no Windows), com o
// SHA-256 conferido antes de usar. Só o Windows x64 tem binário pronto; no Linux o whisper-cli vem compilado por quem usa
// (bin/ da pasta ou o PATH, acharWhisperCli) e os modelos baixam do mesmo jeito. O áudio do clipe sai em WAV 16 kHz mono pelo ffmpeg do compositor do Remotion (o mesmo da
// exportação), o whisper-cli devolve JSON com o tempo de cada pedaço de palavra, e o resultado vira
// midia/<arquivo>.palavras.json: {versao: 2, fonte, palavras: [{w, s, e, p}] em ms}, com o carimbo do áudio (tamanho, data
// e sha256) para transcrever de novo quando a tomada é regravada. Com `destino` (o roteiro da Cliente) grava só a lista, o
// formato que o resolvedor do roteiro lê.
//
// Este arquivo não importa o Electron: o MCP por stdio (mcp/nucleo.ts) e os testes usam o mesmo Transcritor. O IPC
// (registrarIpcTranscricao) recebe o `lidar` e o `enviar` do main.ts.
import {spawn, type ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {closeSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync, type Stats} from 'node:fs';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {inflateRawSync} from 'node:zlib';
import {CANAL, type EstadoTranscricao, type PedidoEmenda, type PedidoTranscricao, type ProgressoTranscricao, type ResultadoEmenda, type ResultadoTranscricao} from '../compartilhado/api';
import {arquivoDasPalavras, conferirFala, fonteDaFala, palavrasValidas, recusaDoDestinoNoProjeto, VERSAO_PALAVRAS, type EstadoDaFala, type FonteDaFala, type PalavrasGravadas} from '../nucleo/legendas';
import type {Palavra} from '../nucleo/roteiro/resolver';
import {ErroProjeto, type Projeto} from '../nucleo/projeto';
import {getCompositorPackage} from './compositor-package';

// ---------- o que baixa: versões presas, com tamanho e SHA-256 ----------
// whisper.cpp v1.9.5 (MIT), build b5454 (06/10/2026), a mesma do commit d1be6fd da tag. O SHA-256 é o que o GitHub
// publica no próprio lançamento e foi conferido no arquivo baixado.
export const WHISPER_VERSAO = 'v1.9.5 (b5454)';
export const BINARIO_WHISPER = {
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip',
  bytes: 8_928_640,
  sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb',
};

// Modelos ggml do Whisper da OpenAI (MIT), convertidos pelo projeto whisper.cpp, presos no commit 5359861 do repositório
// ggerganov/whisper.cpp no Hugging Face. O SHA-256 é o oid do LFS. Medido em 07/11/2026 na narração do exemplo Cliente C2
// (72 s, pt-BR), i5-1135G7 com 7 threads, decodificação gulosa: small 29,8 s e 465 MB de pico, 4,6% de palavras
// erradas; base 14,7 s e 271 MB, 8,2% (scripts/transcrever-teste.mjs, docs/legendas.md).
const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1';
export type IdModeloWhisper = 'base' | 'small';
export type ModeloWhisper = {id: IdModeloWhisper; nome: string; arquivo: string; url: string; bytes: number; sha256: string; dtw: string};
export const MODELOS_WHISPER: Record<IdModeloWhisper, ModeloWhisper> = {
  small: {id: 'small', nome: 'Small (padrão: erra pouco)', arquivo: 'ggml-small-q5_1.bin', url: `${HF}/ggml-small-q5_1.bin`, bytes: 190_085_487,
    sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb', dtw: 'small'},
  base: {id: 'base', nome: 'Base (duas vezes mais rápido, erra mais)', arquivo: 'ggml-base-q5_1.bin', url: `${HF}/ggml-base-q5_1.bin`, bytes: 59_707_625,
    sha256: '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898', dtw: 'base'},
};
export const MODELO_PADRAO: IdModeloWhisper = 'small';
/** Busca em feixe do whisper-cli (o padrão dele é 5). 1 é a decodificação gulosa: no small, 2,5 vezes mais rápida
 *  (29,8 s contra 73,8 s) por meio ponto de erro (4,6% contra 4,1%). O DTW dos tempos por token desliga a flash
 *  attention, dobra o tempo e, medido, não melhorou o começo das palavras: fica desligado. */
export const FEIXE_PADRAO = 1;
/** Começo de conversa que o whisper lê antes do áudio: puxa o vocabulário e a pontuação do direito do trabalho. Na
 *  narração do C2 levou o small de 4,6% para 3,6% de palavras erradas ("Exija" e "exceção" passaram a sair certas). */
export const PROMPT_PADRAO = 'Vídeo sobre direito do trabalho, com regras, exceções e prazos da CLT: rescisão, aviso prévio, FGTS, férias, 13º salário, horas extras, justa causa, transferência.';

// Detector de voz (VAD): o Silero VAD v6.2.0 (MIT), convertido para ggml pelo projeto whisper.cpp, preso no commit
// 9ffd54a do repositório ggml-org/whisper-vad no Hugging Face (licença MIT; o SHA-256 é o oid do LFS). No app ele é um
// filtro: uma passada rápida acha os trechos de voz e só fica a palavra que encosta num deles; silêncio, música e efeito
// não viram palavras inventadas. O whisper continua ouvindo o arquivo inteiro, porque com --vad (só os trechos de voz,
// emendados) o começo das palavras piorou: medido, a mediana do erro foi de 100 para 140 a 170 ms. docs/legendas.md, "VAD".
export const MODELO_VAD = {
  arquivo: 'ggml-silero-v6.2.0.bin',
  url: 'https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v6.2.0.bin',
  bytes: 885_098,
  sha256: '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987',
};
/** Os ajustes do VAD (os nomes do whisper-cli): limiar da voz, fala mínima, silêncio que separa trechos e a folga
 *  que cada trecho ganha nas pontas (para não comer o começo de uma palavra dita baixo). */
export type AjustesVad = {limiar: number; fala_min_ms: number; silencio_min_ms: number; folga_ms: number};
export const VAD_PADRAO: AjustesVad = {limiar: 0.5, fala_min_ms: 250, silencio_min_ms: 100, folga_ms: 30};
export const argumentosVad = (modelo: string, a: AjustesVad = VAD_PADRAO) => ['--vad', '-vm', modelo, '-vt', String(a.limiar),
  '-vspd', String(a.fala_min_ms), '-vsd', String(a.silencio_min_ms), '-vp', String(a.folga_ms)];

/** Onde ficam o whisper-cli e os modelos. ESTUDIO_WHISPER_PASTA troca a pasta (testes e quem guarda os modelos noutro disco). */
export const pastaWhisper = (home = os.homedir()) => process.env.ESTUDIO_WHISPER_PASTA || path.join(home, 'Estudio', 'modelos', 'whisper');

// ---------- baixar com SHA-256 ----------

export type Buscar = (url: string, init: RequestInit) => Promise<Response>;
type Andamento = (p: ProgressoTranscricao) => void;

export class Cancelado extends Error {
  constructor() {
    super('transcrição cancelada');
  }
}

/** sha256 de um arquivo, lido em pedaços de 1 MB (uma narração longa não precisa caber na memória). */
const sha256DoArquivo = (arquivo: string) => {
  const h = createHash('sha256');
  const fd = openSync(arquivo, 'r');
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    for (let n = readSync(fd, buf, 0, buf.length, null); n > 0; n = readSync(fd, buf, 0, buf.length, null)) h.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return h.digest('hex');
};

/** O carimbo do áudio como ele está agora: tamanho, data e sha256 (o mesmo do envelope do som). */
export const fonteDoAudio = (abs: string, st: Stats = statSync(abs)): FonteDaFala => ({tamanho: st.size, modificado_ms: st.mtimeMs, sha256: sha256DoArquivo(abs)});

/** Baixa `url` para `destino` passando por um .parcial; só renomeia se o tamanho e o SHA-256 baterem. */
export const baixarConferido = async (o: {url: string; destino: string; bytes: number; sha256: string; buscar?: Buscar; sinal?: AbortSignal;
  andamento?: (recebido: number, total: number) => void}) => {
  const buscar = o.buscar ?? ((u, i) => fetch(u, i));
  mkdirSync(path.dirname(o.destino), {recursive: true});
  const parcial = `${o.destino}.parcial`;
  rmSync(parcial, {force: true});
  let r: Response;
  try {
    r = await buscar(o.url, {redirect: 'follow', signal: o.sinal, headers: {'User-Agent': 'Estudio-BKM'}});
  } catch (e) {
    if (o.sinal?.aborted) throw new Cancelado();
    throw new Error(`não deu para baixar ${o.url}: ${(e as Error).message}`);
  }
  if (!r.ok || !r.body) throw new Error(`não deu para baixar ${o.url}: HTTP ${r.status}`);
  const hash = createHash('sha256');
  const arquivo = createWriteStream(parcial);
  // erro de escrita (disco cheio, pasta sumida) vira rejeição, nunca um 'error' solto que derruba o processo principal
  let erroEscrita: Error | null = null;
  arquivo.on('error', (e) => (erroEscrita = e));
  const dreno = () => new Promise<void>((ok, falha) => {
    const fim = (e?: Error) => {
      arquivo.off('drain', fim);
      arquivo.off('error', fim);
      if (e) falha(e);
      else ok();
    };
    arquivo.on('drain', fim);
    arquivo.on('error', fim);
  });
  let recebido = 0;
  try {
    const leitor = r.body.getReader();
    for (;;) {
      const {done, value} = await leitor.read();
      if (done) break;
      if (erroEscrita) throw erroEscrita;
      recebido += value.byteLength;
      if (recebido > o.bytes * 1.01 + 1024) {
        await leitor.cancel().catch(() => undefined);
        throw new Error(`o arquivo passou do tamanho esperado (${o.bytes} bytes): ${o.url}`);
      }
      hash.update(value);
      if (!arquivo.write(value)) await dreno();
      o.andamento?.(recebido, o.bytes);
    }
    await new Promise<void>((ok, falha) => arquivo.end((e?: Error | null) => (e ? falha(e) : ok())));
    if (erroEscrita) throw erroEscrita;
  } catch (e) {
    // espera o arquivo fechar antes de apagar: aberto pela metade, ele voltaria depois do rmSync
    await new Promise<void>((ok) => (arquivo.closed ? ok() : (arquivo.once('close', () => ok()), arquivo.destroy())));
    rmSync(parcial, {force: true});
    if (o.sinal?.aborted) throw new Cancelado();
    throw e;
  }
  const obtido = hash.digest('hex');
  if (obtido !== o.sha256) {
    rmSync(parcial, {force: true});
    throw new Error(`o arquivo baixado não confere (SHA-256 ${obtido.slice(0, 12)}…, esperado ${o.sha256.slice(0, 12)}…): ${o.url}`);
  }
  renameSync(parcial, o.destino);
};

// ---------- zip: o bastante para o pacote do whisper.cpp (guardado ou deflate, sem zip64) ----------

/** Extrai do zip os arquivos cujo nome (sem pasta) passa em `quero`, todos direto em `destino`. Devolve os nomes. */
export const extrairZip = (zip: Buffer, destino: string, quero: (nome: string) => boolean): string[] => {
  let fim = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw new Error('o pacote do whisper não é um zip válido');
  const total = zip.readUInt16LE(fim + 10);
  let p = zip.readUInt32LE(fim + 16);
  mkdirSync(destino, {recursive: true});
  const saiu: string[] = [];
  for (let n = 0; n < total; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('diretório do zip quebrado');
    const metodo = zip.readUInt16LE(p + 10);
    const comprimido = zip.readUInt32LE(p + 20);
    const tamanho = zip.readUInt32LE(p + 24);
    const lenNome = zip.readUInt16LE(p + 28);
    const lenExtra = zip.readUInt16LE(p + 30);
    const lenComentario = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const cheio = zip.toString('utf-8', p + 46, p + 46 + lenNome);
    p += 46 + lenNome + lenExtra + lenComentario;
    const nome = cheio.split(/[\\/]/).pop() ?? '';
    if (!nome || cheio.endsWith('/') || !quero(nome)) continue;
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error(`cabeçalho do zip quebrado em ${cheio}`);
    const inicio = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const dados = zip.subarray(inicio, inicio + comprimido);
    const conteudo = metodo === 0 ? dados : metodo === 8 ? inflateRawSync(dados) : null;
    if (!conteudo) throw new Error(`compressão ${metodo} não suportada em ${cheio}`);
    if (conteudo.length !== tamanho) throw new Error(`tamanho errado ao extrair ${cheio}`);
    writeFileSync(path.join(destino, nome), conteudo);
    saiu.push(nome);
  }
  return saiu;
};

// ---------- onde estão as peças ----------

export const EXE_WHISPER = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';

export type Pecas = {pasta: string; cli: string; modelo: string; ffmpeg: string | null; vad?: string};

/** O whisper.cpp só publica binário pronto do Windows x64: é o único sistema em que o app baixa o whisper-cli. */
export const baixaBinario = (plataforma: string = process.platform, arq: string = process.arch) => plataforma === 'win32' && arq === 'x64';

/** O whisper-cli que o app usa: o da pasta do whisper (bin/) e, fora do Windows x64, o primeiro do PATH. No Windows x64
 *  fica só o baixado (o SHA-256 dele foi conferido). Sem nenhum, null. */
export const acharWhisperCli = (pasta: string, o: {plataforma?: string; arq?: string; PATH?: string; existe?: (a: string) => boolean} = {}): string | null => {
  const plataforma = o.plataforma ?? process.platform;
  const existe = o.existe ?? existsSync;
  const exe = plataforma === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  const proprio = path.join(pasta, 'bin', exe);
  if (existe(proprio)) return proprio;
  if (baixaBinario(plataforma, o.arq ?? process.arch)) return null;
  const sep = plataforma === 'win32' ? ';' : ':';
  for (const d of (o.PATH ?? process.env.PATH ?? '').split(sep)) {
    if (d && existe(path.join(d, exe))) return path.join(d, exe);
  }
  return null;
};

/** O que dizer quando falta o whisper-cli num sistema em que ele não baixa sozinho: compilar o whisper.cpp na versão
 *  presa e pôr o whisper-cli na pasta (ou no PATH). docs/legendas.md, "Linux". */
export const comoInstalarWhisper = (pasta: string) =>
  `falta o whisper-cli (whisper.cpp ${WHISPER_VERSAO}): fora do Windows x64 ele não baixa sozinho. Compile o whisper.cpp v1.9.5 `
  + `(cmake -B build -DBUILD_SHARED_LIBS=OFF && cmake --build build --target whisper-cli) e copie build/bin/whisper-cli para `
  + `${path.join(pasta, 'bin')} ou para uma pasta do PATH; os modelos baixam sozinhos`;

/** ffmpeg do compositor do Remotion: no app empacotado fica em app.asar.unpacked; no desenvolvimento, no node_modules. */
export const caminhoFfmpeg = (o: {raizApp?: string; empacotado?: boolean} = {}): string | null => {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  let pacote: string;
  try {
    pacote = getCompositorPackage({arch: process.arch, platform: process.platform});
  } catch {
    return null;
  }
  const candidatos: string[] = [];
  if (o.empacotado && o.raizApp) candidatos.push(path.join(path.dirname(o.raizApp), 'app.asar.unpacked', 'node_modules', pacote, exe));
  if (o.raizApp) candidatos.push(path.join(o.raizApp, 'node_modules', pacote, exe));
  try {
    const exigir = createRequire(path.join(o.raizApp ?? process.cwd(), 'package.json'));
    candidatos.push(path.join(path.dirname(exigir.resolve(`${pacote}/package.json`)), exe));
  } catch {
    /* sem o pacote: fica nos outros candidatos */
  }
  return candidatos.find((c) => existsSync(c)) ?? null;
};

// ---------- extrair o áudio e rodar o whisper ----------

type Rodado = {codigo: number | null; saida: string; erro: string};

const rodar = (exe: string, args: string[], o: {sinal?: AbortSignal; aoErro?: (linha: string) => void; cwd?: string; filho?: (c: ChildProcess) => void}) =>
  new Promise<Rodado>((ok, falha) => {
    if (o.sinal?.aborted) return falha(new Cancelado());
    const c = spawn(exe, args, {windowsHide: true, cwd: o.cwd ?? path.dirname(exe), stdio: ['ignore', 'pipe', 'pipe']});
    o.filho?.(c);
    let saida = '';
    let erro = '';
    let resto = '';
    const parar = () => c.kill();
    o.sinal?.addEventListener('abort', parar, {once: true});
    c.stdout.on('data', (d: Buffer) => (saida += d.toString('utf-8')));
    c.stderr.on('data', (d: Buffer) => {
      const s = d.toString('utf-8');
      erro = (erro + s).slice(-20_000);
      resto += s;
      const linhas = resto.split(/\r?\n|\r/);
      resto = linhas.pop() ?? '';
      for (const l of linhas) o.aoErro?.(l);
    });
    c.on('error', (e) => {
      o.sinal?.removeEventListener('abort', parar);
      falha(e);
    });
    c.on('close', (codigo) => {
      o.sinal?.removeEventListener('abort', parar);
      if (o.sinal?.aborted) return falha(new Cancelado());
      ok({codigo, saida, erro});
    });
  });

/** WAV PCM 16 bits, 16 kHz, mono: o que o whisper-cli lê. `de_ms`/`dur_ms` recortam o arquivo antes. */
export const extrairAudio = async (o: {ffmpeg: string; entrada: string; saida: string; de_ms?: number; dur_ms?: number; sinal?: AbortSignal}) => {
  const recorte = [
    ...(o.de_ms ? ['-ss', (o.de_ms / 1000).toFixed(3)] : []),
    ...(o.dur_ms ? ['-t', (o.dur_ms / 1000).toFixed(3)] : []),
  ];
  const r = await rodar(o.ffmpeg, ['-hide_banner', '-nostdin', '-y', ...recorte, '-i', o.entrada, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', o.saida],
    {sinal: o.sinal});
  if (r.codigo !== 0 || !existsSync(o.saida)) throw new Error(`o ffmpeg não conseguiu tirar o áudio de ${path.basename(o.entrada)}: ${r.erro.trim().split('\n').slice(-3).join(' ')}`);
};

/** Pedaço do JSON completo do whisper-cli (-ojf): cada token com o texto, os tempos em ms e a probabilidade. */
type TokenWhisper = {text: string; offsets?: {from: number; to: number}; t_dtw?: number; p?: number};
type SaidaWhisper = {transcription?: {offsets?: {from: number; to: number}; text?: string; tokens?: TokenWhisper[]}[]};

const especial = (t: string) => /^\[_?[A-Z_]+[^\]]*\]$/.test(t.trim()) || /^<\|.*\|>$/.test(t.trim());

const SO_PONTUACAO = /^[.,;:!?…)"'”»\]-]+$/;

// ---------- o relógio do VAD ----------
// Com --vad, o whisper-cli junta os trechos de voz num áudio só e devolve o tempo de cada token nesse áudio encurtado
// (só o tempo do segmento volta ao relógio do arquivo). Medido: a narração do C2 depois de 14 s de silêncio e música saiu
// começando em 0 s. O whisper-cli escreve no stderr, para cada trecho, onde ele está no arquivo e no áudio encurtado
// (vad_segment_info); com essa tabela o tempo de cada token volta ao arquivo.

/** Um trecho de voz: onde está no arquivo e no áudio só de voz que o whisper ouviu (ms). */
export type TrechoVad = {orig_ms: number; orig_fim_ms: number; vad_ms: number; vad_fim_ms: number};
const LINHA_VAD = /vad_segment_info:\s*orig_start:\s*([\d.]+),\s*orig_end:\s*([\d.]+),\s*vad_start:\s*([\d.]+),\s*vad_end:\s*([\d.]+)/;
/** A linha "vad_segment_info: orig_start: 14.27, orig_end: 16.22, vad_start: 0.00, vad_end: 1.95" do stderr, em ms. */
export const trechoDoLogVad = (linha: string): TrechoVad | null => {
  const m = LINHA_VAD.exec(linha);
  if (!m) return null;
  const [orig_ms, orig_fim_ms, vad_ms, vad_fim_ms] = m.slice(1, 5).map((x) => Math.round(Number(x) * 1000));
  return {orig_ms, orig_fim_ms, vad_ms, vad_fim_ms};
};
/** Leva um tempo do áudio só de voz ao relógio do arquivo, pelo trecho em que ele cai. Depois do fim de um trecho
 *  vem a folga que o whisper põe antes do próximo; ali o whisper costuma marcar o começo da primeira palavra do trecho
 *  seguinte (medido: a mediana do começo andava 60 ms para trás e o p10, 400 ms). Então o começo que cai na folga vai
 *  ao início do próximo trecho, e o fim fica no fim do trecho em que estava. Sem tabela, fica como está. */
export const tempoNoArquivo = (mapa: TrechoVad[], t: number, lado: 'inicio' | 'fim' = 'inicio') => {
  if (!mapa.length) return t;
  let i = 0;
  while (i + 1 < mapa.length && mapa[i + 1].vad_ms <= t) i++;
  const m = mapa[i];
  const prox = mapa[i + 1];
  if (prox && t > m.vad_fim_ms) return lado === 'inicio' ? prox.orig_ms : Math.min(m.orig_fim_ms + (t - m.vad_fim_ms), prox.orig_ms);
  return m.orig_ms + Math.max(0, t - m.vad_ms);
};

// entre parênteses, só as anotações conhecidas: um "(CLT)" dito na fala fica
const ANOTACAO_ENTRE_PARENTESES = /^\((risos|música|musica|aplausos|silêncio|silencio|tosse|suspiro|ruído|ruido|inaudível|inaudivel)\)[.,!?…]*$/i;
/** Tira as anotações que o whisper escreve no lugar do que não é fala: "[música]", "[Som de fio]", "(risos)", "♪". */
export const semAnotacoes = <P extends {w: string}>(ps: P[]): P[] => {
  const out: P[] = [];
  for (let i = 0; i < ps.length; i++) {
    const w = ps[i].w;
    if (/^[♪♫*]+$/.test(w.replace(/[.,!?…]+$/, ''))) continue;
    if (ANOTACAO_ENTRE_PARENTESES.test(w)) continue;
    if (w.startsWith('[')) {
      const fecha = ']';
      // a anotação vai até a palavra que fecha o colchete (no máximo seis palavras); sem fechar, é texto e fica
      let j = i;
      while (j < ps.length && j - i < 6 && !ps[j].w.replace(/[.,!?…]+$/, '').endsWith(fecha)) j++;
      if (j < ps.length && j - i < 6) {
        i = j;
        continue;
      }
    }
    out.push(ps[i]);
  }
  return out;
};

/** Junta os tokens do whisper em palavras: um token que começa com espaço abre palavra nova; o resto (pedaço de palavra,
 *  pontuação) gruda na anterior. O começo da palavra é o do primeiro token e o fim, o do último pedaço que não é só
 *  pontuação: o "?" que o whisper põe no fim da pausa não estica a palavra por cima do silêncio. */
export const palavrasDoWhisper = (json: SaidaWhisper, desloc_ms = 0, vad?: {mapa: TrechoVad[]}): (Palavra & {p: number})[] => {
  const out: (Palavra & {p: number; _n: number})[] = [];
  for (const seg of json.transcription ?? []) {
    // com o VAD e sem a tabela (outra versão do whisper-cli), o segmento dá a diferença: o tempo dele já é o do arquivo
    const toks = (seg.tokens ?? []).filter((t) => t.text && !especial(t.text));
    const passo = vad && !vad.mapa.length && seg.offsets && toks[0]?.offsets ? seg.offsets.from - toks[0].offsets.from : 0;
    const relogio = (x: number, lado: 'inicio' | 'fim') => (vad?.mapa.length ? tempoNoArquivo(vad.mapa, x, lado) : x + passo);
    for (const t of seg.tokens ?? []) {
      const texto = t.text ?? '';
      if (!texto || especial(texto)) continue;
      const de = relogio(t.offsets?.from ?? 0, 'inicio');
      const ate = Math.max(de, relogio(t.offsets?.to ?? t.offsets?.from ?? 0, 'fim'));
      const novo = /^\s/.test(texto) || !out.length;
      const limpo = texto.trim();
      if (!limpo) continue;
      if (novo && !SO_PONTUACAO.test(limpo)) {
        out.push({w: limpo, s: de, e: ate, p: t.p ?? 1, _n: 1});
      } else {
        const u = out[out.length - 1];
        u.w += limpo;
        if (!SO_PONTUACAO.test(limpo)) u.e = Math.max(u.e, ate);
        u.p = (u.p * u._n + (t.p ?? 1)) / (u._n + 1);
        u._n++;
      }
    }
  }
  // tempos em ordem e sem sobreposição: o fim vai até o começo da próxima, no máximo; palavra com menos de 40 ms ganha
  // os 40 ms e empurra a próxima (o whisper às vezes dá o mesmo tempo a duas palavras seguidas)
  for (let i = 0; i < out.length; i++) {
    const w = out[i];
    if (i > 0 && w.s < out[i - 1].e) w.s = out[i - 1].e;
    const prox = out[i + 1];
    if (prox && w.e > prox.s) w.e = Math.max(w.s, prox.s);
    if (w.e - w.s < 40) w.e = w.s + 40;
  }
  return semAnotacoes(out).map(({w, s, e, p}) => ({w, s: Math.round(s + desloc_ms), e: Math.round(e + desloc_ms), p: Math.round(p * 1000) / 1000}));
};

/** Onde há voz no WAV (ms), pelo detector: uma passada do whisper-cli que só roda o VAD (`-d 1`: não decodifica
 *  nada; 2 a 3 s, quase tudo para carregar o modelo). Sem voz nenhuma, lista vazia. null quando o registro não diz
 *  (outra versão do whisper-cli): aí nada é filtrado. */
export const trechosDeVoz = async (o: {cli: string; arquivoModelo: string; wav: string; vad: string; ajustesVad?: AjustesVad; threads?: number; sinal?: AbortSignal}):
  Promise<{de: number; ate: number}[] | null> => {
  const threads = o.threads ?? Math.max(1, Math.min(8, os.cpus().length - 1));
  let achados: number | null = null;
  const trechos: {de: number; ate: number}[] = [];
  const r = await rodar(o.cli, ['-m', o.arquivoModelo, '-f', o.wav, '-t', String(threads), '-d', '1', '-bs', '1', '-bo', '1', ...argumentosVad(o.vad, o.ajustesVad)], {
    sinal: o.sinal,
    aoErro: (l) => {
      const n = /Final speech segments after filtering:\s*(\d+)/.exec(l);
      if (n) achados = Number(n[1]);
      const v = trechoDoLogVad(l);
      if (v) trechos.push({de: v.orig_ms, ate: v.orig_fim_ms});
    },
  });
  if (r.codigo !== 0) throw new Error(`o detector de voz parou (código ${r.codigo}): ${r.erro.trim().split('\n').slice(-3).join(' ')}`);
  if (achados === 0) return [];
  return trechos.length ? trechos : null;
};

/** Fica a frase que encosta num trecho de voz. Frase: palavras seguidas com vão de até `emenda_ms`; basta uma palavra
 *  dela encostar num trecho (com `folga_ms`) para a frase inteira ficar. Medido no conjunto da casa: palavra a palavra, o
 *  filtro tirou "Amigo, você perdeu seu" do começo do vídeo do WhatsApp (o detector não pegou os primeiros 2,9 s, com
 *  música, e o whisper deixou 410 ms entre "seu" e "emprego") e um "O" do C7. O que o whisper inventa no silêncio fica
 *  isolado, segundos longe da fala. */
export const soNaVoz = <P extends {s: number; e: number}>(palavras: P[], trechos: {de: number; ate: number}[], folga_ms = 300, emenda_ms = 1000): P[] => {
  const naVoz = (p: P) => trechos.some((t) => p.e > t.de - folga_ms && p.s < t.ate + folga_ms);
  const out: P[] = [];
  for (let i = 0; i < palavras.length;) {
    let j = i;
    while (j + 1 < palavras.length && palavras[j + 1].s - palavras[j].e <= emenda_ms) j++;
    const frase = palavras.slice(i, j + 1);
    if (frase.some(naVoz)) out.push(...frase);
    i = j + 1;
  }
  return out;
};

/** Roda o whisper-cli no WAV e devolve as palavras em ms desde o começo do WAV. */
export const rodarWhisper = async (o: {cli: string; modelo: ModeloWhisper; arquivoModelo: string; wav: string; idioma?: string; threads?: number; sinal?: AbortSignal;
  andamento?: (pct: number) => void; filho?: (c: ChildProcess) => void; feixe?: number; dtw?: boolean; prompt?: string; extra?: string[];
  /** caminho do modelo do VAD: com ele, o whisper só ouve os trechos com voz */
  vad?: string; ajustesVad?: AjustesVad}) => {
  const base = o.wav.replace(/\.wav$/i, '');
  const threads = o.threads ?? Math.max(1, Math.min(8, os.cpus().length - 1));
  const feixe = o.feixe ?? FEIXE_PADRAO;
  // com o VAD, sem o -np: a tabela dos trechos de voz sai no stderr junto com o resto do registro do whisper-cli
  const args = ['-m', o.arquivoModelo, '-f', o.wav, '-l', o.idioma ?? 'pt', '-t', String(threads), '-ojf', '-of', base, ...(o.vad ? [] : ['-np']), '-pp',
    ...(feixe > 1 ? ['-bs', String(feixe)] : ['-bs', '1', '-bo', '1']), ...(o.dtw ? ['-nfa', '--dtw', o.modelo.dtw] : []),
    ...(o.prompt?.trim() ? ['--prompt', o.prompt.trim().slice(0, 600)] : []), ...(o.vad ? argumentosVad(o.vad, o.ajustesVad) : []), ...(o.extra ?? [])];
  const mapa: TrechoVad[] = [];
  const r = await rodar(o.cli, args, {
    sinal: o.sinal,
    filho: o.filho,
    aoErro: (l) => {
      const m = /progress\s*=\s*(\d+)%/.exec(l);
      if (m) o.andamento?.(Number(m[1]));
      const v = o.vad ? trechoDoLogVad(l) : null;
      if (v) mapa.push(v);
    },
  });
  const json = `${base}.json`;
  if (r.codigo !== 0 || !existsSync(json)) throw new Error(`o whisper parou (código ${r.codigo}): ${r.erro.trim().split('\n').slice(-4).join(' ')}`);
  const lido = JSON.parse(readFileSync(json, 'utf-8')) as SaidaWhisper;
  rmSync(json, {force: true});
  return palavrasDoWhisper(lido, 0, o.vad ? {mapa: mapa.sort((a, b) => a.vad_ms - b.vad_ms)} : undefined);
};

/** O que o app faz com um WAV: o detector acha a voz, o whisper ouve o arquivo inteiro (os tempos ficam os de sempre)
 *  e só fica a palavra que encosta num trecho de voz. Os scripts de medida usam a mesma função. */
export const ouvirWav = async (o: {pecas: Pecas; modelo: ModeloWhisper; wav: string; idioma?: string; prompt?: string; sinal?: AbortSignal;
  andamento?: (etapa: 'voz' | 'whisper', pct: number) => void; filho?: (c: ChildProcess) => void}) => {
  o.andamento?.('voz', 0);
  // o detector que falha não impede a transcrição: sai sem o filtro (o Cancelar continua parando tudo)
  const voz = o.pecas.vad ? await trechosDeVoz({cli: o.pecas.cli, arquivoModelo: o.pecas.modelo, wav: o.wav, vad: o.pecas.vad, sinal: o.sinal})
    .catch((e: unknown) => {
      if (e instanceof Cancelado || o.sinal?.aborted) throw e;
      return null;
    }) : null;
  o.andamento?.('whisper', 0);
  const ouvidas = await rodarWhisper({cli: o.pecas.cli, modelo: o.modelo, arquivoModelo: o.pecas.modelo, wav: o.wav, idioma: o.idioma ?? 'pt', sinal: o.sinal,
    prompt: o.prompt, filho: o.filho, andamento: (pct) => o.andamento?.('whisper', pct)});
  const palavras = voz ? soNaVoz(ouvidas, voz) : ouvidas;
  return {palavras, trechos_de_voz: voz?.length ?? null, fora_da_voz: ouvidas.length - palavras.length};
};

// ---------- o transcritor: um de cada vez, com andamento e cancelar ----------

export type OpcoesTranscritor = {pasta?: string; raizApp?: string; empacotado?: boolean; buscar?: Buscar; modelo?: IdModeloWhisper;
  /** false desliga o detector de voz (padrão: ligado; o modelo de 0,9 MB baixa com o resto) */
  vad?: boolean;
  /** Recebe o andamento de toda transcrição, a do botão e a que a IA pede pelo MCP: o IPC manda à tela. (transversal-N4) */
  aoAndamento?: (p: ProgressoTranscricao & {arquivo: string}) => void};

export class Transcritor {
  private atual: {controle: AbortController; arquivo: string} | null = null;
  // sha256 por caminho + tamanho + data: o áudio de mesmo tamanho e outra data (cópia, git clone) é lido uma vez
  private readonly shas = new Map<string, string>();
  constructor(private readonly o: OpcoesTranscritor = {}) {}

  private shaGuardado(abs: string, st: Stats) {
    const chave = `${abs}|${st.size}|${st.mtimeMs}`;
    let s = this.shas.get(chave);
    if (!s) {
      s = sha256DoArquivo(abs);
      if (this.shas.size >= 256) this.shas.delete(this.shas.keys().next().value!);
      this.shas.set(chave, s);
    }
    return s;
  }

  /** A transcrição de `arquivo` (o palavras.json ao lado dele) ainda é do áudio como ele está? 'velha' quando a tomada
   *  foi regravada com o mesmo nome (ou o arquivo é da versão 1, sem carimbo). Sem o áudio no projeto, vale o que há. */
  conferir(projeto: Projeto, arquivo: string): EstadoDaFala {
    try {
      const rel = arquivoDasPalavras(arquivo);
      if (!projeto.existe(rel)) return 'falta';
      const lido = projeto.lerJson<unknown>(rel).doc;
      if (!projeto.existe(arquivo)) return palavrasValidas(lido).length ? 'em_dia' : 'falta';
      const abs = projeto.caminho(arquivo);
      const st = statSync(abs);
      const e = conferirFala(lido, {tamanho: st.size, modificado_ms: st.mtimeMs});
      if (e !== 'conferir') return e;
      return fonteDaFala(lido)?.sha256 === this.shaGuardado(abs, st) ? 'em_dia' : 'velha';
    } catch {
      return 'falta';
    }
  }

  get pasta() {
    return this.o.pasta ?? pastaWhisper();
  }

  /** O que está instalado e o que falta, sem baixar nada. */
  estado(modelo: IdModeloWhisper = this.o.modelo ?? MODELO_PADRAO): EstadoTranscricao {
    const m = MODELOS_WHISPER[modelo];
    const cli = acharWhisperCli(this.pasta);
    const baixa = baixaBinario();
    const arqModelo = path.join(this.pasta, m.arquivo);
    const ffmpeg = caminhoFfmpeg(this.o);
    const tem = (a: string, bytes?: number) => existsSync(a) && (bytes === undefined || statSync(a).size === bytes);
    const falta: string[] = [];
    if (!cli && baixa) falta.push(`whisper.cpp ${WHISPER_VERSAO} (${Math.round(BINARIO_WHISPER.bytes / 1e6)} MB)`);
    if (!tem(arqModelo, m.bytes)) falta.push(`modelo ${m.arquivo} (${Math.round(m.bytes / 1e6)} MB)`);
    if (this.o.vad !== false && !tem(path.join(this.pasta, MODELO_VAD.arquivo), MODELO_VAD.bytes)) falta.push(`detector de voz ${MODELO_VAD.arquivo} (0,9 MB)`);
    return {
      pasta: this.pasta, modelo, modelos: Object.values(MODELOS_WHISPER).map((x) => ({id: x.id, nome: x.nome, mb: Math.round(x.bytes / 1e6), instalado: tem(path.join(this.pasta, x.arquivo), x.bytes)})),
      pronto: !falta.length && Boolean(ffmpeg) && Boolean(cli || baixa), falta, ffmpeg: Boolean(ffmpeg), ocupado: this.atual?.arquivo,
      plataforma: baixa || Boolean(cli),
      ...(cli || baixa ? {} : {aviso: comoInstalarWhisper(this.pasta)}),
    };
  }

  /** Baixa o que falta (binário e modelo), conferindo o SHA-256; devolve onde estão as peças. */
  async preparar(modelo: IdModeloWhisper, andamento: Andamento = () => undefined, sinal?: AbortSignal): Promise<Pecas> {
    const achado = acharWhisperCli(this.pasta);
    if (!achado && !baixaBinario()) throw new ErroProjeto(comoInstalarWhisper(this.pasta), 'nao_achado');
    const ffmpeg = caminhoFfmpeg(this.o);
    if (!ffmpeg) throw new ErroProjeto('não achei o ffmpeg do compositor do Remotion (@remotion/compositor): reinstale o app', 'nao_achado');
    const m = MODELOS_WHISPER[modelo];
    const bin = path.join(this.pasta, 'bin');
    const cli = achado ?? path.join(bin, EXE_WHISPER);
    if (!existsSync(cli)) {
      const zip = path.join(this.pasta, 'whisper-bin-x64.zip');
      if (!existsSync(zip) || statSync(zip).size !== BINARIO_WHISPER.bytes || sha256DoArquivo(zip) !== BINARIO_WHISPER.sha256) {
        await baixarConferido({...BINARIO_WHISPER, destino: zip, buscar: this.o.buscar, sinal,
          andamento: (r, t) => andamento({etapa: 'baixando', mensagem: `Baixando o whisper.cpp ${WHISPER_VERSAO}`, progresso: (r / t) * 100})});
      }
      andamento({etapa: 'baixando', mensagem: 'Abrindo o pacote do whisper.cpp', progresso: 100});
      const saiu = extrairZip(readFileSync(zip), bin, (n) => n === EXE_WHISPER || /\.dll$/i.test(n) || /^LICENSE/i.test(n));
      if (!saiu.includes(EXE_WHISPER)) throw new Error(`o pacote do whisper.cpp não trouxe o ${EXE_WHISPER}`);
      rmSync(zip, {force: true});
    }
    const arqModelo = path.join(this.pasta, m.arquivo);
    if (!existsSync(arqModelo) || statSync(arqModelo).size !== m.bytes) {
      await baixarConferido({url: m.url, bytes: m.bytes, sha256: m.sha256, destino: arqModelo, buscar: this.o.buscar, sinal,
        andamento: (r, t) => andamento({etapa: 'baixando', mensagem: `Baixando o modelo ${m.arquivo} (${Math.round(t / 1e6)} MB)`, progresso: (r / t) * 100})});
    }
    // o detector de voz: 0,9 MB, baixa junto na primeira vez (e em quem já tinha o whisper, na próxima transcrição)
    let vad: string | undefined;
    if (this.o.vad !== false) {
      vad = path.join(this.pasta, MODELO_VAD.arquivo);
      if (!existsSync(vad) || statSync(vad).size !== MODELO_VAD.bytes) {
        await baixarConferido({...MODELO_VAD, destino: vad, buscar: this.o.buscar, sinal,
          andamento: (r, t) => andamento({etapa: 'baixando', mensagem: 'Baixando o detector de voz (Silero VAD, 0,9 MB)', progresso: (r / t) * 100})});
      }
    }
    return {pasta: this.pasta, cli, modelo: arqModelo, ffmpeg, ...(vad ? {vad} : {})};
  }

  /** Transcreve um arquivo do projeto (ou o trecho `de_ms`+`dur_ms` dele) e grava midia/<arquivo>.palavras.json com o
   *  carimbo do áudio; com `destino`, grava só a lista de palavras nele. */
  async transcrever(projeto: Projeto, pedido: PedidoTranscricao, andamento: Andamento = () => undefined, sinal?: AbortSignal): Promise<ResultadoTranscricao> {
    if (this.atual) throw new ErroProjeto(`já há uma transcrição em andamento (${this.atual.arquivo}); espere ou cancele`, 'patch');
    const rel = pedido.arquivo;
    if (typeof rel !== 'string' || !projeto.existe(rel)) throw new ErroProjeto(`o arquivo não está no projeto: ${String(rel)}`, 'nao_achado');
    // a lista de palavras grava por cima, fora do diário: nunca no manifesto, num documento ou noutro arquivo do app
    const recusa = pedido.destino === undefined ? null : recusaDoDestinoNoProjeto(projeto, String(pedido.destino));
    if (recusa) throw new ErroProjeto(recusa, 'caminho');
    const controle = new AbortController();
    this.atual = {controle, arquivo: rel};
    // o pedido que chega pelo MCP traz o sinal dele: Esc na conversa ou a conexão que cai param o whisper (transversal-N4)
    const pararPeloPedido = () => controle.abort();
    if (sinal?.aborted) controle.abort();
    sinal?.addEventListener('abort', pararPeloPedido, {once: true});
    const tela = this.o.aoAndamento;
    const avisar: Andamento = (p) => {
      andamento(p);
      tela?.({...p, arquivo: rel, ...(pedido.pela_ia ? {pela_ia: true} : {})});
    };
    const t0 = Date.now();
    const temp = path.join(os.tmpdir(), `estudio-fala-${process.pid}-${Date.now()}`);
    try {
      const modelo = MODELOS_WHISPER[pedido.modelo ?? this.o.modelo ?? MODELO_PADRAO] ?? MODELOS_WHISPER[MODELO_PADRAO];
      const pecas = await this.preparar(modelo.id, avisar, controle.signal);
      mkdirSync(temp, {recursive: true});
      // o carimbo é do áudio que o ffmpeg vai ler agora: se a tomada mudar no meio, a próxima conferência pede de novo
      const fonte = fonteDoAudio(projeto.caminho(rel));
      const wav = path.join(temp, 'fala.wav');
      avisar({etapa: 'audio', mensagem: `Tirando o áudio de ${path.basename(rel)}`, progresso: 0});
      await extrairAudio({ffmpeg: pecas.ffmpeg!, entrada: projeto.caminho(rel), saida: wav, de_ms: pedido.de_ms, dur_ms: pedido.dur_ms, sinal: controle.signal});
      // o detector de voz primeiro: o que o whisper escrever fora dos trechos de voz sai (silêncio, música, efeito)
      const {palavras} = await ouvirWav({pecas, modelo, wav, idioma: pedido.idioma ?? 'pt', sinal: controle.signal,
        // o dicionário do vídeo entra no fim do vocabulário: o whisper copia a grafia do que lê no prompt
        prompt: `${pedido.vocabulario ?? PROMPT_PADRAO}${Array.isArray(pedido.termos) && pedido.termos.length ? ` ${pedido.termos.slice(0, 40).join(', ')}.` : ''}`,
        andamento: (etapa, pct) => avisar({etapa: 'transcrevendo', mensagem: etapa === 'voz' ? 'Procurando a voz' : `Transcrevendo com o modelo ${modelo.arquivo}`, progresso: pct})});
      // o tempo das palavras conta do começo do arquivo, mesmo quando só um trecho foi transcrito
      const desloc = pedido.de_ms ?? 0;
      const finais = palavras.map((p) => ({...p, s: p.s + desloc, e: p.e + desloc}));
      const destino = pedido.destino ?? arquivoDasPalavras(rel);
      const trecho = pedido.de_ms !== undefined || pedido.dur_ms !== undefined ? {de_ms: pedido.de_ms, dur_ms: pedido.dur_ms} : undefined;
      const gravado: PalavrasGravadas = {versao: VERSAO_PALAVRAS, fonte, modelo: modelo.id, ...(trecho ? {trecho} : {}), palavras: finais};
      projeto.gravarTexto(destino, `${JSON.stringify(pedido.destino ? finais : gravado)}\n`);
      const r: ResultadoTranscricao = {ok: true, arquivo: rel, palavras: destino, n: finais.length, modelo: modelo.id, duracao_s: Math.round((Date.now() - t0) / 100) / 10,
        texto: finais.map((p) => p.w).join(' ')};
      avisar({etapa: 'pronto', mensagem: `${finais.length} palavras em ${r.duracao_s} s`, progresso: 100});
      return r;
    } catch (e) {
      if (e instanceof Cancelado || controle.signal.aborted) {
        avisar({etapa: 'cancelado', mensagem: 'Transcrição cancelada'});
        return {ok: false, arquivo: rel, cancelado: true, mensagem: 'Transcrição cancelada'};
      }
      throw e;
    } finally {
      this.atual = null;
      sinal?.removeEventListener('abort', pararPeloPedido);
      rmSync(temp, {recursive: true, force: true});
    }
  }

  cancelar() {
    this.atual?.controle.abort();
  }

  /** Cortes pela fala: grava a narração emendada e o palavras.json dela (src/main/cortes-fala.ts). */
  async emendar(projeto: Projeto, pedido: PedidoEmenda): Promise<ResultadoEmenda> {
    const {emendarArquivo} = await import('./cortes-fala');
    return emendarArquivo(projeto, pedido);
  }
}

// ---------- IPC (registrado no main.ts com uma linha) ----------

type Lidar = <A extends unknown[], R>(canal: string, f: (...a: A) => R | Promise<R>) => void;

export const registrarIpcTranscricao = (lidar: Lidar, o: {projeto: () => Projeto; enviar: (canal: string, ...a: unknown[]) => void; aoCancelar: (f: () => void) => void} & OpcoesTranscritor) => {
  // o andamento de toda transcrição vai à tela, também quando a IA pede pelo MCP
  const transcritor = new Transcritor({...o, aoAndamento: (p) => o.enviar(CANAL.falaProgresso, p)});
  lidar(CANAL.falaEstado, (modelo?: IdModeloWhisper) => transcritor.estado(modelo));
  lidar(CANAL.falaEmendar, (pedido: PedidoEmenda) => transcritor.emendar(o.projeto(), pedido));
  lidar(CANAL.falaConferir, (arquivos: string[]) => Object.fromEntries((Array.isArray(arquivos) ? arquivos : []).filter((a) => typeof a === 'string').slice(0, 200)
    .map((a) => [a, transcritor.conferir(o.projeto(), a)])));
  lidar(CANAL.falaTranscrever, (pedido: PedidoTranscricao) => transcritor.transcrever(o.projeto(), {...pedido, pela_ia: undefined}));
  o.aoCancelar(() => transcritor.cancelar());
  return transcritor;
};
