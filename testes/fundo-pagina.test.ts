// Fundo diferente por página no carrossel: a página pode ter `fundo` e/ou `fundo_degrade` próprios; sem eles herda os do
// documento (documentos antigos ficam idênticos). A vista da página (prévia, miniatura, PNG e PDF) usa o fundo efetivo.
import jsonpatch, {type Operation} from 'fast-json-patch';
import {describe, expect, it} from 'vitest';
import {docCarrossel, fundoDaPagina, patchDuplicarPagina, temFundoProprio, vistaDaPagina} from '../src/nucleo/carrossel';
import {resolverMarcaNoDoc} from '../src/nucleo/cor-marca';
import {novoDocImagem} from '../src/nucleo/criar-projeto';
import type {Degrade, DocImagem, OperacaoPatch} from '../src/nucleo/documentos';
import {KIT_ESCRITORIO} from './fixtures/kit-escritorio';
import {marcaDoKit, patchDaMarca} from '../src/nucleo/marca';

const DEG: Degrade = {tipo: 'linear', angulo: 180, paradas: [{cor: '#112233', posicao: 0}, {cor: '#445566', posicao: 1}]};
const DEG_DOC: Degrade = {tipo: 'radial', paradas: [{cor: '#000000', posicao: 0}, {cor: '#FFFFFF', posicao: 1}]};
const aplicar = (doc: DocImagem, patch: OperacaoPatch[]): DocImagem => jsonpatch.applyPatch(structuredClone(doc), patch as Operation[], true, false).newDocument;
const carrossel = (): DocImagem => ({...docCarrossel({largura: 1080, altura: 1350, paginas: 3}), fundo: '#171A19', fundo_degrade: DEG_DOC});

describe('fundo efetivo da página', () => {
  it('sem campos, a página herda o fundo e o degradê do documento', () => {
    const doc = carrossel();
    expect(temFundoProprio(doc.paginas![0])).toBe(false);
    expect(fundoDaPagina(doc, doc.paginas![0])).toEqual({fundo: '#171A19', fundo_degrade: DEG_DOC});
    expect(fundoDaPagina({fundo: '#FFF'}, undefined)).toEqual({fundo: '#FFF'});
  });

  it('com cor própria, usa a cor da página e não põe o degradê do documento por cima', () => {
    const doc = carrossel();
    doc.paginas![1].fundo = '#C9A961';
    expect(temFundoProprio(doc.paginas![1])).toBe(true);
    expect(fundoDaPagina(doc, doc.paginas![1])).toEqual({fundo: '#C9A961'});
  });

  it('só com degradê próprio, a cor continua a do documento e o degradê é o da página', () => {
    const doc = carrossel();
    doc.paginas![2].fundo_degrade = DEG;
    expect(fundoDaPagina(doc, doc.paginas![2])).toEqual({fundo: '#171A19', fundo_degrade: DEG});
  });

  it('a vista da página (o que a prévia e a exportação desenham) leva o fundo efetivo; as outras páginas seguem o documento', () => {
    const doc = carrossel();
    doc.paginas![1].fundo = '#C9A961';
    doc.paginas![1].fundo_degrade = DEG;
    const v1 = vistaDaPagina(doc, 1);
    expect(v1.fundo).toBe('#C9A961');
    expect(v1.fundo_degrade).toEqual(DEG);
    expect(v1.paginas).toBeUndefined();
    const v0 = vistaDaPagina(doc, 0);
    expect(v0.fundo).toBe('#171A19');
    expect(v0.fundo_degrade).toEqual(DEG_DOC);
    // cor própria sem degradê: o degradê do documento sai da vista
    const sem = carrossel();
    sem.paginas![0].fundo = '#FFFFFF';
    expect('fundo_degrade' in vistaDaPagina(sem, 0)).toBe(false);
  });
});

describe('retrocompatibilidade', () => {
  it('documento sem fundo nas páginas tem a mesma vista de antes', () => {
    const doc = carrossel();
    const {paginas, ...resto} = doc;
    paginas!.forEach((p, i) => expect(vistaDaPagina(doc, i)).toEqual({...resto, camadas: p.camadas}));
  });

  it('uma prancheta só (sem paginas) continua igual ao documento', () => {
    const doc = novoDocImagem(1080, 1080);
    expect(vistaDaPagina(doc, 0)).toEqual(doc);
  });
});

describe('fundo da página com o kit e com as páginas', () => {
  it('a cor e o degradê de referência (@destaque) da página resolvem pelo kit da imagem', () => {
    const doc = docCarrossel({largura: 1080, altura: 1350, paginas: 2, marca: marcaDoKit(KIT_ESCRITORIO)});
    doc.paginas![1].fundo = '@destaque';
    doc.paginas![1].fundo_degrade = {tipo: 'linear', paradas: [{cor: '@fundo', posicao: 0}, {cor: '@destaque', posicao: 1}]};
    const r = resolverMarcaNoDoc(doc);
    expect(r.paginas![1].fundo).toBe('#C9A961');
    expect(r.paginas![1].fundo_degrade!.paradas.map((p) => p.cor)).toEqual(['#101826', '#C9A961']);
    expect(doc.paginas![1].fundo).toBe('@destaque'); // o original não muda
    expect(vistaDaPagina(r, 1).fundo).toBe('#C9A961');
  });

  it('trocar o kit leva o fundo próprio da página para o mesmo papel', () => {
    const antigo = docCarrossel({largura: 1080, altura: 1350, paginas: 2});
    antigo.paginas![0].fundo = antigo.fundo;
    const novo = aplicar(antigo, patchDaMarca(antigo, KIT_ESCRITORIO));
    expect(novo.paginas![0].fundo).toBe(novo.fundo);
  });

  it('duplicar a página leva o fundo próprio junto', () => {
    const doc = carrossel();
    doc.paginas![0].fundo = '#C9A961';
    doc.paginas![0].fundo_degrade = DEG;
    const r = patchDuplicarPagina(doc, 0);
    const depois = aplicar(doc, r.patch);
    expect(depois.paginas![1].fundo).toBe('#C9A961');
    expect(depois.paginas![1].fundo_degrade).toEqual(DEG);
  });
});
