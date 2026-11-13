// Espícula de som da M0 (portão da A3): guitarra KS + amp high-gain 8x + IR 4x12 sintetizado + gate.
//
//   npx tsx scripts/espicula-metal/espicula.ts            riff de 30 s, WAV, métricas e análise
//   npx tsx scripts/espicula-metal/espicula.ts --portao   cenário do portão: 4 guitarras x 5 min (só tempo)
//
// Saída em scripts/espicula-metal/saida/ (fora do git).

import {createHash} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {aliasingDb, bandas, centroide, correlacao, espectroMedio, espectrogramaPng, f0Autocorr, rmsPico} from './analise';
import {wav24} from './arquivos';
import {latenciaTotal, montarFaixa, OpcoesFaixa, renderFaixa, Tempos} from './cadeia';
import {BLOCO, db, TAXA} from './comum';
import {OpcoesAmp, PowerAmp, PreAmp, PreEQ, ToneStack} from './amp';
import {AFINACOES, Evento, hzDeMidi, OpcoesGuitarra} from './guitarra';
import {BPM, DURACAO, eventosDoRiff, PARTITURA} from './riff';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SAIDA = join(AQUI, 'saida');

const AMP: OpcoesAmp = {sobreamostragem: 8, ganho: 0.8, graves: 1, medios: -4, agudos: 1, presence: 2, depth: 4, master: 0.6};

const guitarraLado = (lado: 'L' | 'R'): OpcoesGuitarra => ({
  afinacao: AFINACOES.dropB,
  semente: lado === 'L' ? 1101 : 2203,
  cents: lado === 'L' ? -2 : 2.5,
  posPalheta: lado === 'L' ? 0.13 : 0.16,
  posCaptador: 0.07,
});

const faixaLado = (lado: 'L' | 'R', extra: Partial<OpcoesFaixa> = {}, eventos?: Evento[]): OpcoesFaixa => ({
  eventos: eventos ?? eventosDoRiff(lado === 'L' ? 11 : 23),
  guitarra: guitarraLado(lado),
  amp: AMP,
  sementeIR: lado === 'L' ? 401 : 809,
  ...extra,
});

/** Renderiza uma faixa compensando a latência (a saída fica alinhada à grade). */
const faixa = (o: OpcoesFaixa, segundos: number, tempos: Tempos) => {
  const est = montarFaixa(o);
  const lat = latenciaTotal(est);
  const n = Math.round(segundos * TAXA);
  const bruto = renderFaixa(est, n + lat, tempos);
  return {sinal: bruto.slice(lat, lat + n), latencia: lat, estagios: est.map((e) => e.nome)};
};

const sha = (x: Float32Array) => createHash('sha256').update(Buffer.from(x.buffer, x.byteOffset, x.byteLength)).digest('hex');
const fmt = (v: number, c = 3) => v.toFixed(c);
const somaMapa = (t: Tempos) => [...t.values()].reduce((a, b) => a + b, 0);

const renderRiff = (extraL: Partial<OpcoesFaixa> = {}, extraR: Partial<OpcoesFaixa> = {}) => {
  const tempos: Tempos = new Map();
  const t0 = performance.now();
  const L = faixa(faixaLado('L', extraL), DURACAO, tempos);
  const R = faixa(faixaLado('R', extraR), DURACAO, tempos);
  const parede = performance.now() - t0;
  return {L: L.sinal, R: R.sinal, tempos, parede, latencia: L.latencia};
};

const tabelaRtf = (tempos: Tempos, duracaoAudio: number, guitarras: number) =>
  [...tempos.entries()].map(([nome, ms]) => ({
    estagio: nome,
    ms: Math.round(ms),
    rtf: ms / 1000 / duracaoAudio,
    rtfPorGuitarra: ms / 1000 / duracaoAudio / guitarras,
  }));

