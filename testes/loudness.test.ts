// Medidor de loudness (BS.1770-4): casos da EBU Tech 3341, pico verdadeiro, pedaços, curto prazo, a mistura do vídeo
// como o render a faz (quadros, volume, mono em estéreo, faixa muda, arquivo que falta), o alvo no documento e a
// leitura do que o loudnorm do ffmpeg escreve.
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {coeficientesK, resolverAudio, type AudioCenas} from '../src/nucleo/audio';
import {codificarWavPcm} from '../src/nucleo/gravacao';
import {curtoPrazoEm, Medidor, medirAmostras, medirMistura, type FonteAudio} from '../src/nucleo/loudness';
import {igualarLoudness, lerLoudnorm, medirArquivo} from '../src/main/loudness';

const seno = (hz: number, segundos: number, taxa: number, amplitude: number, fase = 0) => {
  const out = new Float32Array(Math.round(segundos * taxa));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / taxa + fase);
  return out;
};
const juntar = (...partes: Float32Array[]) => {
  const out = new Float32Array(partes.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of partes) (out.set(p, o), (o += p.length));
  return out;
};
const dbfs = (db: number) => Math.pow(10, db / 20);

describe('medidor (EBU Tech 3341)', () => {
  it('a ponderação K a 48 kHz tem os coeficientes da tabela do BS.1770-4', () => {
    const [prat, pa] = coeficientesK(48000);
    const tabela = {b0: 1.53512485958697, b1: -2.69169618940638, b2: 1.19839281085285, a1: -1.69065929318241, a2: 0.73248077421585};
    for (const [k, v] of Object.entries(tabela)) expect(prat[k as keyof typeof prat]).toBeCloseTo(v, 9);
    expect(pa).toMatchObject({b0: 1, b1: -2, b2: 1});
    expect(pa.a1).toBeCloseTo(-1.99004745483398, 9);
    expect(pa.a2).toBeCloseTo(0.99007225036621, 9);
  });

  it('caso 1: 1 kHz estéreo a −23 dBFS dá −23,0 LUFS (integrado, curto prazo e momentâneo)', () => {
    const x = seno(1000, 20, 48000, dbfs(-23));
    const m = medirAmostras([x, x], 48000);
    expect(m.integrado_lufs).toBeCloseTo(-23, 1);
    expect(m.curto_max_lufs).toBeCloseTo(-23, 1);
    expect(m.momentaneo_max_lufs).toBeCloseTo(-23, 1);
  });

  it('caso 3: −36, −23 e −36 dBFS (10, 60 e 10 s) dá −23,0 ±0,1: a porta relativa tira as pontas', () => {
    const p = (db: number, s: number) => seno(1000, s, 48000, dbfs(db));
    const x = juntar(p(-36, 10), p(-23, 60), p(-36, 10));
    expect(Math.abs(medirAmostras([x, x], 48000, {pico: false}).integrado_lufs! - -23)).toBeLessThanOrEqual(0.1);
  });

  it('caso 5: −26, −20 e −26 dBFS (20, 20,1 e 20 s) dá −23,0 ±0,1', () => {
    const p = (db: number, s: number) => seno(1000, s, 48000, dbfs(db));
    const x = juntar(p(-26, 20), p(-20, 20.1), p(-26, 20));
    expect(Math.abs(medirAmostras([x, x], 48000, {pico: false}).integrado_lufs! - -23)).toBeLessThanOrEqual(0.1);
  });

  it('mono conta um canal só: 1 kHz com amplitude 0,1 dá −23,0 (−20 dBFS de pico, −3 do valor eficaz)', () => {
    expect(medirAmostras([seno(1000, 5, 48000, 0.1)], 48000).integrado_lufs).toBeCloseTo(-23, 1);
  });

  it('silêncio não tem integrado; abaixo de −70 LUFS também não', () => {
    const m = medirAmostras([new Float32Array(48000 * 3)], 48000);
    expect(m.integrado_lufs).toBeNull();
    expect(m.curto_max_lufs).toBeNull();
    expect(medirAmostras([seno(1000, 3, 48000, dbfs(-75))], 48000).integrado_lufs).toBeNull();
  });

  it('pico verdadeiro: o seno de 997 Hz com amplitude 0,5 dá −6,0 dBTP; entre amostras, o de 12 kHz a 45° passa do pico das amostras', () => {
    expect(medirAmostras([seno(997, 2, 48000, 0.5)], 48000).pico_dbtp).toBeCloseTo(-6, 1);
    // as amostras ficam em ±0,707 (−3 dB), mas a onda passa por 1 entre elas
    const m = medirAmostras([seno(12000, 1, 48000, 1, Math.PI / 4)], 48000);
    expect(m.pico_dbtp!).toBeGreaterThan(-0.4);
    expect(medirAmostras([seno(997, 1, 48000, 0.5)], 48000, {pico: false}).pico_dbtp).toBeNull();
  });

  it('em pedaços de qualquer tamanho dá o mesmo que de uma vez', () => {
    const x = juntar(seno(440, 2, 44100, 0.3), seno(3000, 2.5, 44100, 0.6), seno(80, 1.2, 44100, 0.2));
    const inteiro = medirAmostras([x], 44100);
    const m = new Medidor(44100, 1);
    for (let i = 0; i < x.length; i += 1777) m.alimentar([x.subarray(i, i + 1777)], Math.min(1777, x.length - i));
    const pedacos = m.resultado();
    expect(pedacos.integrado_lufs).toBe(inteiro.integrado_lufs);
    expect(pedacos.pico_dbtp).toBe(inteiro.pico_dbtp);
    expect(pedacos.curto_prazo).toEqual(inteiro.curto_prazo);
  });

  it('curto prazo: um valor a cada 100 ms; na cabeça, a janela de 3 s que termina ali', () => {
    const x = juntar(seno(1000, 3, 48000, dbfs(-30)), seno(1000, 3, 48000, dbfs(-10)));
    const m = medirAmostras([x], 48000, {pico: false});
    expect(m.curto_prazo).toHaveLength(60);
    expect(curtoPrazoEm(m, 50)).toBeNull();
    expect(curtoPrazoEm(m, 3000)!).toBeCloseTo(-33, 0); // só a parte de −30 dBFS (−33 LUFS)
    expect(curtoPrazoEm(m, 6000)!).toBeCloseTo(-13, 0); // só a de −10 dBFS
    expect(curtoPrazoEm(m, 99999)).toBe(m.curto_prazo[59]);
  });
});

