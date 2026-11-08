// Cortes pela fala de ponta a ponta (frente Fala, rodada 3): propor_cortes_fala e aplicar_cortes_fala pelo MCP, com o
// ffmpeg de verdade (o do compositor do Remotion, como a limpeza de voz) gravando o WAV emendado num projeto temporário.
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registrarFerramentas, type TranscritorMcp} from '../src/nucleo/ferramentas-mcp';
import {novoDocCenas, resolverCenas, type DocCenas} from '../src/nucleo/cenas';
import {legendasDaFala, VERSAO_PALAVRAS, type PalavraLegenda} from '../src/nucleo/legendas';
import {Projeto} from '../src/nucleo/projeto';
import {gravarWav, lerWav} from '../src/main/ffmpeg-som';
import {emendarArquivo} from '../src/main/cortes-fala';
import {Transcritor} from '../src/main/transcricao';

const TAXA = 48_000;
const FALA: PalavraLegenda[] = [
  {w: 'Recebeu', s: 200, e: 500}, {w: 'proposta', s: 1700, e: 2000}, {w: 'ãh,', s: 2600, e: 2800}, {w: 'para', s: 3400, e: 3700}, {w: 'mudar.', s: 3900, e: 4200},
];
let pasta = '';
let projeto: Projeto;

beforeAll(() => {
  pasta = mkdtempSync(path.join(tmpdir(), 'estudio-cortes-'));
  mkdirSync(path.join(pasta, 'midia'));
  mkdirSync(path.join(pasta, 'video'));
  // 5 s de zumbido baixo com uma rajada em cada palavra
  const n = 5 * TAXA;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.05 * Math.sin((2 * Math.PI * 47 * i) / TAXA);
  for (const p of FALA) for (let i = Math.round((p.s * TAXA) / 1000); i < Math.round((p.e * TAXA) / 1000); i++) x[i] += 0.4 * Math.sin((2 * Math.PI * 440 * i) / TAXA);
  writeFileSync(path.join(pasta, 'midia', 'narracao.wav'), gravarWav([x], TAXA));
  writeFileSync(path.join(pasta, 'midia', 'narracao.wav.palavras.json'), JSON.stringify(FALA));
  writeFileSync(path.join(pasta, 'estudio.json'), JSON.stringify({formato: 1, nome: 'Cortes', documentos: [{id: 'video', modulo: 'video', caminho: 'video/video.json', titulo: 'V'}]}));
  const clipe = {id: 'n1', arquivo: 'midia/narracao.wav', em: 1000, duracao_ms: 5000};
  const doc: DocCenas = {
    ...novoDocCenas({largura: 1080, altura: 1920, fps: 30}),
    cenas: [{id: 'c1', duracao_ms: 8000, blocos: []}],
    audio: {faixas: [{id: 'voz', nome: 'Narração', papel: 'voz', clipes: [clipe]}]},
    legendas: legendasDaFala([{clipe, faixa: {nome: 'Narração'}, palavras: FALA, caminhoPalavras: 'midia/narracao.wav.palavras.json'}], {largura: 1080, altura: 1920}),
  };
  writeFileSync(path.join(pasta, 'video', 'video.json'), JSON.stringify(doc));
  projeto = new Projeto(pasta);
});
afterAll(() => rmSync(pasta, {recursive: true, force: true}));

const conectar = async (t?: TranscritorMcp) => {
  const servidor = new McpServer({name: 'estudio', version: 'teste'});
  registrarFerramentas(servidor, projeto, 'agente', 'teste', undefined, t);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const cliente = new Client({name: 'teste', version: '1'});
  await Promise.all([servidor.connect(a), cliente.connect(b)]);
  return cliente;
};
const chamar = async (c: Client, name: string, args: Record<string, unknown>) => {
  const r = (await c.callTool({name, arguments: args})) as {isError?: boolean; content: {text: string}[]};
  return {erro: Boolean(r.isError), texto: r.content[0]?.text ?? '', json: r.isError ? null : JSON.parse(r.content[0]?.text ?? 'null')};
};
const lerVideo = () => projeto.lerJson<DocCenas>('video/video.json').doc;
const naTela = () => (resolverCenas(lerVideo()).props.legendas_cenas?.segmentos ?? []).flatMap((s) => s.palavras.map((p) => `${p.w}@${p.s}`));

