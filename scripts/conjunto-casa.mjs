// O conjunto da casa da transcrição local (régua da Fala, docs/legendas.md, "Conjunto da casa"): cerca de 10 min de fala
// da casa (scripts/conjunto-casa.json), transcritos com os mesmos ajustes do app (modelo, vocabulário e detector de voz),
// e a medida contra a conferência feita à mão.
//
//   npx tsx scripts/conjunto-casa.mjs preparar   transcreve cada item e grava, na pasta da conferência, o WAV, o texto
//                                                da máquina para corrigir (<id>.texto.txt) e a amostra de começos de
//                                                palavra em rótulos do Audacity (<id>.inicios.txt). Nunca grava por cima
//                                                de um texto ou de rótulos que já estão lá.
//   npx tsx scripts/conjunto-casa.mjs medir      lê o que foi conferido e mede: palavras erradas (WER), glossário da
//                                                casa e começo das palavras (até 100 ms). Com --refazer, transcreve de
//                                                novo com o código de agora (para comparar modelo, vocabulário ou VAD).
// Opções: --base <pasta das mídias>, --conferencia <pasta>, --modelo small|base, --sem-vad; no preparar, --so <id,id>.
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {norm} from '../src/nucleo/roteiro/resolver.ts';
import {DICIONARIO_CASA} from '../src/nucleo/legendas.ts';
import {MODELOS_WHISPER, MODELO_PADRAO, PROMPT_PADRAO, Transcritor, extrairAudio, ouvirWav} from '../src/main/transcricao.ts';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifesto = JSON.parse(readFileSync(path.join(raiz, 'scripts', 'conjunto-casa.json'), 'utf-8'));
const argv = process.argv.slice(2);
const comando = argv[0];
const opcao = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const casa = (p) => p.replace(/^~(?=[\\/])/, os.homedir());
const base = path.resolve(opcao('--base') ?? casa(manifesto.base));
const conf = path.resolve(opcao('--conferencia') ?? casa(manifesto.conferencia));
const idModelo = opcao('--modelo') ?? MODELO_PADRAO;
const comVad = !argv.includes('--sem-vad');
if (!['preparar', 'medir'].includes(comando)) {
  console.log('uso: npx tsx scripts/conjunto-casa.mjs preparar|medir [--refazer] [--base <pasta>] [--conferencia <pasta>] [--modelo small|base] [--sem-vad]');
  process.exit(1);
}
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s] ${m}`);
const C = (n) => path.join(conf, n);
const sha256 = (arq) => createHash('sha256').update(readFileSync(arq)).digest('hex');

// ---------- transcrever como o app ----------

let pecas;
const transcritor = new Transcritor({raizApp: raiz, vad: comVad});
const transcrever = async (item) => {
  pecas ??= await transcritor.preparar(idModelo, (p) => p.progresso === 100 && log(p.mensagem));
  const wav = C(`${item.id}.wav`);
  await extrairAudio({ffmpeg: pecas.ffmpeg, entrada: path.join(base, item.arquivo), saida: wav});
  const tw = Date.now();
  const {palavras, fora_da_voz} = await ouvirWav({pecas, modelo: MODELOS_WHISPER[idModelo], wav, prompt: PROMPT_PADRAO});
  return {palavras, fora_da_voz, segundos: Math.round((Date.now() - tw) / 100) / 10};
};

// ---------- preparar ----------

const AVISO_TEXTO = [
  '# Corrija o texto abaixo para o que foi dito, palavra por palavra: siglas em caixa alta (FGTS, CLT), números como a',
  '# legenda escreveria (13º, 40%), nomes como se escrevem (Empresa, Escritório Exemplo). A pontuação e as quebras de linha',
  '# não contam. Palavra que não dá para entender: escreva [?]. Quando terminar, troque "não" por "sim" na linha abaixo.',
  '# conferido: não',
];
const textoEmFrases = (palavras) => {
  const linhas = [];
  let atual = [];
  for (const p of palavras) {
    atual.push(p.w);
    if (/[.!?…]$/.test(p.w)) { linhas.push(atual.join(' ')); atual = []; }
  }
  if (atual.length) linhas.push(atual.join(' '));
  return linhas;
};
/** Rótulos do Audacity (início, fim e texto, em segundos, separados por tabulação): a amostra de palavras espaçadas. */
const rotulosDaAmostra = (palavras, n) => {
  const passo = palavras.length / Math.max(1, n);
  const escolhidas = Array.from({length: Math.min(n, palavras.length)}, (_, k) => Math.floor(passo * k + passo / 2));
  return `${escolhidas.map((i, k) => `${(palavras[i].s / 1000).toFixed(3)}\t${(palavras[i].e / 1000).toFixed(3)}\t${String(k + 1).padStart(2, '0')} ${palavras[i].w}`).join('\n')}\n`;
};

if (comando === 'preparar') {
  mkdirSync(conf, {recursive: true});
  // --so a,b: só esses itens (o registro dos outros fica como estava)
  const so = opcao('--so')?.split(',');
  const antes = so && existsSync(C('conjunto.json')) ? JSON.parse(readFileSync(C('conjunto.json'), 'utf-8')) : null;
  const registro = {preparado_em: new Date().toISOString(), modelo: idModelo, vad: comVad, itens: {...(antes?.itens ?? {})}};
  let total = 0;
  for (const item of manifesto.itens) {
    if (so && !so.includes(item.id)) { total += registro.itens[item.id] ? item.segundos : 0; continue; }
    const fonte = path.join(base, item.arquivo);
    if (!existsSync(fonte)) { log(`${item.id}: não achei ${fonte}`); continue; }
    const {palavras, segundos, fora_da_voz} = await transcrever(item);
    writeFileSync(C(`${item.id}.maquina.json`), `${JSON.stringify(palavras)}\n`);
    registro.itens[item.id] = {arquivo: item.arquivo, sha256: sha256(fonte), palavras: palavras.length, fora_da_voz, transcrito_em_s: segundos};
    total += item.segundos;
    const texto = C(`${item.id}.texto.txt`);
    if (existsSync(texto)) log(`${item.id}: ${path.basename(texto)} já existe, ficou como está`);
    else writeFileSync(texto, [`# ${item.id} · ${item.tipo} · ${item.arquivo}`, ...AVISO_TEXTO, '', ...textoEmFrases(palavras), ''].join('\n'));
    const inicios = C(`${item.id}.inicios.txt`);
    if (existsSync(inicios)) log(`${item.id}: ${path.basename(inicios)} já existe, ficou como está`);
    else {
      writeFileSync(inicios, rotulosDaAmostra(palavras, manifesto.amostra_inicios));
      copyFileSync(inicios, C(`${item.id}.inicios.maquina.txt`));
    }
    log(`${item.id}: ${palavras.length} palavras em ${segundos} s (${item.segundos} s de áudio; o detector tirou ${fora_da_voz})`);
  }
  registro.segundos_de_audio = Math.round(total * 10) / 10;
  writeFileSync(C('conjunto.json'), `${JSON.stringify(registro, null, 2)}\n`);
  log(`pronto: ${Object.keys(registro.itens).length} itens, ${(total / 60).toFixed(1)} min de áudio, em ${conf}`);
  process.exit(0);
}

