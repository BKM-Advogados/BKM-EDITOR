// Listas com marcadores e numeradas na imagem (rodada 3, frente Marca): um item por linha, marcador na margem e recuo
// pendente. A conta (quebra, recuo, numeração, alinhamento) é pura e a pintura em canvas, a mesma da prévia, do PNG e do
// PDF, a usa: aqui ela roda com uma medida falsa (10 px por letra). O desenho de verdade é conferido na prévia web.
import jsonpatch, {type Operation} from 'fast-json-patch';
import {describe, expect, it} from 'vitest';
import {temAcabamento} from '../src/nucleo/acabamento';
import {docCarrossel} from '../src/nucleo/carrossel';
import {novoDocImagem} from '../src/nucleo/criar-projeto';
import type {CamadaImagem, DocImagem, OperacaoPatch} from '../src/nucleo/documentos';
import {layoutDeLista, MARCADOR_PADRAO, marcadorDe, recuoDaLista, temLista} from '../src/nucleo/lista';
import {marcaDoKit} from '../src/nucleo/marca';
import {KIT_ESCRITORIO} from './fixtures/kit-escritorio';
import {patchLista} from '../src/nucleo/mcp-marca';

const medir = (t: string) => t.length * 10;
/** A quebra por palavra da pintura, com a medida falsa: o que cabe na largura fica na linha. */
const quebrar = (texto: string, largura: number) => {
  const linhas: string[] = [];
  let linha = '';
  for (const palavra of texto.split(' ')) {
    const tentativa = linha ? `${linha} ${palavra}` : palavra;
    if (medir(tentativa) <= largura) linha = tentativa;
    else {
      if (linha) linhas.push(linha);
      linha = palavra;
    }
  }
  linhas.push(linha);
  return linhas;
};
const texto = (extra: Partial<CamadaImagem>): CamadaImagem => ({id: 't', nome: 't', tipo: 'texto', x: 0, y: 0, largura: 300, altura: 200, tamanho: 20, ...extra});
const aplicar = (doc: DocImagem, patch: OperacaoPatch[]): DocImagem => jsonpatch.applyPatch(structuredClone(doc), patch as Operation[], true, false).newDocument;

describe('regras da lista', () => {
  it('só camada de texto com lista válida é lista, e vai sempre pelo canvas', () => {
    expect(temLista(texto({lista: 'marcadores'}))).toBe(true);
    expect(temLista(texto({lista: 'numerada'}))).toBe(true);
    expect(temLista(texto({}))).toBe(false);
    expect(temLista(texto({lista: 'outra' as never}))).toBe(false);
    expect(temLista({...texto({lista: 'marcadores'}), tipo: 'forma'})).toBe(false);
    expect(temAcabamento(texto({lista: 'marcadores'}))).toBe(true);
    expect(temAcabamento(texto({}))).toBe(false); // o texto livre segue em DOM
  });

  it('marcador: o padrão, o da pessoa (até 4 letras) e a numeração', () => {
    expect(marcadorDe({lista: 'marcadores'}, 1)).toBe('•');
    expect(marcadorDe({lista: 'marcadores', lista_marcador: '→'}, 3)).toBe('→');
    expect(marcadorDe({lista: 'marcadores', lista_marcador: '  '}, 1)).toBe(MARCADOR_PADRAO);
    expect(marcadorDe({lista: 'marcadores', lista_marcador: 'abcdefg'}, 1)).toBe('abcd');
    expect(marcadorDe({lista: 'numerada'}, 1)).toBe('1.');
    expect(marcadorDe({lista: 'numerada', lista_marcador: '→'}, 12)).toBe('12.');
  });

  it('recuo: o da camada ou o maior marcador mais 40% da letra', () => {
    expect(recuoDaLista({lista_recuo: 50, tamanho: 20}, 30)).toBe(50);
    expect(recuoDaLista({tamanho: 20}, 30)).toBe(38); // 30 + 8
    expect(recuoDaLista({}, 10, 100)).toBe(50);
    expect(recuoDaLista({lista_recuo: -4, tamanho: 20}, 30)).toBe(38); // negativo vale como automático
  });
});

