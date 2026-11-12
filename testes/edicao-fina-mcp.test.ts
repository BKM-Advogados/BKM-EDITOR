// Edição fina pelo MCP (src/nucleo/mcp-edicao-fina.ts): dividir_cena, duplicar_cena, editar_legendas, editar_paginas,
// animar_entrada, animar_saida, adicionar_efeito e remover_efeito, com o servidor de verdade em memória sobre um projeto
// numa pasta temporária. Cada chamada vira UMA entrada no diário, como o agente, e o desfazer a reverte inteira.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {novaAnimacao, type DocAnimacao} from '../src/nucleo/animacao';
import {DURACAO_PREAJUSTE_MS} from '../src/nucleo/animacao-preajustes';
import {docCarrossel} from '../src/nucleo/carrossel';
import {novoDocCenas, resolverCenas, type DocCenas} from '../src/nucleo/cenas';
import {novoDocImagem} from '../src/nucleo/criar-projeto';
import type {DocImagem} from '../src/nucleo/documentos';
import {patchAdicionarEfeitos, patchRemoverEfeito} from '../src/nucleo/efeitos';
import {legendasComSubstituicao, patchDividirLegenda, patchJuntarLegendas, patchNovaLegenda} from '../src/nucleo/legendas-edicao';
import {Projeto} from '../src/nucleo/projeto';

let pasta = '';
let projeto: Projeto;
let cliente: Client;

const VIDEO = 'video/video.json';
const CARROSSEL = 'imagem/carrossel.json';
const CAPA = 'imagem/capa.json';
const ANIMACAO = 'animacao/animacao.json';

const chamar = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await cliente.callTool({name, arguments: args})) as {isError?: boolean; content: {text: string}[]};
  const texto = r.content[0]?.text ?? '';
  return {erro: Boolean(r.isError), texto, json: r.isError ? null : JSON.parse(texto)};
};
const ler = <T,>(rel: string) => projeto.lerJson<T>(rel).doc;

/** Chama a ferramenta e confere que ela gravou uma entrada só no diário, do agente, com o seq devolvido. */
const umPasso = async (rel: string, nome: string, args: Record<string, unknown>) => {
  const antes = structuredClone(ler<unknown>(rel));
  const n = projeto.diario().length;
  const r = await chamar(nome, args);
  expect(r.erro, r.texto).toBe(false);
  const novas = projeto.diario().slice(n);
  expect(novas).toHaveLength(1);
  expect(novas[0]).toMatchObject({autor: 'agente', origem: 'teste', documento: rel});
  expect(r.json.seq).toBe(novas[0].seq);
  return {r: r.json, antes, entrada: novas[0]};
};
/** O desfazer da conversa volta o documento ao que era antes do passo. */
const desfazer = async (rel: string, antes: unknown) => {
  const d = await chamar('desfazer');
  expect(d.erro, d.texto).toBe(false);
  expect(ler<unknown>(rel)).toEqual(antes);
};

const video = (): DocCenas => ({
  ...novoDocCenas({largura: 1080, altura: 1920, fps: 30}),
  cenas: [
    {id: 'c1', duracao_ms: 4000, blocos: [
      {id: 'c1-titulo', tipo: 'titulo', texto: 'Abertura', em: 0, x: 0.1, y: 0.3, largura: 0.8},
      {id: 'c1-texto', tipo: 'texto', texto: 'Depois', em: 2500, x: 0.1, y: 0.5, largura: 0.8},
    ]},
    {id: 'c2', duracao_ms: 3000, blocos: [{id: 'c2-titulo', tipo: 'titulo', texto: 'Fim', em: 0, x: 0.1, y: 0.3, largura: 0.8}]},
  ],
  audio: {faixas: [{id: 'narracao', nome: 'Narração', papel: 'voz', clipes: [{id: 'n1', arquivo: 'midia/narracao.wav', em: 1500, corte_ms: 500, duracao_ms: 6000}]}]},
  // as legendas nasceram com o clipe em 1000 ms; ele andou 500 ms depois, e a tela as mostra 500 ms mais tarde
  legendas: {
    segmentos: [
      {id: 'leg-1', em: 1000, sai: 2200, texto: 'Olá a todos', clipe: 'n1', palavras: [{w: 'Olá', s: 1000, e: 1400}, {w: 'a', s: 1400, e: 1500}, {w: 'todos', s: 1600, e: 2200}]},
      {id: 'leg-2', em: 4500, sai: 6000, texto: 'o fgts é seu', clipe: 'n1', palavras: [{w: 'o', s: 4500, e: 4600}, {w: 'fgts', s: 4650, e: 5200}, {w: 'é', s: 5300, e: 5400}, {w: 'seu', s: 5500, e: 6000}]},
    ],
    origens: [{clipe: 'n1', arquivo: 'midia/narracao.wav', palavras: 'midia/narracao.wav.palavras.json', em: 1000, corte_ms: 500}],
  },
});

