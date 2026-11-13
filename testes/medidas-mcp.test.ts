// Frente 3 do MCP: medir_loudness, medir_envelope e limpar_voz (src/nucleo/mcp-medidas.ts) com o servidor de verdade em
// memória sobre um projeto em pasta temporária, WAV sintético e o ffmpeg do node_modules, como o MCP por stdio roda com o
// app fechado. O loudness do MCP tem de ser o mesmo número do medidor da tela (criarMedidorDeLoudness, src/main/loudness.ts),
// e a limpeza num clipe, o mesmo patch do botão da tela (src/nucleo/medidas-som.ts).
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {ehEnvelope, type LimpezaClipe} from '../src/nucleo/audio';
import {novoDocCenas, type DocCenas} from '../src/nucleo/cenas';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import type {MedidaLoudness, MedidasLoudness} from '../src/nucleo/loudness';
import {curvaDoCurtoPrazo, formaDaOnda, leituraDoLoudness} from '../src/nucleo/mcp-medidas';
import {definirServicoMedidas, medirEnvelopeDoAudio, origemDaLimpeza, patchLimpezaDoClipe, patchVoltarAoOriginalDoClipe} from '../src/nucleo/medidas-som';
import {classeDe} from '../src/nucleo/portao';
import {Projeto} from '../src/nucleo/projeto';
import {gravarWav} from '../src/main/ffmpeg-som';
import {lerEnvelope} from '../src/main/ipc-audio';
import {criarMedidorDeLoudness} from '../src/main/loudness';
import {pastaDoFfmpegDoApp, servicoDeMedidas} from '../src/main/medidas';
import {propsDoVideo} from '../src/main/sessao-projeto';

// DSP e ffmpeg de verdade: com a suíte inteira rodando junto, os 5 s padrão do vitest não bastam
vi.setConfig({testTimeout: 60_000});

const RAIZ = path.join(__dirname, '..');
const FFMPEG = pastaDoFfmpegDoApp(RAIZ);
const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-medidas-'));
afterAll(() => {
  definirServicoMedidas(null);
  rmSync(tmp, {recursive: true, force: true});
});

const TAXA = 48000;
const gerador = (semente: number) => {
  let x = semente >>> 0;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 0xffffffff) * 2 - 1;
};
/** 6 s de "voz": frases de 0,8 s (sílabas de 200 Hz com harmônicos) e pausas, mais ruído branco a −50 dBFS. */
const vozComRuido = () => {
  const n = 6 * TAXA;
  const x = new Float32Array(n);
  const aleatorio = gerador(7);
  for (let i = 0; i < n; i++) {
    const t = i / TAXA;
    let s = 0;
    if (t % 1.3 < 0.8 && t % 0.2 < 0.15) for (let h = 1; h <= 8; h++) s += Math.sin(2 * Math.PI * 200 * h * t) / h;
    x[i] = 0.12 * s + aleatorio() * Math.pow(10, -50 / 20) * Math.sqrt(3);
  }
  return x;
};
/** Seno de 997 Hz em estéreo, os dois lados no mesmo nível: pelo BS.1770, `dbfs` LUFS. */
const tom = (segundos: number, dbfs: number) => {
  const a = Math.pow(10, dbfs / 20);
  const x = Float32Array.from({length: segundos * TAXA}, (_, i) => a * Math.sin((2 * Math.PI * 997 * i) / TAXA));
  return [x, x.slice()];
};

