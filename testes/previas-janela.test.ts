// Frente 3 do MCP: ver_imagem e ver_cena_3d (src/nucleo/mcp-previa-janela.ts). Quem desenha é a janela do app (canvas da
// exportação e Three.js), que não roda no vitest nem no Electron bloqueado desta máquina: aqui a janela é falsa e o que se
// confere é o resto: o documento que vai à janela (lido do disco), a página, a câmera, o PNG em saidas/previas/, a
// resposta com a miniatura, a recusa de outro módulo e, sem a janela, a mensagem para abrir o projeto no Estúdio. O
// lado do processo principal (src/main/previa-janela.ts) é conferido com uma ponte falsa.
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {DocCena3D, DocImagem} from '../src/nucleo/documentos';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {
  CAMERA_3D_PADRAO, cameraDaCena, definirServicoPreviaJanela, documentoDoModulo, indiceDaPagina, SEM_JANELA, type ServicoPreviaJanela,
} from '../src/nucleo/mcp-previa-janela';
import {PASTA_PREVIAS} from '../src/nucleo/mcp-previa';
import {classeDe} from '../src/nucleo/portao';
import {Projeto} from '../src/nucleo/projeto';
import {pngDeRgb} from '../src/main/previa';
import {ACAO_PREVIA_CENA3D, ACAO_PREVIA_IMAGEM, quadroDaResposta, servicoDePreviaJanela} from '../src/main/previa-janela';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-previa-janela-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));
afterEach(() => definirServicoPreviaJanela(null));

const IMAGEM: DocImagem = {formato: 1, largura: 1080, altura: 1350, fundo: '#ffffff', camadas: [{id: 't1', tipo: 'texto', texto: 'Olá', x: 10, y: 10} as never]};
const CARROSSEL: DocImagem = {formato: 1, largura: 1080, altura: 1080, fundo: '#101010', camadas: [],
  paginas: [{id: 'p1', nome: 'Capa', camadas: []}, {id: 'p2', nome: 'Meio', camadas: []}, {id: 'p3', nome: 'Fim', camadas: []}]};
const CENA: DocCena3D = {formato: 1, fundo: '#202020', camera: {posicao: [0, 2, 8], alvo: [0, 1, 0], fov: 35},
  luzes: [{id: 'sol', tipo: 'direcional', cor: '#ffffff', intensidade: 1.6, posicao: [3, 5, 2]}],
  objetos: [{id: 'caixa', nome: 'Caixa', tipo: 'caixa', posicao: [0, 0.5, 0], rotacao: [0, 0, 0], escala: [1, 1, 1], cor: '#ff8800'}]};

let projeto: Projeto;
let cliente: Client;
type Resposta = {isError?: boolean; content: ({type: 'text'; text: string} | {type: 'image'; data: string; mimeType: string})[]};
const chamar = async (name: string, args: Record<string, unknown>) => {
  const r = (await cliente.callTool({name, arguments: args})) as Resposta;
  const texto = r.content[0]?.type === 'text' ? r.content[0].text : '';
  return {erro: Boolean(r.isError), texto, json: r.isError ? null : JSON.parse(texto), imagem: r.content.find((c) => c.type === 'image')};
};

/** Janela falsa: devolve um PNG de 2×2 e anota o que recebeu. */
const janelaFalsa = () => {
  const pedidos: {tipo: string; p: Record<string, unknown>}[] = [];
  const png = new Uint8Array(pngDeRgb(2, 2, Buffer.alloc(12, 200)));
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const s: ServicoPreviaJanela = {
    imagem: async (_projeto, p) => {
      pedidos.push({tipo: 'imagem', p});
      return {png, miniatura: jpeg, largura: Math.round(p.doc.largura * p.escala), altura: Math.round(p.doc.altura * p.escala)};
    },
    cena3d: async (_projeto, p) => {
      pedidos.push({tipo: 'cena3d', p});
      return {png, miniatura: jpeg, largura: p.largura, altura: p.altura};
    },
  };
  return {s, pedidos};
};