const animacao = (): DocAnimacao => ({...novaAnimacao(1920, 1080), duracao_ms: 4000});

beforeAll(async () => {
  pasta = mkdtempSync(path.join(tmpdir(), 'estudio-edicao-fina-'));
  for (const p of ['midia', 'video', 'imagem', 'animacao']) mkdirSync(path.join(pasta, p), {recursive: true});
  writeFileSync(path.join(pasta, 'midia', 'narracao.wav'), 'RIFF de mentira');
  writeFileSync(path.join(pasta, 'estudio.json'), JSON.stringify({formato: 1, nome: 'Edição fina', documentos: [
    {id: 'video', modulo: 'video', caminho: VIDEO, titulo: 'Vídeo'},
    {id: 'carrossel', modulo: 'imagem', caminho: CARROSSEL, titulo: 'Carrossel'},
    {id: 'capa', modulo: 'imagem', caminho: CAPA, titulo: 'Capa'},
    {id: 'animacao', modulo: 'animacao', caminho: ANIMACAO, titulo: 'Animação'},
  ]}));
  writeFileSync(path.join(pasta, VIDEO), JSON.stringify(video()));
  writeFileSync(path.join(pasta, CARROSSEL), JSON.stringify(docCarrossel({largura: 1080, altura: 1350, paginas: 3})));
  writeFileSync(path.join(pasta, CAPA), JSON.stringify(novoDocImagem(1080, 1350)));
  writeFileSync(path.join(pasta, ANIMACAO), JSON.stringify(animacao()));
  projeto = new Projeto(pasta);
  const servidor = new McpServer({name: 'estudio', version: 'teste'});
  registrarFerramentas(servidor, projeto, 'agente', 'teste');
  const [a, b] = InMemoryTransport.createLinkedPair();
  cliente = new Client({name: 'teste', version: '1'});
  await Promise.all([servidor.connect(a), cliente.connect(b)]);
});
afterAll(async () => {
  await cliente?.close();
  rmSync(pasta, {recursive: true, force: true});
});

