// Ferramentas da Marca no MCP (rodada 3): ver o kit, pôr uma cor e uma fonte do kit por referência. A lógica fica em
// funções puras de src/nucleo/mcp-marca.ts; o servidor de verdade é chamado em testes/mcp.test.ts.
import jsonpatch, {type Operation} from 'fast-json-patch';
import {describe, expect, it} from 'vitest';
import {docCarrossel} from '../src/nucleo/carrossel';
import {resolverMarcaNoDoc} from '../src/nucleo/cor-marca';
import {novoDocImagem} from '../src/nucleo/criar-projeto';
import type {DocImagem, OperacaoPatch} from '../src/nucleo/documentos';
import {marcaDoKit, patchDaMarca} from '../src/nucleo/marca';
import {KIT_ESCRITORIO} from './fixtures/kit-escritorio';
import {KIT_TESTE} from './fixtures/kit-teste';
import {descreverMarca, patchCorDaMarca, patchFonteDaMarca, referenciaDeCor} from '../src/nucleo/mcp-marca';
import {novoDocCenas} from '../src/nucleo/cenas';

const aplicar = (doc: DocImagem, patch: OperacaoPatch[]): DocImagem => jsonpatch.applyPatch(structuredClone(doc), patch as Operation[], true, false).newDocument;
const carrossel = () => docCarrossel({largura: 1080, altura: 1350, paginas: 3, marca: marcaDoKit(KIT_ESCRITORIO)});

describe('MCP da marca: cor_da_marca', () => {
  it('põe a referência no campo certo da camada e diz a cor e os avisos', () => {
    const doc = carrossel();
    const faixa = patchCorDaMarca(doc, '/paginas/0/camadas/0', 'preenchimento', 'suave');
    expect(faixa.patch).toEqual([{op: 'replace', path: '/paginas/0/camadas/0/preenchimento', value: '@suave'}]);
    expect(faixa).toMatchObject({valor: '@suave', cor: '#A5ADBA', camada: '/paginas/0/camadas/0', avisos: []});
    expect(aplicar(doc, faixa.patch).paginas![0].camadas[0].preenchimento).toBe('@suave');

    const variacao = patchCorDaMarca(doc, '/paginas/0/camadas/0', 'preenchimento', '@destaque+35');
    expect(variacao.valor).toBe('@destaque+35');
    expect(variacao.cor).toBe('#DCC798'); // o destaque do kit do escritório (#C9A961) 35% em direção ao branco

    // a cor do texto sobre o fundo: o suave do kit no fundo do kit lê bem; o fundo no fundo, não
    expect(patchCorDaMarca(doc, '/paginas/0/camadas/1', 'cor', 'texto').avisos).toEqual([]);
    expect(patchCorDaMarca(doc, '/paginas/0/camadas/1', 'cor', 'fundo').avisos[0]).toMatch(/1,0:1/);
  });

  it('contorno e sombra pedem que a camada já tenha; o fundo da peça não pede camada', () => {
    const doc = carrossel();
    expect(() => patchCorDaMarca(doc, '/paginas/0/camadas/0', 'contorno', 'destaque')).toThrow(/não tem contorno/);
    doc.paginas![0].camadas[0].contorno = {espessura: 4};
    expect(patchCorDaMarca(doc, '/paginas/0/camadas/0', 'contorno', 'destaque').patch).toEqual([{op: 'add', path: '/paginas/0/camadas/0/contorno/cor', value: '@destaque'}]);
    expect(patchCorDaMarca(doc, undefined, 'fundo', 'suave').patch).toEqual([{op: 'replace', path: '/fundo', value: '@suave'}]);
    expect(() => patchCorDaMarca(doc, undefined, 'cor', 'texto')).toThrow(/pede a camada/);
  });

  it('recusa campo de outro tipo de camada, nome que o kit não tem e id repetido', () => {
    const doc = carrossel();
    expect(() => patchCorDaMarca(doc, '/paginas/0/camadas/0', 'cor', 'texto')).toThrow(/é forma/);
    expect(() => patchCorDaMarca(doc, '/paginas/0/camadas/1', 'preenchimento', 'texto')).toThrow(/é texto/);
    expect(() => patchCorDaMarca(doc, '/paginas/0/camadas/0', 'preenchimento', 'cobre')).toThrow(/o kit não tem a cor "cobre": fundo, texto, destaque, suave/);
    expect(() => patchCorDaMarca(doc, 'ghost', 'cor', 'texto')).toThrow(/não achada/);
    expect(() => patchCorDaMarca(doc, 'faixa', 'preenchimento', 'destaque')).toThrow(/está em 3 camadas/); // a faixa está em todas as páginas
    expect(() => referenciaDeCor('azul ceu', KIT_TESTE)).toThrow(/não é uma cor do kit/);
    expect(referenciaDeCor('terracotaEscura', KIT_TESTE)).toBe('@terracotaEscura');
  });

  it('sem kit na imagem, usa o neutro e avisa', () => {
    const doc: DocImagem = {...novoDocImagem(1080, 1080), camadas: [{id: 't', nome: 'T', tipo: 'texto', x: 0, y: 0, largura: 10, altura: 10, texto: 'a'}]};
    const r = patchCorDaMarca(doc, 't', 'cor', 'destaque');
    expect(r.avisos[0]).toMatch(/ainda não tem kit/);
    expect(r.cor).toBe('#FFFFFF');
  });
});

describe('MCP da marca: fonte_da_marca e ver_marca', () => {
  it('põe a fonte do kit no texto, por referência', () => {
    const doc = carrossel();
    const r = patchFonteDaMarca(doc, '/paginas/0/camadas/1', 'mono');
    expect(r.patch).toEqual([{op: 'replace', path: '/paginas/0/camadas/1/fonte', value: '@mono'}]);
    expect(r.fonte).toBe('Inter'); // o kit do escritório não tem mono: a de texto
    const kit = aplicar(doc, patchDaMarca(doc, KIT_TESTE));
    expect(resolverMarcaNoDoc(aplicar(kit, patchFonteDaMarca(kit, '/paginas/0/camadas/1', 'mono').patch)).paginas![0].camadas[1].fonte).toBe('IBM Plex Mono');
    expect(() => patchFonteDaMarca(doc, '/paginas/0/camadas/0', 'titulo')).toThrow(/é forma/);
  });

  it('ver_marca lista os nomes que cor_da_marca aceita', () => {
    const d = descreverMarca(carrossel()) as {kit: string; cores: {nome: string; referencia: string}[]; fontes: {titulo: string}};
    expect(d.kit).toBe('escritorio');
    expect(d.cores.map((c) => c.referencia)).toEqual(['@fundo', '@texto', '@destaque', '@suave']);
    expect(d.fontes.titulo).toBe('Inter');
    expect((descreverMarca(novoDocImagem(10, 10)) as {kit: null; aviso: string}).kit).toBeNull();
    expect(descreverMarca(novoDocCenas({largura: 1080, altura: 1920, fps: 30})).kit).toBeNull();
    expect((descreverMarca({formato: 1, objetos: []}) as {aviso: string}).aviso).toMatch(/não recebe kit/);
  });
});
