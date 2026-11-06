// Carrossel de páginas na imagem: documento de uma prancheta só vira páginas em memória (sem reescrever a capa da Cliente),
// criar, duplicar, reordenar, renomear e excluir páginas por patch, o modelo "Novo carrossel" e a exportação em PNG
// por página e PDF (lido de volta: N páginas, cada uma do tamanho da imagem).
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import jsonpatch, {type Operation} from 'fast-json-patch';
import {PDFDocument} from 'pdf-lib';
import {afterAll, describe, expect, it} from 'vitest';
import {baseCamadas, caminhoPagina, docCarrossel, idLivre, indiceNaBase, indicePagina, opsNumerar, paginaDoCaminho, paginasDe, patchCarrossel, patchDuplicarPagina,
  patchExcluirPagina, patchMoverPagina, patchNovaPagina, patchRenomearPagina, temPaginas, vistaDaPagina} from '../src/nucleo/carrossel';
import type {DocImagem, OperacaoPatch} from '../src/nucleo/documentos';
import {gravarPaginas, pdfDasPaginas} from '../src/main/exportar-paginas';

const EXEMPLO = path.join(__dirname, '..', 'exemplos', 'exemplo');
const capa = (): DocImagem => JSON.parse(readFileSync(path.join(EXEMPLO, 'imagem', 'capa.json'), 'utf-8')) as DocImagem;
const aplicar = (doc: DocImagem, patch: OperacaoPatch[]): DocImagem => jsonpatch.applyPatch(structuredClone(doc), patch as Operation[], true, false).newDocument;

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-carrossel-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));

describe('documento sem páginas', () => {
  it('a capa da Cliente vale como uma página só, sem mudar o arquivo', () => {
    const doc = capa();
    expect(temPaginas(doc)).toBe(false);
    const paginas = paginasDe(doc);
    expect(paginas).toHaveLength(1);
    expect(paginas[0].camadas).toBe(doc.camadas);
    expect(paginas[0].camadas.map((c) => c.id)).toEqual(['foto', 'faixa', 'titulo', 'subtitulo', 'logo']);
    expect(baseCamadas(doc, 0)).toBe('/camadas');
    expect(caminhoPagina(doc, 0)).toBeUndefined();
    // a vista da página é o próprio documento: a exportação de uma prancheta só não muda
    expect(vistaDaPagina(doc, 0)).toEqual(doc);
  });

  it('entende caminhos de camada nos dois formatos', () => {
    const um = capa();
    expect(indiceNaBase('/camadas/3', '/camadas')).toBe(3);
    expect(indiceNaBase('/camadas/3/texto', '/camadas')).toBe(-1);
    expect(indiceNaBase('/paginas/1/camadas/2', '/paginas/1/camadas')).toBe(2);
    expect(indiceNaBase('/paginas/1/camadas/2', '/camadas')).toBe(-1);
    expect(paginaDoCaminho(um, '/camadas/2')).toBe(0);
    expect(paginaDoCaminho(um, '/paginas/1/camadas/2')).toBe(-1);
    const varios = aplicar(um, patchNovaPagina(um).patch);
    expect(paginaDoCaminho(varios, '/paginas/1/camadas/0')).toBe(1);
    expect(paginaDoCaminho(varios, '/camadas/2')).toBe(-1);
    expect(indicePagina('/paginas/4')).toBe(4);
    expect(indicePagina('/camadas/4')).toBe(-1);
    expect(idLivre([{id: 'pagina-1'}, {id: 'pagina-2'}], 'pagina-2')).toBe('pagina-3');
    expect(idLivre([], 'Título da página')).toBe('titulo-da-pagina-1');
  });
});