const docVideo = (): DocCenas => ({
  ...novoDocCenas({largura: 1080, altura: 1920, fps: 30}),
  cenas: [{id: 'c1', duracao_ms: 8000, blocos: []}],
  audio: {faixas: [
    {id: 'narracao', nome: 'Narração', papel: 'voz', clipes: [{id: 'n1', arquivo: 'midia/voz.wav', em: 1000, duracao_ms: 6000}]},
    {id: 'musica', nome: 'Música', papel: 'musica', clipes: [{id: 'm1', arquivo: 'midia/musica.wav', em: 0, duracao_ms: 8000}]},
  ]},
});
const docTom = (): DocCenas => ({
  ...novoDocCenas({largura: 1080, altura: 1920, fps: 30}),
  cenas: [{id: 'c1', duracao_ms: 5000, blocos: []}],
  audio: {faixas: [{id: 'musica', nome: 'Música', papel: 'musica', clipes: [{id: 't1', arquivo: 'midia/tom.wav', em: 0, duracao_ms: 5000}]}]},
});

let projeto: Projeto;
let cliente: Client;
const chamar = async (name: string, args: Record<string, unknown>) => {
  const r = (await cliente.callTool({name, arguments: args})) as {isError?: boolean; content: {text: string}[]};
  const texto = r.content[0]?.text ?? '';
  return {erro: Boolean(r.isError), texto, json: r.isError ? null : JSON.parse(texto)};
};
const lerVideo = () => projeto.lerJson<DocCenas>('video/video.json').doc;

beforeAll(async () => {
  const pasta = path.join(tmp, 'Som');
  mkdirSync(path.join(pasta, 'midia'), {recursive: true});
  mkdirSync(path.join(pasta, 'video'), {recursive: true});
  writeFileSync(path.join(pasta, 'midia', 'voz.wav'), gravarWav([vozComRuido()], TAXA));
  writeFileSync(path.join(pasta, 'midia', 'musica.wav'), gravarWav(tom(8, -24), TAXA));
  writeFileSync(path.join(pasta, 'midia', 'tom.wav'), gravarWav(tom(5, -20), TAXA));
  writeFileSync(path.join(pasta, 'estudio.json'), JSON.stringify({formato: 1, nome: 'Som', documentos: [
    {id: 'video', modulo: 'video', caminho: 'video/video.json', titulo: 'Som'},
    {id: 'tom', modulo: 'video', caminho: 'video/tom.json', titulo: 'Tom'},
  ]}));
  writeFileSync(path.join(pasta, 'video', 'video.json'), JSON.stringify(docVideo()));
  writeFileSync(path.join(pasta, 'video', 'tom.json'), JSON.stringify(docTom()));
  projeto = new Projeto(pasta);
  const servidor = new McpServer({name: 'estudio', version: 'teste'});
  registrarFerramentas(servidor, projeto, 'agente', 'teste');
  const [a, b] = InMemoryTransport.createLinkedPair();
  cliente = new Client({name: 'teste', version: '1'});
  await Promise.all([servidor.connect(a), cliente.connect(b)]);
});