describe('MCP: lâmina e cópia de cena', () => {
  it('dividir_cena corta no tempo do vídeo, leva o bloco depois do corte para a segunda e desfaz num passo', async () => {
    const {r, antes, entrada} = await umPasso(VIDEO, 'dividir_cena', {documento: 'video', em_ms: 2000});
    expect(entrada.rotulo).toBe('dividir cena 1 em 2 s');
    expect(r).toMatchObject({ok: true, primeira: {id: 'c1', duracao_ms: 2000, blocos: ['c1-titulo']}, segunda: {caminho: '/cenas/1', duracao_ms: 2000}});
    const d = ler<DocCenas>(VIDEO);
    expect(d.cenas.map((c) => c.duracao_ms)).toEqual([2000, 2000, 3000]);
    expect(d.cenas[1].blocos.map((b) => [b.tipo, b.em])).toEqual([['titulo', 0], ['texto', 500]]);
    expect(d.cenas[1].id).not.toBe('c1');
    await desfazer(VIDEO, antes);
  });

  it('dividir_cena acha a cena pelo tempo (a segunda começa em 4 s) e confere a cena pedida', async () => {
    const {r, antes} = await umPasso(VIDEO, 'dividir_cena', {em_ms: 5500});
    expect(r.primeira).toMatchObject({id: 'c2', duracao_ms: 1500});
    await desfazer(VIDEO, antes);
    const fora = await chamar('dividir_cena', {cena: 'c1', em_ms: 5500});
    expect(fora.erro).toBe(true);
    expect(fora.texto).toMatch(/fora da cena c1/);
    const ponta = await chamar('dividir_cena', {em_ms: 4100});
    expect(ponta.erro).toBe(true);
    expect(ponta.texto).toMatch(/300 ms das pontas/);
    const semTempo = await chamar('dividir_cena', {});
    expect(semTempo.erro).toBe(true);
    expect(semTempo.texto).toMatch(/em_ms/);
  });

  it('duplicar_cena põe a cópia logo depois, com ids novos na cena e nos blocos', async () => {
    const {r, antes} = await umPasso(VIDEO, 'duplicar_cena', {cena: 'c2'});
    const d = ler<DocCenas>(VIDEO);
    expect(d.cenas).toHaveLength(3);
    expect(d.cenas[2].id).toBe(r.copia.id);
    expect(d.cenas[2].id).not.toBe('c2');
    expect(d.cenas[2].blocos[0].id).not.toBe('c2-titulo');
    expect(d.cenas[2].blocos[0]).toMatchObject({tipo: 'titulo', texto: 'Fim'});
    await desfazer(VIDEO, antes);
  });
});

describe('MCP: editar_legendas', () => {
  const naTela = () => resolverCenas(ler<DocCenas>(VIDEO)).props.legendas_cenas!.segmentos.map((s) => [s.id, s.em, s.sai, s.texto]);

  it('dividir usa o tempo da tela: a legenda andou 500 ms com o clipe de voz', async () => {
    expect(naTela()[1]).toEqual(['leg-2', 5000, 6500, 'o fgts é seu']);
    // 5650 na tela é 5150 guardado: o corte vai antes de "é" (5300), e não antes de "fgts"
    const {r, antes} = await umPasso(VIDEO, 'editar_legendas', {op: 'dividir', id: 'leg-2', em_ms: 5650});
    expect(r.legendas.map((s: {texto: string}) => s.texto)).toEqual(['o fgts', 'é seu']);
    expect(r.legendas[1].em).toBe(5800); // a palavra "é" na tela
    await desfazer(VIDEO, antes);
  });

  it('juntar, excluir e criar: cada uma num passo do diário, desfeito inteiro', async () => {
    const junta = await umPasso(VIDEO, 'editar_legendas', {op: 'juntar', id: 'leg-1'});
    expect(junta.r).toMatchObject({removida: 'leg-2', legendas: [{id: 'leg-1', texto: 'Olá a todos o fgts é seu'}]});
    await desfazer(VIDEO, junta.antes);

    const ultima = await chamar('editar_legendas', {op: 'juntar', id: 'leg-2'});
    expect(ultima.erro).toBe(true);
    expect(ultima.texto).toMatch(/depois desta/);

    const exclui = await umPasso(VIDEO, 'editar_legendas', {op: 'excluir', id: 'leg-1'});
    expect(ler<DocCenas>(VIDEO).legendas!.segmentos.map((s) => s.id)).toEqual(['leg-2']);
    await desfazer(VIDEO, exclui.antes);

    const cria = await umPasso(VIDEO, 'editar_legendas', {op: 'criar', em_ms: 3000, texto: 'Entre as duas', duracao_ms: 1200});
    expect(cria.r.legendas).toEqual([{id: 'leg-3', em: 3000, sai: 4200, texto: 'Entre as duas'}]);
    expect(ler<DocCenas>(VIDEO).legendas!.segmentos.map((s) => s.id)).toEqual(['leg-1', 'leg-3', 'leg-2']);
    await desfazer(VIDEO, cria.antes);

    const semId = await chamar('editar_legendas', {op: 'excluir'});
    expect(semId.erro).toBe(true);
    expect(semId.texto).toMatch(/id da legenda/);
    const naoHa = await chamar('editar_legendas', {op: 'excluir', id: 'leg-99'});
    expect(naoHa.texto).toMatch(/nao_achado: legenda não achada: leg-99/);
  });

  it('substituir troca em todas e guarda no dicionário; estilo quebra de novo para a predefinição', async () => {
    const troca = await umPasso(VIDEO, 'editar_legendas', {op: 'substituir', procurar: 'fgts', trocar_por: 'FGTS', guardar: true});
    expect(troca.r).toMatchObject({trocas: 1, no_dicionario: true});
    const leg = ler<DocCenas>(VIDEO).legendas!;
    expect(leg.segmentos[1].texto).toBe('o FGTS é seu');
    expect(leg.dicionario).toEqual([{de: 'fgts', para: 'FGTS'}]);
    await desfazer(VIDEO, troca.antes);

    const nada = await chamar('editar_legendas', {op: 'substituir', procurar: 'inexistente', trocar_por: 'x'});
    expect(nada.erro).toBe(true);

    const estilo = await umPasso(VIDEO, 'editar_legendas', {op: 'estilo', predefinicao: 'caixa'});
    expect(estilo.r.estilo).toEqual({predefinicao: 'caixa'});
    // a "caixa" mostra até 3 palavras por vez: "o fgts é seu" vira dois pedaços
    expect(ler<DocCenas>(VIDEO).legendas!.segmentos.length).toBeGreaterThan(2);
    await desfazer(VIDEO, estilo.antes);
  });
});

