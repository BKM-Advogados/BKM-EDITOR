// O riff de 30 s: 16 compassos de 4/4 a 128 BPM, em semicolcheias.
//
// Cada compasso é uma linha de 16 passos:
//   c  chug em palm mute (B5 solto: cordas 0 e 1 na casa 0)
//   0-9, a-c  power chord aberto na casa indicada (cordas 0, 1 e 2, a mesma casa no drop B), deixado soar
//   =  segura o que está soando
//   .  abafa tudo (pausa)
// Palhetada alternada: passos pares descem (grave para agudo), ímpares sobem (agudo para grave, um pouco mais fracos).
// A dobra L/R toca a mesma partitura com micro-variações de tempo, força e afinação tiradas da semente.

import {Rng} from './comum';
import type {Evento} from './guitarra';

export const BPM = 128;
export const DURACAO = 30; // 16 compassos * 4 tempos * 60 / 128 = 30 s

const A = 'c.cc.cc.1===c.c.';
const B = 'c.cc.cc.3===5=3=';
const C = 'c.ccc.ccc.ccc.cc';
const D = '6=======5===3===';
const S = 'c..c..c.c..c..c.'; // 3+3+2 sincopado
const E = '3===1===0=======';

export const PARTITURA: string[] = [
  A, B, A, D, //
  A, B, C, '1===============',
  S, S, C, E,
  '0=======c.cc.cc.', '5=======3=======', '6=======8===6===', '0===============',
];

const casaDe = (ch: string) => parseInt(ch, 16);

/** Converte a partitura em eventos de corda para uma tomada. `semente` muda só as micro-variações. */
export const eventosDoRiff = (semente: number, opcoes: {humano?: number} = {}): Evento[] => {
  const rng = new Rng(semente);
  const humano = opcoes.humano ?? 1;
  const passo = 60 / BPM / 4;
  const ev: Evento[] = [];
  // Atraso médio da tomada (uma dobra real nunca cai junto) e deriva lenta.
  const atrasoTomada = 0.004 * rng.b() * humano;
  let deriva = 0;
  let soando: number[] = [];
  PARTITURA.forEach((linha, compasso) => {
    if (linha.length !== 16) throw new Error(`compasso ${compasso + 1} não tem 16 passos`);
    for (let i = 0; i < 16; i++) {
      const ch = linha[i];
      deriva = 0.9 * deriva + 0.0015 * rng.g() * humano;
      const t0 = (compasso * 16 + i) * passo + atrasoTomada + deriva + 0.0025 * rng.g() * humano;
      const desce = i % 2 === 0;
      if (ch === '=') continue;
      if (ch === '.') {
        for (const c of soando) ev.push({t: Math.max(0, t0), tipo: 'abafar', corda: c});
        soando = [];
        continue;
      }
      const pm = ch === 'c';
      const cordas = pm ? [0, 1] : [0, 1, 2];
      const casa = pm ? 0 : casaDe(ch);
      // Palhetada: acento no tempo forte, subida mais fraca.
      const forte = i % 4 === 0;
      const vel = Math.min(1, Math.max(0.3, (pm ? 0.78 : 0.95) + (forte ? 0.08 : 0) - (desce ? 0 : 0.1) + 0.05 * rng.g()));
      // Strum: ~3 ms entre cordas, na direção da palhetada.
      const ordem = desce ? cordas : [...cordas].reverse();
      const espaco = (pm ? 0.0022 : 0.0045) * (1 + 0.25 * rng.b() * humano);
      // Cordas que soavam e não são tocadas agora são abafadas pela mão.
      for (const c of soando) if (!cordas.includes(c)) ev.push({t: Math.max(0, t0), tipo: 'abafar', corda: c});
      ordem.forEach((corda, k) => {
        ev.push({t: Math.max(0, t0 + k * espaco), tipo: 'tocar', corda, casa, art: pm ? 'pm' : 'aberto', vel: vel - 0.04 * k});
      });
      soando = cordas;
      // O chug é curto: a mão já abafa antes do próximo passo, se o próximo for pausa.
    }
  });
  return ev;
};
