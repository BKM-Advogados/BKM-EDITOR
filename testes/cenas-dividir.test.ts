// Lâmina: dividir cena no cursor (grupo 5 da Ordem sugerida, 06/11/2026).
import {mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jsonpatch, {type Operation} from 'fast-json-patch';
import {afterAll, describe, expect, it} from 'vitest';
import {novoDocCenas, resolverCenas, type DocCenas} from '../src/nucleo/cenas';
import {dividirCena, PEDACO_MIN_MS} from '../src/nucleo/cenas-dividir';
import {gravarPlano, planoDoProjeto} from '../src/nucleo/criar-projeto';
import {Projeto} from '../src/nucleo/projeto';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-lamina-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));

// cena de 4 s com um bloco que acaba antes do corte (2 s), dois que atravessam (um com sai, outro até o fim) e um que
// começa depois
const doc = (): DocCenas => ({
  ...novoDocCenas({largura: 1080, altura: 1920, fps: 30}),
  cenas: [
    {id: 'a', nome: 'Abertura', duracao_ms: 4000, blocos: [
      {id: 'a-titulo', tipo: 'titulo', x: 0.1, y: 0.3, largura: 0.8, em: 0, sai: 1000, texto: 'Antes'},
      {id: 'a-texto', tipo: 'texto', x: 0.1, y: 0.5, largura: 0.8, em: 500, sai: 3500, texto: 'Atravessa'},
      {id: 'a-lista', tipo: 'lista', x: 0.1, y: 0.6, largura: 0.8, em: 2500, itens: ['Depois']},
      {id: 'a-numero', tipo: 'numero', x: 0.1, y: 0.7, largura: 0.8, em: 1000, de: 0, ate: 10},
    ]},
    {id: 'b', duracao_ms: 3000, blocos: []},
  ],
});

describe('lâmina', () => {
  it('reparte os blocos: o de antes fica, o de depois vai, o que atravessa vai aparado para as duas', () => {
    const r = dividirCena(doc(), 'a', 2000)!;
    expect(r.indice).toBe(0);
    expect(r.primeira).toMatchObject({id: 'a', nome: 'Abertura', duracao_ms: 2000});
    expect(r.primeira.blocos.map((b) => b.id)).toEqual(['a-titulo', 'a-texto', 'a-numero']);
    expect(r.primeira.blocos[0]).toMatchObject({em: 0, sai: 1000});
    expect(r.primeira.blocos[1]).toMatchObject({em: 500, sai: 2000}); // sai explícito vira o fim da primeira
    expect(r.primeira.blocos[2].sai).toBeUndefined(); // sem sai continua indo até o fim
    expect(r.segunda).toMatchObject({nome: 'Abertura', duracao_ms: 2000});
    expect(r.segunda.blocos.map((b) => b.tipo)).toEqual(['texto', 'lista', 'numero']);
    expect(r.segunda.blocos[0]).toMatchObject({em: 0, sai: 1500, texto: 'Atravessa'});
    expect(r.segunda.blocos[1]).toMatchObject({em: 500, itens: ['Depois']});
    expect(r.segunda.blocos[2]).toMatchObject({em: 0});
    expect(r.segunda.blocos[2].sai).toBeUndefined();
  });

  it('a segunda cena nasce com ids novos e nenhum repetido', () => {
    const d = doc();
    const r = dividirCena(d, 'a', 2000)!;
    expect(r.segunda.id).toBe('cena-1');
    const ids = [...r.primeira.blocos, ...r.segunda.blocos].map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(r.segunda.blocos.every((b) => b.id.startsWith('cena-1-'))).toBe(true);
  });

  it('o patch aplicado resolve com os tempos certos e o bloco que atravessa continua inteiro no vídeo', () => {
    const d = doc();
    const r = dividirCena(d, 'a', 2000)!;
    const novo = jsonpatch.applyPatch(structuredClone(d), r.patch as Operation[], true, false).newDocument as DocCenas;
    expect(novo.cenas.map((c) => c.id)).toEqual(['a', 'cena-1', 'b']);
    const {props, avisos} = resolverCenas(novo);
    expect(avisos).toEqual([]);
    expect(props.duracao_ms).toBe(7000);
    expect(props.cenas.map((c) => [c.t_in, c.t_out])).toEqual([[0, 2000], [2000, 4000], [4000, 7000]]);
    const texto = props.cenas.flatMap((c) => c.blocos).filter((b) => b.texto === 'Atravessa');
    expect(texto.map((b) => [b.em, b.sai])).toEqual([[500, 2000], [2000, 3500]]);
  });

  it('recusa corte perto demais das pontas e cena que não existe; cena vazia divide em duas vazias', () => {
    const d = doc();
    expect(dividirCena(d, 'a', PEDACO_MIN_MS - 1)).toBeNull();
    expect(dividirCena(d, 'a', 4000 - PEDACO_MIN_MS + 1)).toBeNull();
    expect(dividirCena(d, 'a', PEDACO_MIN_MS)).not.toBeNull();
    expect(dividirCena(d, 'a', 4000 - PEDACO_MIN_MS)).not.toBeNull();
    expect(dividirCena(d, 'zzz', 1000)).toBeNull();
    const r = dividirCena(d, 'b', 1500)!;
    expect(r.indice).toBe(1);
    expect([r.primeira.duracao_ms, r.segunda.duracao_ms]).toEqual([1500, 1500]);
    expect(r.segunda.blocos).toEqual([]);
  });

  it('no projeto, o inverso do diário desfaz a divisão (Ctrl+Z)', () => {
    const destino = gravarPlano(path.join(tmp, 'lamina'), planoDoProjeto({nome: 'Lâmina', modelo: 'video-branco'}));
    const p = new Projeto(destino);
    const rel = p.arquivoDoDocumento('video');
    const antes = p.lerJson<DocCenas>(rel);
    const r = dividirCena(antes.doc, antes.doc.cenas[0].id, 2000)!;
    const feito = p.aplicarPatch({documento: 'video', versao_base: antes.versao, patch: r.patch, autor: 'pessoa', origem: 'interface', rotulo: 'dividir cena 1'});
    expect(p.lerJson<DocCenas>(rel).doc.cenas).toHaveLength(2);
    p.aplicarPatch({documento: 'video', versao_base: feito.versao, patch: feito.entrada.inverso, autor: 'pessoa', origem: 'desfazer', rotulo: 'desfazer'});
    expect(p.lerJson<DocCenas>(rel).doc).toEqual(antes.doc);
  });
});
