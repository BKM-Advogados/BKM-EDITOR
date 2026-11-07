// A frente Fala pelo MCP: transcrever (os dois usos: um arquivo qualquer, como no roteiro da Cliente e na pesquisa, e os
// clipes de voz do vídeo de cenas, que viram legendas), exportar_legendas e importar_legendas. O transcritor é de mentira
// (grava as palavras da narração do C2): o whisper de verdade fica em scripts/transcrever-teste.mjs.
import {mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registrarFerramentas, type TranscritorMcp} from '../src/nucleo/ferramentas-mcp';
import {novoDocCenas, type DocCenas} from '../src/nucleo/cenas';
import {Projeto} from '../src/nucleo/projeto';

const REFERENCIA = readFileSync(path.join(__dirname, '..', 'exemplos', 'exemplo', 'video', 'palavras.json'), 'utf-8');
let pasta = '';
let projeto: Projeto;
const pedidos: {arquivo: string; destino?: string; modelo?: string}[] = [];

const transcritor: TranscritorMcp = {
  transcrever: async (p, pedido) => {
    pedidos.push(pedido);
    const destino = pedido.destino ?? `${pedido.arquivo}.palavras.json`;
    p.gravarTexto(destino, REFERENCIA);
    const palavras = JSON.parse(REFERENCIA) as {w: string}[];
    return {ok: true, palavras: destino, n: palavras.length, duracao_s: 1.5, texto: palavras.map((w) => w.w).join(' ')};
  },
};

const conectar = async (t?: TranscritorMcp) => {
  const servidor = new McpServer({name: 'estudio', version: 'teste'});
  registrarFerramentas(servidor, projeto, 'agente', 'teste', undefined, t);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const cliente = new Client({name: 'teste', version: '1'});
  await Promise.all([servidor.connect(a), cliente.connect(b)]);
  return cliente;
};
const chamar = async (cliente: Client, name: string, args: Record<string, unknown>) => {
  const r = (await cliente.callTool({name, arguments: args})) as {isError?: boolean; content: {text: string}[]};
  const texto = r.content[0]?.text ?? '';
  return {erro: Boolean(r.isError), texto, json: r.isError ? null : JSON.parse(texto)};
};
const lerVideo = () => projeto.lerJson<DocCenas>('video/video.json').doc;

beforeAll(() => {
  pasta = mkdtempSync(path.join(tmpdir(), 'estudio-fala-'));
  mkdirSync(path.join(pasta, 'midia'), {recursive: true});
  mkdirSync(path.join(pasta, 'video'), {recursive: true});
  writeFileSync(path.join(pasta, 'midia', 'narracao.wav'), 'RIFF de mentira');
  writeFileSync(path.join(pasta, 'midia', 'fonte.mp4'), 'mp4 de mentira');
  writeFileSync(path.join(pasta, 'estudio.json'), JSON.stringify({formato: 1, nome: 'Fala', documentos: [{id: 'video', modulo: 'video', caminho: 'video/video.json', titulo: 'Mudar de cidade'}]}));
  const doc: DocCenas = {
    ...novoDocCenas({largura: 1080, altura: 1920, fps: 30}),
    cenas: [{id: 'c1', duracao_ms: 80000, blocos: []}],
    audio: {faixas: [{id: 'narracao', nome: 'Narração', papel: 'voz', clipes: [{id: 'clipe-1', arquivo: 'midia/narracao.wav', em: 500, duracao_ms: 73000}]}]},
  };
  writeFileSync(path.join(pasta, 'video', 'video.json'), JSON.stringify(doc));
  projeto = new Projeto(pasta);
});
afterAll(() => rmSync(pasta, {recursive: true, force: true}));

