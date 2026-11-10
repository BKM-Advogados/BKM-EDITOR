// Teoria para a música, pura: notas por nome e número MIDI, escalas maior e menor, acordes por cifra ("Am7", "F/C") ou
// por grau no tom ("vi", "V7", "IV"), e o que se gera deles: a faixa de acordes, o baixo e o arpejo. Escrito aqui, sem
// biblioteca de terceiros. Ver docs/musica.md.

export const NOMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOMES_PT = ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'];
const BASE: Record<string, number> = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};

/** Classe de altura (0 = Dó) de um nome: "C", "F#", "Bb", "Eb"; null se não for nota. */
export const classeDe = (nome: string): number | null => {
  const m = /^([A-Ga-g])([#b♯♭]*)$/.exec(nome.trim());
  if (!m) return null;
  let pc = BASE[m[1].toUpperCase()];
  for (const a of m[2]) pc += a === '#' || a === '♯' ? 1 : -1;
  return ((pc % 12) + 12) % 12;
};

/** "C4" é 60 (o Dó central). */
export const nomeDaNota = (midi: number) => `${NOMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
export const nomeDaNotaPt = (midi: number) => `${NOMES_PT[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
export const frequencia = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export type Escala = 'maior' | 'menor';
const INTERVALOS: Record<Escala, number[]> = {maior: [0, 2, 4, 5, 7, 9, 11], menor: [0, 2, 3, 5, 7, 8, 10]};

/** As sete classes de altura da escala, a partir da tônica. */
export const escalaDe = (tom = 'C', escala: Escala = 'maior') => {
  const t = classeDe(tom) ?? 0;
  return INTERVALOS[escala === 'menor' ? 'menor' : 'maior'].map((i) => (t + i) % 12);
};
export const naEscala = (midi: number, tom?: string, escala?: Escala) => escalaDe(tom, escala).includes(((midi % 12) + 12) % 12);

/** A nota da escala mais perto (para cima no empate): "travar na escala". */
export const encaixarNaEscala = (midi: number, tom?: string, escala?: Escala) => {
  const pcs = escalaDe(tom, escala);
  for (let d = 0; d < 12; d++) {
    if (pcs.includes((((midi + d) % 12) + 12) % 12)) return midi + d;
    if (pcs.includes((((midi - d) % 12) + 12) % 12)) return midi - d;
  }
  return midi;
};

// ---------- acordes ----------
const QUALIDADES: [RegExp, number[], string][] = [
  [/^(maj7|M7|7M)$/, [0, 4, 7, 11], 'maj7'],
  [/^(m7b5|ø)$/, [0, 3, 6, 10], 'm7b5'],
  [/^(m7|min7|-7)$/, [0, 3, 7, 10], 'm7'],
  [/^(dim7|°7)$/, [0, 3, 6, 9], 'dim7'],
  [/^(dim|°|o)$/, [0, 3, 6], 'dim'],
  [/^(aug|\+)$/, [0, 4, 8], 'aug'],
  [/^(m6)$/, [0, 3, 7, 9], 'm6'],
  [/^(m|min|-)$/, [0, 3, 7], 'm'],
  [/^(sus4|sus)$/, [0, 5, 7], 'sus4'],
  [/^(sus2)$/, [0, 2, 7], 'sus2'],
  [/^(add9)$/, [0, 4, 7, 14], 'add9'],
  [/^(9)$/, [0, 4, 7, 10, 14], '9'],
  [/^(7)$/, [0, 4, 7, 10], '7'],
  [/^(6)$/, [0, 4, 7, 9], '6'],
  [/^$/, [0, 4, 7], ''],
];

export type Acorde = {simbolo: string; raiz: number; baixo: number; intervalos: number[]; nome: string};

const ROMANOS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** Acorde por cifra ("Am7", "F/C", "Bb") ou por grau no tom ("vi", "V7", "IV", "ii7", "bVII"); null se não entender. */
export const acordeDe = (simbolo: string, tom = 'C', escala: Escala = 'maior'): Acorde | null => {
  const s = simbolo.trim();
  const cifra = /^([A-G][#b♯♭]?)([^/]*)(?:\/([A-G][#b♯♭]?))?$/.exec(s);
  if (cifra) {
    const raiz = classeDe(cifra[1]);
    const q = QUALIDADES.find(([re]) => re.test(cifra[2]));
    if (raiz === null || !q) return null;
    const baixo = cifra[3] ? classeDe(cifra[3]) : raiz;
    return {simbolo: s, raiz, baixo: baixo ?? raiz, intervalos: q[1], nome: `${NOMES[raiz]}${q[2]}${cifra[3] ? `/${NOMES[baixo ?? raiz]}` : ''}`};
  }
  const grau = /^([b#♭♯]?)(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(°|ø|o|\+)?(maj7|7|9|6|sus4|sus2)?$/.exec(s);
  if (!grau) return null;
  const n = ROMANOS.indexOf(grau[2].toUpperCase());
  const pcs = escalaDe(tom, escala);
  const desvio = grau[1] === 'b' || grau[1] === '♭' ? -1 : grau[1] ? 1 : 0;
  const raiz = (pcs[n] + desvio + 12) % 12;
  const menor = grau[2] === grau[2].toLowerCase();
  let qual = grau[3] === '°' || grau[3] === 'o' ? 'dim' : grau[3] === 'ø' ? 'm7b5' : grau[3] === '+' ? 'aug' : menor ? 'm' : '';
  if (grau[4] === '7') qual = qual === 'm' ? 'm7' : qual === 'dim' ? 'dim7' : qual === '' ? '7' : qual;
  else if (grau[4]) qual = qual === 'm' && grau[4] === '6' ? 'm6' : `${qual === 'm' ? 'm' : ''}${grau[4]}`;
  const q = QUALIDADES.find(([, , nome]) => nome === qual) ?? QUALIDADES.find(([, , nome]) => nome === (menor ? 'm' : ''))!;
  return {simbolo: s, raiz, baixo: raiz, intervalos: q[1], nome: `${NOMES[raiz]}${q[2]}`};
};

/** As notas do acorde em MIDI, com a fundamental entre centro − 6 e centro + 5 (padrão: em volta do Dó central). */
export const vozesDoAcorde = (a: Acorde, centro = 60) => {
  const base = centro - 6 + ((((a.raiz - (centro - 6)) % 12) + 12) % 12);
  return a.intervalos.map((i) => base + i);
};

/** A fundamental (ou o baixo da cifra "/") na oitava grave que começa em `menor` (padrão: do Mi1, 28, ao Ré♯2, 39). */
export const baixoDoAcorde = (a: Acorde, menor = 28) => menor + ((a.baixo - (menor % 12) + 12) % 12);
