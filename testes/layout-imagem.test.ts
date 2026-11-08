// Seleção e layout da imagem (rodada 3, B2): a caixa girada, alinhar (6) e distribuir (2), o patch que move várias de
// uma vez (com a foto da máscara junto), o redimensionar de camada girada com o canto parado (imagem-D15), o laço, a
// seleção múltipla da loja e as ferramentas selecionar_camadas, alinhar_camadas e distribuir_camadas do MCP.
import {cpSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jsonpatch, {type Operation} from 'fast-json-patch';
import {afterAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {CamadaImagem, DocImagem, OperacaoPatch} from '../src/nucleo/documentos';
import {Projeto} from '../src/nucleo/projeto';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {
  alinhar, alvoDoAlinhamento, caixaDe, caixaDeVarias, cantosDe, comAcompanhantes, distribuir, patchMover, redimensionarGirada, tocadasPor,
} from '../src/nucleo/layout-imagem';
import {alternarNaSelecao, caminhosDaSelecao, loja, selecionarVarias} from '../src/renderer/estado/loja';

const EXEMPLO = path.join(__dirname, '..', 'exemplos', 'exemplo');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-layout-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));

const aplicar = <T,>(doc: T, patch: OperacaoPatch[]): T => jsonpatch.applyPatch(structuredClone(doc), patch as Operation[], true, false).newDocument;
const c = (id: string, x: number, y: number, largura: number, altura: number, extra: Partial<CamadaImagem> = {}): CamadaImagem =>
  ({id, nome: id, tipo: 'forma', x, y, largura, altura, ...extra});

