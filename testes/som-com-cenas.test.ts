// A narração presa às cenas (video-D3): inserir, duplicar, excluir e mudar a duração de cena move o som e as legendas que o
// seguem; dividir cena não mexe; o patch que já cuida do som, a ordem trocada e `acompanha_cenas: false` ficam como estão.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import jsonpatch, {type Operation} from 'fast-json-patch';
import {describe, expect, it} from 'vitest';
import {novoDocCenas, resolverCenas, type DocCenas} from '../src/nucleo/cenas';
import {dividirCena} from '../src/nucleo/cenas-dividir';
import type {OperacaoPatch} from '../src/nucleo/documentos';
import {Projeto} from '../src/nucleo/projeto';
import {edicoesDeTempo, somAcompanhaCenas} from '../src/nucleo/som-com-cenas';

const palavras = (lista: [string, number, number][]) => lista.map(([w, s, e]) => ({w, s, e}));

/** Três cenas de 4 s; a narração inteira (12 s, a partir do zero do arquivo) com legendas nas três; um efeito em cada cena. */
const doc = (extra: Partial<DocCenas> = {}): DocCenas => ({
  ...novoDocCenas({largura: 720, altura: 1280, fps: 30}),
  cenas: [{id: 'c1', duracao_ms: 4000, blocos: []}, {id: 'c2', duracao_ms: 4000, blocos: []}, {id: 'c3', duracao_ms: 4000, blocos: []}],
  audio: {faixas: [
    {id: 'narracao', nome: 'Narração', papel: 'voz', clipes: [{id: 'n1', arquivo: 'midia/narracao.wav', em: 0, duracao_ms: 12000}]},
    {id: 'efeitos', nome: 'Efeitos', papel: 'efeitos', clipes: [
      {id: 'e1', arquivo: 'midia/pop.wav', em: 1000, duracao_ms: 300}, {id: 'e2', arquivo: 'midia/pop.wav', em: 5500, duracao_ms: 300}, {id: 'e3', arquivo: 'midia/pop.wav', em: 9000, duracao_ms: 300},
    ]},
  ]},
  legendas: {
    segmentos: [
      {id: 'leg-1', em: 500, sai: 1500, texto: 'Primeira cena', clipe: 'n1', palavras: palavras([['Primeira', 500, 1000], ['cena', 1000, 1500]])},
      {id: 'leg-2', em: 5000, sai: 6200, texto: 'Segunda cena aqui', clipe: 'n1', palavras: palavras([['Segunda', 5000, 5500], ['cena', 5500, 5900], ['aqui', 5900, 6200]])},
      {id: 'leg-3', em: 9000, sai: 10000, texto: 'Terceira cena', clipe: 'n1', palavras: palavras([['Terceira', 9000, 9500], ['cena', 9500, 10000]])},
    ],
    origens: [{clipe: 'n1', arquivo: 'midia/narracao.wav', palavras: 'midia/narracao.wav.palavras.json', em: 0, corte_ms: 0}],
  },
  ...extra,
});

const aplicar = (d: DocCenas, patch: OperacaoPatch[]) => jsonpatch.applyPatch(structuredClone(d), patch as Operation[], true, false).newDocument as DocCenas;
/** Aplica o patch da pessoa mais o ajuste do som, como o Projeto faz. */
const comSom = (d: DocCenas, patch: OperacaoPatch[]) => aplicar(d, [...patch, ...somAcompanhaCenas(d, patch)]);
const naTela = (d: DocCenas) => (resolverCenas(d).props.legendas_cenas?.segmentos ?? []).flatMap((s) => s.palavras.map((p) => `${p.w}@${p.s}`));
const clipesDe = (d: DocCenas) => d.audio!.faixas.flatMap((f) => f.clipes.map((c) => ({id: c.id, faixa: f.id, em: c.em, dur: c.duracao_ms, corte: c.corte_ms ?? 0})));
const soma = (d: DocCenas) => d.cenas.reduce((n, c) => n + c.duracao_ms, 0);

