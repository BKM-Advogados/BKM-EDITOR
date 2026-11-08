// Cortes pela fala (frente Fala, rodada 3; docs/legendas.md): propor os cortes pelo palavras.json, conferir os pedidos,
// emendar as amostras com crossfade sem estalo e levar o clipe e as legendas para o tempo novo, e de volta.
import {describe, expect, it} from 'vitest';
import {
  acharClipe, arquivoCortado, clipeDepoisDosCortes, clipeSemCortes, conferirCortes, CROSSFADE_MS, ehPreenchimento, emendarCanais, legendasDepoisDosCortes, legendasSemCortes,
  mapaDosCortes, mapaInversoDosCortes, palavrasDepoisDosCortes, proporCortes,
} from '../src/nucleo/cortes-fala';
import {novoDocCenas, resolverCenas, type DocCenas} from '../src/nucleo/cenas';
import {arquivoDaFala, legendasDaFala, legendasDeOutraTomada, type PalavraLegenda} from '../src/nucleo/legendas';
import type {ClipeAudio} from '../src/nucleo/audio';

const FALA: PalavraLegenda[] = [
  {w: 'Recebeu', s: 0, e: 300},
  {w: 'proposta', s: 1500, e: 1800}, // pausa de 1,2 s antes
  {w: 'ãh,', s: 2400, e: 2600}, // preenchimento no meio de uma pausa
  {w: 'para', s: 3200, e: 3500},
  {w: 'mudar.', s: 3700, e: 4000}, // pausa curta: fica
];

describe('propor e conferir os cortes', () => {
  it('pausa longa fica com 300 ms, o "ãh" sai com a pausa em volta, e a ponta do fim também', () => {
    const cortes = proporCortes(FALA, {inicio_ms: 0, fim_ms: 6000});
    expect(cortes).toEqual([
      {de_ms: 450, ate_ms: 1350, motivo: 'silencio'},
      {de_ms: 1950, ate_ms: 3050, motivo: 'preenchimento', texto: 'ãh,'},
      {de_ms: 4150, ate_ms: 6000, motivo: 'silencio'},
    ]);
    const {problemas, removidas} = conferirCortes(FALA, cortes, {duracao_ms: 6000});
    expect(problemas).toEqual([]);
    expect(removidas.map((p) => p.w)).toEqual(['ãh,']);
    // nenhuma borda a menos de 80 ms de uma palavra que fica
    for (const c of cortes) for (const b of [c.de_ms, c.ate_ms]) for (const p of FALA.filter((x) => x.w !== 'ãh,')) {
      if (b > 0 && b < 6000) expect(b <= p.s - 80 || b >= p.e + 80).toBe(true);
    }
  });

  it('o preenchimento colado numa palavra fica, e a pausa depois dele ainda sai', () => {
    const colado = [FALA[0], FALA[1], {w: 'hum', s: 1850, e: 1950}, FALA[3], FALA[4]];
    const cortes = proporCortes(colado, {inicio_ms: 0, fim_ms: 4100, pontas: false});
    expect(cortes.map((c) => [c.de_ms, c.ate_ms, c.motivo])).toEqual([[450, 1350, 'silencio'], [2100, 3050, 'silencio']]);
    expect(conferirCortes(colado, cortes).removidas).toEqual([]);
  });

  it('o que não é preenchimento não sai; "é", "né" e "tipo" ficam', () => {
    for (const w of ['ãh', 'Ãhh', 'hum', 'hmm', 'éé', 'ahn', 'ãh,', 'Hum...']) expect(ehPreenchimento(w), w).toBe(true);
    for (const w of ['é', 'né', 'tipo', 'então', 'a', 'há', 'humano']) expect(ehPreenchimento(w), w).toBe(false);
    expect(proporCortes(FALA, {preenchimento: false, pontas: false}).map((c) => c.motivo)).toEqual(['silencio']); // o "ãh" vira palavra: as pausas em volta ficam curtas
  });

  it('conferir recusa borda dentro ou perto de palavra, corte curto, sobreposto ou fora do arquivo', () => {
    const r = conferirCortes(FALA, [{de_ms: 200, ate_ms: 1000}, {de_ms: 1350, ate_ms: 1440}, {de_ms: 3550, ate_ms: 3600}, {de_ms: 5000, ate_ms: 7000}], {duracao_ms: 6000});
    expect(r.problemas.join(' | ')).toMatch(/borda 200 ms do corte 1 fica a menos de 80 ms de "Recebeu"/);
    expect(r.problemas.join(' | ')).toMatch(/borda 1440 ms do corte 2 fica a menos de 80 ms de "proposta"/);
    expect(r.problemas.join(' | ')).toMatch(/corte 3 .* tem menos de 60 ms/);
    expect(r.problemas.join(' | ')).toMatch(/corte 4 sai do arquivo/);
  });

  it('o mapa leva cada tempo que fica para o arquivo emendado e volta', () => {
    const cortes = proporCortes(FALA, {inicio_ms: 0, fim_ms: 6000});
    const ida = mapaDosCortes(cortes);
    const volta = mapaInversoDosCortes(cortes);
    expect(ida(1500)).toBe(1500 - 900);
    expect(ida(3200)).toBe(3200 - 900 - 1100);
    expect(ida(2500)).toBe(1950 - 900); // dentro de um corte: o ponto da emenda
    for (const p of FALA.filter((x) => x.w !== 'ãh,')) expect(volta(ida(p.s))).toBe(p.s);
    expect(palavrasDepoisDosCortes(FALA, cortes).map((p) => [p.w, p.s])).toEqual([['Recebeu', 0], ['proposta', 600], ['para', 1200], ['mudar.', 1700]]);
  });
});

