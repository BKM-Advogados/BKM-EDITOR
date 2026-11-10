// Prévias do MCP (frente IDE, docs/ide.md): ver_quadro, ver_cenas e ver_trecho. A lógica (documento, tempo, nomes, limpeza,
// resposta) roda contra um render falso; o render de verdade, que empacota as composições e abre o Chrome, fica na prova
// opcional do fim: ESTUDIO_PROVA_RENDER=1 npx vitest run testes/previa-mcp.test.ts
import {execSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inflateSync} from 'node:zlib';
import {afterAll, afterEach, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {gravarPlano, planoDoProjeto} from '../src/nucleo/criar-projeto';
import type {Manifesto} from '../src/nucleo/documentos';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {
  acharCena, colunasDaFolha, definirServicoPrevia, documentoDaPrevia, escalaPara, gradeDaFolha, limparPrevias, markdownDaPrevia, nomeDaPrevia, PASTA_PREVIAS, PREVIAS_MAX,
  previasParaApagar, tempoNaCena, TRECHO_MAX_MS, type CenaDoVideo, type ServicoPrevia,
} from '../src/nucleo/mcp-previa';
import {classeDe} from '../src/nucleo/portao';
import {Projeto} from '../src/nucleo/projeto';
import {pngDeRgb} from '../src/main/previa';
import {appDoNucleo} from '../src/main/previa-stdio';

const RAIZ = path.join(__dirname, '..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-previa-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));
afterEach(() => definirServicoPrevia(null));

const CENAS: CenaDoVideo[] = [{n: 1, id: 'abre', nome: 'Abertura', t_in: 0, t_out: 2000}, {n: 2, id: 'foto', t_in: 2000, t_out: 5000}, {n: 3, id: 'fim', t_in: 5000, t_out: 6000}];

/** Projeto pequeno de verdade: vídeo de cenas 9:16 com três cenas, foto em midia/ e fonte própria em fontes/. */
const projetoDeTeste = () => {
  const pasta = path.join(mkdtempSync(path.join(tmp, 'p-')), 'Teste');
  gravarPlano(pasta, planoDoProjeto({nome: 'Teste', modelo: 'video-branco', formato: {largura: 1080, altura: 1920}}));
  mkdirSync(path.join(pasta, 'fontes'), {recursive: true});
  copyFileSync(path.join(RAIZ, 'node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2'), path.join(pasta, 'fontes/mono.woff2'));
  copyFileSync(path.join(RAIZ, 'exemplos/exemplo/midia/Cidade Exemplo.jpg'), path.join(pasta, 'midia/foto.jpg'));
  const p = new Projeto(pasta);
  const {doc} = p.lerJson<Record<string, unknown>>('video/video.json');
  p.gravarTexto('video/video.json', JSON.stringify({
    ...doc,
    tema: {...(doc.tema as object), fonte: 'Mono', fontes_arquivos: [{familia: 'Mono', arquivo: 'fontes/mono.woff2', peso: 700}]},
    cenas: [
      {id: 'abre', nome: 'Abertura', duracao_ms: 2000, blocos: [{id: 't1', tipo: 'titulo', texto: 'MONO 0123', em: 0, sai: 2000, x: 0.08, y: 0.4, largura: 0.84, tam: 0.085}]},
      {id: 'foto', duracao_ms: 3000, blocos: [{id: 'i1', tipo: 'imagem', src: 'midia/foto.jpg', ajuste: 'cobrir', em: 0, sai: 3000, x: 0.1, y: 0.1, largura: 0.8, altura: 0.5}]},
      {id: 'fim', duracao_ms: 1000, fundo: '#203040', blocos: []},
    ],
  }, null, 2));
  return p;
};

/** Render falso: grava um PNG de 2×2 em cada arquivo pedido e anota as chamadas. */
const servicoFalso = () => {
  const chamadas: {tipo: string; p: Record<string, unknown>}[] = [];
  const png = pngDeRgb(2, 2, Buffer.alloc(12, 200));
  const s: ServicoPrevia = {
    info: (_projeto, documento) => {
      if (documento !== 'video') throw new Error(`este vídeo não tem "tipo" nem narração (palavras); não sei montá-lo`);
      return {composicao: 'VideoCenas', largura: 1080, altura: 1920, fps: 30, duracao_ms: 6000, cenas: CENAS, avisos: []};
    },
    quadros: async (_projeto, p) => {
      chamadas.push({tipo: 'quadros', p});
      for (const a of p.arquivos) writeFileSync(a, png);
    },
    trecho: async (_projeto, p) => {
      chamadas.push({tipo: 'trecho', p});
      writeFileSync(p.arquivo, 'mp4');
    },
    folha: async (p) => {
      chamadas.push({tipo: 'folha', p});
      for (const a of p.arquivos) expect(existsSync(a)).toBe(true); // os quadros ainda estão lá quando a folha é montada
      writeFileSync(p.destino, png);
    },
    miniatura: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  };
  return {s, chamadas};
};

const conectar = async (p: Projeto) => {
  const servidor = new McpServer({name: 'estudio', version: '0'});
  registrarFerramentas(servidor, p, 'agente', 'IDE');
  const [a, b] = InMemoryTransport.createLinkedPair();
  const cliente = new Client({name: 'teste', version: '0'});
  await Promise.all([servidor.connect(a), cliente.connect(b)]);
  const chamar = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await cliente.callTool({name, arguments: args})) as {isError?: boolean; content: ({type: 'text'; text: string} | {type: 'image'; data: string; mimeType: string})[]};
    const t = r.content[0].type === 'text' ? r.content[0].text : '';
    return {erro: Boolean(r.isError), texto: t, dado: r.isError ? undefined : JSON.parse(t), imagem: r.content.find((c) => c.type === 'image')};
  };
  return {chamar, fechar: () => cliente.close()};
};