beforeAll(async () => {
  const pasta = path.join(tmp, 'Previas');
  mkdirSync(path.join(pasta, 'imagem'), {recursive: true});
  mkdirSync(path.join(pasta, '3d'), {recursive: true});
  mkdirSync(path.join(pasta, 'video'), {recursive: true});
  writeFileSync(path.join(pasta, 'estudio.json'), JSON.stringify({formato: 1, nome: 'Prévias', documentos: [
    {id: 'video', modulo: 'video', caminho: 'video/video.json', titulo: 'Vídeo'},
    {id: 'post', modulo: 'imagem', caminho: 'imagem/post.json', titulo: 'Post'},
    {id: 'carrossel', modulo: 'imagem', caminho: 'imagem/carrossel.json', titulo: 'Carrossel'},
    {id: 'cena', modulo: '3d', caminho: '3d/cena.json', titulo: 'Cena'},
  ]}));
  writeFileSync(path.join(pasta, 'video', 'video.json'), JSON.stringify({tipo: 'cenas', formato: {largura: 1080, altura: 1920, fps: 30}, cenas: []}));
  writeFileSync(path.join(pasta, 'imagem', 'post.json'), JSON.stringify(IMAGEM));
  writeFileSync(path.join(pasta, 'imagem', 'carrossel.json'), JSON.stringify(CARROSSEL));
  writeFileSync(path.join(pasta, '3d', 'cena.json'), JSON.stringify(CENA));
  projeto = new Projeto(pasta);
  const servidor = new McpServer({name: 'estudio', version: 'teste'});
  registrarFerramentas(servidor, projeto, 'agente', 'teste');
  const [a, b] = InMemoryTransport.createLinkedPair();
  cliente = new Client({name: 'teste', version: '1'});
  await Promise.all([servidor.connect(a), cliente.connect(b)]);
});

describe('contas puras', () => {
  it('o documento é o pedido, o que a pessoa vê ou o primeiro do módulo; outro módulo é recusado', () => {
    expect(documentoDoModulo(projeto, 'imagem')).toBe('post');
    expect(documentoDoModulo(projeto, '3d')).toBe('cena');
    expect(documentoDoModulo(projeto, 'imagem', 'carrossel')).toBe('carrossel');
    expect(() => documentoDoModulo(projeto, 'imagem', 'video')).toThrow(/ver_quadro/);
    expect(() => documentoDoModulo(projeto, '3d', 'post')).toThrow(/não cena 3D/);
    expect(() => documentoDoModulo(projeto, 'imagem', 'sumiu')).toThrow(/não achado/);
  });

  it('a página vem de 1 a n; a imagem sem páginas só tem a 1', () => {
    expect(indiceDaPagina(CARROSSEL)).toEqual({indice: 0, total: 3});
    expect(indiceDaPagina(CARROSSEL, 3)).toEqual({indice: 2, total: 3});
    expect(() => indiceDaPagina(CARROSSEL, 4)).toThrow(/de 1 a 3/);
    expect(indiceDaPagina(IMAGEM)).toEqual({indice: 0, total: 1});
    expect(() => indiceDaPagina(IMAGEM, 2)).toThrow(/uma página só/);
  });

  it('a câmera pedida vale campo a campo por cima da do documento, e esta por cima da do monitor', () => {
    expect(cameraDaCena(CENA)).toEqual(CENA.camera);
    expect(cameraDaCena(CENA, {fov: 60})).toEqual({...CENA.camera, fov: 60});
    expect(cameraDaCena(CENA, {posicao: [1, 1, 1], alvo: [1, 2]})).toEqual({posicao: [1, 1, 1], alvo: CENA.camera.alvo, fov: 35});
    expect(cameraDaCena({...CENA, camera: undefined as never})).toEqual(CAMERA_3D_PADRAO);
  });
});

