// Zoom dinâmico (Ken Burns) no bloco de imagem do vídeo de cenas (rodada 2, frente C, 07/11/2026).
import {mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jsonpatch, {type Operation} from 'fast-json-patch';
import {afterAll, describe, expect, it} from 'vitest';
import {novoBlocoCenas, novoDocCenas, resolverCenas, type BlocoCenas, type DocCenas} from '../src/nucleo/cenas';
import {gravarPlano, planoDoProjeto} from '../src/nucleo/criar-projeto';
import {Projeto} from '../src/nucleo/projeto';
import {
  INTENSIDADE_MAX, INTENSIDADE_PADRAO, movimentoEmInteira, patchMovimentoEmTodas, quadroDoMovimento, SEQUENCIA_MOVIMENTO, TIPOS_MOVIMENTO,
  transformDoMovimento,
} from '../src/composicoes/cenas/movimento';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-movimento-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));

const imagem = (id: string, extra: Partial<BlocoCenas> = {}): BlocoCenas => ({id, tipo: 'imagem', x: 0, y: 0, largura: 1, altura: 1, src: `midia/${id}.jpg`, ajuste: 'cobrir', ...extra});

// três imagens paradas em duas cenas, mais um título que não pode ganhar movimento
const doc = (): DocCenas => ({
  ...novoDocCenas({largura: 1080, altura: 1920, fps: 30}),
  cenas: [
    {id: 'a', duracao_ms: 3000, blocos: [imagem('a-imagem'), {id: 'a-titulo', tipo: 'titulo', x: 0.1, y: 0.7, largura: 0.8, texto: 'Título'}]},
    {id: 'b', duracao_ms: 3000, blocos: [imagem('b-imagem'), imagem('b-imagem-2', {em: 1500})]},
  ],
});

const aplicarPatch = (d: DocCenas, patch: unknown[]) => jsonpatch.applyPatch(structuredClone(d), patch as Operation[], true).newDocument as DocCenas;