describe('cortes pela fala pelo MCP', () => {
  it('propor: pausas longas, o "ãh" e as pontas, com o contexto de cada corte', async () => {
    const c = await conectar({transcrever: async () => ({ok: false})});
    const r = await chamar(c, 'propor_cortes_fala', {documento: 'video'});
    expect(r.erro).toBe(false);
    expect(r.json.cortes.map((x: {motivo: string}) => x.motivo)).toEqual(['silencio', 'preenchimento', 'silencio']);
    expect(r.json.cortes[1]).toMatchObject({texto: 'ãh,', contexto: 'Recebeu proposta | para mudar.'});
    expect(r.json.economia_ms).toBeGreaterThan(2000);
  });

  it('aplicar: grava o WAV emendado e o palavras.json carimbado; o clipe e as legendas vão para o tempo novo; Reverter e voltar desfazem', async () => {
    const t = new Transcritor({pasta: path.join(pasta, 'modelos')});
    const c = await conectar({transcrever: async () => ({ok: false}), conferir: (p, a) => t.conferir(p, a), emendar: (p, x) => emendarArquivo(p, x)});
    const antesTela = naTela();
    const r = await chamar(c, 'aplicar_cortes_fala', {documento: 'video'});
    expect(r.erro, r.texto).toBe(false);
    expect(r.json).toMatchObject({ok: true, clipe: 'n1', palavras_tiradas: ['ãh,']});
    const doc = lerVideo();
    const clipe = doc.audio!.faixas[0].clipes[0];
    expect(clipe.arquivo).toBe(r.json.arquivo);
    expect(clipe.cortes_fala).toMatchObject({fonte: 'midia/narracao.wav', duracao_ms: 5000});
    // o WAV tem exatamente o tamanho de antes menos os cortes
    const wav = lerWav(new Uint8Array(readFileSync(projeto.caminho(clipe.arquivo))));
    expect(Math.abs(wav.canais[0].length / TAXA * 1000 - (5000 - r.json.tirado_ms))).toBeLessThanOrEqual(1);
    expect(clipe.duracao_ms).toBe(5000 - r.json.tirado_ms);
    // a transcrição do arquivo novo está em dia (carimbo) e sem o "ãh"
    const palavras = projeto.lerJson<{versao: number; palavras: PalavraLegenda[]}>(`${clipe.arquivo}.palavras.json`).doc;
    expect(palavras.versao).toBe(VERSAO_PALAVRAS);
    expect(palavras.palavras.map((p) => p.w)).toEqual(['Recebeu', 'proposta', 'para', 'mudar.']);
    expect(t.conferir(projeto, clipe.arquivo)).toBe('em_dia');
    // as legendas: as mesmas palavras, mais cedo, sem o "ãh"
    const depois = naTela();
    expect(depois.map((x) => x.split('@')[0])).toEqual(antesTela.map((x) => x.split('@')[0]).filter((w) => w !== 'ãh,'));
    expect(depois.map((x) => Number(x.split('@')[1]))).toEqual(palavras.palavras.map((p) => 1000 + p.s - (clipe.corte_ms ?? 0)));
    expect(projeto.diario().at(-1)).toMatchObject({autor: 'agente', rotulo: expect.stringContaining('cortes pela fala')});
    // corte pedido em cima de palavra: recusado, nada muda
    const recusa = await chamar(c, 'aplicar_cortes_fala', {documento: 'video', cortes: [{de_ms: 100, ate_ms: 300}]});
    expect(recusa.texto).toContain('cortes recusados');
    // voltar: o clipe toca o arquivo de antes e as legendas voltam ao tempo de antes (sem o "ãh")
    const v = await chamar(c, 'aplicar_cortes_fala', {documento: 'video', voltar: true});
    expect(v.json).toMatchObject({ok: true, arquivo: 'midia/narracao.wav'});
    expect(lerVideo().audio!.faixas[0].clipes[0]).toEqual({id: 'n1', arquivo: 'midia/narracao.wav', em: 1000, duracao_ms: 5000});
    expect(naTela()).toEqual(antesTela.filter((x) => !x.startsWith('ãh')));
  });
});