describe('prévias: contas', () => {
  it('documento: o pedido, ou o primeiro vídeo, ou a primeira animação', () => {
    const m: Manifesto = {formato: 1, nome: 'x', documentos: [{id: 'capa', modulo: 'imagem', caminho: 'imagem/capa.json', titulo: 'Capa'},
      {id: 'anima', modulo: 'animacao', caminho: 'a.json', titulo: 'A'}, {id: 'video', modulo: 'video', caminho: 'video/video.json', titulo: 'V'}]};
    expect(documentoDaPrevia(m)).toBe('video');
    expect(documentoDaPrevia({...m, documentos: m.documentos.slice(0, 2)})).toBe('anima');
    expect(documentoDaPrevia(m, 'anima')).toBe('anima');
    expect(() => documentoDaPrevia(m, 'nada')).toThrow('documento não achado');
    expect(() => documentoDaPrevia({...m, documentos: m.documentos.slice(0, 1)})).toThrow('não tem vídeo nem animação');
  });

  it('cena por número ou id, e o tempo dentro dela pela fração', () => {
    expect(acharCena(CENAS, '2').id).toBe('foto');
    expect(acharCena(CENAS, 3).id).toBe('fim');
    expect(acharCena(CENAS, 'abre').n).toBe(1);
    expect(() => acharCena(CENAS, '9')).toThrow('de 1 a 3');
    expect(() => acharCena([], '1')).toThrow('use tempo_ms');
    expect(tempoNaCena(CENAS[1], 0, 30)).toBe(2000);
    expect(tempoNaCena(CENAS[1], 0.5, 30)).toBe(3483); // até o último quadro da cena, não o primeiro da próxima
    expect(tempoNaCena(CENAS[1], 1, 30)).toBe(4967);
    expect(tempoNaCena(CENAS[1], 7, 30)).toBe(4967);
  });

  it('escala e grade da folha: perto de quadrada em pé e deitada, lados pares', () => {
    expect(escalaPara(1080, 1920, 960)).toBe(0.5);
    expect(escalaPara(400, 300, 960)).toBe(1);
    expect(colunasDaFolha(12, 203, 360)).toBe(5);
    expect(colunasDaFolha(12, 360, 203)).toBe(3);
    expect(colunasDaFolha(1, 360, 203)).toBe(1);
    const g = gradeDaFolha(5, 3, {largura: 101, altura: 180}, 8);
    expect(g.linhas).toBe(2);
    expect([g.largura % 2, g.altura % 2]).toEqual([0, 0]);
    expect(g.cantos[4]).toEqual({x: 8 + 109, y: 8 + 188});
  });

  it('limpeza: fica a mais nova e as outras enquanto couberem no número e no tamanho', () => {
    const lista = Array.from({length: 6}, (_, i) => ({nome: `p${i}`, mtime_ms: i * 1000, bytes: 10}));
    expect(previasParaApagar(lista, 4).sort()).toEqual(['p0', 'p1']);
    expect(previasParaApagar(lista, 10, 35).sort()).toEqual(['p0', 'p1', 'p2']);
    expect(previasParaApagar([{nome: 'grande', mtime_ms: 1, bytes: 999}], 10, 5)).toEqual([]);
    const pasta = mkdtempSync(path.join(tmp, 'limpar-'));
    for (const [i, n] of ['a.png', 'b.png', 'c.mp4'].entries()) {
      writeFileSync(path.join(pasta, n), 'x');
      utimesSync(path.join(pasta, n), new Date(), new Date(Date.now() - (3 - i) * 60_000));
    }
    mkdirSync(path.join(pasta, '.folha-1'));
    expect(limparPrevias(pasta, 2)).toEqual(['a.png']);
    expect(readdirSync(pasta).sort()).toEqual(['.folha-1', 'b.png', 'c.mp4']);
  });

  it('nome: tipo, documento, detalhe e carimbo, sem caractere que estrague o markdown', () => {
    expect(nomeDaPrevia('quadro', 'video', '1200ms', 'png', new Date(2026, 10, 10, 9, 5, 7, 42))).toBe('quadro-video-1200ms-20261110-090507-042.png');
    expect(nomeDaPrevia('cenas', 'meu vídeo (2)', '', 'png', new Date(2026, 0, 1))).toBe('cenas-meu-v-deo-2-20260101-000000-000.png');
    expect(markdownDaPrevia('quadro [1]', '/p/x.png')).toBe('![quadro 1](/p/x.png)');
    expect(markdownDaPrevia('quadro', '/home/u/Estudio/Sem título - 05-11 14h32/saidas/previas/x.png')).toBe('![quadro](</home/u/Estudio/Sem título - 05-11 14h32/saidas/previas/x.png>)');
  });

  it('PNG da folha: cabeçalho, tamanho e pixels', () => {
    const rgb = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9]);
    const png = pngDeRgb(2, 2, rgb);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([2, 2]);
    const idat = png.indexOf('IDAT');
    const cru = inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)));
    expect([...cru]).toEqual([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 9, 9, 9]);
  });

  it('de onde o MCP por stdio renderiza: o app instalado (app.asar) ou o repositório', () => {
    const asar = path.join('/opt/Estudio/resources', 'app.asar');
    expect(appDoNucleo('/opt/Estudio/resources', (p) => p === asar)).toEqual({raizApp: asar, empacotado: true});
    expect(appDoNucleo('/home/x/estudio', () => false)).toEqual({raizApp: '/home/x/estudio', empacotado: false});
  });

  it('portão: as três são livres (não saem do PC nem apagam o que é da pessoa)', () => {
    for (const f of ['ver_quadro', 'ver_cenas', 'ver_trecho']) expect(classeDe(f, {readOnlyHint: false, destructiveHint: false, openWorldHint: false} as never)).toBe('livre');
  });
});

