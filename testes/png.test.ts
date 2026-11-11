// C14 e M8 (auditorias de conteúdo e do MCP): o decodificador de PNG lia o entrelaçado (Adam7) como lixo, ignorava o
// tRNS de RGB e de cinza, não lia o indexado de 1, 2 ou 4 bits, saía transparente sem PLTE e alocava o que o IHDR
// mandasse. Agora lê o que precisa, recusa o resto com erro claro antes de alocar, e o ffmpeg converte o que dá (JPG).
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {decodificarPng, ErroPng} from '../src/nucleo/png';
import {acharFfmpeg, converterParaPng, LADO_CONVERTIDO} from '../src/nucleo/imagem-ffmpeg';
import {chunk, ihdr, png8, pngEntrelacado, pngIndexado, pngSoCabecalho, tRNS16} from './apoio/png-teste';
import {deflateSync} from 'node:zlib';

const px = (d: {dados: Uint8ClampedArray}, i: number) => [...d.dados.slice(i * 4, i * 4 + 4)];
const erroDe = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e as ErroPng;
  }
  throw new Error('não lançou');
};

describe('C14/M8: o que o decodificador lê', () => {
  it('RGB, RGBA, cinza e cinza com alfa de 8 bits', () => {
    expect(px(decodificarPng(png8(2, 1, 2, (x) => (x ? [0, 255, 0] : [255, 0, 0]))), 1)).toEqual([0, 255, 0, 255]);
    expect(px(decodificarPng(png8(1, 1, 6, () => [1, 2, 3, 4])), 0)).toEqual([1, 2, 3, 4]);
    expect(px(decodificarPng(png8(1, 1, 0, () => [77])), 0)).toEqual([77, 77, 77, 255]);
    expect(px(decodificarPng(png8(1, 1, 4, () => [77, 9])), 0)).toEqual([77, 77, 77, 9]);
  });

  it('tRNS de RGB e de cinza: a cor marcada fica transparente', () => {
    const rgb = decodificarPng(png8(2, 1, 2, (x) => (x ? [0, 255, 0] : [255, 0, 0]), [tRNS16(0, 255, 0)]));
    expect(px(rgb, 0)).toEqual([255, 0, 0, 255]);
    expect(px(rgb, 1)[3]).toBe(0);
    const cinza = decodificarPng(png8(2, 1, 0, (x) => [x ? 200 : 10], [tRNS16(200)]));
    expect(px(cinza, 0)[3]).toBe(255);
    expect(px(cinza, 1)[3]).toBe(0);
  });

  it('indexado de 1, 2 e 4 bits (logo e pixel art), com tRNS', () => {
    const paleta = [[255, 0, 0], [0, 0, 255], [0, 255, 0], [9, 9, 9]];
    for (const bits of [1, 2, 4, 8] as const) {
      const cores = Math.min(4, 1 << bits);
      const img = decodificarPng(pngIndexado(5, 3, bits, paleta.slice(0, cores), (x, y) => (x + y) % cores, [255, 0]));
      expect(img.largura).toBe(5);
      expect(px(img, 0)).toEqual([255, 0, 0, 255]);
      expect(px(img, 1)).toEqual([0, 0, 255, 0]);
      const idx = (4 + 2) % cores;
      expect(px(img, 4 + 5 * 2)).toEqual([...paleta[idx], idx === 1 ? 0 : 255]);
    }
  });

  it('cinza de 4 bits sobe para 8 bits', () => {
    expect(px(decodificarPng(pngIndexadoCinza4()), 0)).toEqual([255, 255, 255, 255]);
  });
});

/** Cinza de 4 bits, 1×1, amostra 15 (branco). */
const pngIndexadoCinza4 = () => Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr(1, 1, 4, 0),
  chunk('IDAT', deflateSync(Buffer.from([0, 0xf0]))), chunk('IEND', Buffer.alloc(0)),
]);

describe('C14/M8: o que o decodificador recusa, com erro claro', () => {
  it('entrelaçado (Adam7): erro, não lixo; o ffmpeg converte', () => {
    const e = erroDe(() => decodificarPng(pngEntrelacado(4, 4, (_x, y) => (y < 2 ? [255, 0, 0] : [0, 0, 255]))));
    expect(e.message).toMatch(/entrelaçado/);
    expect(e.convertivel).toBe(true);
  });

  it('IHDR de 100000×100000: recusa antes de alocar', () => {
    const t0 = performance.now();
    const e = erroDe(() => decodificarPng(pngSoCabecalho(100000, 100000)));
    expect(e.message).toMatch(/grande demais/);
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it('indexado sem PLTE: erro, em vez de imagem toda transparente', () => {
    const semPaleta = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr(1, 1, 8, 3),
      chunk('IDAT', deflateSync(Buffer.from([0, 0]))), chunk('IEND', Buffer.alloc(0)),
    ]);
    expect(erroDe(() => decodificarPng(semPaleta)).message).toMatch(/sem paleta/);
  });

  it('16 bits e outro formato: erro convertível; dados a mais que o cabeçalho: erro', () => {
    const dezesseis = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr(1, 1, 16, 2),
      chunk('IDAT', deflateSync(Buffer.alloc(7))), chunk('IEND', Buffer.alloc(0)),
    ]);
    expect(erroDe(() => decodificarPng(dezesseis)).convertivel).toBe(true);
    expect(erroDe(() => decodificarPng(Buffer.from('\xff\xd8\xff\xe0 não é png', 'latin1'))).convertivel).toBe(true);
    const bomba = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr(2, 2, 8, 6),
      chunk('IDAT', deflateSync(Buffer.alloc(10_000_000))), chunk('IEND', Buffer.alloc(0)),
    ]);
    expect(erroDe(() => decodificarPng(bomba)).message).toMatch(/maiores do que o cabeçalho/);
  });
});

describe('M8: JPG convertido pelo ffmpeg do app', () => {
  const foto = path.join(__dirname, 'fixtures', 'projeto', 'midia', 'foto.jpg');

  it('acha o ffmpeg do compositor e converte a foto num PNG reduzido que o decodificador lê', async () => {
    expect(acharFfmpeg()).toBeTruthy();
    const img = decodificarPng(await converterParaPng(foto));
    expect(Math.max(img.largura, img.altura)).toBeLessThanOrEqual(LADO_CONVERTIDO);
    expect(img.largura / img.altura).toBeCloseTo(1080 / 760, 1);
  });

  it('o Adam7 também passa pela conversão', async () => {
    const {writeFileSync, mkdtempSync} = await import('node:fs');
    const os = await import('node:os');
    const arq = path.join(mkdtempSync(path.join(os.tmpdir(), 'estudio-png-')), 'adam7.png');
    writeFileSync(arq, pngEntrelacado(4, 4, (_x, y) => (y < 2 ? [255, 0, 0] : [0, 0, 255])));
    const img = decodificarPng(await converterParaPng(arq));
    expect(px(img, 0)).toEqual([255, 0, 0, 255]);
    expect(px(img, 15)).toEqual([0, 0, 255, 255]);
  });

  it('sem ffmpeg, a mensagem diz o que fazer', async () => {
    await expect(converterParaPng(foto, {ffmpeg: null})).rejects.toThrow(/converta para PNG/);
  });
});
