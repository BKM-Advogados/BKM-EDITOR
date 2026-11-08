// Acabamento da imagem: os valores padrão e a leitura calma da sombra, do contorno e do degradê; a geometria do
// degradê (a mesma do CSS), a caixa que a pintura ocupa, a máscara de recorte (quem recorta quem, recortar, soltar e
// subir ou descer com a máscara junto), as predefinições do kit e a capa da Cliente sem acabamento nenhum (abre igual).
import {readFileSync} from 'node:fs';
import path from 'node:path';
import jsonpatch, {type Operation} from 'fast-json-patch';
import {describe, expect, it} from 'vitest';
import {
  blocoDe, caixaPintada, contornoDaMarca, contornoDe, corComOpacidade, degradeDaMarca, degradeDe, elipseDoDegrade, itensDePintura, kitDaImagem, linhaDoDegrade,
  mascaraDe, mascarasEmUso, misturar, paradasDe, patchMoverCamada, patchRecortar, patchSoltar, podeRecortar, SOMBRA_PADRAO, sombraDe, temAcabamento,
} from '../src/nucleo/acabamento';
import {acharCamada} from '../src/nucleo/carrossel';
import type {CamadaImagem, DocImagem, OperacaoPatch} from '../src/nucleo/documentos';
import {MARCA_BKM, MARCA_CLIENTE, MARCAS_INICIAIS} from '../src/nucleo/marca';

const EXEMPLO = path.join(__dirname, '..', 'exemplos', 'exemplo');
const capa = (): DocImagem => JSON.parse(readFileSync(path.join(EXEMPLO, 'imagem', 'capa.json'), 'utf-8')) as DocImagem;
const aplicar = <T,>(doc: T, patch: OperacaoPatch[]): T => jsonpatch.applyPatch(structuredClone(doc), patch as Operation[], true, false).newDocument;

const camada = (id: string, tipo: CamadaImagem['tipo'], extra: Partial<CamadaImagem> = {}): CamadaImagem =>
  ({id, nome: id, tipo, x: 100, y: 200, largura: 300, altura: 150, ...extra});

describe('leitura do acabamento', () => {
  it('sombra, contorno e degradê preenchem o padrão e ignoram o que não vale', () => {
    expect(sombraDe(camada('a', 'texto'))).toBeNull();
    expect(sombraDe(camada('a', 'texto', {sombra: {}}))).toEqual(SOMBRA_PADRAO);
    expect(sombraDe(camada('a', 'texto', {sombra: {opacidade: 0}}))).toBeNull();
    expect(sombraDe(camada('a', 'texto', {sombra: {opacidade: 3, desfoque: -5, x: Number.NaN}}))).toMatchObject({opacidade: 1, desfoque: 0, x: 0});
    expect(contornoDe(camada('a', 'forma', {contorno: {espessura: 0}}))).toBeNull();
    expect(contornoDe(camada('a', 'forma', {contorno: {espessura: 6, posicao: 'qualquer' as never}}))).toEqual({cor: '#FFFFFF', espessura: 6, posicao: 'fora', estilo: 'solido', pontas: 'redonda', juncao: 'redonda'});
    expect(degradeDe({tipo: 'linear', paradas: []})).toBeNull();
    expect(degradeDe({tipo: 'x', paradas: [{cor: '#000', posicao: 0}]})).toMatchObject({tipo: 'linear', angulo: 180, centro: {x: 0.5, y: 0.5}});
  });

  it('as paradas saem em ordem, presas de 0 a 1; uma só vira cor chapada', () => {
    expect(paradasDe({paradas: [{cor: '#FFF', posicao: 1.4}, {cor: '#000', posicao: -1, opacidade: 0.5}]})).toEqual([
      {cor: '#000', posicao: 0, opacidade: 0.5}, {cor: '#FFF', posicao: 1, opacidade: 1}]);
    expect(paradasDe({paradas: [{cor: '#C88155', posicao: 0.3}]})).toEqual([
      {cor: '#C88155', posicao: 0, opacidade: 1}, {cor: '#C88155', posicao: 1, opacidade: 1}]);
  });

  it('só camada com acabamento sai do DOM na prévia (degradê não vale em imagem)', () => {
    expect(temAcabamento(camada('t', 'texto'))).toBe(false);
    expect(temAcabamento(camada('t', 'texto', {sombra: {}}))).toBe(true);
    expect(temAcabamento(camada('f', 'forma', {degrade: {tipo: 'linear', paradas: [{cor: '#000', posicao: 0}]}}))).toBe(true);
    expect(temAcabamento(camada('i', 'imagem', {degrade: {tipo: 'linear', paradas: [{cor: '#000', posicao: 0}]}}))).toBe(false);
    expect(temAcabamento(camada('i', 'imagem', {contorno: {espessura: 4}}))).toBe(true);
  });

  it('a capa da Cliente não tem acabamento: abre igual, toda em DOM', () => {
    const doc = capa();
    expect(doc.camadas.some(temAcabamento)).toBe(false);
    expect(itensDePintura(doc.camadas).map((x) => x.c.id)).toEqual(doc.camadas.filter((c) => c.visivel !== false).map((c) => c.id));
    expect(itensDePintura(doc.camadas).every((x) => !x.mascara)).toBe(true);
  });
});

