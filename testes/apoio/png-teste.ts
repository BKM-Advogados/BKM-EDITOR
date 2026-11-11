// PNGs mínimos para os testes do decodificador e do pixelizar_imagem (RGB, RGBA, cinza, indexado de 1 a 8 bits, Adam7).
import {deflateSync} from 'node:zlib';

const TABELA_CRC = Array.from({length: 256}, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = TABELA_CRC[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

export const chunk = (tipo: string, dados: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dados.length);
  const td = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const ihdr = (w: number, h: number, bits: number, cor: number, entrelacado = 0) => {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(w, 0);
  b.writeUInt32BE(h, 4);
  b[8] = bits;
  b[9] = cor;
  b[12] = entrelacado;
  return chunk('IHDR', b);
};

const montar = (cabecalho: Buffer, extras: Buffer[], linhas: Buffer[]) =>
  Buffer.concat([SIG, cabecalho, ...extras, chunk('IDAT', deflateSync(Buffer.concat(linhas))), chunk('IEND', Buffer.alloc(0))]);

type Px = (x: number, y: number) => number[];

/** PNG de 8 bits por canal (tipo 0, 2, 4 ou 6), filtro 0 em todas as linhas. */
export const png8 = (w: number, h: number, tipo: 0 | 2 | 4 | 6, px: Px, extras: Buffer[] = []) => {
  const canais = {0: 1, 2: 3, 4: 2, 6: 4}[tipo];
  const linhas: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const l = Buffer.alloc(1 + w * canais);
    for (let x = 0; x < w; x++) l.set(px(x, y).slice(0, canais), 1 + x * canais);
    linhas.push(l);
  }
  return montar(ihdr(w, h, 8, tipo), extras, linhas);
};

/** PNG indexado (tipo 3) de 1, 2, 4 ou 8 bits; `paleta` em [r, g, b]; `alfas` vira o tRNS. */
export const pngIndexado = (w: number, h: number, bits: 1 | 2 | 4 | 8, paleta: number[][], indice: (x: number, y: number) => number, alfas?: number[]) => {
  const porByte = 8 / bits;
  const linhas: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const l = Buffer.alloc(1 + Math.ceil(w / porByte));
    for (let x = 0; x < w; x++) {
      const byte = 1 + Math.floor(x / porByte);
      const desloc = 8 - bits * ((x % porByte) + 1);
      l[byte] |= indice(x, y) << desloc;
    }
    linhas.push(l);
  }
  const extras = [chunk('PLTE', Buffer.from(paleta.flat())), ...(alfas ? [chunk('tRNS', Buffer.from(alfas))] : [])];
  return montar(ihdr(w, h, bits, 3), extras, linhas);
};

/** PNG RGB 8 bits entrelaçado (Adam7). */
export const pngEntrelacado = (w: number, h: number, px: Px) => {
  const passos = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
  const partes: Buffer[] = [];
  for (const [x0, y0, dx, dy] of passos) {
    for (let y = y0; y < h; y += dy) {
      const cols: number[] = [];
      for (let x = x0; x < w; x += dx) cols.push(...px(x, y).slice(0, 3));
      if (cols.length) partes.push(Buffer.from([0, ...cols]));
    }
  }
  return montar(ihdr(w, h, 8, 2, 1), [], partes);
};

/** Só o cabeçalho de uma imagem enorme, com um IDAT minúsculo: o decodificador tem de recusar antes de alocar. */
export const pngSoCabecalho = (w: number, h: number) => montar(ihdr(w, h, 8, 6), [], [Buffer.alloc(1)]);

export const tRNS16 = (...amostras: number[]) => {
  const b = Buffer.alloc(amostras.length * 2);
  amostras.forEach((v, i) => b.writeUInt16BE(v, i * 2));
  return chunk('tRNS', b);
};