describe('contas puras', () => {
  it('a forma da onda guarda o mais alto de cada pedaço e não passa de n pontos', () => {
    expect(formaDaOnda([-60, -10, -50, -50, -20, -100], 3)).toEqual([-10, -50, -20]);
    expect(formaDaOnda([-30, -40], 48)).toEqual([-30, -40]);
    expect(formaDaOnda([])).toEqual([]);
    expect(formaDaOnda(Array.from({length: 1000}, (_, i) => -i / 10))).toHaveLength(48);
  });

  it('a curva do curto prazo pega um valor por segundo e troca o silêncio por null', () => {
    const m = {curto_prazo: Array.from({length: 25}, (_, k) => (k < 10 ? -100 : -14.04)), integrado_lufs: -14, curto_max_lufs: -14, momentaneo_max_lufs: -13, pico_dbtp: -1, duracao_ms: 2500} as MedidaLoudness;
    expect(curvaDoCurtoPrazo(m)).toEqual([{t_ms: 1000, lufs: null}, {t_ms: 2000, lufs: -14}]);
  });

  it('a leitura diz a diferença do alvo, o pico alto e quanto a música fica abaixo da voz, sem a curva de 100 ms', () => {
    const m = (i: number | null, pico: number | null): MedidaLoudness => ({integrado_lufs: i, curto_prazo: [i ?? -100], curto_max_lufs: i, momentaneo_max_lufs: i, pico_dbtp: pico, duracao_ms: 100});
    const r: MedidasLoudness = {mistura: m(-17.04, -0.5), voz: m(-18, null), alvo_lufs: -14, pico_dbtp: -1, faltando: ['midia/sumiu.wav'],
      faixas: {'/audio/faixas/0': m(-18, null), '/audio/faixas/1': {...m(-30, null), sob_voz_lufs: -38.26, abaixo_da_voz_lu: 20.24}}};
    const l = leituraDoLoudness(r, docVideo());
    expect(l.mistura).toMatchObject({integrado_lufs: -17, diferenca_do_alvo_lu: -3, no_alvo: false, pico_dbtp: -0.5, pico_alto: true});
    expect(l.mistura).not.toHaveProperty('curto_prazo');
    expect(l.faixas).toEqual([
      expect.objectContaining({id: 'narracao', papel: 'voz', integrado_lufs: -18}),
      expect.objectContaining({id: 'musica', papel: 'musica', sob_voz_lufs: -38.3, abaixo_da_voz_lu: 20.2}),
    ]);
    expect(l.notas!.join(' ')).toMatch(/3 LU abaixo do alvo.*pico.*sumiu\.wav/);
    expect(leituraDoLoudness({...r, mistura: m(-14.6, -2), faltando: []}, docVideo())).toMatchObject({mistura: {no_alvo: true}});
    expect(leituraDoLoudness(r, docVideo(), {curva: true}).curto_prazo_mistura).toEqual([]);
  });

  it('a limpeza num clipe troca o arquivo, guarda o original e as medidas; voltar desfaz; a origem é sempre o da pessoa', () => {
    const doc = docVideo();
    const caminho = '/audio/faixas/0/clipes/0';
    const c = doc.audio!.faixas[0].clipes[0];
    const medidas: LimpezaClipe = {intensidade: 'media', ruido_antes_db: -50, ruido_depois_db: -70, voz_antes_db: -20, voz_depois_db: -20};
    const patch = patchLimpezaDoClipe(doc, caminho, c, {arquivo: 'midia/voz.wav.limpo.wav', medidas});
    expect(patch).toEqual([
      {op: 'test', path: `${caminho}/id`, value: 'n1'},
      {op: 'test', path: `${caminho}/arquivo`, value: 'midia/voz.wav'}, {op: 'replace', path: `${caminho}/arquivo`, value: 'midia/voz.wav.limpo.wav'},
      {op: 'add', path: `${caminho}/original`, value: 'midia/voz.wav'}, {op: 'add', path: `${caminho}/limpeza`, value: medidas},
    ]);
    const limpo = {...c, arquivo: 'midia/voz.wav.limpo.wav', original: 'midia/voz.wav', limpeza: medidas};
    expect(origemDaLimpeza(limpo)).toBe('midia/voz.wav');
    const doc2 = {...doc, audio: {faixas: [{...doc.audio!.faixas[0], clipes: [limpo]}, doc.audio!.faixas[1]]}};
    expect(patchVoltarAoOriginalDoClipe(doc2, caminho, limpo).filter((o) => o.op !== 'test')).toEqual([
      {op: 'replace', path: `${caminho}/arquivo`, value: 'midia/voz.wav'}, {op: 'remove', path: `${caminho}/original`}, {op: 'remove', path: `${caminho}/limpeza`},
    ]);
    expect(patchVoltarAoOriginalDoClipe(doc, caminho, c)).toEqual([]);
  });
});

