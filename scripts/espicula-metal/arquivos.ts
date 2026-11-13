// WAV PCM 24 bits estéreo e PNG (espectrograma) sem dependências: só node:zlib para o deflate do PNG.

import {deflateSync} from 'node:zlib';

export const wav24 = (l: Float32Array, r: Float32Array, taxa: number): Buffer => {
  const n = l.length;
  const dados = n * 2 * 3;
  const b = Buffer.alloc(44 + dados);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + dados, 4);
  b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM inteiro
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(taxa, 24);
  b.writeUInt32LE(taxa * 6, 28);
  b.writeUInt16LE(6, 32);
  b.writeUInt16LE(24, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(dados, 40);
  let o = 44;
  const q = (v: number) => {
    const s = Math.max(-8388608, Math.min(8388607, Math.round(v * 8388607)));
    b.writeIntLE(s, o, 3);
    o += 3;
  };
  for (let i = 0; i < n; i++) {
    q(l[i]);
    q(r[i]);
  }
  return b;
};

const tabelaCrc = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = tabelaCrc[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pedaco = (tipo: string, dados: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dados.length);
  const td = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

/** PNG RGB 8 bits. `rgb` tem largura*altura*3 bytes, linha a linha de cima para baixo. */
export const png = (largura: number, altura: number, rgb: Uint8Array): Buffer => {
  const cru = Buffer.alloc((largura * 3 + 1) * altura);
  for (let y = 0; y < altura; y++) {
    cru[y * (largura * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * largura * 3, largura * 3).copy(cru, y * (largura * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco('IHDR', ihdr),
    pedaco('IDAT', deflateSync(cru)),
    pedaco('IEND', Buffer.alloc(0)),
  ]);
};