describe('prévias pelo MCP (render falso)', () => {
  it('ver_quadro por cena: tempo da cena, PNG em saidas/previas, markdown e a imagem para o agente; nada no diário', async () => {
    const {s, chamadas} = servicoFalso();
    definirServicoPrevia(s);
    const p = projetoDeTeste();
    const {chamar, fechar} = await conectar(p);
    const r = await chamar('ver_quadro', {cena: 'foto', fracao: 0});
    expect(r.erro).toBe(false);
    expect(r.dado.tempo_ms).toBe(2000);
    expect(r.dado.cena).toEqual({n: 2, id: 'foto'});
    expect(r.dado.arquivo.startsWith(path.join(p.raiz, PASTA_PREVIAS))).toBe(true);
    expect(path.isAbsolute(r.dado.arquivo)).toBe(true);
    expect(existsSync(r.dado.arquivo)).toBe(true);
    expect(r.dado.markdown).toBe(`![video em 2 s, cena 2 (foto)](${r.dado.arquivo})`);
    expect([r.dado.largura, r.dado.altura]).toEqual([540, 960]);
    expect(r.imagem).toMatchObject({type: 'image', mimeType: 'image/jpeg'});
    expect(chamadas[0].p).toMatchObject({documento: 'video', tempos_ms: [2000], escala: 0.5});
    const porTempo = await chamar('ver_quadro', {tempo_ms: 5500, escala: 1});
    expect(porTempo.dado.cena.id).toBe('fim');
    expect(chamadas[1].p.escala).toBe(1);
    expect(p.diario()).toEqual([]);
    await fechar();
  });

  it('ver_quadro recusa o que não dá: tempo e cena juntos, depois do fim, cena que não há, documento que não é vídeo', async () => {
    definirServicoPrevia(servicoFalso().s);
    const p = projetoDeTeste();
    const {chamar, fechar} = await conectar(p);
    expect((await chamar('ver_quadro', {cena: '1', tempo_ms: 10})).texto).toContain('não os dois');
    expect((await chamar('ver_quadro', {tempo_ms: 9000})).texto).toContain('passa do fim');
    expect((await chamar('ver_quadro', {cena: '7'})).texto).toContain('cena não achada');
    expect((await chamar('ver_quadro', {documento: 'xis'})).texto).toContain('documento não achado');
    expect(existsSync(p.caminho(PASTA_PREVIAS)) ? readdirSync(p.caminho(PASTA_PREVIAS)) : []).toEqual([]);
    await fechar();
  });

  it('sem render (servidor sem o serviço), a resposta diz por quê', async () => {
    const {chamar, fechar} = await conectar(projetoDeTeste());
    const r = await chamar('ver_quadro');
    expect(r.erro).toBe(true);
    expect(r.texto).toContain('render do Estúdio');
    await fechar();
  });

  it('ver_cenas: um quadro por cena na fração, a grade e onde cada cena ficou; os quadros soltos não ficam', async () => {
    const {s, chamadas} = servicoFalso();
    definirServicoPrevia(s);
    const p = projetoDeTeste();
    const {chamar, fechar} = await conectar(p);
    const r = await chamar('ver_cenas', {});
    expect(r.erro).toBe(false);
    expect(chamadas[0].p.tempos_ms).toEqual([1475, 4225, 5725]);
    expect(chamadas[1]).toMatchObject({tipo: 'folha', p: {colunas: 3}});
    expect(r.dado.cenas.map((c: {coluna: number}) => c.coluna)).toEqual([1, 2, 3]);
    expect(r.dado.arquivo.endsWith('.png')).toBe(true);
    expect(readdirSync(p.caminho(PASTA_PREVIAS))).toEqual([path.basename(r.dado.arquivo)]);
    const duas = await chamar('ver_cenas', {cenas: ['3', 'abre'], fracao: 0});
    expect(duas.dado.cenas.map((c: {id: string}) => c.id)).toEqual(['fim', 'abre']);
    expect(chamadas[2].p.tempos_ms).toEqual([5000, 0]);
    await fechar();
  });

  it('ver_trecho: de/até, a cena inteira, o limite de duração e o padrão de 10 s', async () => {
    const {s, chamadas} = servicoFalso();
    definirServicoPrevia(s);
    const p = projetoDeTeste();
    const {chamar, fechar} = await conectar(p);
    const r = await chamar('ver_trecho', {de_ms: 1000, ate_ms: 3000});
    expect(r.erro).toBe(false);
    expect(r.dado).toMatchObject({de_ms: 1000, ate_ms: 3000, escala: 0.5, largura: 540, altura: 960});
    expect(r.dado.markdown).toMatch(/^!\[video, de 1 s a 3 s\]\(.+\.mp4\)$/);
    expect((await chamar('ver_trecho', {cena: '2'})).dado).toMatchObject({de_ms: 2000, ate_ms: 5000});
    expect((await chamar('ver_trecho', {})).dado).toMatchObject({de_ms: 0, ate_ms: 6000});
    expect((await chamar('ver_trecho', {de_ms: 3000, ate_ms: 1000})).texto).toContain('maior que de_ms');
    expect((await chamar('ver_trecho', {de_ms: 7000})).texto).toContain('passa do fim');
    expect((await chamar('ver_trecho', {cena: '1', de_ms: 0})).texto).toContain('não os dois');
    expect(chamadas.filter((c) => c.tipo === 'trecho')).toHaveLength(3);
    expect(TRECHO_MAX_MS).toBe(60_000);
    await fechar();
  });

  it('a pasta das prévias não passa do limite: as mais velhas saem', async () => {
    definirServicoPrevia(servicoFalso().s);
    const p = projetoDeTeste();
    const pasta = p.caminho(PASTA_PREVIAS);
    mkdirSync(pasta, {recursive: true});
    for (let i = 0; i < PREVIAS_MAX + 5; i++) {
      writeFileSync(path.join(pasta, `velha-${i}.png`), 'x');
      utimesSync(path.join(pasta, `velha-${i}.png`), new Date(), new Date(Date.now() - (100 - i) * 60_000));
    }
    const {chamar, fechar} = await conectar(p);
    const r = await chamar('ver_quadro', {tempo_ms: 0});
    const ficou = readdirSync(pasta);
    expect(ficou).toHaveLength(PREVIAS_MAX);
    expect(ficou).toContain(path.basename(r.dado.arquivo));
    expect(ficou).not.toContain('velha-0.png');
    await fechar();
  });
});

