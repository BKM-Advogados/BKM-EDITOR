// Teste da limpeza de voz com uma voz de verdade, fora do Electron: pega a narração do exemplo da Cliente
// (exemplos/exemplo/midia/video-exemplo.mp4), soma ruído conhecido (zumbido de 60 Hz com harmônicos, ruído de fundo largo e
// chiado agudo), limpa nas três intensidades e mede: ruído nas pausas e nível da voz antes e depois (dB com ponderação K,
// o mesmo número do LUFS) e o resto do ruído somado que sobrou. Confere também o medidor (src/nucleo/loudness.ts) contra
// o loudnorm do ffmpeg do Remotion no mesmo arquivo. Uso: npx tsx scripts/limpeza-teste.mjs [segundos]
// Saída em testes/saida/limpeza/ (ignorada pelo git): voz-com-ruido.wav e voz-limpa-<intensidade>.wav, para ouvir.
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {envelopeDeAmostras} from '../src/nucleo/audio.ts';
import {INTENSIDADES, limparVoz, medirRuido} from '../src/nucleo/limpeza-voz.ts';
import {medirAmostras} from '../src/nucleo/loudness.ts';
import {decodificarAudio, gravarWav} from '../src/main/ffmpeg-som.ts';
import {medirArquivo} from '../src/main/loudness.ts';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const saida = path.join(raiz, 'testes', 'saida', 'limpeza');
const segundos = Number(process.argv[2]) || 40;
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} s] ${m}`);
const db = (v) => (v === null || v === undefined ? '—' : `${v.toFixed(1)} dB`);
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

rmSync(saida, {recursive: true, force: true});
mkdirSync(saida, {recursive: true});

// 1. a voz: narração do exemplo da Cliente, mono como veio (44,1 kHz)
const fonte = await decodificarAudio(path.join(raiz, 'exemplos', 'exemplo', 'midia', 'video-exemplo.mp4'));
const taxa = fonte.taxa;
const n = Math.min(fonte.canais[0].length, Math.round(segundos * taxa));
const voz = fonte.canais[0].slice(0, n);
log(`voz: ${(n / taxa).toFixed(1)} s a ${taxa} Hz, ${fonte.canais.length} canal(is)`);

// 2. ruído conhecido, determinístico: zumbido (60 Hz e harmônicos), ruído largo (branco filtrado, mais grave) e chiado
let semente = 12345;
const aleatorio = () => ((semente = (semente * 1664525 + 1013904223) >>> 0) / 0xffffffff) * 2 - 1;
const zumbido = new Float32Array(n);
const largo = new Float32Array(n);
const chiado = new Float32Array(n);
let lp = 0;
let ant = 0;
for (let i = 0; i < n; i++) {
  const t = i / taxa;
  zumbido[i] = [1, 0.5, 0.35, 0.2].reduce((s, a, h) => s + a * Math.sin(2 * Math.PI * 60 * (h + 1) * t + h), 0);
  lp = 0.92 * lp + 0.08 * aleatorio(); // ruído de sala: mais energia no grave e no médio
  largo[i] = lp;
  const w = aleatorio();
  chiado[i] = w - ant; // diferença: sobe 6 dB por oitava, chiado agudo
  ant = w;
}
const escalar = (x, alvoDbfs) => {
  const k = Math.pow(10, alvoDbfs / 20) / rms(x);
  for (let i = 0; i < x.length; i++) x[i] *= k;
};
escalar(zumbido, -45);
escalar(largo, -42);
escalar(chiado, -50);
const ruido = new Float32Array(n);
for (let i = 0; i < n; i++) ruido[i] = zumbido[i] + largo[i] + chiado[i];
const suja = new Float32Array(n);
for (let i = 0; i < n; i++) suja[i] = Math.max(-1, Math.min(1, voz[i] + ruido[i]));
const arquivoSujo = path.join(saida, 'voz-com-ruido.wav');
writeFileSync(arquivoSujo, gravarWav([suja], taxa));
writeFileSync(path.join(saida, 'voz-original.wav'), gravarWav([voz], taxa));
log(`ruído somado: zumbido −45, largo −42 e chiado −50 dBFS RMS → ${arquivoSujo}`);

// 3. a referência: a voz original nas mesmas pausas (o que seria "limpo de verdade")
const pausasRef = medirRuido(envelopeDeAmostras([suja], taxa));
const original = medirRuido(envelopeDeAmostras([voz], taxa), pausasRef.pausas);
log(`voz original (sem ruído), nas mesmas pausas: ruído ${db(original.ruido_db)} · voz ${db(original.voz_db)}`);

// 4. limpa nas três intensidades
const resto = (limpa) => {
  // o que sobrou do ruído somado: limpa − voz original filtrada do mesmo jeito não dá para isolar; mede a diferença
  // limpa − voz nas pausas (onde a voz é quase nada), em dBFS RMS
  const p = pausasRef.pausas;
  const janela = Math.round(taxa * 0.05);
  let s = 0, c = 0;
  for (const j of p) for (let i = j * janela; i < Math.min(n, (j + 1) * janela); i++) (s += (limpa[i] - voz[i]) ** 2), c++;
  return 10 * Math.log10(s / Math.max(1, c) + 1e-20);
};
log(`resto do ruído nas pausas antes de limpar: ${resto(suja).toFixed(1)} dBFS RMS`);
const resumo = [];
for (const intensidade of Object.keys(INTENSIDADES)) {
  const t = Date.now();
  const mem0 = process.memoryUsage().rss;
  const r = await limparVoz([suja], taxa, intensidade, {pausar: () => new Promise((ok) => setImmediate(ok))});
  const ms = Date.now() - t;
  const mem = Math.round((process.memoryUsage().rss - mem0) / 1024 / 1024);
  const arq = path.join(saida, `voz-limpa-${intensidade}.wav`);
  writeFileSync(arq, gravarWav(r.canais, taxa));
  const m = r.medidas;
  resumo.push({intensidade, ...m, resto_db: Math.round(resto(r.canais[0]) * 10) / 10, ms, mem_mb: mem});
  log(`${INTENSIDADES[intensidade].nome}: ruído nas pausas ${db(m.ruido_antes_db)} → ${db(m.ruido_depois_db)} (${(m.ruido_depois_db - m.ruido_antes_db).toFixed(1)} dB) · voz ${db(m.voz_antes_db)} → ${db(m.voz_depois_db)} · resto do ruído somado ${resto(r.canais[0]).toFixed(1)} dBFS · ${ms} ms (${((ms / 1000) / (n / taxa) * 60).toFixed(1)} s por minuto de áudio), +${mem} MB`);
}
writeFileSync(path.join(saida, 'resumo.json'), JSON.stringify({segundos: n / taxa, taxa, original, resumo}, null, 2));

// 5. o medidor da tela contra o loudnorm do ffmpeg, no mesmo arquivo
const nosso = medirAmostras([suja], taxa);
const ff = await medirArquivo(arquivoSujo);
log(`medidor × ffmpeg (voz com ruído): integrado ${nosso.integrado_lufs} × ${ff.i} LUFS (diferença ${(nosso.integrado_lufs - ff.i).toFixed(2)} LU) · pico ${nosso.pico_dbtp} × ${ff.tp} dBTP`);
const limpaMedia = path.join(saida, 'voz-limpa-media.wav');
const nossoL = medirAmostras((await decodificarAudio(limpaMedia)).canais, taxa);
const ffL = await medirArquivo(limpaMedia);
log(`medidor × ffmpeg (voz limpa, média): integrado ${nossoL.integrado_lufs} × ${ffL.i} LUFS (diferença ${(nossoL.integrado_lufs - ffL.i).toFixed(2)} LU) · pico ${nossoL.pico_dbtp} × ${ffL.tp} dBTP`);
const ok = Math.abs(nosso.integrado_lufs - ff.i) <= 0.5 && Math.abs(nossoL.integrado_lufs - ffL.i) <= 0.5 && resumo.every((x) => x.ruido_depois_db < x.ruido_antes_db - 6);
console.log(ok ? '\nOK: a voz saiu limpa (ruído nas pausas caiu) e o medidor bate com o ffmpeg a ±0,5 LU.' : '\nFALHOU: veja os números acima.');
process.exit(ok ? 0 : 1);