// ---------- medir ----------

const limpa = (w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}º°%]+$/gu, '');
// [?] (o trecho que não deu para entender) sai da conta: a máquina não erra nem acerta ali
const fichas = (texto) => texto.split(/\s+/).filter((w) => w !== '[?]').map(limpa).filter(Boolean);
/** Alinha as palavras (sem acento, caixa e pontuação) e devolve a distância e os pares (iguais ou trocados). */
const alinhar = (ref, hip, chave = norm) => {
  const a = ref.map(chave);
  const b = hip.map(chave);
  const d = Array.from({length: a.length + 1}, (_, i) => Array.from({length: b.length + 1}, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  const par = new Map();
  for (let i = a.length, j = b.length; i > 0 && j > 0;) {
    if (d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { par.set(i - 1, j - 1); i--; j--; }
    else if (d[i][j] === d[i - 1][j] + 1) i--;
    else j--;
  }
  return {erros: d[a.length][b.length], par};
};
const comAcento = (w) => limpa(w).toLowerCase();
/** O dicionário da casa como a legenda o aplica: a sigla escrita em minúsculas volta à caixa alta. */
const comDicionario = (ws) => ws.map((w) => DICIONARIO_CASA.find((e) => e.de.toLowerCase() === w.toLowerCase())?.para ?? w);
/** Ocorrências dos termos do glossário no texto conferido e quantas a máquina escreveu igual (na caixa, se o termo pede). */
const glossario = (ref, hip, par) => {
  const r = {ocorrencias: 0, certas: 0, erradas: []};
  for (const g of manifesto.glossario) {
    const t = fichas(g.termo);
    for (let i = 0; i + t.length <= ref.length; i++) {
      if (!t.every((x, k) => norm(ref[i + k]) === norm(x))) continue;
      r.ocorrencias++;
      const igual = (x, y) => (g.caixa ? x === y : x.toLowerCase() === y.toLowerCase());
      const escrito = t.map((_, k) => (par.has(i + k) ? hip[par.get(i + k)] : '∅'));
      if (t.every((x, k) => igual(escrito[k], x))) r.certas++;
      else r.erradas.push(`${g.termo} → ${escrito.join(' ')}`);
    }
  }
  return r;
};
const lerRotulos = (arq) => readFileSync(arq, 'utf-8').split(/\r?\n/).map((l) => l.split('\t')).filter((c) => c.length >= 3 && c[2].trim())
  .map(([s, , txt]) => ({s: Math.round(Number(s.replace(',', '.')) * 1000), w: txt.trim().replace(/^\d+\s+/, '')}));

const linhas = [];
const soma = {ref: 0, erros: 0, erros_acento: 0, gl_oc: 0, gl_certas: 0, gl_dic: 0, inicios: []};
const faltam = [];
for (const item of manifesto.itens) {
  const arqTexto = C(`${item.id}.texto.txt`);
  if (!existsSync(arqTexto)) { faltam.push(`${item.id}: sem texto (rode preparar)`); continue; }
  const bruto = readFileSync(arqTexto, 'utf-8');
  if (!/^#\s*conferido:\s*sim\b/im.test(bruto)) { faltam.push(`${item.id}: texto ainda não conferido`); continue; }
  const ref = fichas(bruto.split(/\r?\n/).filter((l) => !l.startsWith('#')).join(' '));
  const palavras = argv.includes('--refazer') ? (await transcrever(item)).palavras : JSON.parse(readFileSync(C(`${item.id}.maquina.json`), 'utf-8'));
  const hip = fichas(palavras.map((p) => p.w).join(' '));
  const {erros, par} = alinhar(ref, hip);
  const acento = alinhar(ref, hip, comAcento).erros;
  const gl = glossario(ref, hip, par);
  const glDic = glossario(ref, comDicionario(hip), par);
  // os começos conferidos: cada rótulo movido no Audacity contra a palavra igual mais perto na transcrição
  let inicios = null;
  const arqRot = C(`${item.id}.inicios.txt`);
  const orig = C(`${item.id}.inicios.maquina.txt`);
  if (existsSync(arqRot) && (!existsSync(orig) || readFileSync(arqRot, 'utf-8') !== readFileSync(orig, 'utf-8'))) {
    inicios = lerRotulos(arqRot).map((r) => {
      const perto = palavras.filter((p) => norm(p.w) === norm(r.w) && Math.abs(p.s - r.s) <= 1000).sort((x, y) => Math.abs(x.s - r.s) - Math.abs(y.s - r.s))[0];
      return perto ? Math.abs(perto.s - r.s) : Infinity;
    });
    soma.inicios.push(...inicios);
  } else faltam.push(`${item.id}: começos ainda não conferidos`);
  soma.ref += ref.length; soma.erros += erros; soma.erros_acento += acento;
  soma.gl_oc += gl.ocorrencias; soma.gl_certas += gl.certas; soma.gl_dic += glDic.certas;
  linhas.push({item: item.id, tipo: item.tipo, palavras: ref.length, wer_pct: Math.round((erros / ref.length) * 1000) / 10, wer_com_acento_pct: Math.round((acento / ref.length) * 1000) / 10,
    glossario: `${gl.certas}/${gl.ocorrencias}`, glossario_com_dicionario: `${glDic.certas}/${glDic.ocorrencias}`, glossario_erradas: glDic.erradas,
    inicios_ate_100ms: inicios ? `${inicios.filter((x) => x <= 100).length}/${inicios.length}` : 'não conferido'});
}
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const ini = [...soma.inicios].sort((x, y) => x - y);
const total = {
  palavras: soma.ref, wer_pct: pct(soma.erros, soma.ref), wer_com_acento_pct: pct(soma.erros_acento, soma.ref),
  glossario_pct: pct(soma.gl_certas, soma.gl_oc), glossario_com_dicionario_pct: pct(soma.gl_dic, soma.gl_oc), glossario_ocorrencias: soma.gl_oc,
  inicios_conferidos: ini.length, inicios_ate_100ms_pct: pct(ini.filter((x) => x <= 100).length, ini.length),
  inicio_mediana_ms: ini.length ? ini[Math.floor(ini.length / 2)] : null, inicio_p90_ms: ini.length ? ini[Math.floor(ini.length * 0.9)] : null,
};
const regua = {
  'WER < 10%': total.wer_pct === null ? 'sem conferência' : total.wer_pct < 10 ? 'cumpre' : 'não cumpre',
  'glossário ≥ 95%': total.glossario_com_dicionario_pct === null ? 'sem ocorrência conferida' : total.glossario_com_dicionario_pct >= 95 ? 'cumpre' : 'não cumpre',
  'começo ≤ 100 ms em 90%': total.inicios_ate_100ms_pct === null ? 'sem conferência' : total.inicios_ate_100ms_pct >= 90 ? 'cumpre' : 'não cumpre',
};
const resultado = {medido_em: new Date().toISOString(), modelo: idModelo, vad: comVad, refeito: argv.includes('--refazer'), total, regua, itens: linhas, faltam};
writeFileSync(C('resultado.json'), `${JSON.stringify(resultado, null, 2)}\n`);
console.table(linhas.map(({glossario_erradas, tipo, ...l}) => l));
console.log(JSON.stringify({total, regua}, null, 2));
if (faltam.length) console.log(`falta:\n- ${faltam.join('\n- ')}`);