describe('sem a janela (MCP por stdio com o app fechado)', () => {
  it('as duas pedem para abrir o projeto no Estúdio e não gravam nada', async () => {
    for (const nome of ['ver_imagem', 'ver_cena_3d']) {
      const r = await chamar(nome, {});
      expect(r.erro, nome).toBe(true);
      expect(r.texto).toBe(SEM_JANELA);
      expect(r.texto).toMatch(/abra o projeto no Estúdio/);
    }
    expect(existsSync(projeto.caminho(PASTA_PREVIAS))).toBe(false);
  });

  it('são livres no portão, como as outras prévias, e a descrição avisa que precisam do app', async () => {
    const {tools} = await cliente.listTools();
    for (const nome of ['ver_imagem', 'ver_cena_3d']) {
      const t = tools.find((x) => x.name === nome)!;
      expect(classeDe(nome, t.annotations)).toBe('livre');
      expect(t.description).toMatch(/Só com o projeto aberto no app do Estúdio/);
    }
  });
});

describe('com a janela', () => {
  it('ver_imagem manda o documento do disco, grava o PNG em saidas/previas/ e devolve a miniatura', async () => {
    const {s, pedidos} = janelaFalsa();
    definirServicoPreviaJanela(s);
    const r = await chamar('ver_imagem', {documento: 'post'});
    expect(r.erro, r.texto).toBe(false);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].p).toMatchObject({documento: 'post', doc: IMAGEM, lado_miniatura: 1024});
    expect(pedidos[0].p).not.toHaveProperty('pagina');
    expect(pedidos[0].p.escala).toBeCloseTo(1, 5); // 1350 px de lado maior cabe nos 1600 sem escala
    expect(r.json.arquivo.startsWith(projeto.caminho(PASTA_PREVIAS))).toBe(true);
    expect(path.basename(r.json.arquivo)).toMatch(/^imagem-post-\d{8}-\d{6}-\d{3}\.png$/);
    expect(readFileSync(r.json.arquivo).subarray(1, 4).toString()).toBe('PNG');
    expect(r.json.markdown).toBe(`![post](${r.json.arquivo})`);
    expect(r.json).toMatchObject({documento: 'post', largura: 1080, altura: 1350});
    expect(r.json).not.toHaveProperty('pagina');
    expect(r.imagem).toMatchObject({type: 'image', mimeType: 'image/jpeg'});
  });

  it('ver_imagem no carrossel manda o índice da página e diz qual é; escala pedida vale', async () => {
    const {s, pedidos} = janelaFalsa();
    definirServicoPreviaJanela(s);
    const r = await chamar('ver_imagem', {documento: 'carrossel', pagina: 2, escala: 0.5});
    expect(r.erro, r.texto).toBe(false);
    expect(pedidos[0].p).toMatchObject({pagina: 1, escala: 0.5});
    expect(r.json).toMatchObject({pagina: 2, paginas: 3, largura: 540, altura: 540});
    expect(r.json.markdown).toMatch(/página 2 de 3 \(Meio\)/);
    expect(path.basename(r.json.arquivo)).toMatch(/^imagem-carrossel-p2-/);
    const fora = await chamar('ver_imagem', {documento: 'carrossel', pagina: 9});
    expect(fora.erro).toBe(true);
    expect(fora.texto).toMatch(/de 1 a 3/);
    expect(pedidos).toHaveLength(1);
  });

  it('ver_imagem recusa vídeo e aponta o ver_quadro', async () => {
    definirServicoPreviaJanela(janelaFalsa().s);
    const r = await chamar('ver_imagem', {documento: 'video'});
    expect(r.erro).toBe(true);
    expect(r.texto).toMatch(/ver_quadro/);
  });

  it('ver_cena_3d usa a câmera do documento, ou outra sem mudar o documento', async () => {
    const {s, pedidos} = janelaFalsa();
    definirServicoPreviaJanela(s);
    const antes = readFileSync(projeto.caminho('3d/cena.json'), 'utf-8');
    const r = await chamar('ver_cena_3d', {});
    expect(r.erro, r.texto).toBe(false);
    expect(pedidos[0].p).toMatchObject({documento: 'cena', doc: CENA, camera: CENA.camera, largura: 1280, altura: 720});
    expect(r.json).toMatchObject({documento: 'cena', objetos: 1, largura: 1280, altura: 720});
    expect(path.basename(r.json.arquivo)).toMatch(/^cena3d-cena-\d{8}/);
    const outra = await chamar('ver_cena_3d', {camera: {posicao: [5, 5, 5], fov: 50}, largura: 640, altura: 640});
    expect(outra.erro, outra.texto).toBe(false);
    expect(pedidos[1].p).toMatchObject({camera: {posicao: [5, 5, 5], alvo: [0, 1, 0], fov: 50}, largura: 640, altura: 640});
    expect(path.basename(outra.json.arquivo)).toMatch(/^cena3d-cena-camera-/);
    expect(readFileSync(projeto.caminho('3d/cena.json'), 'utf-8')).toBe(antes);
    expect(outra.imagem).toBeDefined();
  });
});