describe('layout: marcador na margem e recuo pendente', () => {
  it('um item por linha; o texto e o que ele quebra começam no recuo; só a primeira linha leva o marcador', () => {
    const c = texto({lista: 'marcadores', largura: 200, texto: 'um\ndois três quatro cinco seis\nsete'});
    const l = layoutDeLista(c, medir, quebrar);
    expect(l.recuo).toBe(18); // o marcador tem 10 px de largura; mais 40% de 20 (8)
    // a coluna tem 200 - 18 = 182 px: "dois três quatro cinco" (22 letras, 220 px) não cabe, então quebra
    expect(l.linhas).toEqual(['um', 'dois três quatro', 'cinco seis', 'sete']);
    expect(l.marcas).toEqual(['•', '•', null, '•']);
    expect(l.x).toEqual([18, 18, 18, 18]);
    expect(l.linhas.every((linha) => medir(linha) <= 182)).toBe(true);
  });

  it('a numerada conta só os itens com texto e dá mais recuo ao marcador maior (10.)', () => {
    const itens = Array.from({length: 10}, (_, i) => `item ${i + 1}`).join('\n');
    const l = layoutDeLista(texto({lista: 'numerada', texto: `${itens}\n\nfim`}), medir, quebrar);
    expect(l.marcas.filter(Boolean)).toEqual(['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.', '9.', '10.', '11.']);
    expect(l.recuo).toBe(30 + 8); // "10." tem 3 letras
    // a linha em branco entre os itens fica em branco e não gasta número
    expect(l.linhas[10]).toBe('');
    expect(l.marcas[10]).toBeNull();
  });

  it('o recuo da camada manda; o alinhamento vale dentro da coluna (centro no meio dela, direita na borda)', () => {
    const base = {lista: 'marcadores' as const, largura: 200, lista_recuo: 40, texto: 'a'};
    expect(layoutDeLista(texto(base), medir, quebrar).x).toEqual([40]);
    expect(layoutDeLista(texto({...base, alinhar: 'centro'}), medir, quebrar).x).toEqual([40 + 160 / 2]);
    expect(layoutDeLista(texto({...base, alinhar: 'direita'}), medir, quebrar).x).toEqual([200]);
  });

  it('o mesmo texto quebra igual em qualquer chamada: prévia, PNG e PDF usam esta conta', () => {
    const c = texto({lista: 'numerada', largura: 180, texto: 'primeiro item bem comprido que quebra\nsegundo'});
    expect(layoutDeLista(c, medir, quebrar)).toEqual(layoutDeLista({...c}, medir, quebrar));
    // palavra que não cabe na coluna fica na linha dela, como no texto livre (a pintura parte por letra)
    expect(layoutDeLista(texto({lista: 'marcadores', largura: 60, texto: 'supercalifragilistico'}), medir, quebrar).linhas).toEqual(['supercalifragilistico']);
    expect(layoutDeLista(texto({lista: 'marcadores', texto: ''}), medir, quebrar).linhas).toEqual(['']);
  });
});

describe('MCP: fazer_lista', () => {
  const doc = () => {
    const d = docCarrossel({largura: 1080, altura: 1350, paginas: 3, marca: marcaDoKit(KIT_ESCRITORIO)});
    d.paginas![1].camadas.find((c) => c.id === 'texto')!.texto = 'Primeiro ponto\nSegundo ponto';
    return d;
  };
  const alvo = '/paginas/1/camadas/2';

  it('liga a lista com marcadores, com marcador e recuo, e desliga', () => {
    const d = doc();
    const r = patchLista(d, {camada: alvo, tipo: 'marcadores', marcador: '→', recuo: 40});
    expect(r.patch).toEqual([{op: 'add', path: `${alvo}/lista`, value: 'marcadores'}, {op: 'add', path: `${alvo}/lista_marcador`, value: '→'}, {op: 'add', path: `${alvo}/lista_recuo`, value: 40}]);
    expect(r.avisos).toEqual([]);
    const ligada = aplicar(d, r.patch);
    expect(ligada.paginas![1].camadas[2]).toMatchObject({lista: 'marcadores', lista_marcador: '→', lista_recuo: 40});
    // trocar para numerada leva o marcador e troca o tipo; "nenhuma" tira tudo
    const num = patchLista(ligada, {camada: alvo, tipo: 'numerada'});
    expect(num.patch).toEqual([{op: 'replace', path: `${alvo}/lista`, value: 'numerada'}, {op: 'remove', path: `${alvo}/lista_marcador`}, {op: 'remove', path: `${alvo}/lista_recuo`}]);
    const livre = aplicar(ligada, patchLista(ligada, {camada: alvo, tipo: 'nenhuma'}).patch);
    expect(livre.paginas![1].camadas[2]).not.toHaveProperty('lista');
    expect(livre.paginas![1].camadas[2]).not.toHaveProperty('lista_marcador');
    expect(livre.paginas![1].camadas[2]).not.toHaveProperty('lista_recuo');
    expect(patchLista(d, {camada: alvo, tipo: 'nenhuma'}).patch).toEqual([]); // nada a mudar
  });

  it('o marcador padrão não se grava; avisa texto de uma linha só e marcador na numerada; recusa o que não é texto', () => {
    const d = doc();
    expect(patchLista(d, {camada: alvo, tipo: 'marcadores', marcador: '•'}).patch).toEqual([{op: 'add', path: `${alvo}/lista`, value: 'marcadores'}]);
    const uma = doc();
    uma.paginas![1].camadas[2].texto = 'Uma linha só';
    expect(patchLista(uma, {camada: alvo, tipo: 'marcadores'}).avisos[0]).toMatch(/uma linha só/);
    expect(patchLista(d, {camada: alvo, tipo: 'numerada', marcador: '→'}).avisos[0]).toMatch(/só vale na lista com marcadores/);
    expect(() => patchLista(d, {camada: '/paginas/1/camadas/0', tipo: 'marcadores'})).toThrow(/é forma/);
    expect(() => patchLista(d, {camada: alvo, tipo: 'marcadores', recuo: -3})).toThrow(/negativo/);
    expect(() => patchLista(novoDocImagem(10, 10), {camada: 'nao-existe', tipo: 'marcadores'})).toThrow(/não achada/);
  });
});
