// Grupos e travas na imagem (rodada 3, B2): agrupar deixa as camadas vizinhas com o mesmo grupo, desagrupar tira, o
// laço e o alinhar tratam o grupo como uma unidade, camada travada não anda e o patch da IA nela é recusado no núcleo
// (Projeto.aplicarPatch), destravar só pela ferramenta; o comentário do carrossel acha a página pelo id (imagem-D5) e o
// ponto da lista vale só para a camada da página dele (imagem-N1); remover_fundo não grava na página gêmea (imagem-N6).
import {cpSync, mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jsonpatch, {type Operation} from 'fast-json-patch';
import {afterAll, afterEach, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {CamadaImagem, DocImagem, OperacaoPatch} from '../src/nucleo/documentos';
import {Projeto} from '../src/nucleo/projeto';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {caminhoDoAlvo, paginaDoAlvo, patchNovaPagina} from '../src/nucleo/carrossel';
import {expandirGrupos, patchAgrupar, patchDesagrupar, patchMover, patchTravar, planoAlinhar, planoDistribuir, tocadasPor, unidadesDe} from '../src/nucleo/layout-imagem';
import {destravando, motivoDaTrava} from '../src/nucleo/travas-imagem';
import {definirRemovedorDeFundo} from '../src/nucleo/remover-fundo';
import {gravarSemFundo} from '../src/main/remover-fundo';

const EXEMPLO = path.join(__dirname, 'fixtures', 'projeto');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-grupos-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));
afterEach(() => definirRemovedorDeFundo(null));

const aplicar = <T,>(doc: T, patch: OperacaoPatch[]): T => jsonpatch.applyPatch(structuredClone(doc), patch as Operation[], true, false).newDocument;
const c = (id: string, x: number, y: number, extra: Partial<CamadaImagem> = {}): CamadaImagem => ({id, nome: id, tipo: 'forma', x, y, largura: 100, altura: 100, ...extra});
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('grupos', () => {
  const pilha = () => ({camadas: [c('a', 0, 0), c('b', 200, 0), c('c', 400, 0), c('d', 600, 0), c('e', 800, 0)]});

  it('Ctrl+G: mesmo grupo, vizinhas na pilha onde estava a de cima, ordem entre elas mantida; um patch só', () => {
    const doc = pilha();
    const r = patchAgrupar(doc.camadas, '/camadas', [0, 2, 3])!;
    const depois = aplicar(doc, r.patch);
    expect(depois.camadas.map((k) => k.id)).toEqual(['b', 'a', 'c', 'd', 'e']);
    expect(depois.camadas.map((k) => k.grupo ?? '-')).toEqual(['-', 'grupo-1', 'grupo-1', 'grupo-1', '-']);
    expect(r.caminhos).toEqual(['/camadas/1', '/camadas/2', '/camadas/3']);
    expect(patchAgrupar(doc.camadas, '/camadas', [2])).toBeNull();
    // o segundo grupo ganha outro id; desagrupar tira o grupo inteiro
    const dois = aplicar(depois, patchAgrupar(depois.camadas, '/camadas', [0, 4])!.patch);
    expect(new Set(dois.camadas.map((k) => k.grupo))).toEqual(new Set(['grupo-1', 'grupo-2']));
    const solto = aplicar(dois, patchDesagrupar(dois.camadas, '/camadas', [dois.camadas.findIndex((k) => k.id === 'c')]));
    expect(solto.camadas.filter((k) => k.grupo === 'grupo-1')).toEqual([]);
    expect(solto.camadas.filter((k) => k.grupo === 'grupo-2').length).toBe(2);
  });

  it('o grupo é uma unidade: laço traz o grupo inteiro, alinhar move o grupo junto, distribuir conta o grupo como um', () => {
    const camadas = [c('a', 0, 0, {grupo: 'g'}), c('b', 150, 300, {grupo: 'g'}), c('c', 600, 50), c('d', 900, 500)];
    expect(expandirGrupos(camadas, [1])).toEqual([0, 1]);
    expect(tocadasPor(camadas, {x: 160, y: 310, w: 5, h: 5})).toEqual([0, 1]);
    expect(unidadesDe(camadas, [0, 1, 2])).toEqual([[0, 1], [2]]);
    const plano = planoAlinhar(camadas, [0, 1, 2], 'topo', {largura: 1080, altura: 1350});
    const depois = aplicar({camadas}, patchMover(camadas, '/camadas', plano.indices, plano.desl)).camadas;
    // a caixa da seleção começa em y 0: o grupo já está no topo e não anda; c sobe 50
    expect(depois.map((k) => k.y)).toEqual([0, 300, 0, 500]);
    // um grupo sozinho alinha à prancheta, inteiro
    const sozinho = planoAlinhar(camadas, [0, 1], 'direita', {largura: 1080, altura: 1350});
    expect(sozinho.desl).toEqual([{dx: 830, dy: 0}, {dx: 830, dy: 0}]);
    expect(planoDistribuir(camadas, [0, 1, 2, 3], 'horizontal').unidades).toBe(3);
  });
});