describe('geometria do degradê, como o CSS', () => {
  it('linear: 180° vai do meio de cima ao meio de baixo; 90°, da esquerda à direita', () => {
    const v = linhaDoDegrade(180, 1080, 1350);
    expect(v.x0).toBeCloseTo(540, 6);
    expect(v.x1).toBeCloseTo(540, 6);
    expect(v.y0).toBeCloseTo(0, 6);
    expect(v.y1).toBeCloseTo(1350, 6);
    const h = linhaDoDegrade(90, 1080, 1350);
    expect(h.x0).toBeCloseTo(0, 6);
    expect(h.x1).toBeCloseTo(1080, 6);
    expect(h.y0).toBeCloseTo(675, 6);
  });

  it('linear inclinado: o comprimento é |w·sen| + |h·cos| (os cantos caem nas paradas 0 e 1)', () => {
    const p = linhaDoDegrade(135, 1080, 1350);
    const comprimento = Math.hypot(p.x1 - p.x0, p.y1 - p.y0);
    const t = (135 * Math.PI) / 180;
    expect(comprimento).toBeCloseTo(Math.abs(1080 * Math.sin(t)) + Math.abs(1350 * Math.cos(t)), 6);
    // num quadrado a 45°, a linha vai de canto a canto
    const q = linhaDoDegrade(45, 100, 100);
    expect([q.x0, q.y0, q.x1, q.y1].map((n) => Math.round(n * 1e6) / 1e6 + 0)).toEqual([0, 100, 100, 0]);
  });

  it('radial: a elipse do centro passa pelo canto mais longe (farthest-corner)', () => {
    const e = elipseDoDegrade({x: 0.5, y: 0.5}, 1080, 1350);
    expect(e).toMatchObject({cx: 540, cy: 675});
    expect(e.rx).toBeCloseTo(540 * Math.SQRT2, 6);
    expect(e.ry).toBeCloseTo(675 * Math.SQRT2, 6);
    const canto = elipseDoDegrade({x: 0.25, y: 0}, 400, 200);
    // o canto (400, 200) está na elipse: (dx/rx)² + (dy/ry)² = 1
    expect(((400 - canto.cx) / canto.rx) ** 2 + ((200 - canto.cy) / canto.ry) ** 2).toBeCloseTo(1, 6);
  });

  it('cor com opacidade vira rgba; cor sem leitura passa como veio', () => {
    expect(corComOpacidade('#C88155', 0.5)).toBe('rgba(200,129,85,0.5)');
    expect(corComOpacidade('#fff')).toBe('rgb(255,255,255)');
    expect(corComOpacidade('#00000080', 0.5)).toBe('rgba(0,0,0,0.251)');
    expect(corComOpacidade('rgba(10, 20, 30, 0.5)', 0.5)).toBe('rgba(10,20,30,0.25)');
    expect(corComOpacidade('white', 0.5)).toBe('white');
    expect(misturar('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });
});

describe('caixa que a pintura ocupa', () => {
  it('sem acabamento é a caixa; o contorno por fora soma a espessura; na borda, metade', () => {
    expect(caixaPintada(camada('a', 'forma'))).toEqual({x: 100, y: 200, w: 300, h: 150});
    expect(caixaPintada(camada('a', 'forma', {contorno: {espessura: 4}}))).toEqual({x: 96, y: 196, w: 308, h: 158});
    expect(caixaPintada(camada('a', 'forma', {contorno: {espessura: 4, posicao: 'centro'}}))).toEqual({x: 98, y: 198, w: 304, h: 154});
    expect(caixaPintada(camada('a', 'forma', {contorno: {espessura: 4, posicao: 'dentro'}}))).toEqual({x: 100, y: 200, w: 300, h: 150});
  });

  it('a sombra soma 1,5 × o desfoque, puxado pelo deslocamento', () => {
    const r = caixaPintada(camada('a', 'forma', {sombra: {desfoque: 20, x: 0, y: 10}}));
    // 30 de alcance: em cima 30 − 10 = 20, embaixo 30 + 10 = 40, dos lados 30
    expect(r).toEqual({x: 70, y: 180, w: 360, h: 210});
  });

  it('girada, a caixa é a que contém os quatro cantos', () => {
    const r = caixaPintada(camada('a', 'forma', {rotacao: 90}));
    expect(r.w).toBeCloseTo(150, 6);
    expect(r.h).toBeCloseTo(300, 6);
    expect(r.x + r.w / 2).toBeCloseTo(250, 6);
    expect(r.y + r.h / 2).toBeCloseTo(275, 6);
  });
});

describe('máscara de recorte', () => {
  const pilha = (): CamadaImagem[] => [
    camada('fundo', 'forma'),
    camada('foto', 'imagem', {src: 'midia/ana.jpg', mascara: 'circulo'}),
    camada('circulo', 'forma', {forma: 'elipse', contorno: {espessura: 6}}),
    camada('titulo', 'texto', {texto: 'Ana'}),
  ];

  it('a imagem é recortada pela camada logo acima com o id dela; a máscara não se pinta sozinha', () => {
    const cs = pilha();
    expect(mascaraDe(cs, 1)).toBe(2);
    expect([...mascarasEmUso(cs)]).toEqual([[2, 1]]);
    expect(itensDePintura(cs).map((x) => [x.c.id, x.mascara?.c.id])).toEqual([['fundo', undefined], ['foto', 'circulo'], ['titulo', undefined]]);
  });

  it('separadas, ou com a máscara oculta, a foto aparece inteira; foto oculta deixa a máscara aparecer', () => {
    const separadas = pilha();
    [separadas[2], separadas[3]] = [separadas[3], separadas[2]];
    expect(mascaraDe(separadas, 1)).toBe(-1);
    expect(itensDePintura(separadas).map((x) => x.c.id)).toEqual(['fundo', 'foto', 'titulo', 'circulo']);
    const oculta = pilha();
    oculta[2] = {...oculta[2], visivel: false};
    expect(itensDePintura(oculta).map((x) => [x.c.id, x.mascara?.c.id])).toEqual([['fundo', undefined], ['foto', undefined], ['titulo', undefined]]);
    const fotoOculta = pilha();
    fotoOculta[1] = {...fotoOculta[1], visivel: false};
    expect(itensDePintura(fotoOculta).map((x) => x.c.id)).toEqual(['fundo', 'circulo', 'titulo']);
  });

  it('recortar pela camada de cima e soltar (pela foto ou pela máscara)', () => {
    const cs = pilha().map((c) => ({...c, mascara: undefined}));
    const doc: {camadas: CamadaImagem[]} = {camadas: cs.map(({mascara: _m, ...c}) => c)};
    expect(podeRecortar(doc.camadas, 0)).toBe('só uma imagem fica recortada');
    expect(podeRecortar(doc.camadas, 1)).toBeNull();
    const recortado = aplicar(doc, patchRecortar(doc.camadas, '/camadas', 1));
    expect(recortado.camadas[1].mascara).toBe('circulo');
    expect(patchRecortar(doc.camadas, '/camadas', 0)).toEqual([]);
    const pelaMascara = aplicar(recortado, patchSoltar(recortado.camadas, '/camadas', 2));
    expect(pelaMascara.camadas[1].mascara).toBeUndefined();
    const pelaFoto = aplicar(recortado, patchSoltar(recortado.camadas, '/camadas', 1));
    expect(pelaFoto.camadas[1]).not.toHaveProperty('mascara');
  });

  it('a camada de cima precisa ser forma ou texto', () => {
    const cs = [camada('foto', 'imagem'), camada('logo', 'imagem')];
    expect(podeRecortar(cs, 0)).toBe('a camada de cima precisa ser uma forma ou um texto');
    expect(podeRecortar(cs, 1)).toBe('não há camada acima desta');
  });

  it('subir e descer leva a máscara junto, nas duas direções e passando por outro par', () => {
    const ids = (d: {camadas: CamadaImagem[]}) => d.camadas.map((c) => c.id);
    const doc = {camadas: pilha()};
    expect(blocoDe(doc.camadas, 2)).toEqual([1, 2]);
    const subiu = patchMoverCamada(doc.camadas, '/camadas', 1, 1)!;
    expect(ids(aplicar(doc, subiu.patch))).toEqual(['fundo', 'titulo', 'foto', 'circulo']);
    expect(subiu.indice).toBe(2);
    const desceu = patchMoverCamada(doc.camadas, '/camadas', 2, -1)!;
    expect(ids(aplicar(doc, desceu.patch))).toEqual(['foto', 'circulo', 'fundo', 'titulo']);
    expect(desceu.indice).toBe(1);
    // o título desce por cima do par inteiro
    const titulo = patchMoverCamada(doc.camadas, '/camadas', 3, -1)!;
    expect(ids(aplicar(doc, titulo.patch))).toEqual(['fundo', 'titulo', 'foto', 'circulo']);
    expect(titulo.indice).toBe(1);
    expect(patchMoverCamada(doc.camadas, '/camadas', 3, 1)).toBeNull();
    expect(patchMoverCamada(doc.camadas, '/camadas', 0, -1)).toBeNull();
    // o patch testa os ids: outra mão mexeu na ordem, nada é gravado
    const mexido = {camadas: [doc.camadas[0], doc.camadas[3], doc.camadas[1], doc.camadas[2]]};
    expect(() => aplicar(mexido, subiu.patch)).toThrow();
  });
});

describe('predefinições do kit', () => {
  it('contorno na cor de destaque, por fora; no texto, a espessura acompanha a letra', () => {
    expect(contornoDaMarca(MARCA_CLIENTE)).toEqual({cor: '#C88155', espessura: 6, posicao: 'fora'});
    expect(contornoDaMarca(MARCA_CLIENTE, {tipo: 'texto', tamanho: 100})).toMatchObject({espessura: 6});
    expect(contornoDaMarca(MARCA_CLIENTE, {tipo: 'texto', tamanho: 20})).toMatchObject({espessura: 2});
  });

  it('degradê do destaque na camada e do fundo esquentando no fundo da prancheta', () => {
    expect(degradeDaMarca(MARCA_CLIENTE)).toEqual({tipo: 'linear', angulo: 135, paradas: [{cor: '#C88155', posicao: 0}, {cor: misturar('#C88155', '#FFFFFF', 0.35), posicao: 1}]});
    const fundo = degradeDaMarca(MARCA_CLIENTE, 'fundo');
    expect(fundo.paradas[0].cor).toBe('#171A19');
    expect(fundo.angulo).toBe(180);
  });

  it('o kit da imagem é o da cor de fundo dela; sem nenhum, o primeiro', () => {
    expect(kitDaImagem({fundo: '#101826'}, MARCAS_INICIAIS)?.id).toBe(MARCA_BKM.id);
    expect(kitDaImagem({fundo: '#171a19'}, MARCAS_INICIAIS)?.id).toBe('cliente');
    expect(kitDaImagem({fundo: '#123456'}, MARCAS_INICIAIS)?.id).toBe(MARCAS_INICIAIS[0].id);
  });
});

describe('achar a camada (MCP)', () => {
  it('pelo id em qualquer página ou pelo caminho', () => {
    const carrossel: DocImagem = {formato: 1, largura: 1080, altura: 1350, fundo: '#000', camadas: [],
      paginas: [{id: 'p1', nome: 'Capa', camadas: [camada('titulo', 'texto')]}, {id: 'p2', nome: 'Dois', camadas: [camada('foto', 'imagem'), camada('x', 'forma')]}]};
    expect(acharCamada(carrossel, 'foto')).toMatchObject({caminho: '/paginas/1/camadas/0'});
    expect(acharCamada(carrossel, '/paginas/1/camadas/1')?.c.id).toBe('x');
    expect(acharCamada(carrossel, '/camadas/0')).toBeNull();
    expect(acharCamada(capa(), 'logo')).toMatchObject({caminho: '/camadas/4'});
    expect(acharCamada(capa(), 'nada')).toBeNull();
  });
});
