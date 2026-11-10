// A ida e volta vídeo → música → vídeo pelos dois transportes do MCP: HTTP (o do app, com token por aba) e stdio (o
// pacote de mcp/nucleo.ts, que outro app de IA usa fora do Estúdio). O render é o de verdade (WAV a 48 kHz, sem ffmpeg).
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildSync} from 'esbuild';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {McpHttp} from '../src/main/mcp-http';
import {novoDocCenas, type DocCenas} from '../src/nucleo/cenas';
import {novoAudioCenas} from '../src/nucleo/audio';
import {Projeto, serializar} from '../src/nucleo/projeto';
import {definirServicoMusica} from '../src/nucleo/musica-projeto';
import {servicoDeRender} from '../src/main/musica-render';
import {gravarWav} from '../src/main/ffmpeg-som';

const RAIZ = path.join(__dirname, '..');
const pastas: string[] = [];

/** Projeto com um vídeo de cenas, uma narração e uma cama de 6 s a 48 kHz no clipe "clipe-2" da faixa de música. */
const projetoDeTeste = () => {
  const pasta = mkdtempSync(path.join(tmpdir(), 'estudio-musica-t-'));
  pastas.push(pasta);
  const v = novoDocCenas({largura: 1080, altura: 1920, fps: 30});
  v.cenas[0].duracao_ms = 6000;
  v.audio = novoAudioCenas();
  v.audio.faixas[1].clipes.push({id: 'clipe-2', arquivo: 'midia/cama.wav', em: 500, duracao_ms: 4000});
  mkdirSync(path.join(pasta, 'video'), {recursive: true});
  mkdirSync(path.join(pasta, 'midia'), {recursive: true});
  writeFileSync(path.join(pasta, 'estudio.json'), serializar({formato: 1, nome: 'Transporte', documentos: [{id: 'video', modulo: 'video', caminho: 'video/video.json', titulo: 'Vídeo'}]}));
  writeFileSync(path.join(pasta, 'video', 'video.json'), serializar(v));
  const onda = Float32Array.from({length: 6 * 48000}, (_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / 48000));
  writeFileSync(path.join(pasta, 'midia', 'cama.wav'), gravarWav([onda, onda], 48000));
  return pasta;
};

const chamar = async (c: Client, name: string, args: Record<string, unknown>) => {
  const r = (await c.callTool({name, arguments: args})) as {isError?: boolean; content: {text: string}[]};
  if (r.isError) throw new Error(r.content[0].text);
  return JSON.parse(r.content[0].text);
};

/** Leva o clipe à Música, cria uma batida e volta; confere o clipe ligado e o render no disco. */
const idaEVolta = async (c: Client, pasta: string) => {
  const ida = await chamar(c, 'levar_para', {modulo: 'musica', alvo: {documento: 'video', caminho: '/audio/faixas/@musica/clipes/@clipe-2'}});
  expect(ida).toMatchObject({transicao: 't1', destino: {documento: 'musica'}, criado: true});
  await chamar(c, 'criar_padrao', {canal: 'bateria', estilo: 'eletronico', no_arranjo: {em: 0, dur: 8}});
  const volta = await chamar(c, 'concluir_transicao', {transicao: 't1'});
  expect(volta).toMatchObject({documento: 'video', caminho: '/audio/faixas/@musica/clipes/@clipe-2'});
  const clipe = new Projeto(pasta).lerJson<DocCenas>('video/video.json').doc.audio!.faixas[1].clipes[0];
  expect(clipe).toMatchObject({musica: 'musica', duracao_ms: 4000, musica_original: {arquivo: 'midia/cama.wav'}});
  expect(existsSync(path.join(pasta, clipe.arquivo))).toBe(true);
  return clipe;
};

afterAll(() => {
  definirServicoMusica(null);
  for (const p of pastas) rmSync(p, {recursive: true, force: true});
});

describe('ida e volta pelos transportes do MCP', () => {
  let servidor: http.Server;
  let origem = '';
  let mcp: McpHttp;
  let pastaHttp = '';

  beforeAll(async () => {
    definirServicoMusica(servicoDeRender());
    pastaHttp = projetoDeTeste();
    const projeto = new Projeto(pastaHttp);
    mcp = new McpHttp(path.join(pastaHttp, '.config-teste'), () => projeto);
    servidor = http.createServer((req, res) => void mcp.atender(req, res).then((ok) => ok || res.writeHead(404).end()));
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    origem = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });
  afterAll(() => servidor?.close());

  it('HTTP (o do app): a aba entra no diário da transição com a origem dela', async () => {
    const cfg = JSON.parse(readFileSync(mcp.novaAba(origem, 'Gemini 1'), 'utf-8'));
    const c = new Client({name: 'teste', version: '0'});
    await c.connect(new StreamableHTTPClientTransport(new URL(`${origem}/mcp`), {requestInit: {headers: cfg.mcpServers.estudio.headers}}));
    await idaEVolta(c, pastaHttp);
    const daMusica = new Projeto(pastaHttp).diario().filter((e) => e.documento === 'musica/musica.json');
    expect(daMusica.every((e) => e.autor === 'agente' && e.origem === 'Gemini 1' && e.transicao === 't1')).toBe(true);
    await c.close();
  });

  it('stdio (outro app de IA fora do Estúdio): a mesma ida e volta, com o render gravado pelo próprio MCP', async () => {
    const saida = mkdtempSync(path.join(tmpdir(), 'estudio-mcp-pacote-'));
    pastas.push(saida);
    const pacote = path.join(saida, 'nucleo.cjs');
    buildSync({entryPoints: [path.join(RAIZ, 'mcp', 'nucleo.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node20', outfile: pacote,
      absWorkingDir: RAIZ, logLevel: 'warning'});
    const pasta = projetoDeTeste();
    const c = new Client({name: 'outro-app', version: '0'});
    await c.connect(new StdioClientTransport({command: process.execPath, args: [pacote, '--projeto', pasta, '--autor', 'outro-app'], cwd: RAIZ}));
    const clipe = await idaEVolta(c, pasta);
    expect(new Projeto(pasta).lerJson<{duracao_ms: number}>(clipe.arquivo.replace(/\.wav$/, '.json')).doc.duracao_ms).toBe(4000);
    await c.close();
  }, 60_000);
});