// ---------- prova: o render de verdade pelo MCP por stdio, rodado como o .mcp.json manda ----------
const PROVA = process.env.ESTUDIO_PROVA_RENDER === '1';
describe.skipIf(!PROVA)('prova: ver_quadro e ver_cenas de verdade pelo nucleo.cjs (Electron em modo Node)', () => {
  it('quadro e folha saem com a foto de midia/ e a fonte de fontes/', async () => {
    execSync('npm run mcp:build', {cwd: RAIZ, stdio: 'ignore'});
    const p = projetoDeTeste();
    const electron = require('electron') as unknown as string;
    const env = Object.fromEntries(Object.entries({...process.env, ELECTRON_RUN_AS_NODE: '1'}).filter(([, v]) => v !== undefined)) as Record<string, string>;
    const cliente = new Client({name: 'prova', version: '0'});
    await cliente.connect(new StdioClientTransport({command: electron, args: [path.join(RAIZ, 'dist-mcp/nucleo.cjs'), '--projeto', p.raiz, '--origem', 'IDE', '--ide'], env, cwd: p.raiz}));
    try {
      const q = (await cliente.callTool({name: 'ver_quadro', arguments: {cena: '2', fracao: 0.5}}, undefined, {timeout: 300_000})) as {isError?: boolean; content: {type: string; text?: string}[]};
      expect(q.isError).toBeFalsy();
      const dado = JSON.parse(q.content[0].text!);
      expect(readFileSync(dado.arquivo).subarray(1, 4).toString()).toBe('PNG');
      expect(q.content.some((c) => c.type === 'image')).toBe(true);
      const f = (await cliente.callTool({name: 'ver_cenas', arguments: {}}, undefined, {timeout: 300_000})) as {isError?: boolean; content: {text?: string}[]};
      expect(f.isError).toBeFalsy();
      expect(existsSync(JSON.parse(f.content[0].text!).arquivo)).toBe(true);
      expect(existsSync(path.join(p.raiz, '.remotion'))).toBe(false); // o navegador não foi baixado para dentro do projeto
    } finally {
      await cliente.close();
    }
  }, 600_000);
});