describe('MCP: editar_paginas', () => {
  const ids = () => ler<DocImagem>(CARROSSEL).paginas!.map((p) => p.id);

  it('nova, duplicar, mover, renomear e excluir, cada uma num passo desfeito inteiro', async () => {
    const original = ids();
    expect(original).toHaveLength(3);

    const nova = await umPasso(CARROSSEL, 'editar_paginas', {documento: 'carrossel', op: 'nova', pagina: '1', nome: 'Extra'});
    expect(nova.r.pagina.n).toBe(2);
    expect(ler<DocImagem>(CARROSSEL).paginas![1]).toMatchObject({nome: 'Extra', camadas: []});
    await desfazer(CARROSSEL, nova.antes);

    const dup = await umPasso(CARROSSEL, 'editar_paginas', {documento: 'carrossel', op: 'duplicar', pagina: original[2]});
    expect(ids()).toHaveLength(4);
    expect(ler<DocImagem>(CARROSSEL).paginas![3].nome).toMatch(/\(cópia\)$/);
    await desfazer(CARROSSEL, dup.antes);

    const mover = await umPasso(CARROSSEL, 'editar_paginas', {documento: 'carrossel', op: 'mover', pagina: '3', para: 1});
    expect(ids()).toEqual([original[2], original[0], original[1]]);
    expect(mover.r.paginas[0]).toMatchObject({n: 1, id: original[2]});
    await desfazer(CARROSSEL, mover.antes);

    const nome = await umPasso(CARROSSEL, 'editar_paginas', {documento: 'carrossel', op: 'renomear', pagina: '2', nome: 'Meio'});
    expect(ler<DocImagem>(CARROSSEL).paginas![1].nome).toBe('Meio');
    await desfazer(CARROSSEL, nome.antes);

    const exclui = await umPasso(CARROSSEL, 'editar_paginas', {documento: 'carrossel', op: 'excluir', pagina: original[1]});
    expect(ids()).toEqual([original[0], original[2]]);
    await desfazer(CARROSSEL, exclui.antes);
    expect(ids()).toEqual(original);
  });

  it('a prancheta só ganha páginas; a última página não sai; vídeo não tem páginas', async () => {
    const r = await umPasso(CAPA, 'editar_paginas', {documento: 'capa', op: 'nova'});
    expect(ler<DocImagem>(CAPA).paginas).toHaveLength(2);
    expect(r.r.paginas.map((p: {n: number}) => p.n)).toEqual([1, 2]);
    await desfazer(CAPA, r.antes);
    expect(ler<DocImagem>(CAPA).paginas).toBeUndefined();

    const ultima = await chamar('editar_paginas', {documento: 'capa', op: 'excluir', pagina: '1'});
    expect(ultima.erro).toBe(true);
    expect(ultima.texto).toMatch(/última página não sai/);
    const noVideo = await chamar('editar_paginas', {documento: 'video', op: 'nova'});
    expect(noVideo.erro).toBe(true);
    expect(noVideo.texto).toMatch(/video é vídeo: esta ferramenta é de imagem/);
    const semPagina = await chamar('editar_paginas', {documento: 'carrossel', op: 'excluir', pagina: '9'});
    expect(semPagina.texto).toMatch(/página não achada: 9/);
  });
});