describe('processo principal: a ponte com a janela', () => {
  it('pede a ação certa com a raiz do projeto e o documento, e confere a resposta', async () => {
    const pedidos: {acao: string; dados: Record<string, unknown>; tempo?: number}[] = [];
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const s = servicoDePreviaJanela(async (acao, dados, o) => {
      pedidos.push({acao, dados: dados as Record<string, unknown>, tempo: o?.tempo_ms});
      return {ok: true, dados: {png, miniatura: null, largura: 10, altura: 20, faltaram: ['foto']}};
    });
    const q = await s.imagem(projeto, {documento: 'post', doc: IMAGEM, escala: 1, lado_miniatura: 1024});
    expect(q).toEqual({png, miniatura: null, largura: 10, altura: 20, faltaram: ['foto']});
    await s.cena3d(projeto, {documento: 'cena', doc: CENA, camera: CENA.camera, largura: 64, altura: 64, lado_miniatura: 64});
    expect(pedidos.map((p) => p.acao)).toEqual([ACAO_PREVIA_IMAGEM, ACAO_PREVIA_CENA3D]);
    expect(pedidos[0].dados).toMatchObject({raiz: projeto.raiz, documento: 'post', doc: IMAGEM});
    expect(pedidos[0].tempo).toBeGreaterThanOrEqual(60_000);
  });

  it('sem janela, ou sem quem atenda, a mensagem é a de abrir o projeto; a resposta vazia é recusada', () => {
    expect(() => quadroDaResposta({ok: false, mensagem: 'sem janela do Estúdio aberta'})).toThrow(SEM_JANELA);
    expect(() => quadroDaResposta({ok: false, mensagem: 'a janela não atende "previa:imagem" agora'})).toThrow(SEM_JANELA);
    expect(() => quadroDaResposta({ok: false, mensagem: 'a janela do Estúdio está com outro projeto aberto'})).toThrow(/outro projeto/);
    expect(() => quadroDaResposta({ok: true, dados: {largura: 1, altura: 1}})).toThrow(/vazia/);
    expect(quadroDaResposta({ok: true, dados: {png: new Uint8Array([1]).buffer, largura: 1, altura: 1}}).png).toEqual(new Uint8Array([1]));
  });

  it('as ações da janela são as mesmas dos dois lados', () => {
    const renderer = readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'previas-janela.ts'), 'utf-8');
    expect(renderer).toContain(`atender('${ACAO_PREVIA_IMAGEM}'`);
    expect(renderer).toContain(`atender('${ACAO_PREVIA_CENA3D}'`);
  });
});
