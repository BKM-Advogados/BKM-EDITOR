import {readFileSync} from 'node:fs';
import {medirAmostras} from '../src/nucleo/loudness';
const b = readFileSync('testes/saida/projetos/Musica Teste/saidas/Batida.wav');
const bits = b.readUInt16LE(34), ch = b.readUInt16LE(22);
const bpa = bits/8, n = Math.floor((b.length - 44) / (ch*bpa));
const canais = Array.from({length: ch}, () => new Float32Array(n));
let off = 44;
for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
  canais[c][i] = b.readIntLE(off, 3) / 8388607; off += 3;
}
const m = medirAmostras(canais, 48000, {pico: true});
console.log('app medirAmostras: lufs', m.integrado_lufs, 'pico_dbtp', m.pico_dbtp);
