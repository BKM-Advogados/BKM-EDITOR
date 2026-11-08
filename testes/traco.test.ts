// Traçado (rodada 3, frente Marca): tracejado, pontilhado, pontas e junções do contorno, e a forma "linha" com setas que
// acompanha o ângulo. As regras e a geometria são puras e as usa a pintura em canvas, a mesma da prévia e do PNG; o
// desenho de verdade é conferido na prévia web. Ver docs/marca.md.
import jsonpatch, {type Operation} from 'fast-json-patch';
import {describe, expect, it} from 'vitest';
import {caixaPintada, contornoDe, ehLinha, ehVetorial, temAcabamento, tracoDe, tracoParaCanvas} from '../src/nucleo/acabamento';
import {docCarrossel} from '../src/nucleo/carrossel';
import {novoDocImagem} from '../src/nucleo/criar-projeto';
import type {CamadaImagem, DocImagem, OperacaoPatch} from '../src/nucleo/documentos';
import {folgaDaLinha, formaDaCabeca, geometriaDaLinha, linhaDaPredefinicao, linhaDe, linhaNova, PREDEFINICOES_LINHA} from '../src/nucleo/linha';
import {MARCA_BKM, marcaDoKit} from '../src/nucleo/marca';
import {patchInserirLinha} from '../src/nucleo/mcp-marca';

const aplicar = (doc: DocImagem, patch: OperacaoPatch[]): DocImagem => jsonpatch.applyPatch(structuredClone(doc), patch as Operation[], true, false).newDocument;
const camada = (extra: Partial<CamadaImagem>): CamadaImagem => ({id: 'x', nome: 'x', tipo: 'forma', x: 0, y: 0, largura: 100, altura: 40, ...extra});

describe('estilo, pontas e junção do traço', () => {
  it('sem dizer nada é sólido, de pontas e junção redondas (o contorno de sempre)', () => {
    expect(tracoDe({})).toEqual({estilo: 'solido', pontas: 'redonda', juncao: 'redonda'});
    expect(tracoDe({estilo: 'tracejado', pontas: 'reta', juncao: 'pontuda'})).toEqual({estilo: 'tracejado', pontas: 'reta', juncao: 'pontuda'});
    expect(tracoDe({estilo: 'xis', pontas: 7, juncao: null})).toEqual({estilo: 'solido', pontas: 'redonda', juncao: 'redonda'}); // fora do lugar volta ao padrão
    expect(tracoParaCanvas({}, 6)).toEqual({dash: [], cap: 'round', join: 'round', miterLimit: 4});
    expect(contornoDe(camada({contorno: {espessura: 4, estilo: 'pontilhado', juncao: 'chanfrada'}}))).toMatchObject({estilo: 'pontilhado', pontas: 'redonda', juncao: 'chanfrada'});
  });

  it('o canvas recebe a ponta e a junção que a camada pede', () => {
    expect(tracoParaCanvas({pontas: 'reta', juncao: 'pontuda'}, 4)).toMatchObject({cap: 'butt', join: 'miter'});
    expect(tracoParaCanvas({pontas: 'quadrada', juncao: 'chanfrada'}, 4)).toMatchObject({cap: 'square', join: 'bevel'});
  });

  it('tracejado: tracinhos de 3 espessuras e vãos de 2; pontilhado: pontos de 1 com vãos de 1; igual nas três pontas', () => {
    const k = 6;
    for (const pontas of ['reta', 'redonda', 'quadrada'] as const) {
      const mais = pontas === 'reta' ? 0 : k; // a ponta redonda e a quadrada aumentam o tracinho de meia espessura de cada lado
      const tracejado = tracoParaCanvas({estilo: 'tracejado', pontas}, k).dash;
      expect(tracejado[0] + mais, pontas).toBeCloseTo(3 * k, 6); // o que se vê: 3 espessuras
      expect(tracejado[1] - mais, pontas).toBeCloseTo(2 * k, 6); // o vão que se vê: 2 espessuras
      const pontilhado = tracoParaCanvas({estilo: 'pontilhado', pontas}, k).dash;
      expect(pontilhado[0] + mais, pontas).toBeCloseTo(k, 1); // ponta redonda: o ponto de 0,01 (nunca zero) e a ponta fazem o círculo
      expect(pontilhado[1] - mais, pontas).toBeCloseTo(k, 6);
    }
    // ponto redondo: tracinho quase zero com ponta redonda vira um círculo de diâmetro = espessura
    expect(tracoParaCanvas({estilo: 'pontilhado', pontas: 'redonda'}, k).dash[0]).toBeCloseTo(0.01, 6);
    expect(tracoParaCanvas({estilo: 'pontilhado', pontas: 'reta'}, k).dash).toEqual([k, k]);
  });

  it('no contorno por fora a linha é desenhada com o dobro da espessura: a ponta cresce por esse dobro, o desenho se mede pela espessura', () => {
    const e = 5;
    const t = tracoParaCanvas({estilo: 'tracejado', pontas: 'redonda'}, e, 2 * e);
    expect(t.dash[0] + 2 * e).toBeCloseTo(3 * e, 6);
    expect(t.dash[1] - 2 * e).toBeCloseTo(2 * e, 6);
    expect(Math.min(...tracoParaCanvas({estilo: 'tracejado', pontas: 'redonda'}, 1, 2).dash)).toBeGreaterThan(0); // nunca zero ou negativo
  });
});

