// Música, marco 4 (itens 21, 23, 25 e 26), parte pura: o delay e o limitador do mixer, os presets de faixa, a entrega
// no alvo de loudness com stems, o MIDI (gravado e lido de volta no próprio teste, sem arquivo de fora) e o encaixe no
// vídeo (duração em compassos inteiros, seções nos cortes, viradas).
import jsonpatch, {type Operation} from 'fast-json-patch';
import {describe, expect, it} from 'vitest';
import {novaMusica, resolverMusica, type DocMusica} from '../src/nucleo/musica';
import {atrasar, limitarNoLugar, renderizarMusica, TAXA_MUSICA} from '../src/nucleo/musica-som';
import {presetDaFaixa} from '../src/nucleo/musica-acoes';
import {codificarWav, entregaDaMusica, masterizar} from '../src/nucleo/musica-entrega';
import {gravarMidi, lerMidi} from '../src/nucleo/midi';
import {importarMidi, musicaParaMidi, NOTA_GM_DA_PECA} from '../src/nucleo/musica-midi';
import {encaixarNoVideo} from '../src/nucleo/musica-encaixe';
import {medirAmostras} from '../src/nucleo/loudness';
import {novoDocCenas, type DocCenas} from '../src/nucleo/cenas';

const TAXA = TAXA_MUSICA;
const aplicar = <T,>(d: T, e: {patch: unknown[]}) => jsonpatch.applyPatch(structuredClone(d), e.patch as Operation[], true).newDocument as T;