describe('páginas por patch', () => {
  it('a segunda página migra a prancheta para paginas[] e guarda as camadas na primeira', () => {
    const doc = capa();
    const r = patchNovaPagina(doc, 0, 'Conteúdo');
    const depois = aplicar(doc, r.patch);
    expect(temPaginas(depois)).toBe(true);
    expect(depois.camadas).toEqual([]);
    expect(depois.paginas!.map((p) => [p.id, p.nome])).toEqual([['pagina-1', 'Página 1'], ['pagina-2', 'Conteúdo']]);
    expect(depois.paginas![0].camadas).toEqual(doc.camadas);
    expect(depois.paginas![1].camadas).toEqual([]);
    expect(r.indice).toBe(1);
    expect(r.paginas).toEqual(depois.paginas);
    expect(baseCamadas(depois, 1)).toBe('/paginas/1/camadas');
    expect(caminhoPagina(depois, 1)).toBe('/paginas/1');
    expect(vistaDaPagina(depois, 0)).toEqual({...doc, camadas: doc.camadas});
    expect(depois.largura).toBe(1080);
    expect(depois.altura).toBe(1350);
  });

  it('cria, duplica, reordena, renomeia e exclui, acertando o contador "n/N"', () => {
    const base = docCarrossel({largura: 1080, altura: 1350, paginas: 3});
    expect(base.paginas!.map((p) => p.id)).toEqual(['capa', 'pagina-2', 'final']);

    // nova página depois da capa
    let r = patchNovaPagina(base, 0);
    let doc = aplicar(base, r.patch);
    expect(doc.paginas!.map((p) => p.id)).toEqual(['capa', 'pagina-1', 'pagina-2', 'final']);
    expect(r.indice).toBe(1);
    const contador = (d: DocImagem) => d.paginas!.map((p) => p.camadas.find((c) => c.id === 'pagina')?.texto ?? '-');
    expect(contador(doc)).toEqual(['1/4', '-', '3/4', '4/4']);

    // duplicar a página de conteúdo: id novo, camadas iguais, nome com "(cópia)"
    r = patchDuplicarPagina(doc, 2);
    doc = aplicar(doc, r.patch);
    expect(doc.paginas!.map((p) => p.id)).toEqual(['capa', 'pagina-1', 'pagina-2', 'pagina-3', 'final']);
    expect(doc.paginas![3].nome).toBe('Página 2 (cópia)');
    expect(doc.paginas![3].camadas.map((c) => c.id)).toEqual(doc.paginas![2].camadas.map((c) => c.id));
    expect(contador(doc)).toEqual(['1/5', '-', '3/5', '4/5', '5/5']);
    expect(r.indice).toBe(3);

    // mover a página vazia para o fim: a final passa a ser a quarta e os contadores acompanham
    r = patchMoverPagina(doc, 1, 4);
    doc = aplicar(doc, r.patch);
    expect(doc.paginas!.map((p) => p.id)).toEqual(['capa', 'pagina-2', 'pagina-3', 'final', 'pagina-1']);
    expect(contador(doc)).toEqual(['1/5', '2/5', '3/5', '4/5', '-']);
    expect(r.indice).toBe(4);
    expect(patchMoverPagina(doc, 2, 2).patch).toEqual([]);

    // renomear
    r = patchRenomearPagina(doc, 1, '  Regra 1  ');
    doc = aplicar(doc, r.patch);
    expect(doc.paginas![1].nome).toBe('Regra 1');

    // excluir a vazia e a cópia
    r = patchExcluirPagina(doc, 4)!;
    doc = aplicar(doc, r.patch);
    expect(r.indice).toBe(3);
    r = patchExcluirPagina(doc, 2)!;
    doc = aplicar(doc, r.patch);
    expect(doc.paginas!.map((p) => p.id)).toEqual(['capa', 'pagina-2', 'final']);
    expect(contador(doc)).toEqual(['1/3', '2/3', '3/3']);
    expect(r.indice).toBe(2);

    // a última página não sai
    const uma = aplicar(aplicar(doc, patchExcluirPagina(doc, 0)!.patch), patchExcluirPagina(aplicar(doc, patchExcluirPagina(doc, 0)!.patch), 0)!.patch);
    expect(uma.paginas).toHaveLength(1);
    expect(patchExcluirPagina(uma, 0)).toBeNull();
    expect(patchExcluirPagina(capa(), 0)).toBeNull();
  });

  it('o test do id protege contra a página que mudou por baixo', () => {
    const doc = docCarrossel({largura: 1080, altura: 1080, paginas: 4});
    const r = patchExcluirPagina(doc, 1)!;
    const mexido = aplicar(doc, patchMoverPagina(doc, 1, 2).patch);
    expect(() => aplicar(mexido, r.patch)).toThrow();
  });

  it('renomear a página de uma prancheta só também migra', () => {
    const doc = capa();
    const depois = aplicar(doc, patchRenomearPagina(doc, 0, 'Capa').patch);
    expect(depois.paginas).toHaveLength(1);
    expect(depois.paginas![0]).toMatchObject({id: 'pagina-1', nome: 'Capa'});
    expect(depois.paginas![0].camadas).toEqual(doc.camadas);
    expect(depois.camadas).toEqual([]);
  });

  it('só numera camadas "pagina" que ainda são contador', () => {
    const doc = docCarrossel({largura: 1080, altura: 1350, paginas: 2});
    doc.paginas![0].camadas.find((c) => c.id === 'pagina')!.texto = 'Capa';
    expect(opsNumerar(doc.paginas!)).toEqual([]);
    doc.paginas![1].camadas.find((c) => c.id === 'pagina')!.texto = '9/9';
    expect(opsNumerar(doc.paginas!)).toEqual([{op: 'replace', path: '/paginas/1/camadas/3/texto', value: '2/2'}]);
  });
});