const portao = () => {
  // A3: 5 min, 4 guitarras, amp 8x, IR de 200 ms.
  const segundos = 300;
  const reps = Math.ceil(segundos / DURACAO);
  const tempos: Tempos = new Map();
  const t0 = performance.now();
  for (let g = 0; g < 4; g++) {
    const ev: Evento[] = [];
    for (let r = 0; r < reps; r++) {
      for (const e of eventosDoRiff(100 * g + r + 1)) ev.push({...e, t: e.t + r * DURACAO});
    }
    const lado = g % 2 === 0 ? 'L' : 'R';
    const o = faixaLado(lado, {}, ev);
    o.guitarra = {...o.guitarra, semente: o.guitarra.semente + g};
    faixa(o, segundos, tempos);
    process.stdout.write(`  guitarra ${g + 1}/4 pronta (${fmt((performance.now() - t0) / 1000, 1)} s)\n`);
  }
  const parede = performance.now() - t0;
  const rel = {
    cenario: '4 guitarras x 300 s, amp 8x, IR 200 ms, partição 128',
    paredeS: parede / 1000,
    rtfTotal: parede / 1000 / segundos,
    rtfPorGuitarra: parede / 1000 / segundos / 4,
    estagios: tabelaRtf(tempos, segundos, 4),
  };
  console.log(JSON.stringify(rel, null, 2));
  mkdirSync(SAIDA, {recursive: true});
  writeFileSync(join(SAIDA, 'portao.json'), JSON.stringify(rel, null, 2));
};

/** Seno de f0 só pelo amp (sem gabinete), com e sem sobreamostragem: mede o aliasing. */
const testeAliasing = (f0: number, sobre: number) => {
  const n = TAXA * 2;
  const x = new Float32Array(n);
  // seno por rotação (como no app), amplitude de DI forte
  const c = Math.cos((2 * Math.PI * f0) / TAXA);
  const s = Math.sin((2 * Math.PI * f0) / TAXA);
  let a = 0.3;
  let b = 0;
  for (let i = 0; i < n; i++) {
    x[i] = b;
    const na = a * c - b * s;
    b = a * s + b * c;
    a = na;
  }
  const amp = {...AMP, sobreamostragem: sobre};
  const pre = new PreEQ();
  const pa = new PreAmp(amp, BLOCO);
  const ts = new ToneStack(amp);
  const pw = new PowerAmp(amp, BLOCO);
  for (let o = 0; o < n; o += BLOCO) {
    const blk = x.subarray(o, o + BLOCO);
    pre.processar(blk, BLOCO);
    pa.processar(blk, BLOCO);
    ts.processar(blk, BLOCO);
    pw.processar(blk, BLOCO);
  }
  return aliasingDb(x, f0, TAXA);
};

/** Espectro somado de janelas que começam em passos de um tipo. */
const espectroDePassos = (x: Float32Array, filtro: (ch: string) => boolean) => {
  const passo = 60 / BPM / 4;
  const nfft = 4096;
  let soma: Float64Array | null = null;
  let quedas: number[] = [];
  PARTITURA.forEach((linha, c) => {
    for (let i = 0; i < 16; i++) {
      if (!filtro(linha[i])) continue;
      const ini = Math.round((c * 16 + i) * passo * TAXA);
      if (ini + nfft > x.length) continue;
      const p = espectroMedio(x, ini, ini + nfft, nfft);
      if (!soma) soma = new Float64Array(p.length);
      for (let k = 0; k < p.length; k++) soma[k] += p[k];
      const meio = Math.round(passo * TAXA * 0.5);
      const a = rmsPico(x, ini, ini + meio).rms;
      const b = rmsPico(x, ini + meio, ini + 2 * meio).rms;
      quedas.push(db(b / a));
    }
  });
  quedas = quedas.sort((p, q) => p - q);
  return {espectro: soma as Float64Array | null, quedaMedianaDb: quedas[Math.floor(quedas.length / 2)] ?? 0, n: quedas.length};
};