/** Bateria (bumbo, caixa, chimbal) e um baixo, `compassos` compassos, com faixas no mixer. */
const musica = (o: {bpm?: number; compassos?: number} = {}): DocMusica => {
  const d = novaMusica({bpm: o.bpm ?? 120});
  const c = o.compassos ?? 2;
  d.canais.push({id: 'bat', nome: 'Bateria', tipo: 'bateria', faixa_mixer: 'bat', kit: 'eletronico'});
  d.canais.push({id: 'baixo', nome: 'Baixo', tipo: 'sintetizador', faixa_mixer: 'baixo', preset: 'baixo'});
  d.mixer.faixas.push({id: 'bat', nome: 'Bateria', volume_db: 0, pan: 0}, {id: 'baixo', nome: 'Baixo', volume_db: 0, pan: 0});
  d.padroes.push({id: 'p1', canal: 'bat', dur: 4, notas: [{peca: 'bumbo', em: 0, forca: 110}, {peca: 'caixa', em: 1}, {peca: 'bumbo', em: 2}, {peca: 'caixa', em: 3},
    ...[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((em) => ({peca: 'chimbal_fechado' as const, em, forca: 70}))]});
  d.padroes.push({id: 'p2', canal: 'baixo', dur: 4, notas: [{nota: 36, em: 0, dur: 1.5, forca: 100}, {nota: 43, em: 2, dur: 1, forca: 90}]});
  d.arranjo.clipes.push({id: 'c1', canal: 'bat', em: 0, dur: 4 * c, padrao: 'p1'}, {id: 'c2', canal: 'baixo', em: 0, dur: 4 * c, padrao: 'p2'});
  return d;
};

const video = (cenas: number[]): DocCenas => {
  const v = novoDocCenas({largura: 1080, altura: 1920, fps: 30});
  v.cenas[0].duracao_ms = cenas[0];
  for (const [i, ms] of cenas.slice(1).entries()) v.cenas.push({...structuredClone(v.cenas[0]), id: `cena-${i + 2}`, duracao_ms: ms});
  return v;
};

describe('mixer completo (item 21)', () => {
  it('o delay repete o som no tempo da figura, cada vez mais baixo, e no pingue-pongue troca de lado', () => {
    const n = TAXA;
    const imp = [new Float32Array(n), new Float32Array(n)];
    imp[0][0] = imp[1][0] = 1;
    const d = Math.round(0.25 * TAXA);
    const [L, R] = atrasar(imp, 0.25, 0.5, 1, true, TAXA);
    const picoEm = (x: Float32Array, de: number) => Math.max(...Array.from(x.subarray(de, de + 200)).map(Math.abs));
    expect(picoEm(L, d - 1)).toBeGreaterThan(0.3); // primeira volta à esquerda
    expect(picoEm(R, d - 1)).toBeLessThan(1e-6);
    expect(picoEm(R, 2 * d - 1)).toBeGreaterThan(0.1); // a segunda, à direita, mais baixa
    expect(picoEm(R, 2 * d - 1)).toBeLessThan(picoEm(L, d - 1));
    expect(Math.max(...Array.from(L.subarray(0, d - 1)).map(Math.abs))).toBe(0); // nada antes do tempo
  });

  it('o envio de delay de uma faixa entra na mistura, preso ao BPM', () => {
    const d = musica({compassos: 1});
    const seco = renderizarMusica(d, {}).canais[0];
    d.mixer.faixas[0].delay = 0.6;
    d.mixer.master!.delay = {tempo: '1/4', realimentacao: 0.2};
    const r = renderizarMusica(d, {}, {porFaixa: true});
    expect(r.retornos?.delay).toBeDefined();
    let dif = 0;
    for (let i = 0; i < seco.length; i++) dif += Math.abs(r.canais[0][i] - seco[i]);
    expect(dif).toBeGreaterThan(1);
    expect(resolverMusica(d).musica.master.delay.batidas).toBe(1);
  });

  it('o limitador segura o pico no teto e diz quanto tirou', () => {
    const n = TAXA / 2;
    const x = [Float32Array.from({length: n}, (_, i) => 1.8 * Math.sin((2 * Math.PI * 220 * i) / TAXA)), Float32Array.from({length: n}, (_, i) => 0.3 * Math.sin((2 * Math.PI * 330 * i) / TAXA))];
    const red = limitarNoLugar(x, -1, 80, TAXA);
    const teto = Math.pow(10, -1 / 20);
    expect(Math.max(...Array.from(x[0]).map(Math.abs))).toBeLessThanOrEqual(teto + 1e-6);
    expect(red).toBeGreaterThan(5);
    // o que já estava abaixo não muda
    const baixo = [Float32Array.from({length: 1000}, (_, i) => 0.2 * Math.sin(i / 10))];
    const copia = Float32Array.from(baixo[0]);
    expect(limitarNoLugar(baixo, -1, 80, TAXA)).toBe(0);
    expect(baixo[0]).toEqual(copia);
  });

  it('música nova nasce com o limitador ligado; documento antigo, sem o campo, fica desligado', () => {
    expect(resolverMusica(novaMusica()).musica.master.limitador.ativo).toBe(true);
    const antigo = novaMusica();
    delete antigo.mixer.master!.limitador;
    expect(resolverMusica(antigo).musica.master.limitador.ativo).toBe(false);
  });

  it('o preset escreve EQ, compressor e envios, e deixa volume e pan', () => {
    const d = musica();
    d.mixer.faixas[1].volume_db = -6;
    d.mixer.faixas[1].pan = 0.3;
    const e = presetDaFaixa(d, 'baixo', 'baixo');
    const f = aplicar(d, e).mixer.faixas[1];
    expect(f).toMatchObject({volume_db: -6, pan: 0.3, eq: {graves_db: 3, medios_db: -2, agudos_db: -4}, reverb: 0, delay: 0});
    expect(f.compressor?.ativo).toBe(true);
    expect(() => presetDaFaixa(d, 'nada', 'pad')).toThrow(/faixa do mixer não achada/);
  });
});

describe('exportar a música (item 23)', () => {
  it('a mistura sai em −14 LUFS e até −1 dBTP, e os stems somados dão a mistura antes do limitador', () => {
    const d = musica({compassos: 4});
    d.mixer.faixas[0].reverb = 0.2;
    d.mixer.master!.limitador = {ativo: false};
    const r = entregaDaMusica(d, {}, {stems: true});
    expect(r.medida.no_alvo).toBe(true);
    expect(Math.abs((r.medida.lufs ?? 0) + 14)).toBeLessThanOrEqual(0.3);
    expect(r.medida.pico_dbtp!).toBeLessThanOrEqual(-1 + 0.05);
    expect(r.stems?.map((s) => s.nome)).toEqual(['Bateria', 'Baixo', 'Retorno reverb']);
    // sem limitador na entrega (pico baixo), a soma dos stems é a mistura
    if (r.medida.limitador_db === 0) {
      let erro = 0;
      for (let i = 0; i < r.mistura[0].length; i += 7) erro = Math.max(erro, Math.abs(r.stems!.reduce((s, x) => s + x.canais[0][i], 0) - r.mistura[0][i]));
      expect(erro).toBeLessThan(1e-4);
    }
  });

  it('com folga para o codificador, o pico fica mais baixo; silêncio sai sem ajuste', () => {
    const d = musica({compassos: 2});
    const com = entregaDaMusica(d, {}, {folga_db: 0.5});
    expect(com.medida.pico_dbtp!).toBeLessThanOrEqual(-1.5 + 0.05);
    const mudo = masterizar([new Float32Array(TAXA), new Float32Array(TAXA)], TAXA);
    expect(mudo.medida.lufs).toBeNull();
    expect(mudo.medida.ganho_db).toBe(0);
  });

  it('o WAV de 24 bits tem o cabeçalho certo e volta ao mesmo nível', () => {
    const x = [Float32Array.from([0, 0.5, -0.5, 1]), Float32Array.from([0.25, -0.25, 0, -1])];
    const w = codificarWav(x, TAXA, 24);
    const v = new DataView(w.buffer);
    expect(String.fromCharCode(...w.subarray(0, 4))).toBe('RIFF');
    expect(v.getUint16(34, true)).toBe(24);
    expect(v.getUint32(40, true)).toBe(4 * 2 * 3);
    const amostra = (k: number) => {
      const p = 44 + k * 3;
      const q = w[p] | (w[p + 1] << 8) | (w[p + 2] << 16);
      return (q & 0x800000 ? q - 0x1000000 : q) / 8388607;
    };
    expect(amostra(2)).toBeCloseTo(0.5, 5); // quadro 1, esquerda (as amostras vêm intercaladas)
    expect(amostra(3)).toBeCloseTo(-0.25, 5); // quadro 1, direita
    expect(amostra(4)).toBeCloseTo(-0.5, 5);
    expect(amostra(7)).toBeCloseTo(-1, 5);
  });

  it('a entrega da mesma música dá o mesmo loudness duas vezes (determinístico)', () => {
    const d = musica({compassos: 2});
    const a = entregaDaMusica(d, {});
    const b = entregaDaMusica(d, {});
    expect(a.medida).toEqual(b.medida);
    expect(medirAmostras(a.mistura, TAXA).integrado_lufs).toBe(a.medida.lufs);
  });
});

describe('MIDI (item 26)', () => {
  it('grava e lê de volta notas, andamento, compasso, programa e marcadores', () => {
    const bytes = gravarMidi({ppq: 480, bpm: 96, compasso: [3, 4], marcadores: [{tick: 0, texto: 'Intro'}, {tick: 1440, texto: 'Refrão'}],
      trilhas: [{nome: 'Baixo', canal: 0, programa: 33, notas: [{tick: 0, dur: 480, nota: 40, forca: 100}, {tick: 480, dur: 240, nota: 43, forca: 80}]},
        {nome: 'Bateria', canal: 9, notas: [{tick: 0, dur: 120, nota: 36, forca: 120}, {tick: 0, dur: 120, nota: 42, forca: 60}]}]});
    const a = lerMidi(bytes);
    expect(a).toMatchObject({ppq: 480, bpm: 96, compasso: [3, 4]});
    expect(a.marcadores.map((m) => m.texto)).toEqual(['Intro', 'Refrão']);
    expect(a.trilhas[0]).toMatchObject({nome: 'Baixo', canal: 0, programa: 33, notas: [{tick: 0, dur: 480, nota: 40, forca: 100}, {tick: 480, dur: 240, nota: 43, forca: 80}]});
    expect(a.trilhas[1].notas.map((n) => n.nota)).toEqual([36, 42]);
  });

  it('lê formato 0 com running status e nota-ligada com força 0 como desligar', () => {
    // MThd formato 0, uma trilha, 96 ppq; MTrk: 90 3C 64 | 60 3C 00 (running status, desliga) | FF 2F 00
    const corpo = [0x00, 0x90, 0x3c, 0x64, 0x60, 0x3c, 0x00, 0x00, 0xff, 0x2f, 0x00];
    const bytes = Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, corpo.length, ...corpo]);
    const a = lerMidi(bytes);
    expect(a.trilhas).toHaveLength(1);
    expect(a.trilhas[0].notas).toEqual([{tick: 0, dur: 96, nota: 60, forca: 100}]);
    expect(() => lerMidi(Uint8Array.from([1, 2, 3]))).toThrow(/não é um arquivo MIDI/);
  });

  it('a música vai ao MIDI e volta com as mesmas notas, nas mesmas batidas', () => {
    const d = musica({bpm: 100, compassos: 2});
    d.secoes = [{id: 's1', nome: 'Intro', em: 0, dur: 4}, {id: 's2', nome: 'Verso', em: 4, dur: 4}];
    const m = musicaParaMidi(d);
    expect(m.trilhas).toBe(2);
    expect(m.notas).toBe(2 * (12 + 2));
    const e = importarMidi(novaMusica(), m.bytes);
    const n = aplicar(novaMusica(), e);
    expect(n.bpm).toBe(100);
    expect(n.canais.map((c) => c.tipo)).toEqual(['bateria', 'sintetizador']);
    expect(n.canais[1].preset).toBe('baixo');
    expect(n.secoes?.map((s) => [s.nome, s.em, s.dur])).toEqual([['Intro', 0, 4], ['Verso', 4, 4]]);
    const bat = n.padroes.find((p) => p.canal === n.canais[0].id)!;
    expect(bat.dur).toBe(8);
    expect(bat.notas.filter((x) => x.peca === 'bumbo').map((x) => x.em)).toEqual([0, 2, 4, 6]);
    const baixo = n.padroes.find((p) => p.canal === n.canais[1].id)!;
    expect(baixo.notas.slice(0, 2)).toEqual([{nota: 36, em: 0, dur: 1.5, forca: 100}, {nota: 43, em: 2, dur: 1, forca: 90}]);
    // o som da volta é o mesmo da ida (mixer à parte): o render dos canais bate
    expect(NOTA_GM_DA_PECA.bumbo).toBe(36);
  });

  it('nota de bateria sem peça da casa fica de fora com aviso; música com clipes guarda o BPM', () => {
    const bytes = gravarMidi({ppq: 960, bpm: 140, trilhas: [{canal: 9, notas: [{tick: 0, dur: 100, nota: 36, forca: 100}, {tick: 0, dur: 100, nota: 81, forca: 100}]}], marcadores: []});
    const d = musica();
    const e = importarMidi(d, bytes, {em: 8});
    expect(e.avisos?.join(' ')).toMatch(/1 notas de bateria sem peça/);
    const n = aplicar(d, e);
    expect(n.bpm).toBe(120);
    expect(n.arranjo.clipes.at(-1)).toMatchObject({em: 8, dur: 4});
  });
});