describe('mistura do vídeo', () => {
  const TAXA = 48000;
  const faixa = (id: string, papel: 'voz' | 'musica' | 'efeitos', clipes: AudioCenas['faixas'][number]['clipes'], extra: Record<string, unknown> = {}) =>
    ({id, nome: id, papel, clipes, ...extra});
  const props = (faixas: AudioCenas['faixas'], duracao = 4000) => resolverAudio({faixas}, duracao).audio!;

  it('um clipe mono: a mistura mede o mesmo que o arquivo (mono aberto em estéreo a −3 dB por lado)', async () => {
    const fonte: FonteAudio = {canais: [seno(1000, 2, TAXA, 0.1)], taxa: TAXA};
    const audio = props([faixa('narracao', 'voz', [{id: 'v', arquivo: 'v.wav', em: 0, duracao_ms: 2000}])], 2000);
    const r = await medirMistura(audio, {'v.wav': fonte}, {duracao_ms: 2000, fps: 30, taxa: TAXA});
    expect(r.mistura.integrado_lufs).toBeCloseTo(-23, 1);
    expect(r.voz!.integrado_lufs).toBeCloseTo(-23, 1);
    expect(r.faixas['/audio/faixas/0'].integrado_lufs).toBeCloseTo(-23, 1);
    expect(r.mistura.pico_dbtp).toBeCloseTo(-23, 0); // 0,1 × 0,707 por canal
    expect(r.mistura.duracao_ms).toBe(2000);
    expect(r.alvo_lufs).toBe(-14);
    expect(r.pico_dbtp).toBe(-1);
  });

  it('o clipe entra no quadro dele: 1 s de silêncio antes e depois mede como o arquivo com o silêncio em volta', async () => {
    const x = seno(1000, 2, TAXA, 0.1);
    const audio = props([faixa('narracao', 'voz', [{id: 'v', arquivo: 'v.wav', em: 1000, duracao_ms: 2000}])]);
    const r = await medirMistura(audio, {'v.wav': {canais: [x], taxa: TAXA}}, {duracao_ms: 4000, fps: 30, taxa: TAXA});
    const comSilencio = medirAmostras([juntar(new Float32Array(TAXA), x, new Float32Array(TAXA))], TAXA);
    expect(r.mistura.integrado_lufs).toBe(comSilencio.integrado_lufs); // os blocos de 400 ms que pegam a borda entram na porta
    expect(r.mistura.duracao_ms).toBe(4000);
    expect(curtoPrazoEm(r.mistura, 900)).toBe(-100);
    expect(curtoPrazoEm(r.mistura, 2000)!).toBeGreaterThan(-30);
  });

  it('o volume muda uma vez por pacote do arquivo, como o ffmpeg do render', async () => {
    // fade de entrada de 1 s: trocando a cada quadro ou a cada pacote de 0,5 s, a potência média muda
    const x = seno(1000, 2, TAXA, 0.1);
    const audio = props([faixa('narracao', 'voz', [{id: 'v', arquivo: 'v.wav', em: 0, duracao_ms: 2000, fade_in_ms: 1000}])], 2000);
    const porQuadro = await medirMistura(audio, {'v.wav': {canais: [x], taxa: TAXA}}, {duracao_ms: 2000, fps: 30, taxa: TAXA});
    const porPacote = await medirMistura(audio, {'v.wav': {canais: [x], taxa: TAXA, pacote: TAXA / 2}}, {duracao_ms: 2000, fps: 30, taxa: TAXA});
    // com pacote de 0,5 s, o primeiro meio segundo fica no volume do começo (zero): o curto prazo em 0,5 s é silêncio
    expect(curtoPrazoEm(porPacote.mistura, 500)).toBe(-100);
    expect(curtoPrazoEm(porQuadro.mistura, 500)!).toBeGreaterThan(-60);
  });

  it('volume do clipe a 0,5 baixa 6 LU; faixa muda fica de fora; arquivo que falta volta em `faltando`', async () => {
    const fontes = {'v.wav': {canais: [seno(1000, 3, TAXA, 0.1)], taxa: TAXA}, 'm.wav': {canais: [seno(500, 3, TAXA, 0.5), seno(500, 3, TAXA, 0.5)], taxa: TAXA}};
    const audio = props([
      faixa('narracao', 'voz', [{id: 'v', arquivo: 'v.wav', em: 0, duracao_ms: 3000, volume: 0.5}]),
      faixa('musica', 'musica', [{id: 'm', arquivo: 'm.wav', em: 0, duracao_ms: 3000}], {mudo: true}),
      faixa('efeitos', 'efeitos', [{id: 'e', arquivo: 'sumiu.wav', em: 0, duracao_ms: 1000}]),
    ], 3000);
    const r = await medirMistura(audio, fontes, {duracao_ms: 3000, fps: 30, taxa: TAXA});
    expect(r.mistura.integrado_lufs).toBeCloseTo(-29, 0);
    expect(r.faixas['/audio/faixas/1']).toBeUndefined();
    expect(r.faltando).toEqual(['sumiu.wav']);
  });

  it('a música sob a voz soma na mistura e não na narração; sem voz, `voz` é null', async () => {
    const fontes = {'v.wav': {canais: [seno(1000, 2, TAXA, 0.1)], taxa: TAXA}, 'm.wav': {canais: [seno(1000, 2, TAXA, 0.1, Math.PI / 2)], taxa: TAXA}}; // 90° defasada: soma em potência
    const so = props([faixa('musica', 'musica', [{id: 'm', arquivo: 'm.wav', em: 0, duracao_ms: 2000}], {ducking: {ativo: false}})], 2000);
    expect((await medirMistura(so, fontes, {duracao_ms: 2000, fps: 30, taxa: TAXA})).voz).toBeNull();
    const as2 = props([
      faixa('narracao', 'voz', [{id: 'v', arquivo: 'v.wav', em: 0, duracao_ms: 2000}]),
      faixa('musica', 'musica', [{id: 'm', arquivo: 'm.wav', em: 0, duracao_ms: 2000}], {ducking: {ativo: false}}),
    ], 2000);
    const r = await medirMistura(as2, fontes, {duracao_ms: 2000, fps: 30, taxa: TAXA});
    expect(r.voz!.integrado_lufs).toBeCloseTo(-23, 1);
    expect(r.mistura.integrado_lufs! - r.voz!.integrado_lufs!).toBeGreaterThan(2); // dois senos do mesmo nível: ~+3 LU
    expect(r.faixas['/audio/faixas/1'].abaixo_da_voz_lu!).toBeCloseTo(0, 0);
    expect(r.faixas['/audio/faixas/0'].abaixo_da_voz_lu).toBeUndefined(); // a própria voz não se compara
  });

  it('sob a voz: a mediana de voz − música só onde a voz fala, mesmo com a música alta nas pausas', async () => {
    // voz de 0 a 1 s e de 2 a 3 s; música 20 dB abaixo, mas 20 dB mais alta (no nível da voz) nas pausas
    const voz = juntar(seno(1000, 1, TAXA, 0.1), new Float32Array(TAXA), seno(1000, 1, TAXA, 0.1), new Float32Array(TAXA));
    const q = Math.PI / 2;
    const musica = juntar(seno(1000, 1, TAXA, 0.01, q), seno(1000, 1, TAXA, 0.1, q), seno(1000, 1, TAXA, 0.01, q), seno(1000, 1, TAXA, 0.1, q));
    const audio = props([
      faixa('narracao', 'voz', [{id: 'v', arquivo: 'v.wav', em: 0, duracao_ms: 4000}]),
      faixa('musica', 'musica', [{id: 'm', arquivo: 'm.wav', em: 0, duracao_ms: 4000}], {ducking: {ativo: false}}),
    ]);
    const r = await medirMistura(audio, {'v.wav': {canais: [voz], taxa: TAXA}, 'm.wav': {canais: [musica], taxa: TAXA}}, {duracao_ms: 4000, fps: 30, taxa: TAXA});
    const m = r.faixas['/audio/faixas/1'];
    expect(m.integrado_lufs! - r.voz!.integrado_lufs!).toBeGreaterThan(-4); // o integrado da música quase empata com a voz...
    expect(m.abaixo_da_voz_lu!).toBeCloseTo(20, 0); // ...mas sob a voz ela fica 20 LU abaixo
  });

  it('fonte em outra taxa é erro (o processo principal decodifica tudo a 48 kHz); cancelar para', async () => {
    const audio = props([faixa('narracao', 'voz', [{id: 'v', arquivo: 'v.wav', em: 0, duracao_ms: 1000}])], 1000);
    await expect(medirMistura(audio, {'v.wav': {canais: [new Float32Array(44100)], taxa: 44100}}, {duracao_ms: 1000, fps: 30, taxa: TAXA})).rejects.toThrow(/44100/);
    const longo = props([faixa('narracao', 'voz', [{id: 'v', arquivo: 'v.wav', em: 0, duracao_ms: 5000}])], 5000);
    await expect(medirMistura(longo, {'v.wav': {canais: [seno(200, 5, TAXA, 0.1)], taxa: TAXA}}, {duracao_ms: 5000, fps: 30, taxa: TAXA, cancelado: () => true}))
      .rejects.toThrow(/cancelada/);
  });
});