describe('Ken Burns', () => {
  it('sem movimento (ou com tipo desconhecido) a imagem fica parada e o transform não muda', () => {
    expect(quadroDoMovimento(undefined, 0.5)).toEqual({escala: 1, x: 0, y: 0});
    expect(transformDoMovimento(undefined, 0.5)).toBeUndefined();
    expect(transformDoMovimento({tipo: 'girar' as never}, 0.5)).toBeUndefined();
  });

  it('aproximar vai de 1 a 1 + intensidade; afastar faz o caminho de volta', () => {
    expect(quadroDoMovimento({tipo: 'aproximar'}, 0).escala).toBeCloseTo(1);
    expect(quadroDoMovimento({tipo: 'aproximar'}, 1).escala).toBeCloseTo(1 + INTENSIDADE_PADRAO);
    expect(quadroDoMovimento({tipo: 'afastar', intensidade: 0.3}, 0).escala).toBeCloseTo(1.3);
    expect(quadroDoMovimento({tipo: 'afastar', intensidade: 0.3}, 1).escala).toBeCloseTo(1);
    // fora da faixa volta para dentro dela
    expect(quadroDoMovimento({tipo: 'aproximar', intensidade: 9}, 1).escala).toBeCloseTo(1 + INTENSIDADE_MAX);
  });

  it('suave começa e termina devagar; linear anda igual', () => {
    const s = (p: number) => quadroDoMovimento({tipo: 'aproximar'}, p).escala;
    const l = (p: number) => quadroDoMovimento({tipo: 'aproximar', suave: false}, p).escala;
    expect(s(0.1) - s(0)).toBeLessThan(l(0.1) - l(0));
    expect(s(0.55) - s(0.45)).toBeGreaterThan(l(0.55) - l(0.45));
    expect(s(0.5)).toBeCloseTo(l(0.5));
  });

  it('deslizar nunca passa da folga que a escala dá: a borda da imagem não aparece', () => {
    for (const t of TIPOS_MOVIMENTO.filter((x) => x.id !== 'aproximar' && x.id !== 'afastar')) {
      for (const intensidade of [0.05, 0.15, 0.4]) {
        for (const p of [0, 0.25, 0.5, 0.75, 1]) {
          const q = quadroDoMovimento({tipo: t.id, intensidade}, p);
          const folga = (q.escala - 1) / 2;
          expect(Math.abs(q.x)).toBeLessThan(folga);
          expect(Math.abs(q.y)).toBeLessThan(folga);
        }
      }
    }
    // esquerda: a imagem anda para a esquerda (x desce); cima: sobe (y desce)
    expect(quadroDoMovimento({tipo: 'esquerda'}, 1).x).toBeLessThan(quadroDoMovimento({tipo: 'esquerda'}, 0).x);
    expect(quadroDoMovimento({tipo: 'direita'}, 1).x).toBeGreaterThan(quadroDoMovimento({tipo: 'direita'}, 0).x);
    expect(quadroDoMovimento({tipo: 'cima'}, 1).y).toBeLessThan(quadroDoMovimento({tipo: 'cima'}, 0).y);
    expect(quadroDoMovimento({tipo: 'baixo'}, 1).y).toBeGreaterThan(quadroDoMovimento({tipo: 'baixo'}, 0).y);
  });

  it('progresso fora de 0 a 1 fica nas pontas (antes de entrar e depois de sair)', () => {
    expect(quadroDoMovimento({tipo: 'aproximar'}, -2)).toEqual(quadroDoMovimento({tipo: 'aproximar'}, 0));
    expect(quadroDoMovimento({tipo: 'aproximar'}, 3)).toEqual(quadroDoMovimento({tipo: 'aproximar'}, 1));
    expect(transformDoMovimento({tipo: 'esquerda'}, 0)).toMatch(/^translate\(-?[\d.]+%, -?[\d.]+%\) scale\([\d.]+\)$/);
  });

  it('"Movimento em todas as imagens" alterna os tipos, pula o título e o mesmo botão tira de todas', () => {
    const d = doc();
    const r = patchMovimentoEmTodas(d);
    expect(r).toMatchObject({n: 3, acao: 'por', preencher: 0}); // já estavam em Preencher: o encaixe não entra no patch
    expect(r.patch.some((o) => o.path.endsWith('/ajuste'))).toBe(false);
    const com = aplicarPatch(d, r.patch);
    const tipos = com.cenas.flatMap((c) => c.blocos).filter((b) => b.tipo === 'imagem').map((b) => b.movimento?.tipo);
    expect(tipos).toEqual(SEQUENCIA_MOVIMENTO.slice(0, 3));
    expect(com.cenas[0].blocos[1].movimento).toBeUndefined();
    // o documento continua resolvendo e o campo chega à composição
    expect(resolverCenas(com).props.cenas[1].blocos[1].movimento?.tipo).toBe(SEQUENCIA_MOVIMENTO[2]);

    const tirar = patchMovimentoEmTodas(com);
    expect(tirar).toMatchObject({n: 3, acao: 'tirar'});
    expect(aplicarPatch(com, tirar.patch)).toEqual(d);
  });

  it('só as paradas ganham movimento; a que já tinha fica como está', () => {
    const d = doc();
    d.cenas[1].blocos[0].movimento = {tipo: 'cima', intensidade: 0.2};
    const r = patchMovimentoEmTodas(d);
    expect(r.n).toBe(2);
    const com = aplicarPatch(d, r.patch);
    expect(com.cenas[1].blocos[0].movimento).toEqual({tipo: 'cima', intensidade: 0.2});
    expect(com.cenas[0].blocos[0].movimento?.tipo).toBe('aproximar');
    expect(com.cenas[1].blocos[1].movimento?.tipo).toBe('afastar');
  });

  it('o patch confere o id: se o agente trocou o bloco por baixo, não aplica', () => {
    const d = doc();
    const r = patchMovimentoEmTodas(d);
    d.cenas[0].blocos[0].id = 'outro';
    expect(() => aplicarPatch(d, r.patch)).toThrow();
    expect(patchMovimentoEmTodas({...d, cenas: []})).toEqual({patch: [], n: 0, acao: 'por', preencher: 0});
  });

  // video-D12 (pesquisa de qualidade de 07/11): no encaixe Inteira, padrão do bloco novo, a foto e as faixas vazias
  // passeavam juntas dentro da caixa
  const semAjuste = ({ajuste: _a, ...b}: BlocoCenas): BlocoCenas => b;
  const emInteira = (): DocCenas => ({
    ...novoDocCenas({largura: 1080, altura: 1920, fps: 30}),
    cenas: [
      {id: 'a', duracao_ms: 3000, blocos: [{...novoBlocoCenas('imagem', 'a-imagem'), src: 'midia/a.jpg'}]}, // ajuste: 'conter'
      {id: 'b', duracao_ms: 3000, blocos: [semAjuste(imagem('b-imagem')), imagem('b-imagem-2')]}, // sem encaixe e Preencher
    ],
  });

  it('o botão passa para Preencher as imagens em Inteira (ou sem encaixe) no mesmo patch, e só elas', () => {
    const d = emInteira();
    expect(d.cenas[0].blocos[0].ajuste).toBe('conter');
    const r = patchMovimentoEmTodas(d);
    expect(r).toMatchObject({n: 3, acao: 'por', preencher: 2});
    // o encaixe vem logo depois do movimento de cada bloco, protegido pelo mesmo "test" do id
    expect(r.patch.filter((o) => o.path.endsWith('/ajuste')).map((o) => o.path)).toEqual(['/cenas/0/blocos/0/ajuste', '/cenas/1/blocos/0/ajuste']);
    const com = aplicarPatch(d, r.patch);
    const imgs = com.cenas.flatMap((c) => c.blocos);
    expect(imgs.map((b) => b.ajuste)).toEqual(['cobrir', 'cobrir', 'cobrir']);
    expect(imgs.every((b) => b.movimento && !movimentoEmInteira(b))).toBe(true);
    // o resto do bloco não muda
    expect({...imgs[0], ajuste: 'conter', movimento: undefined}).toEqual({...d.cenas[0].blocos[0], movimento: undefined});
    // tirar o movimento deixa o encaixe como está (não há como saber o de antes; o Ctrl+Z do "pôr" é quem volta tudo)
    const sem = aplicarPatch(com, patchMovimentoEmTodas(com).patch);
    expect(sem.cenas.flatMap((c) => c.blocos).map((b) => [b.ajuste, b.movimento])).toEqual([['cobrir', undefined], ['cobrir', undefined], ['cobrir', undefined]]);
  });

  it('a imagem que já se movia em Inteira não muda; o inspetor é que avisa', () => {
    const d = emInteira();
    d.cenas[0].blocos[0].movimento = {tipo: 'baixo'};
    const r = patchMovimentoEmTodas(d);
    expect(r).toMatchObject({n: 2, preencher: 1});
    const com = aplicarPatch(d, r.patch);
    expect(com.cenas[0].blocos[0]).toEqual(d.cenas[0].blocos[0]);
    expect(movimentoEmInteira(com.cenas[0].blocos[0])).toBe(true);
    // o aviso só vale para imagem com movimento fora do Preencher
    expect(movimentoEmInteira({tipo: 'imagem', ajuste: 'cobrir', movimento: {tipo: 'aproximar'}})).toBe(false);
    expect(movimentoEmInteira({tipo: 'imagem', ajuste: 'conter'})).toBe(false);
    expect(movimentoEmInteira({tipo: 'imagem', movimento: {tipo: 'aproximar'}})).toBe(true);
    expect(movimentoEmInteira({tipo: 'titulo', movimento: {tipo: 'aproximar'}})).toBe(false);
  });

  it('no projeto, um único Ctrl+Z tira o movimento e volta o encaixe para Inteira', () => {
    const destino = gravarPlano(path.join(tmp, 'kenburns'), planoDoProjeto({nome: 'Ken Burns', modelo: 'video-branco'}));
    const p = new Projeto(destino);
    const rel = p.arquivoDoDocumento('video');
    const inicio = p.lerJson<DocCenas>(rel);
    const pronto = p.aplicarPatch({documento: 'video', versao_base: inicio.versao, patch: [{op: 'replace', path: '/cenas', value: emInteira().cenas}],
      autor: 'pessoa', origem: 'interface', rotulo: 'três imagens'});
    const antes = p.lerJson<DocCenas>(rel);
    const r = patchMovimentoEmTodas(antes.doc);
    const feito = p.aplicarPatch({documento: 'video', versao_base: pronto.versao, patch: r.patch, autor: 'pessoa', origem: 'interface', rotulo: 'movimento em 3 imagens'});
    expect(p.lerJson<DocCenas>(rel).doc.cenas.flatMap((c) => c.blocos).map((b) => b.ajuste)).toEqual(['cobrir', 'cobrir', 'cobrir']);
    expect(p.diario().filter((e) => e.rotulo === 'movimento em 3 imagens')).toHaveLength(1);
    p.aplicarPatch({documento: 'video', versao_base: feito.versao, patch: feito.entrada.inverso, autor: 'pessoa', origem: 'desfazer', rotulo: 'desfazer'});
    expect(p.lerJson<DocCenas>(rel).doc).toEqual(antes.doc);
  });
});
