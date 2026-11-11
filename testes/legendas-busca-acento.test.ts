// C5 (auditoria de conteúdo): localizar ignorava acento e substituirEmLote não. A lista acendia "1 achada" e "substituir em
// todas" trocava zero. Agora os dois usam a mesma expressão, que ignora acento e lê o texto em NFC.
import {describe, expect, it} from 'vitest';
import {aplicarDicionario, DICIONARIO_CASA, localizar, substituirEmLote, type SegmentoLegenda} from '../src/nucleo/legendas';

const seg = (texto: string, id = 'leg-1'): SegmentoLegenda => ({id, em: 0, sai: 1000, texto});

describe('C5: localizar e substituir com a mesma expressão', () => {
  it('"rescisao" acha e troca "rescisão"', () => {
    const segs = [seg('A rescisão do contrato')];
    expect(localizar(segs, 'rescisao')).toEqual(['leg-1']);
    const r = substituirEmLote(segs, 'rescisao', 'demissão');
    expect(r.trocas).toBe(1);
    expect(r.segmentos[0].texto).toBe('A demissão do contrato');
  });

  it('o inverso: busca acentuada sobre texto sem acento', () => {
    const segs = [seg('o aviso previo indenizado')];
    expect(localizar(segs, 'prévio', {palavra_inteira: true})).toEqual(['leg-1']);
    expect(substituirEmLote(segs, 'prévio', 'prévio', {palavra_inteira: true}).segmentos[0].texto).toBe('o aviso prévio indenizado');
  });

  it('maiúsculas acentuadas e cedilha', () => {
    expect(substituirEmLote([seg('RESCISÃO')], 'rescisao', 'x').trocas).toBe(1);
    expect(substituirEmLote([seg('Ação')], 'acao', 'x').trocas).toBe(1);
  });

  it('texto em NFD (o whisper às vezes devolve) também casa', () => {
    const nfd = [seg('rescisão'.normalize('NFD'))];
    expect(localizar(nfd, 'rescisao')).toEqual(['leg-1']);
    expect(substituirEmLote(nfd, 'rescisao', 'x').trocas).toBe(1);
  });

  it('com caixa a busca é literal (caixa e acento contam)', () => {
    const segs = [seg('A rescisão')];
    expect(localizar(segs, 'rescisao', {caixa: true})).toEqual([]);
    expect(substituirEmLote(segs, 'rescisao', 'x', {caixa: true}).trocas).toBe(0);
    expect(substituirEmLote(segs, 'rescisão', 'x', {caixa: true}).trocas).toBe(1);
  });

  it('localizar acha exatamente os segmentos que substituir troca', () => {
    const segs = [seg('a ação', 'a'), seg('acao', 'b'), seg('ACAO', 'c'), seg('caça', 'd'), seg('nada', 'e')];
    for (const procurar of ['acao', 'ação', 'caca', 'ada']) {
      const achados = localizar(segs, procurar);
      const trocados = substituirEmLote(segs, procurar, '#').segmentos.filter((s, i) => s.texto !== segs[i].texto).map((s) => s.id);
      expect(trocados).toEqual(achados);
    }
  });

  it('o dicionário da casa (siglas) dá o mesmo resultado', () => {
    const r = aplicarDicionario([seg('a clt e o fgts; inss.'), seg('Clóvis e o cltx', 'leg-2')], DICIONARIO_CASA);
    expect(r.segmentos.map((s) => s.texto)).toEqual(['a CLT e o FGTS; INSS.', 'Clóvis e o cltx']);
  });
});
