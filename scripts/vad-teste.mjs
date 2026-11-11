// Medida do detector de voz (VAD) da transcrição local, fora do Electron: o mesmo whisper-cli e o mesmo modelo do app,
// com e sem o VAD, em quatro áudios: silêncio (ruído rosa a -60 dB), música sintética (acordes, baixo e batida; sem voz
// cantada), efeitos sonoros sintéticos em sequência e uma narração de verdade (scripts/voz-de-teste.mjs) depois de 6 s de
// silêncio e 8 s de música. Conta as palavras inventadas fora da fala e confere se os tempos da narração continuam no
// relógio do arquivo (erro do começo das palavras contra o palavras.json conferido dela, deslocado de 14 s).
// Uso: npx tsx scripts/vad-teste.mjs [small|base] ['[{"nome": "x", "modo": "passada", "silencio_min_ms": 1000}]'] [--sem-base]
// (padrão: small; sem VAD, o VAD como filtro, que é o que o app faz, e o VAD numa passada só, em dois ajustes). Saída em testes/saida/vad/ (ignorada pelo git).
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {norm} from '../src/nucleo/roteiro/resolver.ts';
import {MODELOS_WHISPER, PROMPT_PADRAO, Transcritor, VAD_PADRAO, extrairAudio, ouvirWav, rodarWhisper} from '../src/main/transcricao.ts';
import {vozDeTeste} from './voz-de-teste.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const saida = path.join(raiz, 'testes', 'saida', 'vad');
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s] ${m}`);
const id = process.argv[2] ?? 'small';
const modelo = MODELOS_WHISPER[id];
if (!modelo) throw new Error(`modelo desconhecido: ${id}`);

rmSync(saida, {recursive: true, force: true});
mkdirSync(saida, {recursive: true});
const transcritor = new Transcritor({raizApp: raiz});
const pecas = await transcritor.preparar(id, (p) => p.progresso === 100 && log(p.mensagem));
log(`peças: ${JSON.stringify({cli: pecas.cli, vad: pecas.vad})}`);
const ff = (args) => execFileSync(pecas.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {windowsHide: true});
const W = (n) => path.join(saida, n);
const TAXA = 16_000;

// o ffmpeg do Remotion não traz geradores de ruído nem filtros de síntese: os áudios de teste são feitos aqui, em PCM
/** Grava amostras (-1 a 1) num WAV PCM 16 bits, 16 kHz, mono. */
const gravarWav = (arq, x) => {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(TAXA, 24); b.writeUInt32LE(TAXA * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  writeFileSync(arq, b);
};
/** Lê o bloco "data" de um WAV PCM 16 bits mono (o que o ffmpeg grava com -ar 16000 -ac 1). */
const lerWav = (arq) => {
  const b = readFileSync(arq);
  let i = 12;
  while (i + 8 <= b.length) {
    const id = b.toString('ascii', i, i + 4);
    const n = b.readUInt32LE(i + 4);
    if (id === 'data') return Float32Array.from({length: Math.floor(Math.min(n, b.length - i - 8) / 2)}, (_, k) => b.readInt16LE(i + 8 + k * 2) / 32768);
    i += 8 + n + (n % 2);
  }
  throw new Error(`WAV sem dados: ${arq}`);
};
let semente = 7;
const acaso = () => ((semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
const juntar = (...partes) => {
  const out = new Float32Array(partes.reduce((s, x) => s + x.length, 0));
  let i = 0;
  for (const x of partes) { out.set(x, i); i += x.length; }
  return out;
};

// silêncio de sala: ruído grave bem baixo, perto de -60 dB (o whisper costuma inventar "Obrigado." no quase silêncio)
const silencio = new Float32Array(20 * TAXA);
for (let i = 0, y = 0; i < silencio.length; i++) silencio[i] = y = 0.97 * y + 0.03 * acaso() * 0.06;
gravarWav(W('silencio.wav'), silencio);
// música sintética: quatro acordes de 2 s (lá menor, fá, dó, sol) com baixo, batida a cada meio segundo e chimbal
const musica = new Float32Array(20 * TAXA);
for (let i = 0, ant = 0; i < musica.length; i++) {
  const t = i / TAXA;
  const f = [220, 174.61, 261.63, 196][Math.floor((t % 8) / 2)];
  const acorde = 0.12 * Math.sin(2 * Math.PI * f * t) + 0.09 * Math.sin(2 * Math.PI * f * 1.2599 * t) + 0.09 * Math.sin(2 * Math.PI * f * 1.4983 * t) + 0.12 * Math.sin(Math.PI * f * t);
  const batida = 0.35 * Math.exp(-25 * (t % 0.5)) * Math.sin(2 * Math.PI * 55 * t);
  const r = acaso();
  const chimbal = 0.08 * Math.exp(-60 * ((t + 0.25) % 0.5)) * (r - ant);
  ant = r;
  musica[i] = acorde + batida + chimbal;
}
gravarWav(W('musica.wav'), musica);
// efeitos sintéticos como os do carrossel narrado (whoosh, impacto, carimbo, papel, swell, pop), um depois do outro, com
// meio segundo entre eles
const efeito = (seg, f) => Float32Array.from({length: Math.round(seg * TAXA)}, (_, i) => f(i / TAXA, seg));
const ruido = () => acaso();
const efeitos = [
  efeito(1.2, (t, d) => ruido() * Math.sin(Math.PI * t / d) * 0.5), // whoosh: ruído que sobe e desce
  efeito(1.5, (t) => Math.sin(2 * Math.PI * (60 - 20 * t) * t) * Math.exp(-3 * t) * 0.8), // impacto grave
  efeito(0.5, (t) => (ruido() * 0.6 + Math.sin(2 * Math.PI * 140 * t)) * Math.exp(-18 * t) * 0.7), // carimbo
  efeito(0.9, (t, d) => ruido() * 0.25 * Math.sin(Math.PI * t / d)), // papel deslizando
  efeito(2.5, (t, d) => Math.sin(2 * Math.PI * 220 * t) * (t / d) * 0.4), // swell
  efeito(0.3, (t) => Math.sin(2 * Math.PI * 900 * t) * Math.exp(-40 * t) * 0.6), // pop
].map((x) => juntar(x, new Float32Array(TAXA / 2)));
gravarWav(W('efeitos.wav'), juntar(...efeitos));
// a narração depois de 6 s de silêncio e 8 s de música (os 14 s em que nada deve ser escrito)
const voz = vozDeTeste(raiz, {exigirPalavras: true});
await extrairAudio({ffmpeg: pecas.ffmpeg, entrada: voz.voz, saida: W('narracao.wav')});
gravarWav(W('mistura.wav'), juntar(silencio.subarray(0, 6 * TAXA), musica.subarray(0, 8 * TAXA), lerWav(W('narracao.wav'))));
const ANTES_MS = 14_000;
const referencia = voz.palavras.map((p) => ({...p, s: p.s + ANTES_MS, e: p.e + ANTES_MS}));

/** Distância de edição por palavra e o erro do começo das palavras iguais (como em transcrever-teste.mjs). */
const comparar = (ref, hip) => {
  const a = ref.map((p) => norm(p.w));
  const b = hip.map((p) => norm(p.w));
  const d = Array.from({length: a.length + 1}, (_, i) => Array.from({length: b.length + 1}, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  const pares = [];
  for (let i = a.length, j = b.length; i > 0 && j > 0;) {
    if (a[i - 1] === b[j - 1] && d[i][j] === d[i - 1][j - 1]) { pares.push([ref[i - 1], hip[j - 1]]); i--; j--; }
    else if (d[i][j] === d[i - 1][j - 1] + 1) { i--; j--; }
    else if (d[i][j] === d[i - 1][j] + 1) i--;
    else j--;
  }
  const erros = pares.map(([r, h]) => Math.abs(r.s - h.s)).sort((x, y) => x - y);
  return {wer_pct: Math.round((d[a.length][b.length] / a.length) * 1000) / 10, inicio_mediana_ms: erros[Math.floor(erros.length / 2)] ?? 0,
    inicio_p90_ms: erros[Math.floor(erros.length * 0.9)] ?? 0, ate_100ms_pct: Math.round((erros.filter((x) => x <= 100).length / Math.max(1, erros.length)) * 1000) / 10};
};

// as configurações vêm da linha de comando (JSON com {nome, silencio_min_ms, folga_ms, limiar}) ou são as de sempre
// as configurações vêm da linha de comando (JSON com {nome, modo: 'filtro' | 'passada', silencio_min_ms, folga_ms,
// limiar}) ou são as de sempre: sem VAD, o VAD como filtro (o que o app faz) e o VAD numa passada só (--vad)
const pedidas = process.argv[3]?.startsWith('[') ? JSON.parse(process.argv[3]) : [{nome: 'VAD como filtro (o app)', modo: 'filtro'},
  {nome: 'VAD numa passada', modo: 'passada'}, {nome: 'VAD numa passada, pausa 1 s, folga 300 ms', modo: 'passada', silencio_min_ms: 1000, folga_ms: 300}];
const configs = [
  ...(process.argv.includes('--sem-base') ? [] : [{nome: 'sem VAD'}]),
  ...pedidas.map(({nome, modo, ...a}) => ({nome, modo: modo ?? 'passada', ajustesVad: {...VAD_PADRAO, ...a}})),
];
const ouvir = async (c, wav) => {
  if (c.modo === 'filtro') {
    const r = await ouvirWav({pecas, modelo, wav, prompt: PROMPT_PADRAO});
    return {palavras: r.palavras, trechos: r.trechos_de_voz, fora: r.fora_da_voz};
  }
  const vad = c.modo === 'passada' ? {vad: pecas.vad, ajustesVad: c.ajustesVad} : {};
  return {palavras: await rodarWhisper({cli: pecas.cli, modelo, arquivoModelo: pecas.modelo, wav, prompt: PROMPT_PADRAO, ...vad})};
};
const resultados = [];
for (const c of configs) {
  const linha = {config: c.nome};
  for (const nome of ['silencio', 'musica', 'efeitos', 'mistura']) {
    const tw = Date.now();
    const {palavras, trechos, fora} = await ouvir(c, W(`${nome}.wav`));
    writeFileSync(W(`${nome}-${c.nome.replace(/\W+/g, '_')}.json`), JSON.stringify(palavras));
    const s = Math.round((Date.now() - tw) / 100) / 10;
    if (nome === 'mistura') {
      const inventadas = palavras.filter((p) => p.e <= ANTES_MS - 100);
      Object.assign(linha, {mistura_antes_da_fala: inventadas.length, mistura_s: s, ...(trechos !== undefined ? {trechos_de_voz: trechos, fora_da_voz: fora} : {}),
        ...comparar(referencia, palavras.filter((p) => p.e > ANTES_MS - 100))});
      if (inventadas.length) log(`${c.nome}: inventou antes da fala: ${inventadas.map((p) => `${p.w}@${p.s}`).join(' ')}`);
    } else {
      linha[nome] = palavras.length;
      if (palavras.length) log(`${c.nome} · ${nome}: ${palavras.map((p) => p.w).join(' ')}`);
    }
  }
  resultados.push(linha);
  log(JSON.stringify(linha));
}
writeFileSync(W('resultados.json'), JSON.stringify(resultados, null, 2));
console.table(resultados);