describe('sem o serviço (servidor MCP sem o ffmpeg do Estúdio)', () => {
  it('as três respondem com erro claro e nada muda', async () => {
    definirServicoMedidas(null);
    const antes = readFileSync(projeto.caminho('video/video.json'), 'utf-8');
    for (const [nome, args] of [['medir_loudness', {}], ['medir_envelope', {arquivo: 'midia/voz.wav'}], ['limpar_voz', {arquivo: 'midia/voz.wav'}]] as const) {
      const r = await chamar(nome, args);
      expect(r.erro, nome).toBe(true);
      expect(r.texto).toMatch(/ffmpeg do Estúdio/);
    }
    await expect(medirEnvelopeDoAudio(projeto, 'midia/voz.wav')).rejects.toThrow(/ffmpeg do Estúdio/);
    expect(readFileSync(projeto.caminho('video/video.json'), 'utf-8')).toBe(antes);
  });

  it('são livres no portão, como as prévias e o medidor da tela', async () => {
    const {tools} = await cliente.listTools();
    for (const nome of ['medir_loudness', 'medir_envelope', 'limpar_voz']) {
      const t = tools.find((x) => x.name === nome);
      expect(t, nome).toBeDefined();
      expect(classeDe(nome, t!.annotations)).toBe('livre');
    }
    expect(tools.find((x) => x.name === 'medir_loudness')!.annotations?.readOnlyHint).toBe(true);
  });
});