describe('MCP: entradas e saídas prontas da animação', () => {
  it('animar_entrada sobe do começo até o valor da camada; animar_saida termina no fim', async () => {
    const camada = animacao().camadas[0];
    const entra = await umPasso(ANIMACAO, 'animar_entrada', {camada: camada.id, preajuste: 'subir'});
    expect(entra.r).toMatchObject({preajuste: 'subir', propriedades: ['opacidade', 'y'], de_ms: 0, ate_ms: DURACAO_PREAJUSTE_MS});
    let c = ler<DocAnimacao>(ANIMACAO).camadas[0];
    expect(c.trilhas!.y).toEqual([{t_ms: 0, valor: camada.y + 80, curva: 'saida'}, {t_ms: DURACAO_PREAJUSTE_MS, valor: camada.y, curva: 'suave'}]);
    expect(c.trilhas!.opacidade!.map((k) => k.valor)).toEqual([0, 1]);
    expect(ler<DocAnimacao>(ANIMACAO).camadas[0].trilhas).toBeTruthy();

    const sai = await umPasso(ANIMACAO, 'animar_saida', {camada: camada.id, preajuste: 'surgir', duracao_ms: 400});
    expect(sai.r).toMatchObject({de_ms: 3600, ate_ms: 4000});
    c = ler<DocAnimacao>(ANIMACAO).camadas[0];
    // a entrada fica: os quadros da saída entram depois dos dela
    expect(c.trilhas!.opacidade!.map((k) => [k.t_ms, k.valor])).toEqual([[0, 0], [DURACAO_PREAJUSTE_MS, 1], [3600, 1], [4000, 0]]);
    await desfazer(ANIMACAO, sai.antes);
    await desfazer(ANIMACAO, entra.antes);
  });

  it('recusa camada que não existe e pré-ajuste fora da lista', async () => {
    const sem = await chamar('animar_entrada', {camada: 'nada', preajuste: 'surgir'});
    expect(sem.texto).toMatch(/camada nada não encontrada/);
    const ruim = await chamar('animar_entrada', {camada: animacao().camadas[0].id, preajuste: 'explodir'});
    expect(ruim.erro).toBe(true);
  });
});