describe('MCP: transcrever e legendas', () => {
  it('sem transcritor (MCP sem o processo principal), avisa em vez de falhar calado', async () => {
    const c = await conectar();
    const r = await chamar(c, 'transcrever', {arquivo: 'midia/fonte.mp4'});
    expect(r.erro).toBe(true);
    expect(r.texto).toContain('não tem o transcritor');
  });

  it('um arquivo qualquer: grava as palavras ao lado (ou no destino) e devolve o texto', async () => {
    const c = await conectar(transcritor);
    const r = await chamar(c, 'transcrever', {arquivo: 'midia/fonte.mp4', destino: 'video/palavras.json', modelo: 'base'});
    expect(r.json).toMatchObject({ok: true, palavras: 'video/palavras.json', n: 194});
    expect(r.json.texto.startsWith('Recebeu proposta para mudar de cidade?')).toBe(true);
    expect(pedidos.at(-1)).toMatchObject({arquivo: 'midia/fonte.mp4', destino: 'video/palavras.json', modelo: 'base'});
    expect((await chamar(c, 'transcrever', {arquivo: 'midia/fonte.mp4', destino: 'video/palavras.txt'})).erro).toBe(true);
  });

  it('vídeo de cenas: transcreve a narração e gera as legendas no documento, com diário', async () => {
    const c = await conectar(transcritor);
    pedidos.length = 0;
    const r = await chamar(c, 'transcrever', {documento: 'video', estilo: 'karaoke'});
    expect(r.erro).toBe(false);
    expect(pedidos).toEqual([{arquivo: 'midia/narracao.wav', modelo: undefined, vocabulario: undefined, destino: undefined}]);
    expect(r.json.legendas).toBeGreaterThan(20);
    // karaokê: até 4 palavras por legenda, e "de cidade?" não fica sozinha; a primeira palavra da narração começa no zero
    // do arquivo, que está em 500 ms
    expect(r.json.primeiras.slice(0, 2)).toMatchObject([{id: 'leg-1', em: 500, texto: 'Recebeu proposta', falante: 'Narração'}, {texto: 'para mudar de cidade?'}]);
    const doc = lerVideo();
    expect(doc.legendas?.estilo?.predefinicao).toBe('karaoke');
    expect(doc.legendas?.origens?.[0]).toMatchObject({clipe: 'clipe-1', palavras: 'midia/narracao.wav.palavras.json', em: 500});
    expect(Math.max(...doc.legendas!.segmentos.map((s) => s.palavras!.length))).toBeLessThanOrEqual(4);
    expect(projeto.diario().at(-1)).toMatchObject({autor: 'agente', rotulo: expect.stringContaining('legendas da fala')});
    // de novo: a transcrição já existe e não roda outra vez
    pedidos.length = 0;
    const r2 = await chamar(c, 'transcrever', {documento: 'video', faixa: 'narracao', estilo: 'classica'});
    expect(pedidos).toEqual([]);
    expect(r2.json.transcritos[0]).toMatchObject({ja_tinha: true});
    expect(lerVideo().legendas?.estilo?.predefinicao).toBe('classica');
  });

  it('clipe que não existe vira erro claro', async () => {
    const c = await conectar(transcritor);
    const r = await chamar(c, 'transcrever', {documento: 'video', clipe: 'nao-ha'});
    expect(r.erro).toBe(true);
    expect(r.texto).toContain('clipe ou faixa não achado');
  });

  it('exportar_legendas grava SRT e VTT em saidas/ com o título do vídeo; importar_legendas traz de volta', async () => {
    const c = await conectar(transcritor);
    const antes = lerVideo().legendas!.segmentos.map((s) => [s.em, s.sai, s.texto]);
    const r = await chamar(c, 'exportar_legendas', {documento: 'video'});
    expect(r.json.arquivos).toEqual(['saidas/Mudar de cidade.srt', 'saidas/Mudar de cidade.vtt']);
    const vtt = projeto.lerTexto('saidas/Mudar de cidade.vtt');
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain('<v Narração>');
    // importa o SRT de volta por cima: mesmos tempos e textos (as linhas longas voltam juntas)
    const imp = await chamar(c, 'importar_legendas', {documento: 'video', arquivo: 'saidas/Mudar de cidade.srt'});
    expect(imp.json).toMatchObject({ok: true, legendas: antes.length});
    const depois = lerVideo().legendas!;
    expect(depois.segmentos.map((s) => [s.em, s.sai, s.texto.replace(/\n/g, ' ')])).toEqual(antes);
    expect(depois.origens).toBeUndefined();
    expect(depois.estilo?.predefinicao).toBe('classica');
  });
});
