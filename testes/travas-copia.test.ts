// C6 (auditoria de conteúdo): a trava se contornava com uma cópia de mesmo id; M4 (auditoria do MCP): a trava continua
// protegendo as camadas da animação, onde travar_camadas e destravar_camadas valem.
import {describe, expect, it} from 'vitest';
import {destravando, motivoDaTrava} from '../src/nucleo/travas-imagem';
import type {OperacaoPatch} from '../src/nucleo/documentos';
import {novaAnimacao} from '../src/nucleo/animacao';

const travada = {id: 'logo', nome: 'Logo', tipo: 'texto', texto: 'ESTÚDIO', x: 0, y: 0, largura: 100, altura: 40, travada: true};
const doc = () => ({formato: 1, largura: 1080, altura: 1080, camadas: [{id: 'fundo', tipo: 'forma', x: 0, y: 0, largura: 1080, altura: 1080}, structuredClone(travada)]});

describe('C6: a chave de uma camada travada não ganha cópias', () => {
  it('controle: mexer direto na travada é recusado', () => {
    expect(motivoDaTrava(doc(), [{op: 'replace', path: '/camadas/1/texto', value: 'OUTRO'}], 'claude')).toMatch(/travada/);
  });

  it('cópia idêntica no fundo da pilha + alteração da original: recusado', () => {
    const p: OperacaoPatch[] = [
      {op: 'add', path: '/camadas/0', value: structuredClone(travada)},
      {op: 'replace', path: '/camadas/2/texto', value: 'OUTRO'},
    ];
    expect(motivoDaTrava(doc(), p, 'claude')).toMatch(/mesmo id/);
  });

  it('cópia + destravar a original (sem destravar_camadas): recusado; o mesmo com a operação copy', () => {
    expect(motivoDaTrava(doc(), [
      {op: 'add', path: '/camadas/0', value: structuredClone(travada)},
      {op: 'remove', path: '/camadas/2/travada'},
      {op: 'replace', path: '/camadas/2/texto', value: 'OUTRO'},
    ], 'claude')).toMatch(/travada/);
    expect(motivoDaTrava(doc(), [{op: 'copy', from: '/camadas/1', path: '/camadas/0'}, {op: 'remove', path: '/camadas/2/travada'}], 'claude')).toMatch(/travada/);
  });

  it('o que é legítimo segue passando: mover a pilha, editar outra camada, criar com id novo, remover e recolocar', () => {
    expect(motivoDaTrava(doc(), [{op: 'move', from: '/camadas/1', path: '/camadas/0'}], 'claude')).toBeNull();
    expect(motivoDaTrava(doc(), [{op: 'replace', path: '/camadas/0/x', value: 5}], 'claude')).toBeNull();
    expect(motivoDaTrava(doc(), [{op: 'add', path: '/camadas/-', value: {...travada, id: 'logo-2', travada: false}}], 'claude')).toBeNull();
    expect(motivoDaTrava(doc(), [{op: 'remove', path: '/camadas/1'}, {op: 'add', path: '/camadas/0', value: structuredClone(travada)}], 'claude')).toBeNull();
    // a pessoa pode tudo
    expect(motivoDaTrava(doc(), [{op: 'add', path: '/camadas/0', value: structuredClone(travada)}], 'pessoa')).toBeNull();
  });
});

describe('M4: a trava vale na animação', () => {
  const anim = () => {
    const d = novaAnimacao(1920, 1080);
    d.camadas[0].travada = true;
    return d;
  };

  it('mexer na camada travada da animação é recusado; travar e destravar pela ferramenta passam', () => {
    expect(motivoDaTrava(anim(), [{op: 'replace', path: '/camadas/0/x', value: 5}], 'agente')).toMatch(/travada pela pessoa/);
    expect(motivoDaTrava(anim(), [{op: 'remove', path: '/camadas/0/travada'}], 'agente')).toMatch(/destravar_camadas/);
    expect(destravando(() => motivoDaTrava(anim(), [{op: 'remove', path: '/camadas/0/travada'}], 'agente'))).toBeNull();
    const solta = novaAnimacao(1920, 1080);
    expect(motivoDaTrava(solta, [{op: 'add', path: '/camadas/0/travada', value: true}], 'agente')).toBeNull();
  });
});
