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
    // de novo: a transcrição já existe e não roda outra vez, e o clipe que já tem legendas fica como está
    pedidos.length = 0;
    const antes = lerVideo().legendas;
    const r2 = await chamar(c, 'transcrever', {documento: 'video', faixa: 'narracao', estilo: 'classica'});
    expect(pedidos).toEqual([]);
    expect(r2.json.transcritos[0]).toMatchObject({ja_tinha: true});
    expect(r2.json).toMatchObject({geradas: 0, ja_tinham_legendas: ['clipe-1']});
    expect(r2.json.nota).toContain('refazer_legendas');
    expect(lerVideo().legendas).toEqual(antes);
    // refazer_legendas refaz, no estilo pedido, e a palavra corrigida à mão fica
    const atual = lerVideo();
    const i = atual.legendas!.segmentos.findIndex((s) => s.texto.includes('cidade?'));
    const seg = atual.legendas!.segmentos[i];
    const j = seg.palavras!.findIndex((w) => w.w === 'cidade?');
    projeto.aplicarPatch({documento: 'video/video.json', versao_base: projeto.lerJson('video/video.json').versao, autor: 'pessoa', origem: 'interface',
      patch: [{op: 'replace', path: `/legendas/segmentos/${i}/texto`, value: seg.texto.replace('cidade?', 'Cidade?')},
        {op: 'replace', path: `/legendas/segmentos/${i}/palavras/${j}/w`, value: 'Cidade?'}]});
    const r3 = await chamar(c, 'transcrever', {documento: 'video', estilo: 'classica', refazer_legendas: true});
    expect(r3.json).toMatchObject({corrigidas_a_mao_mantidas: 1});
    expect(r3.json.geradas).toBeGreaterThan(10);
    const refeitas = lerVideo().legendas!;
    expect(refeitas.estilo?.predefinicao).toBe('classica');
    expect(refeitas.segmentos.some((s) => s.texto.includes('Cidade?'))).toBe(true);
    expect(refeitas.segmentos.some((s) => s.texto.includes('cidade?'))).toBe(false);
  });

  it('clipe de voz limpa: a fala é a do original, que já tem transcrição; tomada regravada transcreve de novo sem mexer nas legendas', async () => {
    const estados: Record<string, 'em_dia' | 'velha' | 'falta'> = {};
    const comConferir: TranscritorMcp = {...transcritor, conferir: (_p, arquivo) => estados[arquivo] ?? 'falta'};
    const c = await conectar(comConferir);
    const v = projeto.lerJson<DocCenas>('video/video.json');
    projeto.aplicarPatch({documento: 'video/video.json', versao_base: v.versao, autor: 'pessoa', origem: 'interface', patch: [
      {op: 'replace', path: '/audio/faixas/0/clipes/0/arquivo', value: 'midia/narracao.wav.media.limpo.wav'},
      {op: 'add', path: '/audio/faixas/0/clipes/0/original', value: 'midia/narracao.wav'}]});
    const antes = lerVideo().legendas;
    estados['midia/narracao.wav'] = 'em_dia';
    pedidos.length = 0;
    const r = await chamar(c, 'transcrever', {documento: 'video'});
    expect(pedidos).toEqual([]);
    expect(r.json.transcritos).toEqual([{arquivo: 'midia/narracao.wav', palavras: 'midia/narracao.wav.palavras.json', ja_tinha: true}]);
    expect(lerVideo().legendas).toEqual(antes);
    // a pessoa regravou a narração com o mesmo nome: transcreve de novo, e as legendas esperam a decisão dela
    estados['midia/narracao.wav'] = 'velha';
    const r2 = await chamar(c, 'transcrever', {documento: 'video'});
    expect(pedidos.map((x) => x.arquivo)).toEqual(['midia/narracao.wav']);
    expect(r2.json.transcritos[0]).toMatchObject({audio_mudou: true});
    expect(r2.json).toMatchObject({geradas: 0, legendas_de_audio_antigo: ['clipe-1']});
    expect(lerVideo().legendas).toEqual(antes);
  });

  it('o destino nunca é o manifesto, um documento ou outro arquivo do app (transversal-N6)', async () => {
    const c = await conectar(transcritor);
    writeFileSync(path.join(pasta, 'midia', 'config.json'), '{"a": 1}');
    const antes = {manifesto: readFileSync(path.join(pasta, 'estudio.json'), 'utf-8'), video: readFileSync(path.join(pasta, 'video', 'video.json'), 'utf-8')};
    pedidos.length = 0;
    for (const [destino, motivo] of [['estudio.json', 'manifesto'], ['video/video.json', 'documento'], ['Video/../ESTUDIO.json', 'manifesto'],
      ['video\\video.json', 'documento'], ['comentarios.json', 'comentários'], ['pesquisa/pesquisa.json', 'pesquisa'], ['.estudio/estado.json', 'do app'],
      ['midia/config.json', 'não é uma lista de palavras'], ['video/palavras.txt', 'termina em .json']]) {
      const r = await chamar(c, 'transcrever', {arquivo: 'midia/fonte.mp4', destino});
      expect(r.erro, destino).toBe(true);
      expect(r.texto, destino).toContain(motivo);
    }
    expect(pedidos).toEqual([]);
    expect(readFileSync(path.join(pasta, 'estudio.json'), 'utf-8')).toBe(antes.manifesto);
    expect(readFileSync(path.join(pasta, 'video', 'video.json'), 'utf-8')).toBe(antes.video);
    // a lista de palavras que já existe pode ser regravada
    expect((await chamar(c, 'transcrever', {arquivo: 'midia/fonte.mp4', destino: 'video/palavras.json'})).erro).toBe(false);
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
