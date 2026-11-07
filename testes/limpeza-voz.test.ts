// Limpeza de voz: com uma "voz" sintética (sílabas com harmônicos e pausas) e ruído conhecido, o ruído nas pausas cai e a
// voz fica no nível; o grave abaixo de 80 Hz some; o tamanho não muda; cancelar para. E as peças do processo principal
// que não rodam o ffmpeg: o nome do arquivo limpo, o WAV (ler e gravar, inclusive o do pipe) e o que o ffmpeg conta da entrada.
import {describe, expect, it} from 'vitest';
import {envelopeDeAmostras} from '../src/nucleo/audio';
import {INTENSIDADES, LimpezaCancelada, limparVoz, medirRuido} from '../src/nucleo/limpeza-voz';
import {amostrasPorPacote, gravarWav, lerEntrada, lerWav} from '../src/main/ffmpeg-som';
import {arquivoLimpo} from '../src/main/limpeza-voz';

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
  });

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