describe('modelo "Novo carrossel"', () => {
  it('capa, conteúdo e final com campos nomeados, no tamanho pedido', () => {
    const doc = docCarrossel({largura: 1080, altura: 1350, paginas: 7});
    expect(doc).toMatchObject({formato: 1, largura: 1080, altura: 1350, camadas: []});
    expect(doc.paginas!.map((p) => p.nome)).toEqual(['Capa', 'Página 2', 'Página 3', 'Página 4', 'Página 5', 'Página 6', 'Final']);
    for (const [i, p] of doc.paginas!.entries()) {
      const ids = p.camadas.map((c) => c.id);
      expect(ids).toContain('titulo');
      expect(ids).toContain('pagina');
      expect(new Set(ids).size).toBe(ids.length);
      expect(p.camadas.find((c) => c.id === 'pagina')).toMatchObject({tipo: 'texto', texto: `${i + 1}/7`});
      for (const c of p.camadas) {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.x + c.largura).toBeLessThanOrEqual(1080);
        expect(c.y + c.altura).toBeLessThanOrEqual(1350);
      }
    }
    expect(doc.paginas![0].camadas.map((c) => c.id)).toEqual(['faixa', 'titulo', 'subtitulo', 'chamada', 'pagina']);
    expect(doc.paginas![3].camadas.map((c) => c.id)).toEqual(['faixa', 'titulo', 'texto', 'pagina']);
    expect(doc.paginas![6].camadas.map((c) => c.id)).toEqual(['faixa', 'titulo', 'texto', 'pagina']);
  });

  it('quadrado 1:1 e casos pequenos', () => {
    const q = docCarrossel({largura: 1080, altura: 1080, paginas: 2});
    expect(q.paginas!.map((p) => p.id)).toEqual(['capa', 'final']);
    expect(docCarrossel({largura: 1080, altura: 1080, paginas: 1}).paginas!.map((p) => p.id)).toEqual(['capa']);
    for (const c of q.paginas!.flatMap((p) => p.camadas)) expect(c.y + c.altura).toBeLessThanOrEqual(1080);
  });

  it('o patch do modelo transforma uma imagem em branco no carrossel', () => {
    const branco: DocImagem = {formato: 1, largura: 1080, altura: 1350, fundo: '#000000', camadas: [{id: 'titulo', nome: 'Título', tipo: 'texto', x: 0, y: 0, largura: 100, altura: 50}], efeitos: []};
    const modelo = docCarrossel({largura: 1080, altura: 1350, paginas: 5});
    const doc = aplicar(branco, patchCarrossel(modelo));
    expect(doc.camadas).toEqual([]);
    expect(doc.paginas).toEqual(modelo.paginas);
    expect(doc.fundo).toBe(modelo.fundo);
    expect(paginasDe(doc)).toHaveLength(5);
  });
});

