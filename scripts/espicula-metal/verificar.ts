// Conferências das peças da espícula (rodar com npx tsx scripts/espicula-metal/verificar.ts):
// FFT real contra DFT direta, convolução particionada contra convolução direta (com e sem latência),
// resposta do sobreamostrador (banda passante e rejeição) e as duas tanh.

import {satRacional, Sobreamostrador} from './amp';
import {Rng, TAXA} from './comum';
import {FFTReal} from './fft';
import {ConvolucaoParticionada, sintetizarIR} from './gabinete';
import * as M from './mat';

let falhas = 0;
const conferir = (nome: string, ok: boolean, detalhe: string) => {
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${nome}: ${detalhe}`);
  if (!ok) falhas++;
};

// 1) FFT real
{
  const n = 64;
  const rng = new Rng(5);
  const x = new Float64Array(n).map(() => rng.b());
  const re = new Float64Array(n / 2 + 1);
  const im = new Float64Array(n / 2 + 1);
  const f = new FFTReal(n);
  f.direta(x, re, im);
  let erro = 0;
  for (let k = 0; k <= n / 2; k++) {
    let r = 0;
    let i = 0;
    for (let t = 0; t < n; t++) {
      r += x[t] * Math.cos((2 * Math.PI * k * t) / n);
      i -= x[t] * Math.sin((2 * Math.PI * k * t) / n);
    }
    erro = Math.max(erro, Math.abs(r - re[k]), Math.abs(i - im[k]));
  }
  const y = new Float64Array(n);
  f.inversa(re, im, y);
  let erroIda = 0;
  for (let t = 0; t < n; t++) erroIda = Math.max(erroIda, Math.abs(y[t] - x[t]));
  conferir('FFT real x DFT', erro < 1e-12, `erro ${erro.toExponential(2)}`);
  conferir('FFT ida e volta', erroIda < 1e-14, `erro ${erroIda.toExponential(2)}`);
}

// 2) Convolução particionada
for (const particao of [128, 512]) {
  const ir = sintetizarIR(3, 0.05);
  const rng = new Rng(9);
  const n = 128 * 40;
  const x = new Float32Array(n).map(() => rng.b());
  const direta = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < ir.length && k <= i; k++) s += ir[k] * x[i - k];
    direta[i] = s;
  }
  const cv = new ConvolucaoParticionada(ir, particao, 128);
  const y = new Float32Array(x);
  for (let o = 0; o < n; o += 128) cv.processar(y.subarray(o, o + 128), 128);
  let erro = 0;
  for (let i = 0; i + cv.latencia < n; i++) erro = Math.max(erro, Math.abs(y[i + cv.latencia] - direta[i]));
  conferir(`convolução P=${particao} (latência ${cv.latencia})`, erro < 1e-5, `erro ${erro.toExponential(2)}, ${cv.particoes} partições`);
}

// 3) Sobreamostrador 8x: ganho em 1 kHz e 16 kHz (passa), rejeição de 30 kHz gerado a 8x (não pode dobrar)
{
  const medir = (f: number) => {
    const s = new Sobreamostrador(8);
    const n = 4800;
    const x = new Float32Array(n).map((_, i) => Math.sin((2 * Math.PI * f * i) / TAXA));
    const u = new Float64Array(n * 8);
    const y = new Float32Array(n);
    s.subir(x, n, u);
    s.descer(u, n, y);
    // RMS * raiz de 2 (o pico amostrado de 16 kHz a 48 kHz cai em 3 pontos por período e engana)
    let e = 0;
    for (let i = n / 2; i < n; i++) e += y[i] * y[i];
    return 20 * Math.log10(Math.sqrt((2 * e) / (n / 2)));
  };
  const g1 = medir(1000);
  const g16 = medir(16000);
  conferir('sobreamostrador 8x, 1 kHz', Math.abs(g1) < 0.05, `${g1.toFixed(3)} dB`);
  conferir('sobreamostrador 8x, 16 kHz (ida e volta)', Math.abs(g16) < 0.5, `${g16.toFixed(3)} dB`);
  // senoide a 30 kHz criada direto na taxa alta: depois de descer, quanto sobra dobrado em 18 kHz
  const s = new Sobreamostrador(8);
  const n = 4800;
  const u = new Float64Array(n * 8).map((_, i) => Math.sin((2 * Math.PI * 30000 * i) / (TAXA * 8)));
  const y = new Float32Array(n);
  s.descer(u, n, y);
  let p = 0;
  for (let i = n / 2; i < n; i++) p = Math.max(p, Math.abs(y[i]));
  conferir('rejeição de 30 kHz na descida', 20 * Math.log10(p) < -70, `${(20 * Math.log10(p)).toFixed(1)} dB`);
}

// 4) tanh racional
{
  let erro = 0;
  for (let x = -5; x <= 5; x += 0.001) erro = Math.max(erro, Math.abs(satRacional(x) - Math.tanh(x)));
  conferir('tanh racional x Math.tanh', erro < 0.03, `erro máx ${erro.toFixed(4)}`);
}

// 5) matemática própria contra Math (precisão; o determinismo é conferido rodando o --hash em node e em bun)
{
  const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));
  let eSin = 0;
  let eCos = 0;
  for (let x = -20; x <= 20; x += 0.000731) {
    eSin = Math.max(eSin, Math.abs(M.sin(x) - Math.sin(x)));
    eCos = Math.max(eCos, Math.abs(M.cos(x) - Math.cos(x)));
  }
  let eExp = 0;
  for (let x = -700; x <= 700; x += 0.0137) eExp = Math.max(eExp, rel(M.exp(x), Math.exp(x)));
  let eLog = 0;
  for (let x = 1e-300; x < 1e300; x *= 1.0371) eLog = Math.max(eLog, Math.abs(M.log(x) - Math.log(x)) / Math.max(1, Math.abs(Math.log(x))));
  let ePow = 0;
  for (let a = 0.001; a < 100; a *= 1.13) for (let b = -10; b <= 10; b += 0.37) ePow = Math.max(ePow, rel(M.pow(a, b), Math.pow(a, b)));
  let eAtan = 0;
  for (let y = -3; y <= 3; y += 0.0173) for (let x = -3; x <= 3; x += 0.0191) eAtan = Math.max(eAtan, Math.abs(M.atan2(y, x) - Math.atan2(y, x)));
  conferir('mat.sin', eSin < 1e-15, `erro ${eSin.toExponential(2)}`);
  conferir('mat.cos', eCos < 1e-15, `erro ${eCos.toExponential(2)}`);
  conferir('mat.exp', eExp < 1e-14, `erro relativo ${eExp.toExponential(2)}`);
  conferir('mat.log', eLog < 1e-15, `erro ${eLog.toExponential(2)}`);
  conferir('mat.pow', ePow < 1e-13, `erro relativo ${ePow.toExponential(2)}`);
  conferir('mat.atan2', eAtan < 1e-15, `erro ${eAtan.toExponential(2)}`);
}

if (falhas) {
  console.error(`${falhas} falha(s)`);
  process.exit(1);
}
