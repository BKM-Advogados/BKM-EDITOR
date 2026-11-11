// Decodificador de PNG em TypeScript puro (sem dependências externas) usando node:zlib. Lê o que o pixelizar_imagem
// precisa: 8 bits por canal (RGBA, RGB, cinza, cinza com alfa), indexado e cinza de 1, 2, 4 ou 8 bits, e o tRNS (a cor
// transparente) de todos eles. O que não lê (entrelaçado, 16 bits, imagem grande demais) dá erro claro, antes de alocar.
import {inflateSync} from "node:zlib";
import type {DadosImagem} from "./animacao-pixel";

const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Maior área lida (4096 × 4096): acima disso a conta é longa e síncrona, e o IHDR mentiroso alocaria gigabytes. */
export const MAX_PIXELS_PNG = 4096 * 4096;

/** Erro do decodificador. `convertivel`: o arquivo é uma imagem que o ffmpeg sabe converter para um PNG que lemos
 *  (outro formato, entrelaçado, 16 bits, grande demais). */
export class ErroPng extends Error {
  constructor(message: string, readonly convertivel = false) {
    super(message);
  }
}

export const ehPng = (buf: Buffer) => buf.length >= 8 && buf.subarray(0, 8).equals(ASSINATURA_PNG);

const paethPredictor = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
};

const CANAIS: Record<number, number> = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4};

/** Decodifica um buffer PNG para DadosImagem (RGBA de 8 bits). */
export const decodificarPng = (buf: Buffer): DadosImagem => {
  if (!ehPng(buf)) throw new ErroPng("arquivo não é um PNG", true);

  let offset = 8;
  let largura = 0;
  let altura = 0;
  let bitDepth = 0;
  let colorType = -1;
  let entrelacado = 0;
  const idats: Buffer[] = [];
  let paletaBuf: Buffer | null = null;
  let trnsBuf: Buffer | null = null;

  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    if (offset + 12 + len > buf.length) throw new ErroPng(`PNG cortado (o bloco ${type} passa do fim do arquivo)`);
    const chunkData = buf.subarray(offset + 8, offset + 8 + len);
    offset += 12 + len;

    if (type === "IHDR") {
      if (len < 13) throw new ErroPng("PNG com cabeçalho (IHDR) inválido");
      largura = chunkData.readUInt32BE(0);
      altura = chunkData.readUInt32BE(4);
      bitDepth = chunkData[8];
      colorType = chunkData[9];
      entrelacado = chunkData[12];
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

  if (!largura || !altura) throw new ErroPng("PNG sem cabeçalho (IHDR) ou com tamanho zero");
  if (largura * altura > MAX_PIXELS_PNG) {
    throw new ErroPng(`imagem de ${largura}x${altura} é grande demais: reduza para até 4096 px de lado`, true);
  }
  const canais = CANAIS[colorType];
  if (canais === undefined) throw new ErroPng(`tipo de cor PNG ${colorType} não suportado`);
  const bitsOk = colorType === 0 || colorType === 3 ? [1, 2, 4, 8].includes(bitDepth) : bitDepth === 8;
  if (!bitsOk) throw new ErroPng(`PNG de ${bitDepth} bits por canal não é lido: salve com 8 bits`, true);
  if (entrelacado) throw new ErroPng("PNG entrelaçado (Adam7) não é lido: salve sem entrelaçamento", true);
  if (colorType === 3 && !paletaBuf) throw new ErroPng("PNG indexado sem paleta (PLTE)");
  if (!idats.length) throw new ErroPng("PNG sem dados de imagem (IDAT)");

  const bitsPorPixel = canais * bitDepth;
  const bpp = Math.max(1, bitsPorPixel >> 3); // bytes por pixel, para os filtros
  const bytesPorLinha = Math.ceil((largura * bitsPorPixel) / 8);
  const esperado = altura * (1 + bytesPorLinha);

  let descomprimido: Buffer;
  try {
    descomprimido = inflateSync(Buffer.concat(idats), {maxOutputLength: esperado + 1024});
  } catch (e) {
    throw new ErroPng(`PNG com dados inválidos ou maiores do que o cabeçalho diz (${(e as Error).message})`);
  }
  if (descomprimido.length < esperado) throw new ErroPng("PNG cortado (faltam linhas da imagem)");

  // a cor transparente do tRNS (cinza e RGB): amostras de 16 bits, comparadas no valor da profundidade da imagem
  const cinzaTransp = colorType === 0 && trnsBuf && trnsBuf.length >= 2 ? trnsBuf.readUInt16BE(0) : -1;
  const rgbTransp = colorType === 2 && trnsBuf && trnsBuf.length >= 6
    ? [trnsBuf.readUInt16BE(0), trnsBuf.readUInt16BE(2), trnsBuf.readUInt16BE(4)] : null;
  const maxAmostra = (1 << bitDepth) - 1;
  const amostra = (linha: Buffer, x: number) => {
    if (bitDepth === 8) return linha[x];
    const bit = x * bitDepth;
    return (linha[bit >> 3] >> (8 - bitDepth - (bit & 7))) & maxAmostra;
  };

  const out = new Uint8ClampedArray(largura * altura * 4);
  const linhaBuffer = Buffer.alloc(bytesPorLinha);
  const linhaAnterior = Buffer.alloc(bytesPorLinha);

  let srcOffset = 0;
  let dstOffset = 0;

  for (let y = 0; y < altura; y++) {
    const filter = descomprimido[srcOffset++];
    if (filter > 4) throw new ErroPng(`PNG com filtro ${filter} inválido na linha ${y}`);
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
        const p = x * 4;
        out[dstOffset++] = linhaBuffer[p];
        out[dstOffset++] = linhaBuffer[p + 1];
        out[dstOffset++] = linhaBuffer[p + 2];
        out[dstOffset++] = linhaBuffer[p + 3];
      } else if (colorType === 2) {
        const p = x * 3;
        const r = linhaBuffer[p];
        const g = linhaBuffer[p + 1];
        const bl = linhaBuffer[p + 2];
        out[dstOffset++] = r;
        out[dstOffset++] = g;
        out[dstOffset++] = bl;
        out[dstOffset++] = rgbTransp && rgbTransp[0] === r && rgbTransp[1] === g && rgbTransp[2] === bl ? 0 : 255;
      } else if (colorType === 3) {
        const idx = amostra(linhaBuffer, x);
        out[dstOffset++] = paletaBuf![idx * 3] ?? 0;
        out[dstOffset++] = paletaBuf![idx * 3 + 1] ?? 0;
        out[dstOffset++] = paletaBuf![idx * 3 + 2] ?? 0;
        out[dstOffset++] = trnsBuf && trnsBuf[idx] !== undefined ? trnsBuf[idx] : 255;
      } else if (colorType === 0) {
        const v = amostra(linhaBuffer, x);
        const g = Math.round((v * 255) / maxAmostra);
        out[dstOffset++] = g;
        out[dstOffset++] = g;
        out[dstOffset++] = g;
        out[dstOffset++] = v === cinzaTransp ? 0 : 255;
      } else {
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