// ---------- exportação ----------
// PNG mínimo (cor chapada) escrito à mão: IHDR, um IDAT com as linhas sem filtro e IEND. É o bastante para o pdf-lib
// medir e embutir a imagem.
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
const pngChapado = (w: number, h: number, cor: [number, number, number]) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bits
  ihdr[9] = 2; // RGB
  const linha = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) linha.set(cor, 1 + x * 3);
  const bruto = Buffer.concat(Array.from({length: h}, () => linha));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pedaco('IHDR', ihdr), pedaco('IDAT', zlib.deflateSync(bruto)), pedaco('IEND', Buffer.alloc(0))]);
};

describe('exportar páginas', () => {
  it('PDF com uma página por imagem, do tamanho da imagem', async () => {
    const pdf = await pdfDasPaginas([pngChapado(216, 270, [20, 24, 28]), pngChapado(216, 270, [200, 129, 85]), pngChapado(108, 108, [255, 255, 255])]);
    const lido = await PDFDocument.load(pdf);
    expect(lido.getPageCount()).toBe(3);
    expect(lido.getPage(0).getSize()).toEqual({width: 216, height: 270});
    expect(lido.getPage(2).getSize()).toEqual({width: 108, height: 108});
  });

  it('grava 01.png… numa pasta própria e o PDF ao lado, sem sobrescrever', async () => {
    const saidas = path.join(tmp, 'saidas');
    const paginas = [1, 2, 3, 4, 5].map((n) => ({numero: n, png: pngChapado(216, 270, [n * 40, 0, 0])}));
    const r = await gravarPaginas({saidas, nome: 'Carrossel · Férias', paginas, pdf: true});
    expect(r.ok).toBe(true);
    expect(path.basename(r.pasta!)).toBe('Carrossel - Férias');
    expect(readdirSync(r.pasta!)).toEqual(['01.png', '02.png', '03.png', '04.png', '05.png']);
    expect(r.pdf).toBe(path.join(saidas, 'Carrossel - Férias.pdf'));
    expect(r.mostrar).toBe(r.pdf);
    expect((await PDFDocument.load(readFileSync(r.pdf!))).getPageCount()).toBe(5);
    expect(readFileSync(path.join(r.pasta!, '03.png'))).toEqual(paginas[2].png);

    // de novo: pasta e PDF ganham " (2)" juntos
    const r2 = await gravarPaginas({saidas, nome: 'Carrossel · Férias', paginas, pdf: true});
    expect(path.basename(r2.pasta!)).toBe('Carrossel - Férias (2)');
    expect(r2.pdf).toBe(path.join(saidas, 'Carrossel - Férias (2).pdf'));
    expect(existsSync(r.pdf!)).toBe(true);

    // uma página sem PDF: arquivo solto com o número da página
    const r3 = await gravarPaginas({saidas, nome: 'Carrossel · Férias', paginas: [paginas[2]], pdf: false});
    expect(r3.arquivos).toEqual([path.join(saidas, 'Carrossel - Férias - 03.png')]);
    expect(r3.pdf).toBeUndefined();
    expect((await gravarPaginas({saidas, nome: 'x', paginas: [], pdf: true})).ok).toBe(false);
  });
});
