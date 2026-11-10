// A frente Som pelo MCP (src/nucleo/mcp-som.ts): dividir_clipe, copiar_clipe e crossfade, com o servidor de verdade em
// memória sobre um projeto de teste. Cada chamada vai para o diário como o agente e tem inverso (o Reverter).
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {novoDocCenas, resolverCenas, type DocCenas} from '../src/nucleo/cenas';
import {Projeto} from '../src/nucleo/projeto';

let pasta = '';
let projeto: Projeto;
let cliente: Client;

const chamar = async (name: string, args: Record<string, unknown>) => {
  const r = (await cliente.callTool({name, arguments: args})) as {isError?: boolean; content: {text: string}[]};
  const texto = r.content[0]?.text ?? '';
  return {erro: Boolean(r.isError), texto, json: r.isError ? null : JSON.parse(texto)};
};
const lerVideo = () => projeto.lerJson<DocCenas>('video/video.json').doc;

const documento = (): DocCenas => ({
  ...novoDocCenas({largura: 1080, altura: 1920, fps: 30}),
  cenas: [{id: 'c1', duracao_ms: 30000, blocos: []}],
  audio: {faixas: [
    {id: 'narracao', nome: 'Narração', papel: 'voz', clipes: [{id: 'n1', arquivo: 'midia/narracao.wav', em: 1000, corte_ms: 500, duracao_ms: 6000}]},
    {id: 'musica', nome: 'Música', papel: 'musica', clipes: [
      {id: 'm1', arquivo: 'midia/a.wav', em: 0, duracao_ms: 10000}, {id: 'm2', arquivo: 'midia/b.wav', em: 10000, corte_ms: 5000, duracao_ms: 10000},
    ]},
  ]},
  legendas: {
    segmentos: [
      {id: 'leg-1', em: 1000, sai: 2200, texto: 'Olá a todos', clipe: 'n1', palavras: [{w: 'Olá', s: 1000, e: 1400}, {w: 'a', s: 1400, e: 1500}, {w: 'todos', s: 1600, e: 2200}]},
      {id: 'leg-2', em: 4500, sai: 6000, texto: 'o FGTS é seu', clipe: 'n1', palavras: [{w: 'o', s: 4500, e: 4600}, {w: 'FGTS', s: 4650, e: 5200}, {w: 'é', s: 5300, e: 5400}, {w: 'seu', s: 5500, e: 6000}]},
    ],
    origens: [{clipe: 'n1', arquivo: 'midia/narracao.wav', palavras: 'midia/narracao.wav.palavras.json', em: 1000, corte_ms: 500}],
  },
});

const envelope = (duracao_ms: number) => JSON.stringify({versao: 2, janela_ms: 50, duracao_ms, db: []});

beforeAll(async () => {
  pasta = mkdtempSync(path.join(tmpdir(), 'estudio-mcp-som-'));
  mkdirSync(path.join(pasta, 'midia'), {recursive: true});
  mkdirSync(path.join(pasta, 'video'), {recursive: true});
  for (const f of ['narracao', 'a', 'b']) writeFileSync(path.join(pasta, 'midia', `${f}.wav`), 'RIFF de mentira');
  // a música A tem 12 s (2 s a mais que o clipe); a B tem 15 s e o clipe dela pula os 5 s do começo
  writeFileSync(path.join(pasta, 'midia', 'a.wav.envelope.json'), envelope(12000));
  writeFileSync(path.join(pasta, 'midia', 'b.wav.envelope.json'), envelope(15000));
  writeFileSync(path.join(pasta, 'estudio.json'), JSON.stringify({formato: 1, nome: 'Som', documentos: [{id: 'video', modulo: 'video', caminho: 'video/video.json', titulo: 'Som'}]}));
  writeFileSync(path.join(pasta, 'video', 'video.json'), JSON.stringify(documento()));
  projeto = new Projeto(pasta);
  const servidor = new McpServer({name: 'estudio', version: 'teste'});
  registrarFerramentas(servidor, projeto, 'agente', 'teste');
  const [a, b] = InMemoryTransport.createLinkedPair();
  cliente = new Client({name: 'teste', version: '1'});
  await Promise.all([servidor.connect(a), cliente.connect(b)]);
});
afterAll(() => rmSync(pasta, {recursive: true, force: true}));