const principal = () => {
  mkdirSync(SAIDA, {recursive: true});
  console.log('Render 1 (frio, inclui JIT)...');
  const r1 = renderRiff();
  console.log(`  ${fmt(r1.parede / 1000, 2)} s de parede para ${DURACAO} s de áudio x 2 guitarras`);
  console.log('Render 2 (quente) e conferência de determinismo...');
  const r2 = renderRiff();
  const hashL1 = sha(r1.L);
  const hashL2 = sha(r2.L);
  const hashR1 = sha(r1.R);
  const deterministico = hashL1 === hashL2 && hashR1 === sha(r2.R);

  // Mix: dobra aberta L/R, normalizada a -1 dBFS de pico.
  let pico = 0;
  for (let i = 0; i < r1.L.length; i++) pico = Math.max(pico, Math.abs(r1.L[i]), Math.abs(r1.R[i]));
  const ganho = 0.891 / pico;
  const L = new Float32Array(r1.L.length);
  const R = new Float32Array(r1.R.length);
  // fade de 0,4 s no fim (o último acorde é cortado em 30 s)
  const fade = Math.round(0.4 * TAXA);
  for (let i = 0; i < L.length; i++) {
    const f = i > L.length - fade ? (L.length - i) / fade : 1;
    L[i] = r1.L[i] * ganho * f;
    R[i] = r1.R[i] * ganho * f;
  }
  const wav = wav24(L, R, TAXA);
  writeFileSync(join(SAIDA, 'riff.wav'), wav);
  const mono = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) mono[i] = 0.5 * (L[i] + R[i]);
  writeFileSync(join(SAIDA, 'espectrograma.png'), espectrogramaPng(mono, TAXA));

  console.log('Análise...');
  const p = espectroMedio(mono);
  const resultado: Record<string, unknown> = {};
  resultado.render = {
    duracaoS: DURACAO,
    guitarras: 2,
    taxa: TAXA,
    bloco: BLOCO,
    latenciaAmostras: r1.latencia,
    frio: {paredeS: r1.parede / 1000, rtfTotal: r1.parede / 1000 / DURACAO, estagios: tabelaRtf(r1.tempos, DURACAO, 2)},
    quente: {
      paredeS: r2.parede / 1000,
      rtfTotal: r2.parede / 1000 / DURACAO,
      rtfPorGuitarra: r2.parede / 1000 / DURACAO / 2,
      somaEstagiosS: somaMapa(r2.tempos) / 1000,
      estagios: tabelaRtf(r2.tempos, DURACAO, 2),
    },
    deterministico,
    sha256: {L: hashL1, R: hashR1, wav: createHash('sha256').update(wav).digest('hex')},
  };
  const rp = rmsPico(mono);
  resultado.nivel = {
    picoDbfs: db(rmsPico(L).pico > rmsPico(R).pico ? rmsPico(L).pico : rmsPico(R).pico),
    rmsDbfs: db(rp.rms),
    crestDb: db(rp.pico / rp.rms),
    correlacaoLR: correlacao(L, R),
  };
  resultado.espectro = {bandasDbRelativo: bandas(p, TAXA), centroideHz: centroide(p, TAXA)};
  const pm = espectroDePassos(mono, (ch) => ch === 'c');
  const ab = espectroDePassos(mono, (ch) => /[0-9a-c]/.test(ch));
  resultado.articulacao = {
    palmMute: {passos: pm.n, centroideHz: pm.espectro ? centroide(pm.espectro, TAXA) : 0, quedaMeioPassoDb: pm.quedaMedianaDb, bandas: pm.espectro ? bandas(pm.espectro, TAXA) : []},
    aberto: {passos: ab.n, centroideHz: ab.espectro ? centroide(ab.espectro, TAXA) : 0, quedaMeioPassoDb: ab.quedaMedianaDb, bandas: ab.espectro ? bandas(ab.espectro, TAXA) : []},
  };

  // Aliasing: seno de ~1, 2,5 e 4 kHz (1031 e não 1000: com 1000 Hz os harmônicos dobrados caem em cima de outros harmônicos) pelo amp a 1x e a 8x.
  resultado.aliasing = [1031, 2489, 3951].map((f) => ({f0: f, sem: testeAliasing(f, 1), com8x: testeAliasing(f, 8)}));

  // Piso de ruído: guitarra parada 3 s, com e sem gate (mesmo ganho de normalização do riff).
  const silencio = (gate: boolean) => {
    const t: Tempos = new Map();
    const s = faixa(faixaLado('L', {gate}, []), 3, t).sinal;
    return db(rmsPico(s, TAXA, 3 * TAXA).rms * ganho);
  };
  resultado.ruido = {semGateDbfs: silencio(false), comGateDbfs: silencio(true)};

  // Afinação: cada corda solta, só o DI, aberta e em palm mute.
  const afinacao = AFINACOES.dropB.map((midi, corda) => {
    const medir = (art: 'pm' | 'aberto') => {
      const ev: Evento[] = [{t: 0, tipo: 'tocar', corda, casa: 0, art, vel: 0.8}];
      const t: Tempos = new Map();
      const o = faixaLado('L', {soDI: true, ruido: false}, ev);
      o.guitarra = {...o.guitarra, cents: 0, variacaoCents: 0};
      const s = faixa(o, 0.5, t).sinal;
      const f = f0Autocorr(s, Math.round(0.03 * TAXA), Math.round(0.08 * TAXA), TAXA);
      return 1200 * Math.log2(f / hzDeMidi(midi));
    };
    return {corda, midi, hz: hzDeMidi(midi), centsAberto: medir('aberto'), centsPm: medir('pm')};
  });
  resultado.afinacao = {
    obs: 'cents medidos no DI (autocorrelação de 30 a 110 ms), sem a micro-variação por nota',
    cordas: afinacao,
  };

  // Custo: tanh nativo no pré-amp e convolução com partição de 1024 (offline).
  const variante = (nome: string, extra: Partial<OpcoesFaixa>) => {
    const t: Tempos = new Map();
    const t0 = performance.now();
    const s = faixa(faixaLado('L', extra), DURACAO, t).sinal;
    const parede = performance.now() - t0;
    let dif = 0;
    for (let i = 0; i < s.length; i++) dif = Math.max(dif, Math.abs(s[i] - r1.L[i]));
    return {variante: nome, rtfUmaGuitarra: parede / 1000 / DURACAO, estagios: tabelaRtf(t, DURACAO, 1), difMaxDb: db(dif / pico)};
  };
  const quenteL = tabelaRtf(r2.tempos, DURACAO, 2);
  resultado.variantes = [
    variante('tanh nativo no pré-amp', {amp: {...AMP, tanhNativo: true}}),
    variante('IR com partição 1024 (latência 1024)', {particaoIR: 1024}),
    variante('pré-amp sem sobreamostragem (1x)', {amp: {...AMP, sobreamostragem: 1}}),
    variante('pré-amp 4x', {amp: {...AMP, sobreamostragem: 4}}),
  ];
  resultado.referenciaQuente = quenteL;

  writeFileSync(join(SAIDA, 'metricas.json'), JSON.stringify(resultado, null, 2));
  console.log(JSON.stringify(resultado, null, 2));
  console.log(`\nWAV: ${join(SAIDA, 'riff.wav')}`);
};

/** Só o render do riff e os hashes do PCM (Float32) de cada lado: para comparar motores JS (node, bun/JSC). */
const soHash = () => {
  // --tanh-nativo: o mesmo render com Math.tanh no pré-amp, para ver o hash mudar entre motores
  const extra: Partial<OpcoesFaixa> = process.argv.includes('--tanh-nativo') ? {amp: {...AMP, tanhNativo: true}} : {};
  const r = renderRiff(extra, extra);
  const motor = typeof (globalThis as {Bun?: unknown}).Bun !== 'undefined' ? 'bun (JavaScriptCore)' : `node ${process.version} (V8 ${process.versions.v8})`;
  console.log(JSON.stringify({motor, L: sha(r.L), R: sha(r.R), rtfTotal: r.parede / 1000 / DURACAO}));
};

if (process.argv.includes('--portao')) portao();
else if (process.argv.includes('--hash')) soHash();
else principal();