describe('alvo de loudness no documento', () => {
  it('padrão −14 LUFS e −1 dBTP; fora da faixa vira aviso e o limite', () => {
    expect(resolverAudio({faixas: []}, 1000).audio).toMatchObject({alvo_lufs: -14, pico_dbtp: -1});
    const r = resolverAudio({faixas: [], alvo_lufs: -3, pico_dbtp: 2}, 1000);
    expect(r.audio).toMatchObject({alvo_lufs: -9, pico_dbtp: 0});
    expect(r.avisos.join(' ')).toMatch(/alvo de loudness -3/);
    expect(r.avisos.join(' ')).toMatch(/pico máximo 2/);
    expect(resolverAudio({faixas: [], alvo_lufs: -16}, 1000)).toMatchObject({audio: {alvo_lufs: -16}, avisos: []});
  });
});

describe('leitura do loudnorm', () => {
  const saida = (i: string, tp: string) => `[Parsed_loudnorm_0 @ 000001] \n{\n\t"input_i" : "${i}",\n\t"input_tp" : "${tp}",\n\t"input_lra" : "1.10",\n`
    + `\t"input_thresh" : "-30.72",\n\t"output_i" : "-13.98",\n\t"output_tp" : "-2.59",\n\t"output_lra" : "0.60",\n\t"output_thresh" : "-24.17",\n`
    + '\t"normalization_type" : "dynamic",\n\t"target_offset" : "-0.02"\n}\n[out#0/null @ 0000] video:0KiB audio:9008KiB\n';

  it('lê o último bloco JSON da saída de erro do ffmpeg', () => {
    expect(lerLoudnorm(`${saida('-30.00', '-12.00')}${saida('-20.45', '-9.13')}`)).toEqual({i: -20.45, tp: -9.13, lra: 1.1, thresh: -30.72, offset: -0.02, tipo: 'dynamic'});
  });

  it('silêncio (-inf) ou nada medido dá null', () => {
    expect(lerLoudnorm(saida('-inf', '-inf'))).toBeNull();
    expect(lerLoudnorm('Output file is empty, nothing was encoded')).toBeNull();
  });
});