describe('linha e seta', () => {
  it('os padrões: 6 px, sólida, sem pontas de seta, seta de 4 espessuras (14 no mínimo)', () => {
    expect(linhaDe({})).toEqual({espessura: 6, estilo: 'solido', pontas: 'redonda', juncao: 'redonda', inicio: 'nenhuma', fim: 'nenhuma', tamanho: 24});
    expect(linhaDe({linha: {espessura: 2}}).tamanho).toBe(14);
    expect(linhaDe({linha: {fim: 'triangulo', inicio: 'xis' as never, espessura: -3, tamanho_seta: 40}})).toMatchObject({fim: 'triangulo', inicio: 'nenhuma', espessura: 0.5, tamanho: 40});
    expect(ehLinha(camada({forma: 'linha'}))).toBe(true);
    expect(ehLinha(camada({forma: 'elipse'}))).toBe(false);
    expect(ehVetorial(camada({forma: 'linha'}))).toBe(true);
    expect(temAcabamento(camada({forma: 'linha'}))).toBe(true); // sempre pelo canvas
  });

  it('a geometria: o traço vai de ponta a ponta no meio da altura e para antes do triângulo, do losango e do círculo', () => {
    const base = {largura: 200, altura: 40};
    expect(geometriaDaLinha({...base})).toMatchObject({x0: 0, x1: 200, y: 20, cabecas: []});
    const triangulo = geometriaDaLinha({...base, linha: {fim: 'triangulo', tamanho_seta: 30}});
    expect(triangulo).toMatchObject({x0: 0, x1: 170});
    expect(triangulo.cabecas).toEqual([{tipo: 'triangulo', x: 200, y: 20, sentido: 1, tamanho: 30}]);
    expect(geometriaDaLinha({...base, linha: {inicio: 'losango', fim: 'circulo', tamanho_seta: 20}})).toMatchObject({x0: 10, x1: 190});
    expect(geometriaDaLinha({...base, linha: {inicio: 'seta', fim: 'barra'}})).toMatchObject({x0: 0, x1: 200}); // aberta e barra não cobrem o traço
    expect(geometriaDaLinha({...base, linha: {inicio: 'triangulo', fim: 'triangulo'}}).cabecas.map((h) => [h.x, h.sentido])).toEqual([[0, -1], [200, 1]]);
    // mais curta que as pontas: o traço some, ficam as pontas
    const curta = geometriaDaLinha({largura: 20, altura: 40, linha: {inicio: 'triangulo', fim: 'triangulo', tamanho_seta: 30}});
    expect(curta.x1).toBeLessThanOrEqual(curta.x0);
    expect(curta.cabecas).toHaveLength(2);
  });

  it('cada ponta tem a sua forma, apontando para fora (a do início, para a esquerda)', () => {
    const fim = {x: 100, y: 20, sentido: 1 as const, tamanho: 20};
    expect(formaDaCabeca({...fim, tipo: 'triangulo'})).toEqual({poligono: [[100, 20], [80, 10], [80, 30]]});
    expect(formaDaCabeca({...fim, tipo: 'circulo'})).toEqual({circulo: {x: 90, y: 20, r: 10}});
    expect(formaDaCabeca({...fim, tipo: 'barra'})).toEqual({abertos: [[[100, 10], [100, 30]]]});
    const aberta = formaDaCabeca({...fim, tipo: 'seta'}).abertos![0];
    expect(aberta[1]).toEqual([100, 20]); // o bico no fim da linha
    expect(aberta[0][0]).toBeLessThan(100);
    expect(formaDaCabeca({...fim, tipo: 'losango'}).poligono).toHaveLength(4);
    const inicio = formaDaCabeca({tipo: 'triangulo', x: 0, y: 20, sentido: -1, tamanho: 20});
    expect(inicio.poligono![0]).toEqual([0, 20]);
    expect(inicio.poligono![1][0]).toBe(20); // a base fica para dentro da linha
  });

  it('a seta acompanha o ângulo: a caixa tem o comprimento do segmento e o giro é o ângulo, de qualquer ponto a qualquer ponto', () => {
    const pontas = (c: Omit<CamadaImagem, 'id'>) => {
      const cx = c.x + c.largura / 2;
      const cy = c.y + c.altura / 2;
      const t = ((c.rotacao ?? 0) * Math.PI) / 180;
      const m = c.largura / 2;
      return [[cx - m * Math.cos(t), cy - m * Math.sin(t)], [cx + m * Math.cos(t), cy + m * Math.sin(t)]];
    };
    for (const [x1, y1, x2, y2] of [[10, 20, 110, 80], [300, 300, 100, 100], [50, 50, 50, 250], [200, 90, 20, 90], [0, 0, 400, 0], [500, 40, 530, 10]]) {
      const c = linhaNova({x1, y1, x2, y2, fim: 'triangulo'});
      const [a, b] = pontas(c);
      expect(a[0]).toBeCloseTo(x1, -0.3); // dentro de 1 px (a posição é arredondada)
      expect(a[1]).toBeCloseTo(y1, -0.3);
      expect(b[0]).toBeCloseTo(x2, -0.3);
      expect(b[1]).toBeCloseTo(y2, -0.3);
      expect(c.largura).toBe(Math.round(Math.hypot(x2 - x1, y2 - y1)));
    }
    expect(linhaNova({x1: 0, y1: 0, x2: 100, y2: 100}).rotacao).toBe(45);
    expect(linhaNova({x1: 0, y1: 0, x2: 0, y2: 100}).rotacao).toBe(90);
    expect(linhaNova({x1: 100, y1: 0, x2: 0, y2: 0}).rotacao).toBe(180);
    expect(linhaNova({x1: 0, y1: 0, x2: 100, y2: 0}).rotacao).toBeUndefined(); // horizontal, para a direita: sem giro
    expect(linhaNova({x1: 5, y1: 5, x2: 5, y2: 5}).largura).toBe(2); // o mesmo ponto: 2 px
  });

  it('só guarda no documento o que difere do padrão; nome de seta ou de linha; cor do kit por referência', () => {
    expect(linhaNova({x1: 0, y1: 0, x2: 50, y2: 0})).toMatchObject({nome: 'Linha', forma: 'linha', preenchimento: '@destaque', linha: {}});
    const seta = linhaNova({x1: 0, y1: 0, x2: 50, y2: 0, fim: 'triangulo', estilo: 'tracejado', espessura: 3, pontas: 'redonda', juncao: 'pontuda'});
    expect(seta).toMatchObject({nome: 'Seta', linha: {fim: 'triangulo', estilo: 'tracejado', espessura: 3, juncao: 'pontuda'}});
    expect(seta.linha).not.toHaveProperty('pontas'); // redonda é o padrão
    expect(linhaNova({x1: 0, y1: 0, x2: 50, y2: 0, cor: '#112233'}).preenchimento).toBe('#112233');
  });

  it('as predefinições do botão: horizontais, de 40% da largura, no centro; todas existem', () => {
    const doc = novoDocImagem(1080, 1350);
    expect(PREDEFINICOES_LINHA.length).toBeGreaterThanOrEqual(6);
    for (const p of PREDEFINICOES_LINHA) {
      const c = linhaDaPredefinicao(doc, p.id)!;
      expect(c, p.id).toMatchObject({forma: 'linha', largura: 432, x: 324});
      expect(c.rotacao).toBeUndefined();
      expect(c.y + c.altura / 2, p.id).toBeCloseTo(675, -0.3); // dentro de 1 px (a caixa é arredondada)
    }
    expect(linhaDaPredefinicao(doc, 'seta-dupla')!.linha).toMatchObject({inicio: 'triangulo', fim: 'triangulo'});
    expect(linhaDaPredefinicao(doc, 'tracejada')!.linha).toMatchObject({estilo: 'tracejado'});
    expect(linhaDaPredefinicao(doc, 'nao-existe')).toBeNull();
  });

  it('a pintura ocupa mais que a caixa: a ponta e a seta passam dela, e a caixa pintada gira junto', () => {
    const c = camada({forma: 'linha', largura: 100, altura: 20, linha: {fim: 'triangulo', tamanho_seta: 30}});
    const folga = folgaDaLinha(c);
    expect(folga.esq).toBeGreaterThanOrEqual(30);
    const pintada = caixaPintada(c, folga);
    expect(pintada.w).toBe(100 + 2 * folga.esq);
    expect(pintada.h).toBe(20 + 2 * folga.cima);
    const girada = caixaPintada({...c, rotacao: 90}, folga);
    expect(girada.w).toBeCloseTo(pintada.h, 6);
    expect(girada.h).toBeCloseTo(pintada.w, 6);
  });
});

