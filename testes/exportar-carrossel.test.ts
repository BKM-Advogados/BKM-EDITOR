// Exportação do carrossel (rodada 3, B2): o PDF do A4 a 300 dpi sai no tamanho do papel, 21 × 29,7 cm, e não com
// 87 × 124 cm (imagem-D12); a exportação em partes grava cada PNG ao chegar e monta o PDF lendo do disco, sem o
// carrossel inteiro em memória (imagem-D19).
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {PDFDocument} from 'pdf-lib';
import {afterAll, describe, expect, it} from 'vitest';
import {pontosPorPixel} from '../src/nucleo/carrossel';
import {abrirExportacao, fecharExportacao, gravarParte, pdfDasPaginas} from '../src/main/exportar-paginas';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-exportar-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));

// PNG mínimo de cor chapada (IHDR, um IDAT sem filtro, IEND), o bastante para o pdf-lib
const crc32 = (() => {
  const tabela = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  return (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = tabela[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();
const pedaco = (tipo: string, dados: Buffer) => {
  const tam = Buffer.alloc(4);
  tam.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'latin1'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tam, corpo, crc]);
};
const pngChapado = (w: number, h: number) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const bruto = Buffer.alloc((1 + w * 3) * h, 200);
  for (let y = 0; y < h; y++) bruto[y * (1 + w * 3)] = 0; // filtro "nenhum" em cada linha
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pedaco('IHDR', ihdr), pedaco('IDAT', zlib.deflateSync(bruto)), pedaco('IEND', Buffer.alloc(0))]);
};
const cm = (pt: number) => (pt / 72) * 2.54;

describe('PDF do A4 no tamanho do papel (imagem-D12)', () => {
  it('A4 a 300 dpi (em pé ou deitado) vira 72/300 pt por px; imagem de rede fica 1 px = 1 pt', () => {
    expect(pontosPorPixel(2480, 3508)).toBeCloseTo(0.24, 6);
    expect(pontosPorPixel(3508, 2480)).toBeCloseTo(0.24, 6);
    expect(pontosPorPixel(1080, 1350)).toBe(1);
    expect(pontosPorPixel(1200, 627)).toBe(1);
  });

  it('a página do PDF do A4 mede 21 × 29,7 cm', async () => {
    const pdf = await PDFDocument.load(await pdfDasPaginas([pngChapado(2480, 3508)], pontosPorPixel(2480, 3508)));
    const {width, height} = pdf.getPage(0).getSize();
    expect(cm(width)).toBeCloseTo(21, 1);
    expect(cm(height)).toBeCloseTo(29.7, 1);
    // o feed continua 1 px = 1 pt
    const feed = await PDFDocument.load(await pdfDasPaginas([pngChapado(108, 135)]));
    expect(feed.getPage(0).getSize()).toEqual({width: 108, height: 135});
  }, 30_000);
});

describe('exportação em partes (imagem-D19)', () => {
  it('cada PNG vai para o disco ao chegar; o fechar monta o PDF lendo de lá, na ordem', async () => {
    const saidas = path.join(tmp, 'saidas');
    const {sessao, pasta} = abrirExportacao({saidas, nome: 'Carrossel · Férias', pdf: true});
    expect(path.basename(pasta)).toBe('Carrossel - Férias'); // o nome da pasta passa pelo nomeDePasta
    gravarParte(sessao, {numero: 2, png: pngChapado(54, 67)});
    expect(existsSync(path.join(pasta, '02.png'))).toBe(true);
    gravarParte(sessao, {numero: 1, png: pngChapado(54, 67)});
    gravarParte(sessao, {numero: 3, png: pngChapado(54, 54)});
    const r = await fecharExportacao(sessao);
    expect(r).toMatchObject({ok: true, pasta, pdf: `${pasta}.pdf`});
    expect(r.arquivos!.map((a) => path.basename(a))).toEqual(['01.png', '02.png', '03.png']);
    const pdf = await PDFDocument.load(readFileSync(r.pdf!));
    expect(pdf.getPageCount()).toBe(3);
    expect(pdf.getPage(2).getSize()).toEqual({width: 54, height: 54});
    // a sessão fecha: nada mais entra, e a próxima exportação não pisa na pasta
    expect(() => gravarParte(sessao, {numero: 4, png: pngChapado(4, 4)})).toThrow(/não achada/);
    expect((await fecharExportacao(sessao)).ok).toBe(false);
    expect(path.basename(abrirExportacao({saidas, nome: 'Carrossel · Férias', pdf: true}).pasta)).toBe('Carrossel - Férias (2)');
  });

  it('sem página não há PDF', async () => {
    const {sessao} = abrirExportacao({saidas: path.join(tmp, 'vazio'), nome: 'Nada', pdf: true});
    expect(await fecharExportacao(sessao)).toMatchObject({ok: false, mensagem: 'nenhuma página para exportar'});
  });
});
