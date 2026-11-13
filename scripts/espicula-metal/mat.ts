// Matemática transcendental própria (A3): sin, cos, exp, log, pow, atan e atan2 só com + - * / e comparações,
// mais Math.round/Math.floor/Math.abs/Math.sqrt (exatos pelo IEEE-754). O resultado é o mesmo em qualquer motor JS.
//
// Por que: medido na espícula, Math.cos, Math.sin, Math.exp, Math.atan2 e Math.tanh dão valores diferentes no último
// bit entre o V8 (node) e o JavaScriptCore (bun); só isso nas tabelas da FFT já muda o hash do PCM. Precisão destas:
// erro relativo de ~1e-16 a ~1e-15 (não são arredondadas corretamente, mas são deterministas), o bastante para
// coeficientes de filtro e tabelas.
//
// Constantes de redução de argumento e polinômios de núcleo do fdlibm (domínio público, Sun Microsystems).

const PIO2_1 = 1.5707963267341256e0; // 33 bits altos de pi/2
const PIO2_2 = 6.077100506303966e-11;
const PIO2_3 = 2.0222662487111665e-21;
const LN2_HI = 6.93147180369123816490e-1;
const LN2_LO = 1.90821492927058770002e-10;

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

const senoNucleo = (r: number) => {
  const z = r * r;
  return r + r * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
};
const cossenoNucleo = (r: number) => {
  const z = r * r;
  return 1 - 0.5 * z + z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
};

/** Reduz x a r em [-pi/4, pi/4] e o quadrante k (x = k pi/2 + r). Bom para |x| < 2^20. */
const reduzir = (x: number): [number, number] => {
  const k = Math.round(x * 0.6366197723675814);
  const r = x - k * PIO2_1 - k * PIO2_2 - k * PIO2_3;
  return [r, ((k % 4) + 4) % 4];
};

export const sin = (x: number) => {
  const [r, q] = reduzir(x);
  if (q === 0) return senoNucleo(r);
  if (q === 1) return cossenoNucleo(r);
  if (q === 2) return -senoNucleo(r);
  return -cossenoNucleo(r);
};

export const cos = (x: number) => {
  const [r, q] = reduzir(x);
  if (q === 0) return cossenoNucleo(r);
  if (q === 1) return -senoNucleo(r);
  if (q === 2) return -cossenoNucleo(r);
  return senoNucleo(r);
};

/** 2^k exato para k inteiro na faixa normal. */
const pot2 = (k: number) => {
  let b = k < 0 ? 0.5 : 2;
  let e = Math.abs(k);
  let r = 1;
  while (e > 0) {
    if (e & 1) r *= b;
    b *= b;
    e >>>= 1;
  }
  return r;
};

export const exp = (x: number) => {
  if (x > 709) return Infinity;
  if (x < -745) return 0;
  const k = Math.round(x * 1.4426950408889634);
  const r = x - k * LN2_HI - k * LN2_LO; // |r| <= ~0,347
  // Taylor até r^14 (resto < 1e-17)
  let s = 1;
  let t = 1;
  for (let i = 1; i <= 14; i++) {
    t = (t * r) / i;
    s += t;
  }
  // em dois passos para não estourar em 2^k perto dos extremos
  const k1 = k >> 1;
  return s * pot2(k1) * pot2(k - k1);
};

const vista = new DataView(new ArrayBuffer(8));

export const log = (x: number) => {
  if (!(x > 0)) return x === 0 ? -Infinity : NaN;
  if (x === Infinity) return Infinity;
  // x = m * 2^e com m em [1, 2) pelos bits (exato; subnormais escalados antes)
  let e = 0;
  if (x < 2.2250738585072014e-308) {
    x *= 18014398509481984; // 2^54
    e -= 54;
  }
  vista.setFloat64(0, x);
  const alto = vista.getUint32(0);
  e += ((alto >>> 20) & 0x7ff) - 1023;
  vista.setUint32(0, (alto & 0x800fffff) | (1023 << 20));
  let m = vista.getFloat64(0);
  if (m > 1.4142135623730951) {
    m *= 0.5;
    e += 1;
  }
  // log(m) = 2 atanh(s), s = (m-1)/(m+1), |s| <= 0,1716
  const s = (m - 1) / (m + 1);
  const z = s * s;
  let soma = 0;
  for (let i = 21; i >= 3; i -= 2) soma = soma * z + 1 / i;
  const lm = 2 * s + 2 * s * z * soma;
  return e * LN2_HI + (e * LN2_LO + lm);
};

export const pow = (a: number, b: number) => {
  if (b === 0) return 1;
  if (a === 0) return b > 0 ? 0 : Infinity;
  if (a < 0) {
    if (!Number.isInteger(b)) return NaN;
    const v = exp(b * log(-a));
    return b % 2 === 0 ? v : -v;
  }
  return exp(b * log(a));
};

const TAN_PI_12 = 0.2679491924311227;
const RAIZ3 = 1.7320508075688772;

/** atan em |x| <= tan(pi/12) por série (resto < 1e-17). */
const atanNucleo = (x: number) => {
  const z = x * x;
  let soma = 0;
  for (let i = 29; i >= 3; i -= 2) soma = soma * -z + 1 / i;
  // x - x^3/3 + x^5/5 - ... ; o laço montou 1/3 - z/5 + z^2/7 ... com sinais alternados
  return x - x * z * soma;
};

export const atan = (x: number): number => {
  if (x < 0) return -atan(-x);
  if (x > 1) return Math.PI / 2 - atan(1 / x);
  if (x > TAN_PI_12) return Math.PI / 6 + atanNucleo((x * RAIZ3 - 1) / (x + RAIZ3));
  return atanNucleo(x);
};

export const atan2 = (y: number, x: number) => {
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + Math.PI : atan(y / x) - Math.PI;
  if (y > 0) return Math.PI / 2;
  if (y < 0) return -Math.PI / 2;
  return 0;
};
