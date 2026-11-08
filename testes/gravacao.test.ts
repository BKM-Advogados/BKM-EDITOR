// Gravar a narração (rodada 3, frente Som): o WAV PCM de 48 kHz que a interface codifica e o processo principal confere, os
// medidores, o teleprompter (a conta de tempo) e as ferramentas MCP preparar_teleprompter e adicionar_clipe_audio.
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {envelopeDeAmostras, resolverAudio} from '../src/nucleo/audio';
import {novoDocCenas, type DocCenas} from '../src/nucleo/cenas';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {
  codificarWavPcm, duracaoDoTeleprompter, juntarPedacos, lerCabecalhoWav, niveisDoPedaco, nomeDaTomada, palavraEm, PPM_MAX, PPM_MIN, PPM_PADRAO, RESTRICOES_MICROFONE, TAXA_GRAVACAO,
  teleprompterDe, temposDoTeleprompter, textoDasCenas,
} from '../src/nucleo/gravacao';
import {Projeto} from '../src/nucleo/projeto';
import {salvarTomada} from '../src/main/ipc-gravacao';
import {decodificarAudio} from '../src/main/ffmpeg-som';

const seno = (hz: number, segundos: number, amplitude = 0.5, taxa = TAXA_GRAVACAO) => {
  const out = new Float32Array(Math.round(segundos * taxa));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / taxa);
  return out;
};

