// Rodada 3, frente C: corte limpo (video-D1 da lâmina, video-D2 e tres-efeitos-D4 do corte entre cenas). A lâmina marca o bloco
// que atravessa o corte, e a composição o emenda: o vídeo dividido sai igual ao inteiro (conferido por pixel no render).
import jsonpatch, {type Operation} from 'fast-json-patch';
import {describe, expect, it} from 'vitest';
import {tempoDoBloco} from '../src/composicoes/cenas/continuidade';
import {novoDocCenas, resolverCenas, type DocCenas} from '../src/nucleo/cenas';
import {dividirCena} from '../src/nucleo/cenas-dividir';

const doc = (): DocCenas => ({
  ...novoDocCenas({largura: 1080, altura: 1920, fps: 30}),
  cenas: [{id: 'a', duracao_ms: 4000, blocos: [
    {id: 'a-titulo', tipo: 'titulo', x: 0.1, y: 0.2, largura: 0.8, em: 0, texto: 'Atravessa'},
    {id: 'a-numero', tipo: 'numero', x: 0.1, y: 0.4, largura: 0.8, em: 300, sai: 3500, de: 0, ate: 1000},
    {id: 'a-curto', tipo: 'texto', x: 0.1, y: 0.6, largura: 0.8, em: 100, sai: 800, texto: 'Acaba antes'},
    {id: 'a-tarde', tipo: 'texto', x: 0.1, y: 0.7, largura: 0.8, em: 2600, texto: 'Começa depois'},
  ]}],
});
const aplicar = (d: DocCenas, patch: unknown[]) => jsonpatch.applyPatch(structuredClone(d), patch as Operation[], true).newDocument as DocCenas;
// o bloco de um tipo na cena i (a lâmina dá ids novos aos blocos da segunda cena)
const bloco = (d: DocCenas, i: number, tipo: string, n = 0) => d.cenas[i].blocos.filter((b) => b.tipo === tipo)[n]!;

describe('lâmina com corte limpo (video-D1)', () => {
  it('o bloco que atravessa leva as marcas: a primeira metade segue, a segunda já estava na tela', () => {
    const d = doc();
    const cortado = aplicar(d, dividirCena(d, 'a', 2000)!.patch);
    // sem sai: o resto é até o fim da cena (4000 − 2000); a segunda metade já estava na tela há 2000 − 0
    expect(bloco(cortado, 0, 'titulo')).toMatchObject({segue_ms: 2000});
    expect(bloco(cortado, 1, 'titulo')).toMatchObject({em: 0, desde_ms: 2000});
    // com sai explícito: 3500 − 2000 = 1500 adiante; já estava há 2000 − 300
    expect(bloco(cortado, 0, 'numero')).toMatchObject({sai: 2000, segue_ms: 1500});
    expect(bloco(cortado, 1, 'numero')).toMatchObject({em: 0, sai: 1500, desde_ms: 1700});
    // quem acaba antes ou começa depois do corte não leva marca
    expect(cortado.cenas[0].blocos.find((b) => b.id === 'a-curto')?.segue_ms).toBeUndefined();
    expect(bloco(cortado, 1, 'texto').desde_ms).toBeUndefined();
    expect(bloco(cortado, 1, 'texto').texto).toBe('Começa depois');
  });

  it('o relógio de cada metade é o do bloco inteiro: o mesmo começo e a mesma duração do movimento', () => {
    const d = doc();
    const inteiro = resolverCenas(d).props.cenas[0].blocos.find((b) => b.id === 'a-numero')!;
    const cortado = resolverCenas(aplicar(d, dividirCena(d, 'a', 2000)!.patch)).props.cenas;
    const metade1 = cortado[0].blocos.find((b) => b.tipo === 'numero')!;
    const metade2 = cortado[1].blocos.find((b) => b.tipo === 'numero')!;
    const ref = tempoDoBloco(inteiro);
    expect(tempoDoBloco(metade1)).toMatchObject({inicio: ref.inicio, total: ref.total, segue: true});
    expect(tempoDoBloco(metade2)).toMatchObject({inicio: ref.inicio, total: ref.total, segue: false});
    expect(ref.segue).toBe(false);
  });

  it('um segundo corte soma as marcas, e o meio de três pedaços continua o bloco dos dois lados', () => {
    const d = doc();
    const um = aplicar(d, dividirCena(d, 'a', 1000)!.patch);
    const dois = aplicar(um, dividirCena(um, um.cenas[1].id, 1500)!.patch); // corta a segunda cena em 1,5 s
    expect(bloco(dois, 1, 'titulo')).toMatchObject({desde_ms: 1000, segue_ms: 3000 - 1500}); // veio de antes e segue adiante
    expect(bloco(dois, 2, 'titulo')).toMatchObject({desde_ms: 2500, em: 0});
    const inteiro = tempoDoBloco(resolverCenas(d).props.cenas[0].blocos[0]);
    const props = resolverCenas(dois).props.cenas;
    for (const [i, c] of props.entries()) {
      const t = tempoDoBloco(c.blocos.find((b) => b.tipo === 'titulo')!);
      expect(t.inicio, `pedaço ${i}`).toBe(inteiro.inicio);
      expect(t.total, `pedaço ${i}`).toBe(inteiro.total);
    }
  });

  it('um documento antigo, sem marcas, tem o mesmo relógio de antes', () => {
    expect(tempoDoBloco({em: 1500, sai: 3000})).toEqual({inicio: 1500, total: 1500, segue: false});
    expect(tempoDoBloco({em: 0, sai: 0, desde_ms: -5, segue_ms: NaN})).toEqual({inicio: 0, total: 1, segue: false});
  });
});