describe('a emenda: sem estalo, no tamanho certo e com as palavras no lugar', () => {
  const TAXA = 48_000;
  /** Zumbido de 47 Hz o tempo todo (o corte cai fora de fase) e uma rajada de 440 Hz em cada palavra. */
  const sinal = (palavras: PalavraLegenda[], ms: number) => {
    const n = Math.round((ms * TAXA) / 1000);
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.05 * Math.sin((2 * Math.PI * 47 * i) / TAXA);
    for (const p of palavras) {
      const a = Math.round((p.s * TAXA) / 1000);
      const b = Math.round((p.e * TAXA) / 1000);
      const rampa = Math.round(0.01 * TAXA);
      for (let i = a; i < b && i < n; i++) x[i] += 0.5 * Math.sin((2 * Math.PI * 440 * (i - a)) / TAXA) * Math.min(1, (i - a) / rampa, (b - i) / rampa);
    }
    return x;
  };
  const degrauPerto = (x: Float32Array, centro: number, raio: number) => {
    let max = 0;
    for (let i = Math.max(1, centro - raio); i < Math.min(x.length, centro + raio); i++) max = Math.max(max, Math.abs(x[i] - x[i - 1]));
    return max;
  };

  it('o tamanho é o de antes menos os cortes, amostra a amostra, em cada canal', () => {
    const x = sinal(FALA, 6000);
    const cortes = proporCortes(FALA, {inicio_ms: 0, fim_ms: 6000});
    const [a, b] = emendarCanais([x, x.slice()], TAXA, cortes);
    const tirado = cortes.reduce((s, c) => s + Math.round((c.ate_ms * TAXA) / 1000) - Math.round((c.de_ms * TAXA) / 1000), 0);
    expect(a.length).toBe(x.length - tirado);
    expect(b).toEqual(a);
  });

  it(`com crossfade de ${CROSSFADE_MS} ms nenhuma emenda dá degrau; sem ele (controle), dá`, () => {
    const x = sinal(FALA, 6000);
    const cortes = proporCortes(FALA, {inicio_ms: 0, fim_ms: 6000, pontas: false});
    const [com] = emendarCanais([x], TAXA, cortes, CROSSFADE_MS);
    const [sem] = emendarCanais([x], TAXA, cortes, 0);
    const proprio = degrauPerto(x, Math.round(0.7 * TAXA), Math.round(0.1 * TAXA)); // o maior passo do zumbido sozinho
    const mapa = mapaDosCortes(cortes);
    const raio = Math.round(((CROSSFADE_MS + 4) * TAXA) / 1000);
    const degraus = cortes.map((c) => Math.round((mapa(c.de_ms) * TAXA) / 1000)).map((p) => [degrauPerto(com, p, raio), degrauPerto(sem, p, raio)]);
    for (const [d] of degraus) expect(d).toBeLessThan(proprio * 4); // da ordem do próprio zumbido: sem estalo
    expect(Math.max(...degraus.map(([, d]) => d))).toBeGreaterThan(proprio * 20); // o corte seco estala
  });

  it('cada palavra começa no tempo remapeado (até 5 ms: a rampa de 10 ms da rajada atrasa a detecção)', () => {
    const x = sinal(FALA, 6000);
    const cortes = proporCortes(FALA, {inicio_ms: 0, fim_ms: 6000});
    const [y] = emendarCanais([x], TAXA, cortes);
    for (const p of palavrasDepoisDosCortes(FALA, cortes)) {
      const de = Math.max(0, Math.round(((p.s - 5) * TAXA) / 1000));
      let i = de;
      while (i < y.length && Math.abs(y[i]) < 0.12) i++;
      expect(Math.abs((i * 1000) / TAXA - p.s), p.w).toBeLessThanOrEqual(5);
    }
  });
});

