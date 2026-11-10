// Decodificador de PNG em TypeScript puro (sem dependências externas) usando node:zlib
import {inflateSync} from "node:zlib";
import type {DadosImagem} from "./animacao-pixel";

const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const paethPredictor = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
};

/** Decodifica um buffer PNG de 8 bits por canal (RGBA, RGB, Grayscale ou com paleta) para DadosImagem */
export const decodificarPng = (buf: Buffer): DadosImagem => {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(ASSINATURA_PNG)) {
    throw new Error("arquivo não é um PNG válido");
  }

  let offset = 8;
  let largura = 0;
  let altura = 0;
  let bitDepth = 8;
  let colorType = 6;
  const idats: Buffer[] = [];
  let paletaBuf: Buffer | null = null;
  let trnsBuf: Buffer | null = null;

  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const chunkData = buf.subarray(offset + 8, offset + 8 + len);
    offset += 12 + len;

    if (type === "IHDR") {
      largura = chunkData.readUInt32BE(0);
      altura = chunkData.readUInt32BE(4);
      bitDepth = chunkData[8];
      colorType = chunkData[9];
    } else if (type === "PLTE") {
      paletaBuf = chunkData;
    } else if (type === "tRNS") {
      trnsBuf = chunkData;
    } else if (type === "IDAT") {
      idats.push(chunkData);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8) {
    throw new Error(`bit depth ${bitDepth} não suportado; use 8 bits por canal`);
  }

  const comprimido = Buffer.concat(idats);
  const descomprimido = inflateSync(comprimido);

  let bpp = 4; // bytes por pixel
  if (colorType === 0) bpp = 1; // grayscale
  else if (colorType === 2) bpp = 3; // RGB
  else if (colorType === 3) bpp = 1; // paleta
  else if (colorType === 4) bpp = 2; // grayscale + alpha
  else if (colorType === 6) bpp = 4; // RGBA
  else throw new Error(`tipo de cor PNG ${colorType} não suportado`);

  const bytesPorLinha = largura * bpp;
  const out = new Uint8ClampedArray(largura * altura * 4);
  const linhaBuffer = Buffer.alloc(bytesPorLinha);
  const linhaAnterior = Buffer.alloc(bytesPorLinha);

  let srcOffset = 0;
  let dstOffset = 0;

  for (let y = 0; y < altura; y++) {
    const filter = descomprimido[srcOffset++];
    for (let x = 0; x < bytesPorLinha; x++) {
      const raw = descomprimido[srcOffset++];
      const a = x >= bpp ? linhaBuffer[x - bpp] : 0;
      const b = linhaAnterior[x];
      const c = x >= bpp ? linhaAnterior[x - bpp] : 0;

      let val = raw;
      if (filter === 1) val = (raw + a) & 0xff;
      else if (filter === 2) val = (raw + b) & 0xff;
      else if (filter === 3) val = (raw + Math.floor((a + b) / 2)) & 0xff;
      else if (filter === 4) val = (raw + paethPredictor(a, b, c)) & 0xff;

      linhaBuffer[x] = val;
    }

    linhaBuffer.copy(linhaAnterior);

    // Converte a linha filtrada para RGBA
    for (let x = 0; x < largura; x++) {
      if (colorType === 6) {
        // RGBA
        const p = x * 4;
        out[dstOffset++] = linhaBuffer[p];
        out[dstOffset++] = linhaBuffer[p + 1];
        out[dstOffset++] = linhaBuffer[p + 2];
        out[dstOffset++] = linhaBuffer[p + 3];
      } else if (colorType === 2) {
        // RGB
        const p = x * 3;
        out[dstOffset++] = linhaBuffer[p];
        out[dstOffset++] = linhaBuffer[p + 1];
        out[dstOffset++] = linhaBuffer[p + 2];
        out[dstOffset++] = 255;
      } else if (colorType === 3 && paletaBuf) {
        // Paleta
        const idx = linhaBuffer[x];
        out[dstOffset++] = paletaBuf[idx * 3] ?? 0;
        out[dstOffset++] = paletaBuf[idx * 3 + 1] ?? 0;
        out[dstOffset++] = paletaBuf[idx * 3 + 2] ?? 0;
        out[dstOffset++] = trnsBuf && trnsBuf[idx] !== undefined ? trnsBuf[idx] : 255;
      } else if (colorType === 0) {
        // Grayscale
        const g = linhaBuffer[x];
        out[dstOffset++] = g;
        out[dstOffset++] = g;
        out[dstOffset++] = g;
        out[dstOffset++] = 255;
      } else if (colorType === 4) {
        // Grayscale + Alpha
        const p = x * 2;
        const g = linhaBuffer[p];
        out[dstOffset++] = g;
        out[dstOffset++] = g;
        out[dstOffset++] = g;
        out[dstOffset++] = linhaBuffer[p + 1];
      }
    }
  }

  return {largura, altura, dados: out};
};