describe('MCP: inserir_linha', () => {
  const carrossel = () => docCarrossel({largura: 1080, altura: 1350, paginas: 3, marca: marcaDoKit(MARCA_BKM)});

  it('põe a linha na página, com o ângulo em rotacao e a cor do kit', () => {
    const doc = carrossel();
    const r = patchInserirLinha(doc, {x1: 100, y1: 200, x2: 400, y2: 500, fim: 'triangulo'});
    expect(r.patch[0]).toMatchObject({op: 'add', path: '/paginas/0/camadas/-'});
    expect(r).toMatchObject({id: 'seta-1', pagina: 'capa', rotacao: 45, avisos: []});
    const depois = aplicar(doc, r.patch);
    const nova = depois.paginas![0].camadas.at(-1)!;
    expect(nova).toMatchObject({forma: 'linha', preenchimento: '@destaque', rotacao: 45, linha: {fim: 'triangulo'}});
    expect(patchInserirLinha(depois, {x1: 0, y1: 0, x2: 10, y2: 0}).id).toBe('linha-1');
    expect(patchInserirLinha(depois, {x1: 0, y1: 0, x2: 10, y2: 0, fim: 'seta'}).id).toBe('seta-2');
  });

  it('página, cor do kit ou hexadecimal; recusa página e cor que não existem; avisa sem kit e ponto repetido', () => {
    const doc = carrossel();
    const r = patchInserirLinha(doc, {x1: 0, y1: 0, x2: 100, y2: 0, pagina: 'final', cor: 'suave', estilo: 'pontilhado'});
    expect((r.patch[0] as {path: string}).path).toBe('/paginas/2/camadas/-');
    expect((r.patch[0] as unknown as {value: CamadaImagem}).value).toMatchObject({preenchimento: '@suave', linha: {estilo: 'pontilhado'}});
    expect(() => patchInserirLinha(doc, {x1: 0, y1: 0, x2: 1, y2: 1, pagina: 'nao'})).toThrow(/página não achada/);
    expect(() => patchInserirLinha(doc, {x1: 0, y1: 0, x2: 1, y2: 1, cor: 'cobre'})).toThrow(/o kit não tem a cor "cobre"/);
    expect(patchInserirLinha(novoDocImagem(100, 100), {x1: 0, y1: 0, x2: 50, y2: 0}).avisos[0]).toMatch(/ainda não tem kit/);
    expect(patchInserirLinha(doc, {x1: 5, y1: 5, x2: 5, y2: 5}).avisos[0]).toMatch(/o mesmo/);
  });
});