describe('o clipe e as legendas depois dos cortes, e de volta', () => {
  const doc = (): DocCenas => {
    const clipe: ClipeAudio = {id: 'n1', arquivo: 'midia/n.wav.limpo.wav', original: 'midia/n.wav', em: 1000, duracao_ms: 6000,
      limpeza: {intensidade: 'media', ruido_antes_db: -50, ruido_depois_db: -70, voz_antes_db: -20, voz_depois_db: -20}};
    const legendas = legendasDaFala([{clipe: {...clipe, arquivo: 'midia/n.wav'}, faixa: {nome: 'Narração'}, palavras: FALA, caminhoPalavras: 'midia/n.wav.palavras.json'}],
      {largura: 1080, altura: 1920, estilo: {predefinicao: 'karaoke'}});
    return {...novoDocCenas({largura: 1080, altura: 1920, fps: 30}), cenas: [{id: 'c1', duracao_ms: 10_000, blocos: []}],
      audio: {faixas: [{id: 'voz', nome: 'Narração', papel: 'voz', clipes: [clipe]}]}, legendas};
  };
  const naTela = (d: DocCenas) => (resolverCenas(d).props.legendas_cenas?.segmentos ?? []).flatMap((s) => s.palavras.map((p) => `${p.w}@${p.s}`));

  it('o clipe toca o arquivo emendado, mais curto, e guarda o de antes; as legendas andam e o "ãh" sai', () => {
    const d = doc();
    const {clipe, caminho} = acharClipe(d.audio, 'n1')!;
    expect(caminho).toBe('/audio/faixas/0/clipes/0');
    const cortes = proporCortes(FALA, {inicio_ms: 0, fim_ms: 6000});
    const arquivo = arquivoCortado(clipe.arquivo, cortes);
    expect(arquivo).toMatch(/^midia\/n\.wav\.limpo\.wav\.cortes-[0-9a-f]{8}\.wav$/);
    expect(arquivoCortado(clipe.arquivo, [...cortes].reverse())).toBe(arquivo);
    const novo = clipeDepoisDosCortes(clipe, cortes, arquivo);
    expect(novo).toMatchObject({arquivo, duracao_ms: 6000 - 900 - 1100 - 1850, cortes_fala: {fonte: 'midia/n.wav.limpo.wav', original: 'midia/n.wav', duracao_ms: 6000}});
    expect(novo.original).toBeUndefined();
    expect(arquivoDaFala(novo)).toBe(arquivo); // a fala do clipe é a do arquivo emendado, que tem palavras.json próprio
    const legendas = legendasDepoisDosCortes(d.legendas, clipe, cortes, {arquivo, palavras: `${arquivo}.palavras.json`, corte_ms: 0});
    const depois: DocCenas = {...d, audio: {faixas: [{...d.audio!.faixas[0], clipes: [novo]}]}, legendas};
    expect(naTela(depois)).toEqual(['Recebeu@1000', 'proposta@1600', 'para@2200', 'mudar.@2700']);
    expect(legendas!.segmentos.map((s) => s.texto).join(' ')).not.toContain('ãh');
    expect(legendasDeOutraTomada(depois)).toEqual([]);
  });

  it('voltar: o clipe e as legendas voltam ao arquivo de antes (sem o "ãh", que foi cortado)', () => {
    const d = doc();
    const {clipe} = acharClipe(d.audio, 'n1')!;
    const cortes = proporCortes(FALA, {inicio_ms: 0, fim_ms: 6000});
    const arquivo = arquivoCortado(clipe.arquivo, cortes);
    const novo = clipeDepoisDosCortes(clipe, cortes, arquivo);
    const legendas = legendasDepoisDosCortes(d.legendas, clipe, cortes, {arquivo, palavras: `${arquivo}.palavras.json`, corte_ms: 0});
    const voltou = clipeSemCortes(novo)!;
    expect(voltou).toEqual(clipe);
    const leg = legendasSemCortes(legendas, novo, voltou, 'midia/n.wav.palavras.json');
    const deVolta: DocCenas = {...d, audio: {faixas: [{...d.audio!.faixas[0], clipes: [voltou]}]}, legendas: leg};
    expect(naTela(deVolta)).toEqual(naTela(d).filter((w) => !w.startsWith('ãh')));
    expect(clipeSemCortes(clipe)).toBeNull();
  });
});