describe('MCP: pilha de efeitos', () => {
  it('adicionar_efeito põe um tipo (com o valor preso à faixa) e um pré-ajuste; remover_efeito tira pelo id', async () => {
    const um = await umPasso(VIDEO, 'adicionar_efeito', {documento: 'video', tipo: 'brilho', valor: 5});
    expect(um.r.adicionados).toEqual([{id: 'brilho-1', tipo: 'brilho', valor: 2, caminho: '/efeitos/0'}]);

    const varios = await umPasso(VIDEO, 'adicionar_efeito', {documento: 'video', preajuste: 'cinema'});
    expect(varios.r.adicionados.map((e: {id: string}) => e.id)).toEqual(['contraste-1', 'saturacao-1', 'vinheta-1', 'granulado-1']);
    expect(ler<DocCenas>(VIDEO).efeitos!.map((e) => e.id)).toEqual(['brilho-1', 'contraste-1', 'saturacao-1', 'vinheta-1', 'granulado-1']);

    const tira = await umPasso(VIDEO, 'remover_efeito', {documento: 'video', id: 'vinheta-1'});
    expect(tira.r.restam).toEqual(['brilho-1', 'contraste-1', 'saturacao-1', 'granulado-1']);
    await desfazer(VIDEO, tira.antes);
    await desfazer(VIDEO, varios.antes);
    await desfazer(VIDEO, um.antes);
  });

  it('na imagem também; recusa tipo com pré-ajuste, cor fora do tom e id que não está na pilha', async () => {
    const tom = await umPasso(CAPA, 'adicionar_efeito', {documento: 'capa', tipo: 'tom', cor: '#336699'});
    expect(ler<DocImagem>(CAPA).efeitos).toEqual([{id: 'tom-1', tipo: 'tom', valor: 0.25, cor: '#336699'}]);
    await desfazer(CAPA, tom.antes);
    expect((await chamar('adicionar_efeito', {documento: 'capa', tipo: 'brilho', preajuste: 'quente'})).texto).toMatch(/um dos dois/);
    expect((await chamar('adicionar_efeito', {documento: 'capa', tipo: 'brilho', cor: '#000000'})).texto).toMatch(/só no efeito tom/);
    expect((await chamar('remover_efeito', {documento: 'capa', id: 'nada'})).texto).toMatch(/efeito não achado: nada/);
    expect((await chamar('adicionar_efeito', {documento: 'animacao', tipo: 'brilho'})).texto).toMatch(/é animação/);
  });
});

describe('núcleo: as contas que a tela e o MCP dividem', () => {
  const doc = video();

  it('juntar e dividir legenda conferem o id e a palavra', () => {
    const j = patchJuntarLegendas(doc, 'leg-1');
    expect('patch' in j && j.patch[0]).toEqual({op: 'test', path: '/legendas/segmentos/0/id', value: 'leg-1'});
    const d = patchDividirLegenda(doc, 'leg-1', 1450);
    expect('partes' in d && d.partes.map((p) => p.texto)).toEqual(['Olá a', 'todos']);
    expect(patchDividirLegenda({...doc, legendas: {segmentos: [{id: 'x', em: 0, sai: 500, texto: 'Só'}]}}, 'x')).toEqual({erro: 'uma palavra só não se divide'});
  });

  it('legenda nova num vídeo sem legendas cria a lista; substituir sem guardar não mexe no dicionário', () => {
    const r = patchNovaLegenda({...doc, legendas: undefined}, 1000);
    expect(r.patch).toEqual([{op: 'add', path: '/legendas', value: {estilo: {predefinicao: 'classica'}, segmentos: [{id: 'leg-1', em: 1000, sai: 3000, texto: 'Nova legenda'}]}}]);
    const s = legendasComSubstituicao(doc.legendas!, 'todos', 'vocês');
    expect(s.trocas).toBe(1);
    expect(s.legendas.dicionario).toBeUndefined();
  });

  it('efeitos: pilha que não é lista vira lista; remover confere o id', () => {
    expect(patchAdicionarEfeitos({efeitos: 'quebrado'}, [{id: 'sepia-1', tipo: 'sepia', valor: 0.4}]))
      .toEqual({primeiro: 0, patch: [{op: 'replace', path: '/efeitos', value: [{id: 'sepia-1', tipo: 'sepia', valor: 0.4}]}]});
    expect(patchRemoverEfeito([{id: 'a', tipo: 'brilho', valor: 1}], 0)).toEqual([{op: 'test', path: '/efeitos/0/id', value: 'a'}, {op: 'remove', path: '/efeitos/0'}]);
  });
});
