// A marca d'água não cobre a legenda (junção das frentes Vídeo curto e Fala, 07/11/2026; video-N2, som-N5, imagem-N4 e
// transversal-N3 da segunda pesquisa de qualidade): posicaoSegura recebe a caixa da legenda como mais uma área a evitar,
// lida das props que vão ao render (legendas_cenas.area e estilo.posicao, no formato do resolvedor).
import {describe, expect, it} from 'vitest';
import {novoDocCenas, resolverCenas} from '../src/nucleo/cenas';
import {
  caixaDaLegenda, CANTOS_MARCA, configPadraoMarca, legendasDasProps, legendasNoDestino, marcaDaguaDoDestino, TAMANHO_MARCA, type ConfigMarcaDagua,
} from '../src/nucleo/exportacao';
import {FORMATOS_VIDEO} from '../src/nucleo/formatos';
import {areaDaLegenda, PREDEFINICOES_LEGENDA, type IdEstiloLegenda, type LegendasP, type PosicaoLegenda} from '../src/nucleo/legendas';
import {conjuntoDe, livreDasZonas, zonasDaMarca, type CantoMarca, type Ret} from '../src/nucleo/zonas-seguras';

const FONTES = {logo: 'midia/logo-exemplo.png', assinatura: '@escritorioexemplo', fonte: 'Archivo'};
const QUADRADO = {largura: 1080, altura: 1080};
const FEED = {largura: 1080, altura: 1350};
const REELS = {largura: 1080, altura: 1920};

/** As legendas como o resolvedor entrega ao render: um vídeo de cenas com uma fala de duas linhas. */
// frente Fala, rodada 3: no 4:5 a legenda fica no corte 1:1 por padrão (fala-D8); `alturaToda` mede como no relatório
const legendasEm = (q: {largura: number; altura: number}, posicao?: PosicaoLegenda, predefinicao: IdEstiloLegenda = 'classica', oculto = false, alturaToda = false): LegendasP => {
  const doc = {
    ...novoDocCenas({...q, fps: 30}),
    legendas: {segmentos: [{id: 's1', em: 0, sai: 2000, texto: 'Uma frase comprida o bastante para ocupar duas linhas'}],
      estilo: {predefinicao, ...(posicao ? {posicao} : {}), ...(alturaToda ? {no_quadrado: false} : {})}, ...(oculto ? {oculto} : {})},
  };
  const l = (resolverCenas(doc).props as unknown as {legendas_cenas?: LegendasP}).legendas_cenas;
  if (!l) throw new Error('o resolvedor não devolveu legendas');
  return l;
};
const marca = (q: {largura: number; altura: number}, legendas: LegendasP | null, extra: Partial<ConfigMarcaDagua> = {}) =>
  marcaDaguaDoDestino({...configPadraoMarca(q, FONTES), ligada: true, ...extra}, q, FONTES, 3, legendas)!;
const ret = (m: {x: number; y: number; largura: number; altura: number}): Ret => ({x: m.x, y: m.y, largura: m.largura, altura: m.altura});
const cruza = (a: Ret, b: Ret) => a.x < b.x + b.largura - 1e-9 && b.x < a.x + a.largura - 1e-9 && a.y < b.y + b.altura - 1e-9 && b.y < a.y + a.altura - 1e-9;