describe('travas', () => {
  const doc = (): DocImagem => ({formato: 1, largura: 1080, altura: 1350, fundo: '#000', camadas: [c('fundo', 0, 0, {travada: true}), c('t', 10, 10)]});

  it('travada não anda: fica fora do laço, do patch de mover e do alinhar', () => {
    const d = doc();
    expect(tocadasPor(d.camadas, {x: 0, y: 0, w: 2000, h: 2000})).toEqual([1]);
    expect(patchMover(d.camadas, '/camadas', [0, 1], [{dx: 5, dy: 0}, {dx: 5, dy: 0}]).filter((o) => o.op === 'test').map((o) => o.value)).toEqual(['t']);
    expect(planoAlinhar(d.camadas, [0, 1], 'centro', {largura: 1080, altura: 1350}).desl[0]).toEqual({dx: 0, dy: 0});
  });

  it('patch da IA que mexe, apaga ou destrava camada travada é recusado; da pessoa passa; travar e reordenar passam', () => {
    const d = doc();
    expect(motivoDaTrava(d, [{op: 'replace', path: '/camadas/0/x', value: 50}], 'agente')).toMatch(/travada pela pessoa/);
    expect(motivoDaTrava(d, [{op: 'remove', path: '/camadas/0'}], 'agente')).toMatch(/travada/);
    expect(motivoDaTrava(d, [{op: 'replace', path: '/camadas', value: []}], 'agente')).toMatch(/travada/);
    expect(motivoDaTrava(d, [{op: 'remove', path: '/camadas/0/travada'}], 'agente')).toMatch(/destravar_camadas/);
    expect(motivoDaTrava(d, [{op: 'replace', path: '/camadas/0/x', value: 50}], 'pessoa')).toBeNull();
    expect(motivoDaTrava(d, [{op: 'replace', path: '/camadas/1/x', value: 50}], 'agente')).toBeNull();
    expect(motivoDaTrava(d, [{op: 'add', path: '/camadas/1/travada', value: true}], 'agente')).toBeNull();
    expect(motivoDaTrava(d, [{op: 'move', from: '/camadas/0', path: '/camadas/1'}], 'agente')).toBeNull();
    expect(destravando(() => motivoDaTrava(d, patchTravar(d.camadas, '/camadas', [0], false), 'agente'))).toBeNull();
    expect(motivoDaTrava(d, patchTravar(d.camadas, '/camadas', [0], false), 'agente')).toMatch(/destravar_camadas/);
  });

  it('no núcleo: Projeto.aplicarPatch recusa o patch do agente e grava o da pessoa', () => {
    const pasta = mkdtempSync(path.join(tmp, 'nucleo-'));
    cpSync(EXEMPLO, pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
    const p = new Projeto(pasta);
    const {versao} = p.lerJson('imagem/capa.json');
    p.aplicarPatch({documento: 'capa', versao_base: versao, patch: [{op: 'add', path: '/camadas/4/travada', value: true}], autor: 'pessoa', origem: 'teste'});
    expect(() => p.aplicarPatch({documento: 'capa', patch: [{op: 'replace', path: '/camadas/4/x', value: 0}], autor: 'agente', origem: 'mcp'})).toThrow(/logo está travada/);
    expect(p.lerJson<DocImagem>('imagem/capa.json').doc.camadas[4].x).toBe(70);
    p.aplicarPatch({documento: 'capa', patch: [{op: 'replace', path: '/camadas/4/x', value: 0}], autor: 'pessoa', origem: 'interface'});
    expect(p.lerJson<DocImagem>('imagem/capa.json').doc.camadas[4].x).toBe(0);
  });
});

describe('comentários do carrossel', () => {
  const carrossel = (): DocImagem => ({formato: 1, largura: 1080, altura: 1350, fundo: '#000', camadas: [],
    paginas: [{id: 'p1', nome: 'Um', camadas: [c('titulo', 0, 0)]}, {id: 'p2', nome: 'Dois', camadas: [c('titulo', 0, 0)]}, {id: 'p3', nome: 'Três', camadas: [c('foto', 0, 0), c('titulo', 0, 0)]}]});

  it('a página nova inserida antes não leva o comentário para outra página (imagem-D5)', () => {
    const doc = carrossel();
    const alvo = {objeto: '/paginas/2/camadas/1', objeto_id: 'titulo', pagina_id: 'p3'};
    expect(caminhoDoAlvo(doc, alvo)).toBe('/paginas/2/camadas/1');
    const depois = aplicar(doc, patchNovaPagina(doc, 0).patch);
    expect(paginaDoAlvo(depois, alvo)).toBe(3);
    expect(caminhoDoAlvo(depois, alvo)).toBe('/paginas/3/camadas/1');
    // a pilha da página mudou: acha pelo id da camada
    const pilha = aplicar(depois, [{op: 'move', from: '/paginas/3/camadas/1', path: '/paginas/3/camadas/0'}]);
    expect(caminhoDoAlvo(pilha, alvo)).toBe('/paginas/3/camadas/0');
    // comentário antigo, sem a página: continua pelo caminho
    expect(paginaDoAlvo(depois, {objeto: '/paginas/2/camadas/1'})).toBe(2);
  });

  it('o ponto da lista acende só na camada da página do comentário, não no mesmo id das outras (imagem-N1)', () => {
    const doc = carrossel();
    const alvo = {objeto: '/paginas/2/camadas/1', objeto_id: 'titulo', pagina_id: 'p3'};
    const acesos = [0, 1, 2].flatMap((p) => doc.paginas![p].camadas.map((_, i) => `/paginas/${p}/camadas/${i}`)).filter((k) => k === caminhoDoAlvo(doc, alvo));
    expect(acesos).toEqual(['/paginas/2/camadas/1']);
  });
});

describe('ferramentas de grupo e trava', () => {
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

  it('agrupar, travar (o aplicar_patch da IA é recusado), destravar e desagrupar', async () => {
    const m = await conectar();
    const g = await m.chamar('agrupar_camadas', {documento: 'capa', camadas: ['titulo', 'subtitulo']});
    expect(g.dado).toMatchObject({ok: true, mudou: true, grupo: 'grupo-1'});
    expect(m.capa().camadas.filter((k) => k.grupo === 'grupo-1').map((k) => k.id)).toEqual(['titulo', 'subtitulo']);
    await m.chamar('travar_camadas', {documento: 'capa', camadas: ['logo']});
    const {versao} = m.projeto.lerJson('imagem/capa.json');
    const recusado = await m.chamar('aplicar_patch', {documento: 'capa', versao_base: versao, patch: [{op: 'replace', path: '/camadas/4/x', value: 0}]});
    expect(recusado.erro).toBe(true);
    expect(recusado.texto).toMatch(/logo está travada pela pessoa/);
    const alinhou = await m.chamar('alinhar_camadas', {documento: 'capa', camadas: ['logo'], como: 'centro'});
    expect(alinhou.dado).toMatchObject({movidas: 0});
    expect((await m.chamar('destravar_camadas', {documento: 'capa', camadas: ['logo']})).dado).toMatchObject({ok: true, mudou: true});
    expect(m.capa().camadas[4].travada).toBeUndefined();
    expect((await m.chamar('desagrupar_camadas', {documento: 'capa', camadas: ['titulo']})).dado).toMatchObject({mudou: true});
    expect(m.capa().camadas.some((k) => k.grupo)).toBe(false);
    await m.fechar();
  }, 30_000);

  it('remover_fundo não grava na página gêmea quando a página é duplicada e reordenada no meio (imagem-N6)', async () => {
    const m = await conectar();
    const {doc, versao} = m.projeto.lerJson<DocImagem>('imagem/capa.json');
    m.projeto.aplicarPatch({documento: 'capa', versao_base: versao, autor: 'pessoa', origem: 'teste', rotulo: 'carrossel',
      patch: [{op: 'replace', path: '/camadas', value: []}, {op: 'add', path: '/paginas', value: [{id: 'p1', nome: 'Capa', camadas: doc.camadas}]}]});
    definirRemovedorDeFundo(async (src) => {
      // enquanto o modelo roda, a pessoa duplica a capa e põe a cópia na frente
      const agora = m.projeto.lerJson<DocImagem>('imagem/capa.json');
      const copia = {id: 'p1-copia', nome: 'Cópia', camadas: structuredClone(agora.doc.paginas![0].camadas)};
      m.projeto.aplicarPatch({documento: 'capa', versao_base: agora.versao, autor: 'pessoa', origem: 'teste', rotulo: 'duplicar e mover',
        patch: [{op: 'add', path: '/paginas/0', value: copia}]});
      return {caminho: gravarSemFundo(m.projeto, src, PNG), ms: 1};
    });
    const r = await m.chamar('remover_fundo', {documento: 'capa', camada: '/paginas/0/camadas/0'});
    expect(r.erro).toBe(false);
    expect(r.dado.camada).toBe('/paginas/1/camadas/0');
    const d = m.capa();
    expect(d.paginas![1].id).toBe('p1');
    expect(d.paginas![1].camadas[0].src_original).toBe('midia/foto.jpg');
    expect(d.paginas![0].camadas[0].src_original).toBeUndefined();
    await m.fechar();
  }, 30_000);
});
