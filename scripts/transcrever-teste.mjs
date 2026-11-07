// Teste da transcrição local, fora do Electron: usa o mesmo Transcritor do app (src/main/transcricao.ts) para baixar o
// whisper.cpp e o modelo (se faltarem) em %USERPROFILE%\Estudio\modelos\whisper\, transcreve a narração do exemplo Cliente C2
// (72 s, pt-BR) e compara com o palavras.json de referência do exemplo: palavras certas (WER), erro do começo de cada
// palavra, tempo e pico de memória do whisper-cli.
// Uso: npx tsx scripts/transcrever-teste.mjs [base|small|turbo ...]   (padrão: small)
// Saída em testes/saida/transcrever/ (ignorada pelo git).
import {execFileSync} from 'node:child_process';
import {cpSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Projeto} from '../src/nucleo/projeto.ts';
import {norm} from '../src/nucleo/roteiro/resolver.ts';
import {MODELOS_WHISPER, Transcritor, extrairAudio, rodarWhisper} from '../src/main/transcricao.ts';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const saida = path.join(raiz, 'testes', 'saida', 'transcrever');
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s] ${m}`);
const modelos = process.argv.slice(2).length ? process.argv.slice(2) : ['small'];

rmSync(saida, {recursive: true, force: true});
mkdirSync(path.join(saida, 'projeto', 'midia'), {recursive: true});
cpSync(path.join(raiz, 'exemplos', 'exemplo', 'midia', 'video-exemplo.mp4'), path.join(saida, 'projeto', 'midia', 'video-exemplo.mp4'));
const referencia = JSON.parse(readFileSync(path.join(raiz, 'exemplos', 'exemplo', 'video', 'palavras.json'), 'utf-8'));

/** Distância de edição por palavra (sem acento, caixa e pontuação) e o alinhamento, para comparar os tempos. */
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
  const media = erros.reduce((s, x) => s + x, 0) / Math.max(1, erros.length);
  const fim = pares.map(([r, h]) => Math.abs(r.e - h.e)).reduce((s, x) => s + x, 0) / Math.max(1, pares.length);
  return {wer: d[a.length][b.length] / a.length, iguais: pares.length, erro_inicio_medio_ms: Math.round(media), erro_inicio_mediana_ms: erros[Math.floor(erros.length / 2)] ?? 0,
    erro_inicio_p90_ms: erros[Math.floor(erros.length * 0.9)] ?? 0, erro_fim_medio_ms: Math.round(fim)};
};

/** Pico do working set do processo, lido do tasklist a cada 300 ms (MB). */
const vigiarMemoria = (pid) => {
  let pico = 0;
  const ler = () => {
    try {
      const linha = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {encoding: 'utf-8', windowsHide: true});
      const kb = Number((/"([\d.,\s ]+) K"/.exec(linha)?.[1] ?? '0').replace(/[^\d]/g, ''));
      pico = Math.max(pico, kb / 1024);
    } catch { /* o processo acabou */ }
  };
  const relogio = setInterval(ler, 300);
  return {parar: () => (clearInterval(relogio), Math.round(pico))};
};

const projeto = new Projeto(path.join(saida, 'projeto'));
const transcritor = new Transcritor({raizApp: raiz});
log(`estado: ${JSON.stringify(transcritor.estado())}`);
const resultados = {};
for (const id of modelos) {
  const m = MODELOS_WHISPER[id];
  if (!m) throw new Error(`modelo desconhecido: ${id}`);
  let ultimo = '';
  const pecas = await transcritor.preparar(id, (p) => {
    const linha = `${p.mensagem} ${Math.floor(p.progresso ?? 0)}%`;
    if (linha !== ultimo && Math.floor(p.progresso ?? 0) % 10 === 0) log(linha);
    ultimo = linha;
  });
  log(`peças prontas: ${pecas.cli}`);
  const wav = path.join(saida, `fala-${id}.wav`);
  const ta = Date.now();
  await extrairAudio({ffmpeg: pecas.ffmpeg, entrada: projeto.caminho('midia/video-exemplo.mp4'), saida: wav});
  log(`áudio em WAV 16 kHz mono: ${((Date.now() - ta) / 1000).toFixed(1)} s`);
  const tw = Date.now();
  let vigia;
  const palavras = await rodarWhisper({cli: pecas.cli, modelo: m, arquivoModelo: pecas.modelo, wav, filho: (c) => (vigia = vigiarMemoria(c.pid)),
    andamento: (pct) => pct % 25 === 0 && log(`${id}: ${pct}%`)});
  const segundos = (Date.now() - tw) / 1000;
  const memoria = vigia?.parar() ?? 0;
  writeFileSync(path.join(saida, `palavras-${id}.json`), JSON.stringify(palavras, null, 0));
  const c = comparar(referencia, palavras);
  resultados[id] = {segundos: Math.round(segundos * 10) / 10, memoria_pico_mb: memoria, palavras: palavras.length, referencia: referencia.length, ...c,
    wer_pct: Math.round(c.wer * 1000) / 10};
  log(`${id}: ${JSON.stringify(resultados[id])}`);
  log(`texto: ${palavras.map((p) => p.w).join(' ')}`);
}
// o caminho do app inteiro: transcrever() grava midia/video-exemplo.mp4.palavras.json no projeto
const r = await transcritor.transcrever(projeto, {arquivo: 'midia/video-exemplo.mp4', modelo: modelos[0]}, (p) => p.etapa !== 'transcrevendo' && log(`${p.etapa}: ${p.mensagem}`));
log(`transcrever(): ${JSON.stringify({...r, texto: `${r.texto?.slice(0, 60)}…`})}`);
writeFileSync(path.join(saida, 'resultados.json'), JSON.stringify(resultados, null, 2));
console.table(resultados);