describe.skipIf(!FFMPEG)('com o ffmpeg do node_modules (o MCP com o app fechado)', () => {
  beforeAll(() => definirServicoMedidas(servicoDeMedidas({binarios: () => FFMPEG})));

  it('medir_envelope grava o .envelope.json carimbado, que a tela aceita como em dia', async () => {
    const r = await chamar('medir_envelope', {arquivo: 'midia/voz.wav'});
    expect(r.erro, r.texto).toBe(false);
    expect(r.json).toMatchObject({arquivo: 'midia/voz.wav', envelope: 'midia/voz.wav.envelope.json', janela_ms: 50});
    expect(r.json.duracao_ms).toBeGreaterThan(5900);
    expect(r.json.duracao_ms).toBeLessThan(6100);
    expect(r.json.forma_db).toHaveLength(48);
    expect(r.json.nivel_db).toBeLessThan(-10);
    expect(r.json.nivel_db).toBeGreaterThan(-40);
    const gravado = projeto.lerJson<unknown>('midia/voz.wav.envelope.json').doc;
    expect(ehEnvelope(gravado)).toBe(true);
    expect(lerEnvelope(projeto, 'midia/voz.wav')?.duracao_ms).toBe(r.json.duracao_ms); // o carimbo confere com o arquivo
    // a função do núcleo para quem importa áudio (frente 2) mede o mesmo
    expect((await medirEnvelopeDoAudio(projeto, 'midia/musica.wav')).duracao_ms).toBeGreaterThan(7900);
    expect(lerEnvelope(projeto, 'midia/musica.wav')).toBeDefined();
  });

  it('medir_envelope recusa o que não está no projeto', async () => {
    const r = await chamar('medir_envelope', {arquivo: 'midia/nao-existe.wav'});
    expect(r.erro).toBe(true);
    expect(r.texto).toMatch(/nao_achado/);
  });

  it('medir_loudness mede o tom de 997 Hz a −20 dBFS em −20 LUFS e dá o mesmo número do medidor da tela', async () => {
    const r = await chamar('medir_loudness', {documento: 'tom', curva: true});
    expect(r.erro, r.texto).toBe(false);
    expect(r.json.documento).toBe('tom');
    expect(r.json.mistura.integrado_lufs).toBeGreaterThan(-20.6);
    expect(r.json.mistura.integrado_lufs).toBeLessThan(-19.4);
    expect(r.json.mistura.diferenca_do_alvo_lu).toBeCloseTo(r.json.mistura.integrado_lufs + 14, 1);
    expect(r.json.voz).toBeNull();
    expect(r.json.curto_prazo_mistura.length).toBeGreaterThanOrEqual(4);
    const tela = await criarMedidorDeLoudness()(projeto, propsDoVideo(projeto, 'tom', ''));
    expect('erro' in tela).toBe(false);
    expect(r.json.mistura.integrado_lufs).toBe(Math.round((tela as MedidasLoudness).mistura.integrado_lufs! * 10) / 10);
  });

  it('medir_loudness no vídeo com voz e música diz quanto a música fica abaixo da voz', async () => {
    const r = await chamar('medir_loudness', {});
    expect(r.erro, r.texto).toBe(false);
    expect(r.json.documento).toBe('video');
    expect(r.json.voz.integrado_lufs).toEqual(expect.any(Number));
    const musica = r.json.faixas.find((f: {id: string}) => f.id === 'musica');
    expect(musica.abaixo_da_voz_lu).toEqual(expect.any(Number));
    expect(r.json).not.toHaveProperty('curto_prazo_mistura');
  });

  it('limpar_voz com arquivo grava o limpo ao lado, com envelope, sem tocar no original', async () => {
    const original = readFileSync(projeto.caminho('midia/voz.wav'));
    const r = await chamar('limpar_voz', {arquivo: 'midia/voz.wav'});
    expect(r.erro, r.texto).toBe(false);
    expect(r.json).toMatchObject({ok: true, original: 'midia/voz.wav', arquivo: 'midia/voz.wav.limpo.wav', intensidade: 'media'});
    expect(r.json.medidas.ruido_depois_db).toBeLessThan(r.json.medidas.ruido_antes_db);
    expect(existsSync(projeto.caminho('midia/voz.wav.limpo.wav'))).toBe(true);
    expect(lerEnvelope(projeto, 'midia/voz.wav.limpo.wav')).toBeDefined();
    expect(readFileSync(projeto.caminho('midia/voz.wav')).equals(original)).toBe(true);
    expect(projeto.lerJson<DocCenas>('video/video.json').doc.audio!.faixas[0].clipes[0].arquivo).toBe('midia/voz.wav'); // o documento não muda
  });

  it('limpar_voz num clipe faz o que o botão da tela faz, parte sempre do original e volta ao original', async () => {
    const leve = await chamar('limpar_voz', {clipe: 'n1', intensidade: 'leve'});
    expect(leve.erro, leve.texto).toBe(false);
    let c = lerVideo().audio!.faixas[0].clipes[0];
    expect(c).toMatchObject({arquivo: 'midia/voz.wav.limpo-leve.wav', original: 'midia/voz.wav', limpeza: {intensidade: 'leve'}});
    const forte = await chamar('limpar_voz', {clipe: 'n1', intensidade: 'forte'});
    expect(forte.erro, forte.texto).toBe(false);
    c = lerVideo().audio!.faixas[0].clipes[0];
    expect(c).toMatchObject({arquivo: 'midia/voz.wav.limpo-forte.wav', original: 'midia/voz.wav', limpeza: {intensidade: 'forte'}});
    expect(projeto.diario().at(-1)).toMatchObject({autor: 'agente', origem: 'teste', rotulo: expect.stringMatching(/^limpar voz \(forte\)/)});
    const volta = await chamar('limpar_voz', {clipe: 'n1', voltar: true});
    expect(volta.erro, volta.texto).toBe(false);
    c = lerVideo().audio!.faixas[0].clipes[0];
    expect(c.arquivo).toBe('midia/voz.wav');
    expect(c).not.toHaveProperty('original');
    expect(c).not.toHaveProperty('limpeza');
    const outra = await chamar('limpar_voz', {clipe: 'n1', voltar: true});
    expect(outra.erro).toBe(true);
    expect(outra.texto).toMatch(/já toca o arquivo original/);
  });

  it('limpar_voz recusa pedido sem alvo, com os dois alvos, voltar com arquivo e clipe que não existe', async () => {
    for (const args of [{}, {clipe: 'n1', arquivo: 'midia/voz.wav'}, {arquivo: 'midia/voz.wav', voltar: true}, {clipe: 'nao-tem'}]) {
      const r = await chamar('limpar_voz', args);
      expect(r.erro, JSON.stringify(args)).toBe(true);
    }
  });
});