describe("marca d'água e legenda", () => {
  it('1:1 com a Clássica embaixo: sem a legenda a marca caía na última linha; com ela, sobe para cima da legenda', () => {
    const l = legendasEm(QUADRADO, 'baixo');
    const cx = caixaDaLegenda(l, QUADRADO)!;
    const antes = marca(QUADRADO, null);
    expect(antes.y).toBeCloseTo(0.905, 3); // o caso do relatório: y 0,905 a 0,965, base da legenda em 0,94
    expect(cruza(ret(antes), cx)).toBe(true);
    const m = marca(QUADRADO, l);
    expect(m).toMatchObject({segura: true, alinhar: 'direita'});
    expect(cruza(ret(m), cx)).toBe(false);
    expect(m.y + m.altura).toBeLessThanOrEqual(cx.y); // logo acima da legenda, no mesmo lado direito
    expect(m.x).toBeCloseTo(antes.x, 5);
  });

  it('4:5 com a Clássica de duas linhas embaixo: a marca sai de cima da primeira linha e continua dentro dos cortes da grade', () => {
    const l = legendasEm(FEED, 'baixo', 'classica', false, true);
    const cx = caixaDaLegenda(l, FEED)!;
    // a caixa cobre a legenda que o relatório mediu: duas linhas de 0,845 a 0,94 da altura, de margem a margem (5%)
    expect(cx.y).toBeLessThanOrEqual(0.845);
    expect(cx.y + cx.altura).toBeGreaterThanOrEqual(0.94);
    expect(cx.x).toBeLessThanOrEqual(0.05);
    expect(cx.x + cx.largura).toBeGreaterThanOrEqual(0.95);
    const antes = marca(FEED, null);
    expect([antes.y, antes.y + antes.altura].map((v) => Math.round(v * 1000) / 1000)).toEqual([0.824, 0.872]);
    expect(cruza(ret(antes), cx)).toBe(true);
    const m = marca(FEED, l);
    expect(m.segura).toBe(true);
    expect(cruza(ret(m), cx)).toBe(false);
    expect(m.y + m.altura).toBeLessThanOrEqual(cx.y);
    expect(livreDasZonas(conjuntoDe('feed')!.zonas, ret(m))).toBe(true); // ainda nos cortes 1:1 e 3:4
  });

  it('9:16 com a legenda "Em cima": a marca do canto de cima desce para logo abaixo dela, longe da coluna de ícones', () => {
    const l = legendasEm(REELS, 'cima');
    const cx = caixaDaLegenda(l, REELS)!;
    expect(cx.y).toBeLessThanOrEqual(0.14); // a legenda "Em cima" começa em 0,14 (0,13 da faixa do perfil + 0,01)
    const antes = marca(REELS, null);
    expect(cruza(ret(antes), cx)).toBe(true);
    const m = marca(REELS, l);
    expect(m.segura).toBe(true);
    expect(cruza(ret(m), cx)).toBe(false);
    expect(m.y).toBeGreaterThanOrEqual(cx.y + cx.altura);
    expect(m.y + m.altura).toBeLessThan(0.42); // a coluna de ícones começa em 42%
    expect(livreDasZonas(conjuntoDe('vertical')!.zonas, ret(m))).toBe(true);
  });

  it('com a legenda do outro lado, ou oculta, a marca fica onde sempre ficou', () => {
    // 9:16 com a legenda embaixo e a marca em cima; 1:1 e 4:5 com a legenda em cima e a marca embaixo
    expect(marca(REELS, legendasEm(REELS, 'baixo'))).toEqual(marca(REELS, null));
    expect(marca(QUADRADO, legendasEm(QUADRADO, 'cima'))).toEqual(marca(QUADRADO, null));
    expect(marca(FEED, legendasEm(FEED, 'cima'))).toEqual(marca(FEED, null));
    // legenda oculta: não sai no vídeo, não empurra a marca
    expect(legendasDasProps({legendas_cenas: legendasEm(FEED, 'baixo', 'classica', true)})).toBeNull();
    expect(marca(FEED, legendasDasProps({legendas_cenas: legendasEm(FEED, 'baixo', 'classica', true)}))).toEqual(marca(FEED, null));
  });

  it('a Faixa da marca vai de borda a borda: a marca do canto de baixo fica acima dela', () => {
    const l = legendasEm(FEED, 'baixo', 'faixa');
    const cx = caixaDaLegenda(l, FEED)!;
    expect([cx.x, cx.largura]).toEqual([0, 1]);
    const m = marca(FEED, l, {canto: 'inf-esq'});
    expect(m.segura).toBe(true);
    expect(m.y + m.altura).toBeLessThanOrEqual(cx.y);
  });

  it('em todo formato, posição e estilo de legenda, todo canto e tamanho até 10%: a marca fica fora da legenda e das zonas', () => {
    for (const f of FORMATOS_VIDEO) {
      const zonas = conjuntoDe(zonasDaMarca(f.largura, f.altura))?.zonas ?? [];
      for (const posicao of ['baixo', 'meio', 'cima'] as const) {
        for (const predefinicao of Object.keys(PREDEFINICOES_LEGENDA) as IdEstiloLegenda[]) {
          const l = legendasEm(f, posicao, predefinicao);
          const cx = caixaDaLegenda(l, f)!;
          for (const {id: canto} of CANTOS_MARCA) {
            for (const tamanho of [TAMANHO_MARCA.min, 0.06, 0.1]) {
              const m = marca(f, l, {canto: canto as CantoMarca, tamanho});
              const onde = `${f.id} ${posicao} ${predefinicao} ${canto} ${tamanho}`;
              expect(m.segura, onde).toBe(true);
              expect(cruza(ret(m), cx), onde).toBe(false);
              expect(livreDasZonas(zonas, ret(m)), onde).toBe(true);
            }
          }
        }
      }
    }
  });

  it('as legendas vêm das props do render; a miniatura usa a área do destino, a mesma conta do resolvedor', () => {
    const l = legendasEm(REELS, 'baixo');
    expect(legendasDasProps({legendas_cenas: l})).toBe(l);
    expect(legendasDasProps({})).toBeNull();
    expect(legendasDasProps(null)).toBeNull();
    expect(legendasDasProps({legendas_cenas: {...l, segmentos: []}})).toBeNull();
    expect(legendasDasProps({legendas_cenas: {...l, area: {topo: 0.1}}})).toBeNull();
    // um vídeo 9:16 exportado em 4:5: a área passa a ser a do 4:5, igual à de um vídeo feito em 4:5
    expect(legendasNoDestino(l, FEED)!.area).toEqual(areaDaLegenda(1080, 1350));
    expect(legendasNoDestino(l, FEED)!.area).toEqual(legendasEm(FEED, 'baixo').area);
    expect(legendasNoDestino(null, FEED)).toBeNull();
  });
});