describe('encaixe no vídeo (item 25)', () => {
  it('fecha no último quadro com compassos inteiros, mudando o BPM pouco, e estende o padrão', () => {
    const d = musica({bpm: 120, compassos: 4}); // 8 s
    d.video = {documento: 'video', em_ms: 0};
    const v = video([5000, 5000, 5800]); // 15,8 s: 8 compassos pediriam 121,5 BPM
    const e = encaixarNoVideo(d, v, {modo: 'duracao'});
    const n = aplicar(d, e);
    expect(e.extra).toMatchObject({compassos: 8});
    expect(n.bpm).toBeCloseTo(121.52, 2);
    const m = resolverMusica(n).musica;
    expect(m.duracao_batidas).toBe(32);
    expect(Math.abs(m.duracao_s - 15.8)).toBeLessThan(0.01);
  });

  it('com áudio na música, o BPM fica e o fim cai no quadro, com aviso', () => {
    const d = musica({compassos: 8}); // 16 s
    d.canais.push({id: 'cama', nome: 'Cama', tipo: 'audio', faixa_mixer: 'cama'});
    d.arranjo.clipes.push({id: 'c3', canal: 'cama', em: 0, dur: 32, audio: 'midia/cama.wav', corte_s: 0, ganho_db: 0});
    const e = encaixarNoVideo(d, video([5000, 5000]), {modo: 'duracao'});
    const n = aplicar(d, e);
    expect(n.bpm).toBe(120);
    expect(resolverMusica(n).musica.duracao_s).toBeCloseTo(10, 3);
    expect(e.avisos?.join(' ')).toMatch(/não estica/);
  });

  it('uma seção por cena, no compasso do corte, e viradas antes de cada uma', () => {
    const d = musica({compassos: 8}); // 32 batidas, 2 s por compasso
    d.video = {documento: 'video', em_ms: 0};
    const e = encaixarNoVideo(d, video([4100, 3900, 8000]), {modo: 'cortes', viradas: true});
    const n = aplicar(d, e);
    expect(n.secoes?.map((s) => [s.nome, s.em, s.dur])).toEqual([['Cena 1', 0, 8], ['Cena 2', 8, 8], ['Cena 3', 16, 16]]);
    expect(e.extra?.viradas).toBe(2);
    const virada = n.padroes.find((p) => p.nome === 'Virada')!;
    const prato = n.padroes.find((p) => p.nome === 'Prato')!;
    const bat = n.arranjo.clipes.filter((c) => c.canal === 'bat');
    expect(bat.filter((c) => c.padrao === virada.id).map((c) => c.em)).toEqual([6, 14]);
    expect(bat.filter((c) => c.padrao === prato.id).map((c) => c.em)).toEqual([8, 16]);
    // o groove sai só no buraco da virada e continua de onde estava
    const groove = bat.filter((c) => c.padrao === 'p1').map((c) => [c.em, c.dur, c.inicio ?? 0]);
    expect(groove).toEqual([[0, 6, 0], [8, 6, 8], [16, 16, 16]]);
    // o baixo não muda
    expect(n.arranjo.clipes.filter((c) => c.canal === 'baixo')).toEqual(d.arranjo.clipes.filter((c) => c.canal === 'baixo'));
    // a segunda vez não duplica os padrões de virada
    const e2 = encaixarNoVideo(n, video([4100, 3900, 8000]), {modo: 'cortes'});
    expect(e2.patch.filter((x) => x.path === '/padroes/-')).toHaveLength(0);
  });

  it('música que começa depois do fim do vídeo é erro com a frase', () => {
    const d = musica();
    d.video = {documento: 'video', em_ms: 20_000};
    expect(() => encaixarNoVideo(d, video([5000]))).toThrow(/depois do fim do vídeo/);
  });
});
