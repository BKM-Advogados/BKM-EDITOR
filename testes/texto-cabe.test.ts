// Texto da imagem (rodada 3, B2): a quebra depois do hífen como o CSS (imagem-D6: a prévia quebrava em "pré-" e o PNG
// descia a palavra inteira) e o texto que cabe na caixa (`caber`): o maior tamanho em que as linhas cabem na altura e
// nenhum pedaço de palavra passa da largura. Medida de mentira (cada letra com a mesma largura); a medida de verdade é
// a do canvas, igual na prévia e no PNG (scripts/comparar-imagem.mjs).
import {describe, expect, it} from 'vitest';
import {pedacosDaPalavra, quebrarLinhas, tamanhoQueCabe} from '../src/renderer/modulos/imagem/pintura';
import {ENTRELINHA} from '../src/renderer/modulos/imagem/comum';

// 10 px por letra
const fixa = {measureText: (t: string) => ({width: [...t].length * 10}) as TextMetrics};
// letra com metade do tamanho da fonte (lido do ctx.font, "700 48px …")
const proporcional = () => {
  const ctx = {font: '', measureText: (t: string) => ({width: [...t].length * Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 10) * 0.5}) as TextMetrics};
  return ctx;
};

describe('quebra depois do hífen (imagem-D6)', () => {
  it('a palavra com hífen parte depois do hífen; número com traço não', () => {
    expect(pedacosDaPalavra('pré-aviso')).toEqual(['pré-', 'aviso']);
    expect(pedacosDaPalavra('e-mail')).toEqual(['e-', 'mail']);
    expect(pedacosDaPalavra('2026-11')).toEqual(['2026-11']);
    expect(pedacosDaPalavra('-10')).toEqual(['-10']);
    expect(pedacosDaPalavra('mês–ano')).toEqual(['mês–', 'ano']);
  });

  it('"pré-" fica no fim da linha, como na prévia, e o texto não ganha uma linha a mais', () => {
    // 17 letras por linha: cabe "Rescisão com pré-", não cabe "Rescisão com pré-aviso"
    expect(quebrarLinhas(fixa, 'Rescisão com pré-aviso indenizado', 170)).toEqual(['Rescisão com pré-', 'aviso indenizado']);
    // sem hífen, nada muda
    expect(quebrarLinhas(fixa, 'Rescisão com aviso indenizado', 170)).toEqual(['Rescisão com', 'aviso indenizado']);
    // pedaço maior que a caixa parte por letra, como o overflow-wrap
    expect(quebrarLinhas(fixa, 'abcdefgh', 50)).toEqual(['abcde', 'fgh']);
  });
});

describe('texto que cabe na caixa', () => {
  const caixa = {texto: 'Prazo de 30 dias para pagar a rescisão', largura: 600, altura: 300, peso: 700, fonte: 'Archivo', tamanho: 48};

  it('o maior tamanho que cabe: as linhas cabem na altura e um pixel a mais já não cabe', () => {
    const ctx = proporcional();
    const s = tamanhoQueCabe(ctx, caixa);
    const linhas = (t: number) => {
      ctx.font = `700 ${t}px x`;
      return quebrarLinhas(ctx, caixa.texto, caixa.largura).length;
    };
    expect(linhas(s) * s * ENTRELINHA).toBeLessThanOrEqual(caixa.altura + 0.5);
    const maior = s + 1;
    ctx.font = `700 ${maior}px x`;
    const palavraPassa = caixa.texto.split(' ').some((p) => ctx.measureText(p).width > caixa.largura);
    expect(palavraPassa || linhas(maior) * maior * ENTRELINHA > caixa.altura + 0.5).toBe(true);
    expect(s).toBeGreaterThan(40);
  });

  it('caixa maior dá letra maior; palavra comprida limita pela largura (nada parte por letra)', () => {
    expect(tamanhoQueCabe(proporcional(), {...caixa, altura: 600})).toBeGreaterThan(tamanhoQueCabe(proporcional(), caixa));
    const palavra = {...caixa, texto: 'Inconstitucionalidade', altura: 1000};
    const s = tamanhoQueCabe(proporcional(), palavra);
    expect(21 * s * 0.5).toBeLessThanOrEqual(palavra.largura);
    expect(21 * (s + 1) * 0.5).toBeGreaterThan(palavra.largura);
  });
});