describe('caixa e alinhamento', () => {
  it('a caixa de uma camada girada contém os quatro cantos', () => {
    expect(caixaDe(c('a', 0, 0, 100, 50))).toEqual({x: 0, y: 0, w: 100, h: 50});
    const k = caixaDe(c('a', 0, 0, 100, 50, {rotacao: 90}));
    expect(k.w).toBeCloseTo(50, 6);
    expect(k.h).toBeCloseTo(100, 6);
    expect(k.x).toBeCloseTo(25, 6);
    expect(k.y).toBeCloseTo(-25, 6);
    expect(caixaDeVarias([c('a', 10, 20, 30, 40), c('b', 100, 0, 10, 10)])).toEqual({x: 10, y: 0, w: 100, h: 60});
  });

  it('os seis alinhamentos levam cada caixa à borda ou ao centro do alvo', () => {
    const cs = [c('a', 10, 10, 100, 50), c('b', 300, 200, 50, 100)];
    const alvo = alvoDoAlinhamento(cs, {largura: 1080, altura: 1350});
    expect(alvo).toEqual({x: 10, y: 10, w: 340, h: 290});
    expect(alinhar(cs, 'esquerda', alvo)).toEqual([{dx: 0, dy: 0}, {dx: -290, dy: 0}]);
    expect(alinhar(cs, 'direita', alvo)).toEqual([{dx: 240, dy: 0}, {dx: 0, dy: 0}]);
    expect(alinhar(cs, 'centro', alvo)).toEqual([{dx: 120, dy: 0}, {dx: -145, dy: 0}]);
    expect(alinhar(cs, 'topo', alvo)).toEqual([{dx: 0, dy: 0}, {dx: 0, dy: -190}]);
    expect(alinhar(cs, 'base', alvo)).toEqual([{dx: 0, dy: 240}, {dx: 0, dy: 0}]);
    expect(alinhar(cs, 'meio', alvo)).toEqual([{dx: 0, dy: 120}, {dx: 0, dy: -95}]);
    // uma camada só: o alvo é a prancheta
    const uma = [c('a', 10, 10, 100, 50)];
    expect(alvoDoAlinhamento(uma, {largura: 1080, altura: 1350})).toEqual({x: 0, y: 0, w: 1080, h: 1350});
    expect(alinhar(uma, 'centro', alvoDoAlinhamento(uma, {largura: 1080, altura: 1350}))).toEqual([{dx: 480, dy: 0}]);
  });

  it('distribuir deixa o mesmo espaço entre as caixas; a primeira e a última ficam', () => {
    const cs = [c('a', 0, 0, 100, 10), c('b', 500, 0, 100, 10), c('m', 130, 0, 50, 10)];
    const d = distribuir(cs, 'horizontal');
    expect(d[0]).toEqual({dx: 0, dy: 0});
    expect(d[1]).toEqual({dx: 0, dy: 0});
    // vão = (600 − 0 − 250) / 2 = 175: o do meio vai para 275
    expect(d[2]).toEqual({dx: 145, dy: 0});
    expect(distribuir(cs.slice(0, 2), 'vertical')).toEqual([{dx: 0, dy: 0}, {dx: 0, dy: 0}]);
    const v = distribuir([c('a', 0, 0, 10, 100), c('b', 0, 900, 10, 100), c('m', 0, 100, 10, 100)], 'vertical');
    // vão = (1000 − 0 − 300) / 2 = 350: o do meio vai de 100 para 450
    expect(v[2]).toEqual({dx: 0, dy: 350});
  });

  it('mover várias é um patch só, com test dos ids; a foto vai com a máscara', () => {
    const camadas = [c('fundo', 0, 0, 10, 10), {...c('foto', 100, 100, 400, 400), tipo: 'imagem' as const, mascara: 'circ'}, c('circ', 150, 150, 300, 300), c('t', 0, 0, 50, 50)];
    expect(comAcompanhantes(camadas, [2, 3])).toEqual([1, 2, 3]);
    const patch = patchMover(camadas, '/camadas', [2, 3], [{dx: 10, dy: 0}, {dx: 10, dy: 0}]);
    const depois = aplicar({camadas}, patch).camadas;
    expect(depois.map((k) => k.x)).toEqual([0, 110, 160, 10]);
    expect(patch.filter((o) => o.op === 'test').map((o) => o.value)).toEqual(['foto', 'circ', 't']);
    expect(patchMover(camadas, '/camadas', [3], [{dx: 0, dy: 0}])).toEqual([]);
  });

  it('redimensionar camada girada deixa o canto de cima à esquerda parado (imagem-D15)', () => {
    const girada = c('t', 200, 300, 400, 100, {rotacao: 30});
    const antes = cantosDe(girada)[0];
    const nova = redimensionarGirada(girada, 600, 160);
    const depois = cantosDe({...nova, rotacao: 30})[0];
    expect(Math.abs(depois[0] - antes[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(depois[1] - antes[1])).toBeLessThanOrEqual(1);
    expect(nova).toMatchObject({largura: 600, altura: 160});
    // sem giro, só muda o tamanho
    expect(redimensionarGirada(c('t', 5, 6, 10, 10), 20, 30)).toEqual({x: 5, y: 6, largura: 20, altura: 30});
  });

  it('o laço pega as camadas tocadas, sem as ocultas e sem a foto recortada', () => {
    const camadas = [c('a', 0, 0, 100, 100), c('b', 500, 500, 100, 100), c('oculta', 10, 10, 10, 10, {visivel: false}),
      {...c('foto', 0, 0, 300, 300), tipo: 'imagem' as const, mascara: 'circ'}, c('circ', 20, 20, 200, 200)];
    expect(tocadasPor(camadas, {x: 50, y: 50, w: 10, h: 10})).toEqual([0, 4]);
    expect(tocadasPor(camadas, {x: 0, y: 0, w: 1000, h: 1000})).toEqual([0, 1, 4]);
  });
});

describe('seleção múltipla na loja', () => {
  it('o principal é o último; Shift+clique põe e tira; quem lê só `caminho` continua lendo uma camada', () => {
    selecionarVarias('capa', ['/camadas/0', '/camadas/2']);
    expect(loja.get().selecao).toEqual({documento: 'capa', caminho: '/camadas/2', outros: ['/camadas/0']});
    expect(caminhosDaSelecao(loja.get().selecao)).toEqual(['/camadas/2', '/camadas/0']);
    alternarNaSelecao('capa', '/camadas/1');
    expect(loja.get().selecao?.caminho).toBe('/camadas/1');
    expect(caminhosDaSelecao(loja.get().selecao, 'capa').sort()).toEqual(['/camadas/0', '/camadas/1', '/camadas/2']);
    alternarNaSelecao('capa', '/camadas/1');
    alternarNaSelecao('capa', '/camadas/0');
    expect(loja.get().selecao).toEqual({documento: 'capa', caminho: '/camadas/2'});
    expect(caminhosDaSelecao(loja.get().selecao, 'outro')).toEqual([]);
    selecionarVarias('capa', []);
    expect(loja.get().selecao).toBeNull();
  });
});

describe('ferramentas da seleção e do layout', () => {
  const conectar = async () => {
    const pasta = mkdtempSync(path.join(tmp, 'mcp-'));
    cpSync(EXEMPLO, pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
    const projeto = new Projeto(pasta);
    const servidor = new McpServer({name: 'estudio', version: '0'});
    registrarFerramentas(servidor, projeto, 'agente', 'teste');
    const [a, b] = InMemoryTransport.createLinkedPair();
    const cliente = new Client({name: 'teste', version: '0'});
    await Promise.all([servidor.connect(a), cliente.connect(b)]);
    const chamar = async (name: string, args: Record<string, unknown>) => {
      const r = (await cliente.callTool({name, arguments: args})) as {isError?: boolean; content: {text: string}[]};
      return {erro: Boolean(r.isError), texto: r.content[0].text, dado: r.isError ? undefined : JSON.parse(r.content[0].text)};
    };
    return {projeto, pasta, chamar, capa: () => projeto.lerJson<DocImagem>('imagem/capa.json').doc, fechar: () => cliente.close()};
  };

  it('selecionar_camadas grava o pedido que a tela lê; id e caminho valem', async () => {
    const m = await conectar();
    const r = await m.chamar('selecionar_camadas', {documento: 'capa', camadas: ['titulo', '/camadas/3']});
    expect(r.dado).toMatchObject({ok: true, documento: 'capa', caminhos: ['/camadas/2', '/camadas/3']});
    expect(JSON.parse(readFileSync(path.join(m.pasta, '.estudio', 'selecao.json'), 'utf-8'))).toMatchObject({documento: 'capa', caminhos: ['/camadas/2', '/camadas/3'], autor: 'agente'});
    expect((await m.chamar('selecionar_camadas', {documento: 'capa', camadas: ['nada']})).texto).toMatch(/não achada/);
    await m.fechar();
  });

  it('alinhar_camadas e distribuir_camadas gravam um patch no diário', async () => {
    const m = await conectar();
    // título (940 de largura) e logo (360), os dois em x 70: alinhados à direita, o logo vai para 650
    const r = await m.chamar('alinhar_camadas', {documento: 'capa', camadas: ['titulo', 'logo'], como: 'direita'});
    expect(r.dado).toMatchObject({ok: true, movidas: 1});
    const doc = m.capa();
    const t = doc.camadas.find((k) => k.id === 'titulo')!;
    expect(doc.camadas.find((k) => k.id === 'logo')!.x).toBe(650);
    expect(t.x).toBe(70);
    expect(m.projeto.diario().at(-1)).toMatchObject({autor: 'agente', rotulo: 'alinhar (direita) 2 camada(s)'});
    expect((await m.chamar('alinhar_camadas', {documento: 'capa', camadas: ['titulo', 'subtitulo'], como: 'esquerda'})).dado).toMatchObject({movidas: 0});
    // uma camada só: centraliza na prancheta
    await m.chamar('alinhar_camadas', {documento: 'capa', camadas: ['logo'], como: 'centro'});
    const logo = m.capa().camadas.find((k) => k.id === 'logo')!;
    expect(Math.abs(caixaDe(logo).x + caixaDe(logo).w / 2 - doc.largura / 2)).toBeLessThanOrEqual(0.5);
    expect((await m.chamar('distribuir_camadas', {documento: 'capa', camadas: ['titulo', 'logo'], eixo: 'vertical'})).texto).toMatch(/três camadas/);
    const d = await m.chamar('distribuir_camadas', {documento: 'capa', camadas: ['titulo', 'subtitulo', 'logo'], eixo: 'vertical'});
    expect(d.erro).toBe(false);
    await m.fechar();
  }, 30_000);

  it('recusa id repetido em página duplicada e camadas de páginas diferentes', async () => {
    const m = await conectar();
    const {doc, versao} = m.projeto.lerJson<DocImagem>('imagem/capa.json');
    m.projeto.aplicarPatch({documento: 'capa', versao_base: versao, autor: 'pessoa', origem: 'teste', rotulo: 'duas páginas',
      patch: [{op: 'replace', path: '/camadas', value: []}, {op: 'add', path: '/paginas', value: [{id: 'p1', nome: 'Um', camadas: doc.camadas}, {id: 'p2', nome: 'Dois', camadas: doc.camadas}]}]});
    expect((await m.chamar('alinhar_camadas', {documento: 'capa', camadas: ['titulo'], como: 'topo'})).texto).toMatch(/está em 2 camadas/);
    expect((await m.chamar('alinhar_camadas', {documento: 'capa', camadas: ['/paginas/0/camadas/2', '/paginas/1/camadas/3'], como: 'topo'})).texto).toMatch(/mesma página/);
    const ok = await m.chamar('selecionar_camadas', {documento: 'capa', camadas: ['/paginas/1/camadas/2']});
    expect(ok.dado).toMatchObject({pagina: '/paginas/1', caminhos: ['/paginas/1/camadas/2']});
    await m.fechar();
  }, 30_000);
});
