// Rodada 3, frente C: a cena 3D é lida com validação (tres-efeitos-D12). Um campo com o tipo errado, escrito à mão ou pela IA,
// não derruba a janela: a tela desenha a cena corrigida e o inspetor avisa o que estava fora do lugar.
import {describe, expect, it} from 'vitest';
import {INTENSIDADE_PADRAO_LUZ, lerCena3d, novoDoc3d} from '../src/nucleo/cena3d';

describe('cena 3D lida com validação', () => {
  const boa = {
    formato: 1, fundo: '#101010', camera: {posicao: [4, 3, 6], alvo: [0, 0, 0], fov: 40},
    luzes: [{id: 'sol', tipo: 'direcional', cor: '#ffffff', intensidade: 1.6, posicao: [3, 5, 3]}, {id: 'amb', tipo: 'ambiente', cor: '#ffffff', intensidade: 0.4}],
    objetos: [{id: 'caixa', nome: 'Caixa', tipo: 'caixa', posicao: [0, 0.5, 0], rotacao: [0, 30, 0], escala: [1, 1, 1], cor: '#C88155', metalico: 0.2, rugosidade: 0.6}],
  };

  it('uma cena certa sai igual e sem problemas', () => {
    const r = lerCena3d(boa);
    expect(r.problemas).toEqual([]);
    expect(r.doc).toEqual(boa);
  });

  it('intensidade em texto e posição como objeto não derrubam: viram número e padrão, com o caminho do que mudou (D12)', () => {
    const r = lerCena3d({
      ...boa,
      luzes: [{id: 'sol', tipo: 'direcional', cor: '#fff', intensidade: '2', posicao: {x: 1}}],
      objetos: [{id: 'caixa', tipo: 'caixa', posicao: {x: 1, y: 2}, rotacao: 'zero', escala: [1, 'dois', 1], cor: 7, metalico: 'alto', rugosidade: 9}],
    });
    expect(r.doc.luzes[0]).toMatchObject({intensidade: 2, posicao: [3, 5, 3]});
    expect(r.doc.objetos[0]).toMatchObject({posicao: [0, 0, 0], rotacao: [0, 0, 0], escala: [1, 1, 1], cor: '#808080', nome: 'caixa', rugosidade: 1});
    expect(r.doc.objetos[0].metalico).toBeUndefined();
    const caminhos = r.problemas.map((p) => p.caminho);
    expect(caminhos).toEqual(expect.arrayContaining(['/luzes/0/intensidade', '/luzes/0/posicao', '/objetos/0/posicao', '/objetos/0/rotacao', '/objetos/0/escala',
      '/objetos/0/cor', '/objetos/0/metalico', '/objetos/0/rugosidade']));
    // o valor que o "Corrigir" grava é o que a tela passou a usar
    expect(r.problemas.find((p) => p.caminho === '/luzes/0/intensidade')?.valor).toBe(2);
    expect(r.problemas.find((p) => p.caminho === '/objetos/0/posicao')?.valor).toEqual([0, 0, 0]);
  });

  it('tipo que não existe, item que não é objeto e lista que não é lista: sempre uma cena desenhável, com as listas do mesmo tamanho', () => {
    const r = lerCena3d({objetos: [null, {id: 'x', tipo: 'pirâmide'}, 'caixa'], luzes: [{tipo: 'laser'}, 3], camera: {posicao: 'perto', fov: 400}, fundo: 12});
    expect(r.doc.objetos.map((o) => [o.id, o.tipo])).toEqual([['objeto-1', 'caixa'], ['x', 'caixa'], ['objeto-3', 'caixa']]);
    expect(r.doc.luzes.map((l) => [l.id, l.tipo])).toEqual([['luz-1', 'ambiente'], ['luz-2', 'ambiente']]);
    expect(r.doc.camera).toEqual({posicao: [4, 3, 6], alvo: [0, 0, 0], fov: 179});
    expect(r.doc.fundo).toBe('#000000');
    expect(lerCena3d(null).doc).toEqual({formato: 1, fundo: '#000000', luzes: [], objetos: []});
    expect(lerCena3d({objetos: 'nenhum'}).doc.objetos).toEqual([]);
    expect(r.problemas.length).toBeGreaterThan(6);
  });

  it('uma cena sem câmera continua sem câmera (a vista padrão é do motor)', () => {
    expect(lerCena3d({...boa, camera: undefined}).doc.camera).toBeUndefined();
  });
});

describe('rodada 3: id repetido, intensidade por tipo de luz e cena nova', () => {
  it('objeto com id repetido ganha id novo, aparece na cena e o aviso leva o id para o Corrigir (tres-efeitos-D11)', () => {
    const r = lerCena3d({objetos: [
      {id: 'caixa', nome: 'Caixa', tipo: 'caixa', posicao: [0, 0, 0], rotacao: [0, 0, 0], escala: [1, 1, 1], cor: '#fff'},
      {id: 'caixa', nome: 'Caixa', tipo: 'caixa', posicao: [2, 0, 0], rotacao: [0, 0, 0], escala: [1, 1, 1], cor: '#fff'},
      {id: 'caixa', nome: 'Caixa', tipo: 'caixa', posicao: [4, 0, 0], rotacao: [0, 0, 0], escala: [1, 1, 1], cor: '#fff'},
    ], luzes: [{id: 'sol', tipo: 'direcional', cor: '#fff', intensidade: 1, posicao: [1, 1, 1]}, {id: 'sol', tipo: 'ponto', cor: '#fff', intensidade: 5, posicao: [2, 2, 2]}]});
    expect(r.doc.objetos.map((o) => o.id)).toEqual(['caixa', 'caixa-2', 'caixa-3']);
    expect(r.doc.luzes.map((l) => l.id)).toEqual(['sol', 'sol-2']);
    expect(r.problemas.filter((p) => p.caminho.endsWith('/id')).map((p) => [p.caminho, p.valor])).toEqual([
      ['/objetos/1/id', 'caixa-2'], ['/objetos/2/id', 'caixa-3'], ['/luzes/1/id', 'sol-2'],
    ]);
    // um id que sobra para o objeto seguinte não colide com o gerado
    expect(lerCena3d({objetos: [{id: 'a'}, {id: 'a'}, {id: 'a-2'}]}).doc.objetos.map((o) => o.id)).toEqual(['a', 'a-2', 'a-2-2']);
  });

  it('cada tipo de luz tem a sua intensidade de partida; a de ponto não é a do sol (tres-efeitos-D9)', () => {
    expect(INTENSIDADE_PADRAO_LUZ).toEqual({ambiente: 0.5, direcional: 1.6, ponto: 60});
    // cabe na faixa que a leitura aceita
    for (const v of Object.values(INTENSIDADE_PADRAO_LUZ)) {
      expect(lerCena3d({luzes: [{id: 'x', tipo: 'ponto', cor: '#fff', intensidade: v, posicao: [1, 1, 1]}]}).doc.luzes[0].intensidade).toBe(v);
    }
  });

  it('a cena nova do app é lida sem nenhum aviso (a prévia web usa a mesma)', () => {
    const nova = novoDoc3d();
    const r = lerCena3d(nova);
    expect(r.problemas).toEqual([]);
    expect(r.doc.objetos.map((o) => o.id)).toEqual(['chao', 'caixa']);
    expect(r.doc.luzes.map((l) => l.id)).toEqual(['ambiente', 'sol']);
  });
});
