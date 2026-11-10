// Limpeza de voz: com uma "voz" sintética (sílabas com harmônicos e pausas) e ruído conhecido, o ruído nas pausas cai e a
// voz fica no nível; o grave abaixo de 80 Hz some; o tamanho não muda; cancelar para. E as peças do processo principal
// que não rodam o ffmpeg: o nome do arquivo limpo, o WAV (ler e gravar, inclusive o do pipe) e o que o ffmpeg conta da entrada.
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it, vi} from 'vitest';
import {envelopeDeAmostras} from '../src/nucleo/audio';
import {gravarPlano, planoDoProjeto} from '../src/nucleo/criar-projeto';
import {INTENSIDADES, LimpezaCancelada, limparVoz, medirRuido} from '../src/nucleo/limpeza-voz';
import {Projeto} from '../src/nucleo/projeto';
import {amostrasPorPacote, gravarWav, lerEntrada, lerWav} from '../src/main/ffmpeg-som';
import {arquivoDoEnvelope, lerEnvelope} from '../src/main/ipc-audio';
import {apagarLimposSemUso, arquivoLimpo, garantirForaDoGit, limparArquivo, REGRAS_GIT, versoesLimpas} from '../src/main/limpeza-voz';

// DSP, ffmpeg e git de verdade: com a suíte inteira e outras sessões rodando juntas, os 5 s padrão do vitest não bastam
vi.setConfig({testTimeout: 30_000});

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-limpeza-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], {cwd, encoding: 'utf-8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
const temGit = (() => {
  try {
    execFileSync('git', ['--version'], {windowsHide: true});
    return true;
  } catch {
    return false;
  }
})();
const FFMPEG = path.join('node_modules', '@remotion', `compositor-${process.platform}-${process.arch}${process.platform === 'win32' ? '-msvc' : ''}`, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const projetoNovo = (nome: string) => new Projeto(gravarPlano(path.join(tmp, nome), planoDoProjeto({nome, modelo: 'video-branco'})));

const TAXA = 48000;
const gerador = (semente: number) => {
  let x = semente >>> 0;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 0xffffffff) * 2 - 1;
};

/** 6 s: frases de 0,8 s (sílabas de 200 Hz com harmônicos, uns −20 dBFS) e pausas de 0,5 s, mais ruído branco a −50 dBFS. */
const vozComRuido = (o: {ruido?: number; rumor?: number} = {}) => {
  const n = 6 * TAXA;
  const voz = new Float32Array(n);
  const ruido = new Float32Array(n);
  const aleatorio = gerador(3);
  for (let i = 0; i < n; i++) {
    const t = i / TAXA;
    const naFrase = t % 1.3 < 0.8 && t % 0.2 < 0.15;
    if (naFrase) {
      let s = 0;
      for (let h = 1; h <= 8; h++) s += Math.sin(2 * Math.PI * 200 * h * t) / h;
      voz[i] = 0.12 * s * Math.min(1, (t % 0.2) / 0.01, (0.15 - (t % 0.2)) / 0.02);
    }
    ruido[i] = aleatorio() * (o.ruido ?? Math.pow(10, -50 / 20)) * Math.sqrt(3) + (o.rumor ?? 0) * Math.sin(2 * Math.PI * 30 * t);
  }
  const suja = new Float32Array(n);
  for (let i = 0; i < n; i++) suja[i] = voz[i] + ruido[i];
  return {voz, suja};
};

/** Quanto de um seno de `hz` há no sinal (amplitude, por correlação). */
const componente = (x: Float32Array, hz: number) => {
  let c = 0, s = 0;
  for (let i = 0; i < x.length; i++) {
    c += x[i] * Math.cos((2 * Math.PI * hz * i) / TAXA);
    s += x[i] * Math.sin((2 * Math.PI * hz * i) / TAXA);
  }
  return (2 * Math.hypot(c, s)) / x.length;
};

describe('limpeza de voz', () => {
  it('o ruído nas pausas cai e a voz fica no nível, mais quanto mais forte a intensidade', async () => {
    const {suja} = vozComRuido();
    const quedas: number[] = [];
    for (const intensidade of ['leve', 'media', 'forte'] as const) {
      const r = await limparVoz([suja], TAXA, intensidade);
      const m = r.medidas;
      expect(r.canais[0]).toHaveLength(suja.length);
      expect(r.canais[0].every(Number.isFinite)).toBe(true);
      expect(m.intensidade).toBe(intensidade);
      expect(m.ruido_antes_db).toBeLessThan(-45);
      expect(Math.abs(m.voz_depois_db! - m.voz_antes_db!)).toBeLessThan(1.5);
      quedas.push(m.ruido_antes_db - m.ruido_depois_db);
      expect(r.envelope.duracao_ms).toBe(6000);
    }
    expect(quedas[0]).toBeGreaterThan(6);
    expect(quedas[1]).toBeGreaterThan(quedas[0]);
    expect(quedas[2]).toBeGreaterThan(quedas[1]);
    expect(quedas[1]).toBeGreaterThan(INTENSIDADES.media.reducao_db - 6);
  });

  it('corta o rumor grave (30 Hz) e não atrasa a voz', async () => {
    const {voz, suja} = vozComRuido({rumor: 0.05});
    const r = await limparVoz([suja], TAXA, 'media');
    expect(componente(r.canais[0], 30)).toBeLessThan(componente(suja, 30) / 30); // mais de 30 dB abaixo
    // o fundamental da voz continua no lugar: correlação alta com a voz limpa original, sem atraso
    let xy = 0, xx = 0, yy = 0;
    for (let i = 0; i < voz.length; i++) (xy += voz[i] * r.canais[0][i]), (xx += voz[i] ** 2), (yy += r.canais[0][i] ** 2);
    expect(xy / Math.sqrt(xx * yy)).toBeGreaterThan(0.9);
  });

  it('estéreo limpa os dois canais; silêncio sai silêncio; o mesmo áudio dá o mesmo resultado', async () => {
    const {suja} = vozComRuido();
    const r = await limparVoz([suja, suja.map((v) => v * 0.5)], TAXA, 'leve');
    expect(r.canais).toHaveLength(2);
    const zero = await limparVoz([new Float32Array(TAXA)], TAXA);
    expect(zero.canais[0].every((v) => v === 0)).toBe(true);
    const a = await limparVoz([suja], TAXA, 'forte');
    const b = await limparVoz([suja], TAXA, 'forte');
    expect(a.canais[0]).toEqual(b.canais[0]);
  }, 20_000); // DSP em estéreo: passa de 5 s quando a suíte inteira roda junto (integração da rodada 2)

  it('cancelar para no meio, com LimpezaCancelada; o andamento chega a 1', async () => {
    const {suja} = vozComRuido();
    await expect(limparVoz([suja], TAXA, 'media', {cancelado: () => true})).rejects.toBeInstanceOf(LimpezaCancelada);
    const vistos: number[] = [];
    await limparVoz([suja], TAXA, 'media', {aoProgresso: (p) => vistos.push(p)});
    expect(vistos.at(-1)).toBe(1);
    expect(vistos.every((p, i) => i === 0 || p >= vistos[i - 1])).toBe(true);
  });

  it('o ruído medido é o das pausas: as 10 % janelas mais quietas, sem zero digital', () => {
    const env = envelopeDeAmostras([vozComRuido().suja], TAXA);
    const m = medirRuido(env);
    expect(m.ruido_db).toBeGreaterThan(-60);
    expect(m.ruido_db).toBeLessThan(-45);
    expect(m.voz_db!).toBeGreaterThan(m.ruido_db + 20);
    // o depois se mede nas mesmas janelas
    expect(medirRuido(env, m.pausas).pausas).toBe(m.pausas);
  });
});

describe('processo principal (sem ffmpeg)', () => {
  it('o arquivo limpo fica ao lado do original; leve e forte levam o nome', () => {
    expect(arquivoLimpo('midia/narracao.wav')).toBe('midia/narracao.wav.limpo.wav');
    expect(arquivoLimpo('midia/narracao.mp3', 'forte')).toBe('midia/narracao.mp3.limpo-forte.wav');
  });

  it('WAV de 16 bits: grava e lê de volta; o do pipe (tamanho desconhecido) e o de 24 bits também', () => {
    const a = new Float32Array([0, 0.5, -0.5, 0.25, -1]);
    const wav = gravarWav([a, a.map((v) => -v)], 22050);
    const lido = lerWav(wav);
    expect(lido.taxa).toBe(22050);
    expect(lido.canais).toHaveLength(2);
    lido.canais[0].forEach((v, i) => expect(v).toBeCloseTo(a[i], 3));
    const pipe = Buffer.from(wav);
    pipe.writeUInt32LE(0xffffffff, 40);
    expect(lerWav(pipe).canais[1][1]).toBeCloseTo(-0.5, 3);
    // 24 bits, mono: 0,5 e −0,25
    const w24 = Buffer.alloc(44 + 6);
    w24.write('RIFF', 0, 'ascii');
    w24.write('WAVEfmt ', 8, 'ascii');
    w24.writeUInt32LE(16, 16);
    w24.writeUInt16LE(1, 20);
    w24.writeUInt16LE(1, 22);
    w24.writeUInt32LE(48000, 24);
    w24.writeUInt16LE(24, 34);
    w24.write('data', 36, 'ascii');
    w24.writeUInt32LE(6, 40);
    w24.writeIntLE(4194304, 44, 3);
    w24.writeIntLE(-2097152, 47, 3);
    expect(Array.from(lerWav(w24).canais[0])).toEqual([0.5, -0.25]);
    expect(() => lerWav(Buffer.from('nada disso'))).toThrow(/WAV/);
  });

  it('lê o codec, a taxa e os canais da entrada no que o ffmpeg escreve, e o tamanho do pacote de cada codec', () => {
    const wav = lerEntrada('Input #0, wav, from \'x.wav\':\n  Duration: 00:00:12.00\n  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 22050 Hz, mono, s16, 352 kb/s\n'
      + 'Output #0, wav, to \'pipe:1\':\n  Stream #0:0: Audio: pcm_s24le, 48000 Hz, stereo, s32 (24 bit), 2304 kb/s\n');
    expect(wav).toEqual({codec: 'pcm_s16le', taxa: 22050, canais: 1});
    expect(amostrasPorPacote(wav!)).toBe(2048);
    const mp4 = lerEntrada('  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 95 kb/s (default)');
    expect(mp4).toEqual({codec: 'aac', taxa: 44100, canais: 2});
    expect(amostrasPorPacote(mp4!)).toBe(1024);
    expect(amostrasPorPacote({codec: 'pcm_s16le', canais: 2})).toBe(1024);
    expect(amostrasPorPacote({codec: 'mp3', canais: 2})).toBe(1152);
    expect(lerEntrada('nada')).toBeNull();
  });
});

describe('versões limpas fora do git (som-D13)', () => {
  it('a regra entra no .gitignore uma vez, no projeto que já tem um e no que não tem', () => {
    const p = projetoNovo('Regra');
    const antes = readFileSync(p.caminho('.gitignore'), 'utf-8');
    expect(garantirForaDoGit(p)).toBe(true);
    const depois = readFileSync(p.caminho('.gitignore'), 'utf-8');
    expect(depois.startsWith(antes)).toBe(true); // o que havia fica
    for (const r of REGRAS_GIT) expect(depois.split('\n')).toContain(r);
    expect(REGRAS_GIT).toEqual(expect.arrayContaining(['*.limpo.wav', '*.limpo-leve.wav', '*.limpo-forte.wav', '*.limpo.wav.envelope.json']));
    expect(garantirForaDoGit(p)).toBe(false);
    expect(readFileSync(p.caminho('.gitignore'), 'utf-8')).toBe(depois);
    // projeto antigo sem .gitignore (ou com um sem quebra de linha no fim)
    rmSync(p.caminho('.gitignore'));
    expect(garantirForaDoGit(p)).toBe(true);
    expect(readFileSync(p.caminho('.gitignore'), 'utf-8').split('\n')).toContain('*.limpo-forte.wav');
    writeFileSync(p.caminho('.gitignore'), 'saidas/');
    garantirForaDoGit(p);
    expect(readFileSync(p.caminho('.gitignore'), 'utf-8').split('\n').slice(0, 2)).toEqual(['saidas/', expect.stringMatching(/^# Estúdio/)]);
  });

  it.skipIf(!temGit)('o git do projeto ignora as três intensidades e os envelopes delas, e não o original', () => {
    const p = projetoNovo('Git');
    git(p.raiz, 'init', '-q');
    garantirForaDoGit(p);
    const limpos = (['leve', 'media', 'forte'] as const).map((i) => arquivoLimpo('midia/sub/narracao.wav', i));
    for (const f of ['midia/sub/narracao.wav', ...limpos, ...limpos.map(arquivoDoEnvelope), 'midia/sub/narracao.wav.envelope.json']) p.gravarTexto(f, 'x');
    git(p.raiz, 'add', '-A'); // o que o commit automático faz
    const entrou = git(p.raiz, 'diff', '--cached', '--name-only').split('\n').filter(Boolean);
    expect(entrou).toContain('midia/sub/narracao.wav');
    expect(entrou).toContain('midia/sub/narracao.wav.envelope.json');
    expect(entrou.filter((f) => f.includes('.limpo'))).toEqual([]);
  });

  it('na abertura apaga a versão que nenhum documento cita, com o envelope; a citada, o original e o arquivo da pessoa ficam', () => {
    const p = projetoNovo('Sobras');
    const doc = p.manifesto().documentos.find((d) => d.modulo === 'video')!;
    const forte = arquivoLimpo('midia/narracao.wav', 'forte');
    const sobras = [arquivoLimpo('midia/narracao.wav'), arquivoLimpo('midia/narracao.wav', 'leve'), arquivoLimpo('midia/antiga.mp3')];
    for (const f of ['midia/narracao.wav', 'midia/minha voz.limpo.wav', forte, ...sobras]) {
      p.gravarTexto(f, 'x');
      if (f.includes('.wav.limpo') || f.includes('.mp3.limpo')) p.gravarTexto(arquivoDoEnvelope(f), '{}');
    }
    const d = p.lerJson<Record<string, unknown>>(doc.caminho).doc;
    p.gravarTexto(doc.caminho, JSON.stringify({...d, audio: {faixas: [{id: 'f', nome: 'Narração', papel: 'voz', clipes: [
      {id: 'a', arquivo: forte, original: 'midia/narracao.wav', em: 0, duracao_ms: 1000}]}]}}, null, 2));
    expect(versoesLimpas(p)).toEqual([...sobras, forte].sort());
    expect(apagarLimposSemUso(p).sort()).toEqual([...sobras].sort());
    for (const f of sobras) {
      expect(existsSync(p.caminho(f))).toBe(false);
      expect(existsSync(p.caminho(arquivoDoEnvelope(f)))).toBe(false);
    }
    for (const f of [forte, arquivoDoEnvelope(forte), 'midia/narracao.wav', 'midia/minha voz.limpo.wav']) expect(existsSync(p.caminho(f))).toBe(true);
    // documento quebrado no meio de uma gravação: na dúvida, não apaga nada
    p.gravarTexto(arquivoLimpo('midia/narracao.wav'), 'x');
    p.gravarTexto(doc.caminho, '{"audio": ');
    expect(apagarLimposSemUso(p)).toEqual([]);
    expect(existsSync(p.caminho(arquivoLimpo('midia/narracao.wav')))).toBe(true);
  });

  it('som-N1: a faxina poupa a versão que o diário ainda cita, e o Ctrl+Z depois de reabrir acha o arquivo', () => {
    const p = projetoNovo('Diario');
    const doc = p.manifesto().documentos.find((d) => d.modulo === 'video')!;
    const media = arquivoLimpo('midia/narracao.wav');
    const forte = arquivoLimpo('midia/narracao.wav', 'forte');
    const orfa = arquivoLimpo('midia/narracao.wav', 'leve'); // limpeza que não chegou ao documento
    for (const f of ['midia/narracao.wav', media, forte, orfa]) p.gravarTexto(f, 'x');
    for (const f of [media, forte, orfa]) p.gravarTexto(arquivoDoEnvelope(f), '{}');
    const pela = (patch: Parameters<Projeto['aplicarPatch']>[0]['patch'], rotulo: string) =>
      p.aplicarPatch({documento: doc.id, patch, autor: 'pessoa', origem: 'interface', rotulo});
    // sessão 1: Limpar voz (Média), depois Limpar de novo (Forte)
    pela([{op: 'add', path: '/audio', value: {faixas: [{id: 'f', nome: 'Narração', papel: 'voz', clipes: [
      {id: 'a', arquivo: media, original: 'midia/narracao.wav', limpeza: {intensidade: 'media'}, em: 0, duracao_ms: 1000}]}]}}], 'limpar voz');
    pela([{op: 'replace', path: '/audio/faixas/0/clipes/0/arquivo', value: forte},
      {op: 'replace', path: '/audio/faixas/0/clipes/0/limpeza', value: {intensidade: 'forte'}}], 'limpar de novo');
    // sessão 2: a abertura apaga só a órfã; a Média, que o documento não cita mais, fica porque o inverso a cita
    expect(apagarLimposSemUso(p)).toEqual([orfa]);
    expect(existsSync(p.caminho(orfa))).toBe(false);
    expect(existsSync(p.caminho(arquivoDoEnvelope(orfa)))).toBe(false);
    for (const f of [media, arquivoDoEnvelope(media), forte]) expect(existsSync(p.caminho(f))).toBe(true);
    // Ctrl+Z como o main.ts faz: a última entrada da pessoa pela interface, com o inverso dela
    const ultima = p.diario().filter((e) => e.autor === 'pessoa' && e.origem === 'interface').at(-1)!;
    p.aplicarPatch({documento: ultima.documento, versao_base: ultima.versao_depois, patch: ultima.inverso, autor: 'pessoa', origem: 'desfazer'});
    const clipe = p.lerJson<{audio: {faixas: {clipes: {arquivo: string}[]}[]}}>(doc.caminho).doc.audio.faixas[0].clipes[0];
    expect(clipe.arquivo).toBe(media);
    expect(existsSync(p.caminho(clipe.arquivo))).toBe(true);
    // diário com uma linha quebrada: na dúvida, não apaga nada
    p.gravarTexto(orfa, 'x');
    writeFileSync(p.caminho('.estudio/diario.jsonl'), `${readFileSync(p.caminho('.estudio/diario.jsonl'), 'utf-8')}{"seq": \n`);
    expect(apagarLimposSemUso(p)).toEqual([]);
    expect(existsSync(p.caminho(orfa))).toBe(true);
  });

  it.skipIf(!temGit || !existsSync(FFMPEG))('limpar de verdade (ffmpeg do Remotion): .gitignore antes do WAV, que fica fora do git, e envelope carimbado', async () => {
    const p = projetoNovo('Limpar');
    git(p.raiz, 'init', '-q');
    writeFileSync(p.caminho('.gitignore'), 'saidas/\n'); // projeto antigo, sem a regra
    writeFileSync(p.caminho('midia/narracao.wav'), gravarWav([vozComRuido().suja], TAXA));
    const r = await limparArquivo(p, 'midia/narracao.wav', 'media');
    expect(r.arquivo).toBe('midia/narracao.wav.limpo.wav');
    expect(readFileSync(p.caminho('.gitignore'), 'utf-8').split('\n')).toContain('*.limpo.wav');
    const env = lerEnvelope(p, r.arquivo); // o carimbo confere com o WAV gravado
    expect(env?.versao).toBe(2);
    expect(env?.fonte?.tamanho).toBe(readFileSync(p.caminho(r.arquivo)).length);
    git(p.raiz, 'add', '-A');
    const entrou = git(p.raiz, 'diff', '--cached', '--name-only').split('\n').filter(Boolean);
    expect(entrou).toEqual(expect.arrayContaining(['.gitignore', 'midia/narracao.wav']));
    expect(entrou.filter((f) => f.includes('.limpo'))).toEqual([]);
  }, 30_000); // git + ffmpeg + DSP de verdade: passa de 5 s quando a suíte inteira roda junto
});