describe('a narração presa às cenas (video-D3)', () => {
  it('alongar a cena 2 em 1 s abre um vazio no fim dela: a narração é dividida ali e o que vem depois anda 1 s, com as legendas e o efeito', () => {
    const antes = doc();
    const patch: OperacaoPatch[] = [{op: 'replace', path: '/cenas/1/duracao_ms', value: 5000}];
    const depois = comSom(antes, patch);
    expect(soma(depois)).toBe(13000);
    const n = clipesDe(depois).filter((c) => c.faixa === 'narracao');
    expect(n).toHaveLength(2);
    expect(n[0]).toMatchObject({id: 'n1', em: 0});
    expect(n[0].dur).toBeCloseTo(8000, 0);
    expect(n[1].em).toBeCloseTo(9000, 0); // o pedaço depois do corte começa 1 s mais tarde...
    expect(n[1].corte).toBeCloseTo(8000, 0); // ...tocando o mesmo trecho do arquivo
    expect(n[0].dur + n[1].dur).toBeCloseTo(12000, 0);
    // na tela: as legendas da cena 3 andaram 1 s; as das cenas 1 e 2 ficaram
    expect(naTela(depois)).toEqual(['Primeira@500', 'cena@1000', 'Segunda@5000', 'cena@5500', 'aqui@5900', 'Terceira@10000', 'cena@10500']);
    expect(clipesDe(depois).find((c) => c.id === 'e3')!.em).toBe(10000);
    expect(clipesDe(depois).find((c) => c.id === 'e2')!.em).toBe(5500);
  });

  it('encurtar a cena 2 em 1 s tira o último segundo dela do som: sai o que estava lá (a legenda e o efeito) e o resto anda 1 s para trás', () => {
    const antes = doc({cenas: [{id: 'c1', duracao_ms: 4000, blocos: []}, {id: 'c2', duracao_ms: 4000, blocos: []}, {id: 'c3', duracao_ms: 4000, blocos: []}]});
    antes.audio!.faixas[1].clipes.push({id: 'e4', arquivo: 'midia/pop.wav', em: 7200, duracao_ms: 300}); // dentro do segundo que sai
    const depois = comSom(antes, [{op: 'replace', path: '/cenas/1/duracao_ms', value: 3000}]);
    const n = clipesDe(depois).filter((c) => c.faixa === 'narracao');
    expect(n).toHaveLength(2);
    expect(n[0].dur).toBeCloseTo(7000, 0);
    expect(n[1].em).toBeCloseTo(7000, 0);
    expect(n[1].corte).toBeCloseTo(8000, 0); // o segundo 7–8 do arquivo ficou de fora
    expect(n[1].dur).toBeCloseTo(4000, 0);
    expect(clipesDe(depois).map((c) => c.id)).not.toContain('e4');
    expect(clipesDe(depois).find((c) => c.id === 'e3')!.em).toBe(8000);
    expect(naTela(depois)).toEqual(['Primeira@500', 'cena@1000', 'Segunda@5000', 'cena@5500', 'aqui@5900', 'Terceira@8000', 'cena@8500']);
  });

  it('excluir a cena 2 tira os 4 s dela do som, das legendas e dos efeitos; a cena 3 sobe para o lugar', () => {
    const depois = comSom(doc(), [{op: 'remove', path: '/cenas/1'}]);
    expect(soma(depois)).toBe(8000);
    const ids = clipesDe(depois).map((c) => c.id);
    expect(ids).not.toContain('e2');
    expect(clipesDe(depois).find((c) => c.id === 'e3')!.em).toBe(5000);
    expect(naTela(depois)).toEqual(['Primeira@500', 'cena@1000', 'Terceira@5000', 'cena@5500']);
    expect(depois.legendas!.segmentos.map((s) => s.texto)).toEqual(['Primeira cena', 'Terceira cena']);
    const n = clipesDe(depois).filter((c) => c.faixa === 'narracao');
    expect(n.reduce((s, c) => s + c.dur, 0)).toBeCloseTo(8000, 0);
  });

  it('inserir uma cena nova depois da 1 (ou duplicar a 1) abre o vazio no fim da 1; no começo, abre em zero', () => {
    const nova = {id: 'nova', duracao_ms: 2000, blocos: []};
    const depois = comSom(doc(), [{op: 'add', path: '/cenas/1', value: nova}]);
    expect(soma(depois)).toBe(14000);
    expect(naTela(depois)).toEqual(['Primeira@500', 'cena@1000', 'Segunda@7000', 'cena@7500', 'aqui@7900', 'Terceira@11000', 'cena@11500']);
    const noComeco = comSom(doc(), [{op: 'add', path: '/cenas/0', value: nova}]);
    expect(clipesDe(noComeco).find((c) => c.id === 'e1')!.em).toBe(3000);
    expect(naTela(noComeco)[0]).toBe('Primeira@2500');
    const duplicada = comSom(doc(), [{op: 'add', path: '/cenas/1', value: {...doc().cenas[0], id: 'c1-copia'}}]);
    expect(soma(duplicada)).toBe(16000);
    expect(clipesDe(duplicada).find((c) => c.id === 'e3')!.em).toBe(13000);
  });

  it('o ajuste não muda o documento de antes (o Projeto compara com ele para montar o inverso)', () => {
    const antes = doc();
    const copia = structuredClone(antes);
    expect(somAcompanhaCenas(antes, [{op: 'replace', path: '/cenas/1/duracao_ms', value: 5000}]).map((o) => o.path)).toEqual(['/audio', '/legendas']);
    expect(antes).toEqual(copia);
  });

  it('dividir a cena não mexe no som (a primeira metade fica com o id, a segunda é nova, o total é o mesmo)', () => {
    const antes = doc();
    const r = dividirCena(antes, 'c2', 1500)!;
    expect(r).not.toBeNull();
    expect(edicoesDeTempo(antes, aplicar(antes, r.patch))).toEqual([]);
    expect(somAcompanhaCenas(antes, r.patch)).toEqual([]);
  });

  it('o patch que já mexe no som, a ordem trocada, trocar todas as cenas e acompanha_cenas: false deixam o som em paz', () => {
    const antes = doc();
    const duracao: OperacaoPatch = {op: 'replace', path: '/cenas/1/duracao_ms', value: 5000};
    expect(somAcompanhaCenas(antes, [duracao, {op: 'replace', path: '/audio/faixas/1/clipes/2/em', value: 10000}])).toEqual([]);
    expect(somAcompanhaCenas(antes, [duracao, {op: 'remove', path: '/legendas'}])).toEqual([]);
    expect(somAcompanhaCenas(antes, [{op: 'move', from: '/cenas/0', path: '/cenas/2'}])).toEqual([]); // ordem trocada
    expect(somAcompanhaCenas(antes, [{op: 'replace', path: '/cenas', value: [{id: 'x', duracao_ms: 3000, blocos: []}]}])).toEqual([]); // nenhuma de antes sobra
    expect(somAcompanhaCenas(antes, [{op: 'replace', path: '/cenas/0/blocos', value: []}])).toEqual([]); // não mexe no tempo
    const solta = doc();
    solta.audio!.acompanha_cenas = false;
    expect(somAcompanhaCenas(solta, [duracao])).toEqual([]);
    expect(somAcompanhaCenas(novoDocCenas({largura: 720, altura: 1280, fps: 30}), [duracao])).toEqual([]); // sem som
  });

  it('uma legenda que o corte atravessa é partida na palavra do corte (a cena 2 alongada no meio da fala)', () => {
    const antes = doc();
    antes.legendas!.segmentos[1] = {id: 'leg-2', em: 7500, sai: 8500, texto: 'Fala que atravessa', clipe: 'n1', palavras: palavras([['Fala', 7500, 7800], ['que', 7800, 8100], ['atravessa', 8100, 8500]])};
    const depois = comSom(antes, [{op: 'replace', path: '/cenas/1/duracao_ms', value: 5000}]);
    // o corte é em 8000 (fim da cena 2): "Fala que" fica, "atravessa" anda 1 s
    expect(naTela(depois)).toContain('Fala@7500');
    expect(naTela(depois)).toContain('que@7800');
    expect(naTela(depois)).toContain('atravessa@9100');
  });

  it('pelo Projeto: uma gravação só no diário, com o inverso que devolve o documento de antes (o Ctrl+Z desfaz o conjunto)', () => {
    const pasta = mkdtempSync(path.join(tmpdir(), 'estudio-som-cenas-'));
    try {
      mkdirSync(path.join(pasta, 'video'), {recursive: true});
      writeFileSync(path.join(pasta, 'estudio.json'), JSON.stringify({formato: 1, nome: 'Som e cenas', documentos: [{id: 'video', modulo: 'video', caminho: 'video/video.json', titulo: 'V'}]}));
      const antes = doc();
      writeFileSync(path.join(pasta, 'video', 'video.json'), `${JSON.stringify(antes, null, 2)}\n`);
      const p = new Projeto(pasta);
      p.adicionarAjuste(somAcompanhaCenas);
      p.adicionarAjuste(somAcompanhaCenas); // idempotente
      p.aplicarPatch({documento: 'video', patch: [{op: 'replace', path: '/cenas/1/duracao_ms', value: 5000}], autor: 'pessoa', origem: 'interface', rotulo: 'duração da cena 2'});
      const lido = p.lerJson<DocCenas>('video/video.json').doc;
      expect(lido.cenas[1].duracao_ms).toBe(5000);
      expect(lido.audio!.faixas[0].clipes).toHaveLength(2);
      const diario = p.diario();
      expect(diario).toHaveLength(1);
      expect(diario[0].patch.map((o) => o.path)).toEqual(['/cenas/1/duracao_ms', '/audio', '/legendas']);
      expect(aplicar(lido, diario[0].inverso)).toEqual(antes);
      // sem o ajuste registrado, o som fica onde estava (outro Projeto, mesmo arquivo)
      const sem = new Projeto(pasta);
      sem.aplicarPatch({documento: 'video', patch: [{op: 'replace', path: '/cenas/2/duracao_ms', value: 6000}], autor: 'pessoa', origem: 'interface'});
      expect(sem.lerJson<DocCenas>('video/video.json').doc.audio!.faixas[0].clipes).toHaveLength(2);
    } finally {
      rmSync(pasta, {recursive: true, force: true});
    }
  });
});