describe('loudness do carrossel narrado da Cliente (som-D5)', () => {
  const FFMPEG = path.join('node_modules', '@remotion', `compositor-${process.platform}-${process.arch}${process.platform === 'win32' ? '-msvc' : ''}`, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  it.skipIf(!existsSync(FFMPEG))('o MP4 do carrossel com narração a −26 LUFS sai em −14 LUFS e pico até −1 dBTP; sem narração, nada muda', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'estudio-d5-'));
    try {
      const mp4 = path.join(dir, 'carrossel.mp4');
      // 6 s de um tom a 300 Hz baixo (perto de −26 LUFS) em AAC, num MP4 só de áudio: o ffmpeg do Remotion não traz filtros nem demuxers de teste
      // para fabricar vídeo, e a correção copia o vídeo que houver (`-map 0:v?`), então o som é o que ela mede e regrava
      writeFileSync(path.join(dir, 'tom.wav'), codificarWavPcm([seno(300, 6, 48000, 0.05)], 48000, 16));
      execFileSync(FFMPEG, ['-y', '-i', path.join(dir, 'tom.wav'), '-c:a', 'libfdk_aac', '-b:a', '192k', '-f', 'mp4', mp4], {stdio: 'pipe'});
      const antes = await medirArquivo(mp4);
      expect(antes!.i).toBeLessThan(-22); // narração baixa: sairia assim
      const r = await igualarLoudness({arquivo: mp4, props: {composicao: 'CarrosselTema', audio: 'narracao.wav'}});
      expect(r).not.toBeNull();
      const depois = await medirArquivo(mp4);
      console.info('[medida] carrossel: antes', antes!.i.toFixed(1), 'LUFS → depois', depois!.i.toFixed(1), 'LUFS, pico', depois!.tp.toFixed(1), 'dBTP');
      expect(Math.abs(depois!.i - -14)).toBeLessThanOrEqual(0.6);
      expect(depois!.tp).toBeLessThanOrEqual(-0.9);
      // sem narração em props.audio, o carrossel não é tocado; e outra composição sem som também não
      expect(await igualarLoudness({arquivo: mp4, props: {composicao: 'CarrosselTema'}})).toBeNull();
      expect(await igualarLoudness({arquivo: mp4, props: {composicao: 'Outra', audio: 'x.wav'}})).toBeNull();
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  }, 120_000);
});