describe('WAV da gravação', () => {
  it('24 bits: o cabeçalho diz PCM, 48 kHz, mono, e as amostras voltam com erro abaixo de 1e-6', () => {
    const x = seno(440, 0.5);
    const wav = codificarWavPcm([x], TAXA_GRAVACAO, 24);
    expect(lerCabecalhoWav(wav)).toEqual({canais: 1, taxa: 48000, bits: 24, amostras: 24000});
    expect(wav.length).toBe(44 + 24000 * 3);
    // decodifica à mão: inteiro de 24 bits com sinal, dividido pelo máximo
    const v = new DataView(wav.buffer);
    let pior = 0;
    for (let i = 0; i < x.length; i += 97) {
      const q = (v.getUint8(44 + i * 3) | (v.getUint8(45 + i * 3) << 8) | (v.getUint8(46 + i * 3) << 16)) << 8 >> 8;
      pior = Math.max(pior, Math.abs(q / (2 ** 23 - 1) - x[i]));
    }
    expect(pior).toBeLessThan(1e-6);
  });

  it('16 bits e estéreo; amostra fora de −1…1 é cortada; silêncio e vetor vazio não quebram', () => {
    const wav = codificarWavPcm([Float32Array.of(0, 2, -2, 0.5), Float32Array.of(0, 0, 0, 0)], 48000, 16);
    expect(lerCabecalhoWav(wav)).toEqual({canais: 2, taxa: 48000, bits: 16, amostras: 4});
    const v = new DataView(wav.buffer);
    expect([v.getInt16(48, true), v.getInt16(52, true)]).toEqual([32767, -32767]);
    expect(lerCabecalhoWav(codificarWavPcm([new Float32Array(0)], 48000))).toMatchObject({amostras: 0});
  });

  it('o ffmpeg do Remotion decodifica a tomada de 24 bits, e o envelope sai do áudio gravado', async () => {
    const x = seno(300, 1, 0.5);
    const dir = mkdtempSync(path.join(tmpdir(), 'estudio-grav-'));
    try {
      writeFileSync(path.join(dir, 'tomada.wav'), codificarWavPcm([x], TAXA_GRAVACAO, 24));
      const d = await decodificarAudio(path.join(dir, 'tomada.wav'));
      expect(d.taxa).toBe(48000);
      expect(d.canais[0].length).toBe(48000);
      let pior = 0;
      for (let i = 0; i < x.length; i += 53) pior = Math.max(pior, Math.abs(d.canais[0][i] - x[i]));
      expect(pior).toBeLessThan(1e-5);
      // seno de amplitude 0,5 a 300 Hz: −9,7 dB de pico → perto de −12,7 LUFS pela ponderação K (−3 dB do RMS, −0,7 do K)
      const env = envelopeDeAmostras(d.canais, d.taxa);
      expect(env.duracao_ms).toBe(1000);
      expect(Math.abs(env.db[10] - -9.7)).toBeLessThan(0.5);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('recusa o que não é WAV PCM: texto, float, 8 bits, sem bloco data', () => {
    expect('erro' in (lerCabecalhoWav(new TextEncoder().encode('RIFF de mentira, sem nada de WAV por dentro, só texto comprido')) as object)).toBe(true);
    const wav = codificarWavPcm([seno(440, 0.1)], 48000, 16);
    const v = new DataView(wav.buffer);
    v.setUint16(20, 3, true); // float
    expect(lerCabecalhoWav(wav)).toMatchObject({erro: expect.stringMatching(/PCM/)});
    v.setUint16(20, 1, true);
    v.setUint16(34, 8, true);
    expect(lerCabecalhoWav(wav)).toMatchObject({erro: expect.stringMatching(/8 bits/)});
    expect(lerCabecalhoWav(new Uint8Array(10))).toMatchObject({erro: expect.stringMatching(/curto/)});
  });

  it('o microfone é aberto sem eco, ruído nem ganho automático, mono e a 48 kHz', () => {
    expect(RESTRICOES_MICROFONE).toEqual({echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1, sampleRate: 48000});
  });

  it('medidor: seno de 0,5 dá pico −6,0 dB e RMS −9,0 dB; silêncio é −100; juntar pedaços preserva a ordem', () => {
    const n = niveisDoPedaco(seno(1000, 0.2, 0.5));
    expect(n.pico_db).toBeCloseTo(-6.02, 1);
    expect(n.rms_db).toBeCloseTo(-9.03, 1);
    expect(niveisDoPedaco(new Float32Array(100))).toEqual({pico_db: -100, rms_db: -100});
    expect(Array.from(juntarPedacos([Float32Array.of(1, 2), Float32Array.of(), Float32Array.of(3)]))).toEqual([1, 2, 3]);
  });

  it('o nome da tomada nunca repete um que existe', () => {
    const existentes = new Set(['midia/narracao-gravada.wav', 'midia/narracao-gravada-2.wav']);
    expect(nomeDaTomada((c) => existentes.has(c))).toBe('midia/narracao-gravada-3.wav');
    expect(nomeDaTomada(() => false)).toBe('midia/narracao-gravada.wav');
  });
});

describe('teleprompter', () => {
  const texto = 'Recebeu proposta para mudar de cidade? Calma, pense primeiro.\n\nO FGTS é seu, e ninguém tira.';

  it('cada palavra tem o tempo de 60 000/ppm ms e a pontuação acrescenta a pausa de quem lê', () => {
    const t = temposDoTeleprompter(texto, 150); // 400 ms por palavra
    expect(t).toHaveLength(16);
    expect(t.slice(0, 3)).toEqual([0, 400, 800]);
    expect(t[5] - t[4]).toBe(400); // "de" não tem pontuação
    expect(t[6] - t[5]).toBe(400 + 500); // "cidade?" fecha a frase: pausa de ponto depois dela
    expect(t[7] - t[6]).toBe(400 + 250); // "Calma," pede a pausa de vírgula
    expect(t[8] - t[7]).toBe(400);
    expect(t[9] - t[8]).toBe(400 + 500 + 600); // "primeiro." fecha a frase e o parágrafo
  });

  it('o parágrafo novo pede mais um respiro, e o dobro de velocidade corta o tempo (sem a pausa) pela metade', () => {
    const rapido = temposDoTeleprompter('a b c d', 240);
    expect(rapido).toEqual([0, 250, 500, 750]);
    const com = temposDoTeleprompter('um dois.\n\ntrês quatro', 150);
    const sem = temposDoTeleprompter('um dois. três quatro', 150);
    expect(com[2] - sem[2]).toBe(600);
  });

  it('a palavra da vez em cada instante; antes do começo −1; depois do fim, a última', () => {
    const t = temposDoTeleprompter('um dois três quatro', 150);
    expect(palavraEm(t, -1)).toBe(-1);
    expect(palavraEm(t, 0)).toBe(0);
    expect(palavraEm(t, 399)).toBe(0);
    expect(palavraEm(t, 400)).toBe(1);
    expect(palavraEm(t, 1250)).toBe(3);
    expect(palavraEm(t, 99999)).toBe(3);
    expect(palavraEm([], 100)).toBe(-1);
  });

  it('a duração da leitura é a do começo da última palavra mais o tempo dela; a velocidade é limitada', () => {
    expect(duracaoDoTeleprompter('um dois três quatro', 150)).toBe(1200 + 400);
    expect(duracaoDoTeleprompter('', 150)).toBe(0);
    expect(duracaoDoTeleprompter('um dois', 9999)).toBe(duracaoDoTeleprompter('um dois', PPM_MAX));
    expect(duracaoDoTeleprompter('um dois', 1)).toBe(duracaoDoTeleprompter('um dois', PPM_MIN));
  });

  it('o do documento é normalizado; sem texto, não há teleprompter', () => {
    expect(teleprompterDe({texto: 'oi'})).toEqual({texto: 'oi', palavras_por_minuto: PPM_PADRAO, tamanho: 0.045, espelhar: false});
    expect(teleprompterDe({texto: 'oi', palavras_por_minuto: 180, tamanho: 9, espelhar: true})).toMatchObject({palavras_por_minuto: 180, tamanho: 0.12, espelhar: true});
    expect(teleprompterDe({texto: '   '})).toBeNull();
    expect(teleprompterDe(undefined)).toBeNull();
  });

  it('o texto das cenas: títulos, textos e listas, uma cena por parágrafo, sem os asteriscos do destaque', () => {
    expect(textoDasCenas({cenas: [
      {blocos: [{tipo: 'titulo', texto: 'Seu **FGTS**'}, {tipo: 'imagem'}, {tipo: 'lista', itens: ['Um', 'Dois']}]},
      {blocos: [{tipo: 'numero'}]},
      {blocos: [{tipo: 'texto', texto: 'Fim.'}]},
    ]})).toBe('Seu FGTS\nUm\nDois\n\nFim.');
  });
});

describe('salvar a tomada no projeto (processo principal)', () => {
  let pasta = '';
  beforeAll(() => {
    pasta = mkdtempSync(path.join(tmpdir(), 'estudio-tomada-'));
    mkdirSync(path.join(pasta, 'midia'), {recursive: true});
    writeFileSync(path.join(pasta, 'estudio.json'), JSON.stringify({formato: 1, nome: 'Tomada', documentos: []}));
  });
  afterAll(() => rmSync(pasta, {recursive: true, force: true}));

  it('grava em midia/ sem sobrescrever a tomada anterior e devolve o caminho no projeto', () => {
    const p = new Projeto(pasta);
    const wav = codificarWavPcm([seno(200, 0.2)], 48000, 24);
    expect(salvarTomada(p, wav)).toBe('midia/narracao-gravada.wav');
    expect(salvarTomada(p, wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer)).toBe('midia/narracao-gravada-2.wav');
    expect(readFileSync(path.join(pasta, 'midia', 'narracao-gravada.wav')).length).toBe(wav.length);
  });

  it('recusa o que não é WAV, outra taxa e WAV vazio, e não deixa arquivo', () => {
    const p = new Projeto(pasta);
    expect(() => salvarTomada(p, new Uint8Array(200))).toThrow(/tomada recusada/);
    expect(() => salvarTomada(p, codificarWavPcm([seno(200, 0.2, 0.5, 44100)], 44100, 16))).toThrow(/44100 Hz/);
    expect(() => salvarTomada(p, codificarWavPcm([new Float32Array(0)], 48000, 24))).toThrow(/não tem som/);
    expect(p.existe('midia/narracao-gravada-3.wav')).toBe(false);
  });
});

describe('MCP: teleprompter e clipe de áudio', () => {
  let pasta = '';
  let projeto: Projeto;
  let cliente: Client;
  const chamar = async (name: string, args: Record<string, unknown>) => {
    const r = (await cliente.callTool({name, arguments: args})) as {isError?: boolean; content: {text: string}[]};
    const t = r.content[0]?.text ?? '';
    return {erro: Boolean(r.isError), texto: t, json: r.isError ? null : JSON.parse(t)};
  };
  const lerVideo = () => projeto.lerJson<DocCenas>('video/video.json').doc;

  beforeAll(async () => {
    pasta = mkdtempSync(path.join(tmpdir(), 'estudio-mcp-grav-'));
    mkdirSync(path.join(pasta, 'midia'), {recursive: true});
    mkdirSync(path.join(pasta, 'video'), {recursive: true});
    writeFileSync(path.join(pasta, 'midia', 'narracao-gravada.wav'), codificarWavPcm([seno(200, 8, 0.1)], 48000, 24));
    writeFileSync(path.join(pasta, 'midia', 'whoosh.wav'), codificarWavPcm([seno(800, 0.8, 0.7)], 48000, 24));
    writeFileSync(path.join(pasta, 'midia', 'cama.wav'), codificarWavPcm([seno(220, 5, 0.3)], 48000, 24));
    // o app já mediu os dois primeiros (o .envelope.json ao lado); a cama ainda não
    for (const a of ['narracao-gravada', 'whoosh']) {
      const wav = readFileSync(path.join(pasta, 'midia', `${a}.wav`));
      const x = new Float32Array((wav.length - 44) / 3);
      const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
      for (let i = 0; i < x.length; i++) x[i] = ((v.getUint8(44 + i * 3) | (v.getUint8(45 + i * 3) << 8) | (v.getUint8(46 + i * 3) << 16)) << 8 >> 8) / (2 ** 23 - 1);
      writeFileSync(path.join(pasta, 'midia', `${a}.wav.envelope.json`), JSON.stringify(envelopeDeAmostras([x], 48000)));
    }
    writeFileSync(path.join(pasta, 'estudio.json'), JSON.stringify({formato: 1, nome: 'Gravar', documentos: [{id: 'video', modulo: 'video', caminho: 'video/video.json', titulo: 'Gravar'}]}));
    const doc: DocCenas = {
      ...novoDocCenas({largura: 1080, altura: 1920, fps: 30}),
      cenas: [
        {id: 'c1', duracao_ms: 6000, blocos: [{id: 't1', tipo: 'titulo', x: 0.1, y: 0.4, largura: 0.8, texto: 'Recebeu proposta de **outra cidade**?'}]},
        {id: 'c2', duracao_ms: 6000, blocos: [{id: 't2', tipo: 'texto', x: 0.1, y: 0.4, largura: 0.8, texto: 'Calma: o FGTS é seu.'}]},
      ],
    };
    writeFileSync(path.join(pasta, 'video', 'video.json'), JSON.stringify(doc));
    projeto = new Projeto(pasta);
    const servidor = new McpServer({name: 'estudio', version: 'teste'});
    registrarFerramentas(servidor, projeto, 'agente', 'teste');
    const [a, b] = InMemoryTransport.createLinkedPair();
    cliente = new Client({name: 'teste', version: '1'});
    await Promise.all([servidor.connect(a), cliente.connect(b)]);
  });
  afterAll(() => rmSync(pasta, {recursive: true, force: true}));

  it('preparar_teleprompter sem texto usa as cenas, grava o campo no vídeo e estima a duração', async () => {
    const r = await chamar('preparar_teleprompter', {documento: 'video', palavras_por_minuto: 140});
    expect(r.erro).toBe(false);
    expect(r.json).toMatchObject({ok: true, usou_o_texto_das_cenas: true, palavras: 10});
    expect(lerVideo().teleprompter).toEqual({texto: 'Recebeu proposta de outra cidade?\n\nCalma: o FGTS é seu.', palavras_por_minuto: 140});
    expect(projeto.diario().at(-1)).toMatchObject({autor: 'agente', rotulo: 'texto do teleprompter'});
    // de novo, com texto próprio e espelho: troca o campo e mantém o que não foi dito
    const outra = await chamar('preparar_teleprompter', {texto: 'Primeiro parágrafo.\n\nSegundo.', espelhar: true});
    expect(outra.json.usou_o_texto_das_cenas).toBe(false);
    expect(lerVideo().teleprompter).toEqual({texto: 'Primeiro parágrafo.\n\nSegundo.', palavras_por_minuto: 140, espelhar: true});
  });

  it('preparar_teleprompter sem texto nem cenas com texto recusa', async () => {
    const vazio = path.join(pasta, 'video', 'vazio.json');
    writeFileSync(vazio, JSON.stringify({...novoDocCenas({largura: 1080, altura: 1920, fps: 30}), cenas: [{id: 'c', duracao_ms: 3000, blocos: []}]}));
    const m = JSON.parse(readFileSync(path.join(pasta, 'estudio.json'), 'utf-8'));
    m.documentos.push({id: 'vazio', modulo: 'video', caminho: 'video/vazio.json', titulo: 'Vazio'});
    writeFileSync(path.join(pasta, 'estudio.json'), JSON.stringify(m));
    const r = await chamar('preparar_teleprompter', {documento: 'vazio'});
    expect(r.erro).toBe(true);
    expect(r.texto).toMatch(/não há texto/);
  });

  it('adicionar_clipe_audio põe a tomada gravada na narração (o app cria as faixas) com a duração do envelope', async () => {
    const r = await chamar('adicionar_clipe_audio', {documento: 'video', arquivo: 'midia/narracao-gravada.wav', papel: 'voz'});
    expect(r.erro).toBe(false);
    expect(r.json).toMatchObject({ok: true, faixa: 'narracao', clipe: {em: 0, duracao_ms: 8000}});
    const d = lerVideo();
    expect(d.audio!.faixas.map((f) => f.papel)).toEqual(['voz', 'musica', 'efeitos']);
    expect(d.audio!.faixas[0].clipes[0]).toMatchObject({arquivo: 'midia/narracao-gravada.wav', duracao_ms: 8000});
  });

  it('o efeito entra 20 LU abaixo da voz medida; a música vai até o fim do vídeo com fade e avisa se cobre outra', async () => {
    const e = await chamar('adicionar_clipe_audio', {documento: 'video', arquivo: 'midia/whoosh.wav', papel: 'efeitos', em_ms: 2000});
    expect(e.json.clipe.volume).toBeLessThan(0.2);
    expect(e.json.clipe).toMatchObject({em: 2000, duracao_ms: 800});
    const m = await chamar('adicionar_clipe_audio', {documento: 'video', arquivo: 'midia/cama.wav', papel: 'musica', duracao_ms: 5000});
    expect(m.json.clipe).toMatchObject({em: 0, duracao_ms: 5000});
    expect(lerVideo().audio!.faixas[1].clipes[0].fade_out_ms).toBe(1500);
    const m2 = await chamar('adicionar_clipe_audio', {documento: 'video', arquivo: 'midia/cama.wav', papel: 'musica', em_ms: 3000, duracao_ms: 5000});
    expect(m2.json.avisos.join(' ')).toMatch(/entra por cima/);
    // o documento resolvido avisa que as duas músicas tocam juntas
    expect(resolverAudio(lerVideo().audio, 12000).avisos.join(' ')).toMatch(/tocam juntas/);
  });

  it('recusa arquivo que não é áudio, que não existe, ou ainda sem medida e sem duracao_ms', async () => {
    expect((await chamar('adicionar_clipe_audio', {documento: 'video', arquivo: 'video/video.json', papel: 'voz'})).erro).toBe(true);
    expect((await chamar('adicionar_clipe_audio', {documento: 'video', arquivo: 'midia/nada.wav', papel: 'voz'})).texto).toMatch(/não está no projeto/);
    const sem = await chamar('adicionar_clipe_audio', {documento: 'video', arquivo: 'midia/cama.wav', papel: 'efeitos'});
    expect(sem.erro).toBe(true);
    expect(sem.texto).toMatch(/duracao_ms/);
  });
});