describe('MCP: som do vídeo de cenas', () => {
  it('dividir_clipe divide na grade de quadros, leva as legendas e grava no diário como o agente, com inverso', async () => {
    const r = await chamar('dividir_clipe', {documento: 'video', clipe: 'n1', em_ms: 4000});
    expect(r.erro).toBe(false);
    expect(r.json).toMatchObject({ok: true, primeiro: {id: 'n1', em: 1000}, segundo: {id: 'n1-1'}, legendas: {levadas_ao_segundo: 1, partidas: 0}});
    expect(r.json.corte_ms).toBeCloseTo(4000, 2); // 90 quadros depois de 1000 ms
    const d = lerVideo();
    expect(d.audio!.faixas[0].clipes.map((c) => c.id)).toEqual(['n1', 'n1-1']);
    expect(d.legendas!.segmentos.map((s) => [s.id, s.clipe])).toEqual([['leg-1', 'n1'], ['leg-2', 'n1-1']]);
    const e = projeto.diario().at(-1)!;
    expect(e).toMatchObject({autor: 'agente', origem: 'teste'});
    expect(e.rotulo).toMatch(/dividir clipe n1/);
    expect(e.inverso.length).toBeGreaterThan(0);
    // a tela continua com as mesmas palavras
    expect(resolverCenas(d).props.legendas_cenas!.segmentos.map((s) => s.texto)).toEqual(['Olá a todos', 'o FGTS é seu']);
  });

  it('dividir_clipe sem em_ms usa onde a cabeça está; sem isso, pede o tempo', async () => {
    const sem = await chamar('dividir_clipe', {documento: 'video', clipe: 'm1'});
    expect(sem.erro).toBe(true);
    expect(sem.texto).toMatch(/em_ms/);
    projeto.gravarEstado({area: 'video', documento: 'video', tempo_ms: 5000, atualizado_em: new Date().toISOString()});
    const r = await chamar('dividir_clipe', {clipe: 'm1'});
    expect(r.erro).toBe(false);
    expect(r.json.segundo).toMatchObject({id: 'm1-1', em: 5000});
  });

  it('dividir_clipe recusa o corte fora do clipe e o clipe que não existe, sem gravar nada', async () => {
    const antes = projeto.diario().length;
    expect((await chamar('dividir_clipe', {documento: 'video', clipe: 'n1', em_ms: 20000})).erro).toBe(true);
    expect((await chamar('dividir_clipe', {documento: 'video', clipe: 'nao-existe', em_ms: 2000})).erro).toBe(true);
    expect(projeto.diario().length).toBe(antes);
  });

  it('copiar_clipe copia depois do original com as legendas', async () => {
    const r = await chamar('copiar_clipe', {documento: 'video', clipe: 'n1-1'});
    expect(r.erro).toBe(false);
    expect(r.json.copia).toMatchObject({id: 'n1-1-1'});
    expect(r.json.legendas_copiadas).toBe(1);
    const d = lerVideo();
    expect(d.audio!.faixas[0].clipes.map((c) => c.id)).toEqual(['n1', 'n1-1', 'n1-1-1']);
    expect(d.legendas!.segmentos).toHaveLength(3);
  });

  it('crossfade estende pelo som que sobra nos arquivos (lê o envelope ao lado) e grava a curva', async () => {
    // m1 foi dividido em m1 (0–5000) e m1-1 (5000–10000); o crossfade é entre m1-1 e m2
    const r = await chamar('crossfade', {documento: 'video', de: 'm1-1', para: 'm2', duracao_ms: 1500});
    expect(r.erro).toBe(false);
    expect(r.json).toMatchObject({ok: true, curva: 'potencia', duracao_ms: 1500});
    // o arquivo a.wav tem 12 s e o clipe m1-1 vai até 10 s: dá para estender 1,5 s no fim
    expect(r.json.desce).toMatchObject({id: 'm1-1', duracao_ms: 6500});
    expect(r.json.sobe).toMatchObject({id: 'm2', em: 10000, duracao_ms: 10000});
    const faixa = lerVideo().audio!.faixas[1];
    expect(faixa.clipes.find((c) => c.id === 'm1-1')).toMatchObject({fade_out_ms: 1500, fade_out_curva: 'potencia'});
    expect(faixa.clipes.find((c) => c.id === 'm2')).toMatchObject({fade_in_ms: 1500, fade_in_curva: 'potencia'});
  });

  it('crossfade em modo sobrepor e recusas', async () => {
    const r = await chamar('crossfade', {documento: 'video', de: 'm1', para: 'm1-1', duracao_ms: 800, curva: 'linear', modo: 'sobrepor'});
    expect(r.erro).toBe(false);
    expect(r.json.sobe).toMatchObject({id: 'm1-1', em: 4200});
    expect((await chamar('crossfade', {documento: 'video', de: 'm1', para: 'n1', duracao_ms: 800})).erro).toBe(true); // faixas diferentes
    expect((await chamar('crossfade', {documento: 'video', de: 'm1', para: 'm1-1', duracao_ms: 20})).erro).toBe(true); // curto demais (o esquema recusa)
    expect((await chamar('crossfade', {documento: 'video', de: 'm1', para: 'm1-1', duracao_ms: 800, curva: 'estranha'})).erro).toBe(true);
  });
});
