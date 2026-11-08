// Música, parte pura: o documento (tempo em batidas, avisos), o som (determinístico, no tempo certo, com swing,
// divisão de clipe sem mudar o que se ouve, mixer) e o que liga a música ao vídeo (código do render, patches).
import jsonpatch, {type Operation} from 'fast-json-patch';
import {describe, expect, it} from 'vitest';
import {musicaDeClipe, musicaParaCriar, novaMusica, posicaoEmCompasso, resolverMusica, type DocMusica} from '../src/nucleo/musica';
import {comSwing, renderizarMusica, sintetizarPeca, TAXA_MUSICA} from '../src/nucleo/musica-som';
import {codigoDoSom, cortesDoVideo, patchAtualizarLigados, patchClipeNovo, patchLigarClipe, patchVoltarAoOriginal, renderDaMusica} from '../src/nucleo/musica-video';
import {ESTILOS, padraoDoEstilo} from '../src/nucleo/musica-estilos';
import {novoDocCenas, type DocCenas} from '../src/nucleo/cenas';
import {novoAudioCenas} from '../src/nucleo/audio';

const TAXA = TAXA_MUSICA;

/** Uma bateria com um padrão de um compasso e um clipe de `compassos` compassos. */
const bateria = (notas: DocMusica['padroes'][number]['notas'], o: {bpm?: number; compassos?: number; swing?: number} = {}): DocMusica => {
  const d = novaMusica({bpm: o.bpm ?? 120});
  d.swing = o.swing ?? 0;
  d.canais.push({id: 'bat', nome: 'Bateria', tipo: 'bateria', kit: 'eletronico'});
  d.padroes.push({id: 'p1', canal: 'bat', dur: 4, notas});
  d.arranjo.clipes.push({id: 'c1', canal: 'bat', em: 0, dur: 4 * (o.compassos ?? 1), padrao: 'p1'});
  return d;
};

/** Primeira amostra acima do limiar a partir de `de`. */
const ataque = (x: Float32Array, de = 0, limiar = 0.02) => {
  for (let i = de; i < x.length; i++) if (Math.abs(x[i]) > limiar) return i;
  return -1;
};
const rms = (x: Float32Array, de = 0, ate = x.length) => {
  let s = 0;
  for (let i = de; i < ate; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, ate - de));
};
const seno = (seg: number, f = 440, taxa = TAXA) => Float32Array.from({length: Math.round(seg * taxa)}, (_, i) => 0.5 * Math.sin((2 * Math.PI * f * i) / taxa));

describe('documento de música', () => {
  it('converte batidas em segundos pelo BPM e dá a posição em compasso', () => {
    const d = bateria([{peca: 'bumbo', em: 0}], {bpm: 90, compassos: 2});
    const {musica, avisos} = resolverMusica(d);
    expect(avisos).toEqual([]);
    expect(musica.seg_por_batida).toBeCloseTo(60 / 90);
    expect(musica.duracao_batidas).toBe(8);
    expect(musica.duracao_s).toBeCloseTo((8 * 60) / 90);
    expect(posicaoEmCompasso(5.5, [4, 4])).toBe('2.2+0.5');
  });

  it('fora do lugar vira aviso, nunca erro', () => {
    const d = bateria([{peca: 'bumbo', em: 0}]);
    d.bpm = 999;
    d.arranjo.clipes.push({id: 'x', canal: 'nao-existe', em: -2, dur: 4});
    const {musica, avisos} = resolverMusica(d);
    expect(musica.bpm).toBe(300);
    expect(avisos.join(' | ')).toMatch(/BPM 999/);
    expect(avisos.join(' | ')).toMatch(/"x" começa antes do zero/);
    expect(avisos.join(' | ')).toMatch(/canal "nao-existe", que não existe/);
    expect(musica.clipes.find((c) => c.id === 'x')!.mudo).toBe(true);
  });

  it('"Editar em Música" nasce com o áudio do clipe, o corte e a duração, no ponto do vídeo', () => {
    const d = musicaDeClipe({id: 'clipe-2', arquivo: 'midia/cama.mp3', em: 3000, duracao_ms: 12000, corte_ms: 4000}, {video: 'video'});
    expect(d.bpm).toBe(120);
    expect(d.arranjo.clipes[0]).toMatchObject({canal: 'audio', em: 0, dur: 24, audio: 'midia/cama.mp3', corte_s: 4, origem: {documento: 'video', clipe: 'clipe-2'}});
    expect(d.video).toEqual({documento: 'video', em_ms: 3000, voz_guia: true});
    expect(resolverMusica(d).musica.duracao_s).toBeCloseTo(12);
  });

  it('"Criar em Música" numa faixa de música enche compassos inteiros até o tempo pedido', () => {
    const d = musicaParaCriar({video: 'video', papel: 'musica', em_ms: 0, dur_ms: 9000});
    // 9 s a 120 BPM = 18 batidas → 5 compassos de 4/4
    expect(d.arranjo.clipes[0].dur).toBe(20);
    expect(d.canais[0].tipo).toBe('bateria');
  });
});

describe('som da música', () => {
  it('é o mesmo a cada render (o ruído vem da semente) e com ou sem o cache', () => {
    const d = bateria(padraoDoEstilo('pop').notas, {compassos: 2});
    const a = renderizarMusica(d, {});
    const cache = new Map();
    renderizarMusica(d, {}, {cache});
    const b = renderizarMusica(d, {}, {cache});
    expect(a.canais[0].length).toBe(Math.ceil(4 * TAXA)); // 8 batidas a 120 BPM = 4 s
    expect(Buffer.from(b.canais[0].buffer).equals(Buffer.from(a.canais[0].buffer))).toBe(true);
    const outra = {...d, semente: 2};
    expect(Buffer.from(renderizarMusica(outra, {}).canais[0].buffer).equals(Buffer.from(a.canais[0].buffer))).toBe(false);
  });

  it('cada batida cai no tempo dela', () => {
    // o aro é curto (12 ms): cada ataque se acha sem a cauda do anterior
    const d = bateria([{peca: 'aro', em: 0}, {peca: 'aro', em: 1}, {peca: 'aro', em: 2.5}]);
    const L = renderizarMusica(d, {}).canais[0];
    expect(ataque(L)).toBeLessThan(5);
    expect(Math.abs(ataque(L, Math.round(0.45 * TAXA)) - 0.5 * TAXA)).toBeLessThan(5);
    expect(Math.abs(ataque(L, Math.round(1.2 * TAXA)) - 1.25 * TAXA)).toBeLessThan(5);
  });

  it('o swing atrasa só as semicolcheias do contratempo', () => {
    expect(comSwing(0.25, 1)).toBeCloseTo(0.25 + 1 / 12);
    expect(comSwing(0.5, 1)).toBe(0.5);
    const d = bateria([{peca: 'aro', em: 0.25}], {swing: 1});
    const L = renderizarMusica(d, {}).canais[0];
    expect(Math.abs(ataque(L) - (0.25 + 1 / 12) * 0.5 * TAXA)).toBeLessThan(5);
  });

  it('dividir um clipe de padrão (com "inicio") não muda o que se ouve', () => {
    const notas = [{peca: 'bumbo' as const, em: 0}, {peca: 'caixa' as const, em: 1}, {peca: 'bumbo' as const, em: 2}, {peca: 'caixa' as const, em: 3}];
    const inteiro = bateria(notas, {compassos: 2});
    const dividido = bateria(notas, {compassos: 2});
    dividido.arranjo.clipes = [{id: 'c1', canal: 'bat', em: 0, dur: 2, padrao: 'p1'}, {id: 'c2', canal: 'bat', em: 2, dur: 6, padrao: 'p1', inicio: 2}];
    const a = renderizarMusica(inteiro, {}).canais[0];
    const b = renderizarMusica(dividido, {}).canais[0];
    let dif = 0;
    for (let i = 0; i < a.length; i++) dif = Math.max(dif, Math.abs(a[i] - b[i]));
    expect(dif).toBeLessThan(1e-6);
  });

  it('o chimbal fechado corta o aberto (grupo de corte)', () => {
    const so = bateria([{peca: 'chimbal_aberto', em: 0}]);
    const cortado = bateria([{peca: 'chimbal_aberto', em: 0}, {peca: 'chimbal_fechado', em: 0.5}]);
    const a = renderizarMusica(so, {}).canais[0];
    const b = renderizarMusica(cortado, {}).canais[0];
    // depois do fechado (0,25 s) e do fim dele, o aberto já não soa
    const de = Math.round(0.45 * TAXA), ate = Math.round(0.55 * TAXA);
    expect(rms(b, de, ate)).toBeLessThan(rms(a, de, ate) / 10);
  });

  it('o áudio entra do corte, com o ganho, e o mono abre em estéreo a −3 dB', () => {
    const d = novaMusica();
    d.canais.push({id: 'a', nome: 'Áudio', tipo: 'audio'});
    d.arranjo.clipes.push({id: 'c1', canal: 'a', em: 1, dur: 2, audio: 'midia/x.wav', corte_s: 0.5, ganho_db: -6});
    const fonte = seno(3);
    const {canais, faltando} = renderizarMusica(d, {'midia/x.wav': {canais: [fonte], taxa: TAXA}});
    expect(faltando).toEqual([]);
    const i = Math.round(0.5 * TAXA) + 1000; // 1 batida = 0,5 s
    const esperado = fonte[Math.round(0.5 * TAXA) + 1000] * Math.pow(10, -6 / 20) * Math.SQRT1_2;
    expect(canais[0][i]).toBeCloseTo(esperado, 5);
    expect(canais[1][i]).toBeCloseTo(esperado, 5);
    expect(rms(canais[0], 0, Math.round(0.49 * TAXA))).toBe(0);
  });

  it('áudio que falta fica calado e volta em "faltando"', () => {
    const d = musicaDeClipe({id: 'k', arquivo: 'midia/sumiu.wav', em: 0, duracao_ms: 1000}, {video: 'video'});
    const r = renderizarMusica(d, {});
    expect(r.faltando).toEqual(['midia/sumiu.wav']);
    expect(r.avisos.join(' ')).toMatch(/sumiu\.wav não foi lido/);
  });

  it('mixer: volume em dB, pan, mudo e solo', () => {
    const d = bateria([{peca: 'bumbo', em: 0}]);
    d.canais.push({id: 'b2', nome: 'B2', tipo: 'bateria'});
    d.padroes.push({id: 'p2', canal: 'b2', dur: 4, notas: [{peca: 'caixa', em: 0}]});
    d.arranjo.clipes.push({id: 'c2', canal: 'b2', em: 0, dur: 4, padrao: 'p2'});
    const base = renderizarMusica(d, {}, {porFaixa: true});
    d.mixer.faixas = [{id: 'bat', volume_db: -6, pan: -1}, {id: 'b2', mudo: true}];
    const r = renderizarMusica(d, {}, {porFaixa: true});
    expect(rms(r.faixas!.bat[0])).toBeCloseTo(rms(base.faixas!.bat[0]) * Math.pow(10, -6 / 20), 5);
    expect(rms(r.faixas!.bat[1])).toBe(0); // todo à esquerda
    expect(r.faixas!.b2).toBeUndefined();
    d.mixer.faixas = [{id: 'b2', solo: true}];
    const solo = renderizarMusica(d, {}, {porFaixa: true});
    expect(Object.keys(solo.faixas!)).toEqual(['b2']);
  });

  it('o reverb soma uma cauda e o EQ mexe no timbre', () => {
    const d = bateria([{peca: 'caixa', em: 0}]);
    const seco = renderizarMusica(d, {}).canais[0];
    d.mixer.faixas = [{id: 'bat', reverb: 0.8}];
    const molhado = renderizarMusica(d, {}).canais[0];
    const cauda = [Math.round(0.6 * TAXA), Math.round(1.5 * TAXA)] as const;
    expect(rms(molhado, ...cauda)).toBeGreaterThan(rms(seco, ...cauda) * 5);
    d.mixer.faixas = [{id: 'bat', eq: {agudos_db: -18}}];
    expect(rms(renderizarMusica(d, {}).canais[0])).toBeLessThan(rms(seco));
  });

  it('cada peça do kit sintetizado sai com som e pico em 0,9', () => {
    for (const peca of ['bumbo', 'caixa', 'palma', 'aro', 'chimbal_fechado', 'chimbal_aberto', 'prato', 'tom_grave', 'tom_agudo', 'shaker'] as const) {
      const s = sintetizarPeca(peca, TAXA);
      expect(Math.max(...s.map(Math.abs))).toBeCloseTo(0.9, 3);
    }
  });

  it('os estilos da casa são compassos de 4/4 com bumbo', () => {
    for (const e of ESTILOS) {
      const p = padraoDoEstilo(e.id);
      expect(p.dur).toBe(4);
      expect(p.notas.some((n) => n.peca === 'bumbo')).toBe(true);
      expect(p.notas.every((n) => n.em >= 0 && n.em < 4)).toBe(true);
    }
    expect(padraoDoEstilo('basico').notas.filter((n) => n.peca === 'chimbal_fechado')).toHaveLength(8);
  });
});

describe('música no vídeo', () => {
  const video = (): DocCenas => {
    const v = novoDocCenas({largura: 1080, altura: 1920, fps: 30});
    v.cenas[0].duracao_ms = 4000;
    v.cenas.push({...structuredClone(v.cenas[0]), id: 'cena-2', duracao_ms: 6000});
    v.audio = novoAudioCenas();
    v.audio!.faixas[1].clipes.push({id: 'clipe-2', arquivo: 'midia/cama.mp3', em: 1000, duracao_ms: 8000, corte_ms: 2000, volume: 0.5, fade_out_ms: 500});
    return v;
  };

  it('o código do render muda com o som, não com o título', () => {
    const d = bateria([{peca: 'bumbo', em: 0}]);
    const c = codigoDoSom(d);
    expect(c).toMatch(/^[0-9a-f]{16}$/);
    expect(codigoDoSom({...d, titulo: 'Outro nome'})).toBe(c);
    expect(codigoDoSom({...d, bpm: 121})).not.toBe(c);
    expect(renderDaMusica('musica', d).arquivo).toBe(`midia/musica/musica.${c}.wav`);
  });

  it('ligar o clipe guarda o áudio de antes, e "Voltar ao original" o devolve', () => {
    const v = video();
    const a = {faixa: v.audio!.faixas[1], fi: 1, clipe: v.audio!.faixas[1].clipes[0], ci: 0};
    const ligado = jsonpatch.applyPatch(structuredClone(v), patchLigarClipe(a, 'musica', {arquivo: 'midia/musica/musica.0123456789abcdef.wav', duracao_ms: 8000}) as Operation[]).newDocument;
    const c = ligado.audio!.faixas[1].clipes[0];
    expect(c).toMatchObject({arquivo: 'midia/musica/musica.0123456789abcdef.wav', musica: 'musica', corte_ms: 0, duracao_ms: 8000, volume: 0.5, fade_out_ms: 500,
      musica_original: {arquivo: 'midia/cama.mp3', corte_ms: 2000, duracao_ms: 8000}});
    const volta = jsonpatch.applyPatch(structuredClone(ligado), patchVoltarAoOriginal({...a, clipe: c}) as Operation[]).newDocument;
    expect(volta.audio!.faixas[1].clipes[0]).toEqual(v.audio!.faixas[1].clipes[0]);
  });

  it('a ligação viva troca o arquivo e segue a duração só de quem não foi aparado', () => {
    const v = video();
    v.audio!.faixas[1].clipes = [
      {id: 'a', arquivo: 'midia/musica/m.aaaaaaaaaaaaaaaa.wav', em: 0, duracao_ms: 8000, musica: 'm'},
      {id: 'b', arquivo: 'midia/musica/m.aaaaaaaaaaaaaaaa.wav', em: 0, duracao_ms: 3000, musica: 'm'},
      {id: 'c', arquivo: 'midia/outra.wav', em: 0, duracao_ms: 3000},
    ];
    const {patch, clipes, antigos} = patchAtualizarLigados(v, 'm', {arquivo: 'midia/musica/m.bbbbbbbbbbbbbbbb.wav', duracao_ms: 10000}, () => 8000);
    expect(clipes).toEqual(['a', 'b']);
    expect(antigos).toEqual(['midia/musica/m.aaaaaaaaaaaaaaaa.wav', 'midia/musica/m.aaaaaaaaaaaaaaaa.wav']);
    const novo = jsonpatch.applyPatch(structuredClone(v), patch as Operation[]).newDocument;
    expect(novo.audio!.faixas[1].clipes.map((c) => [c.arquivo.slice(-20), c.duracao_ms])).toEqual([['bbbbbbbbbbbbbbbb.wav', 10000], ['bbbbbbbbbbbbbbbb.wav', 3000], ['midia/outra.wav', 3000]]);
  });

  it('pôr no vídeo cria a faixa de efeitos quando falta, e os cortes de cena viram marcadores', () => {
    const v = video();
    v.audio!.faixas = v.audio!.faixas.filter((f) => f.papel !== 'efeitos');
    const {patch, caminho} = patchClipeNovo(v, {idMusica: 'm', papel: 'efeitos', em_ms: 500, render: {arquivo: 'midia/musica/m.x.wav', duracao_ms: 2000}});
    const novo = jsonpatch.applyPatch(structuredClone(v), patch as Operation[]).newDocument;
    const f = novo.audio!.faixas.find((x) => x.papel === 'efeitos')!;
    expect(f.clipes[0]).toMatchObject({id: 'musica-1', em: 500, duracao_ms: 2000, musica: 'm'});
    expect(caminho).toBe(`/audio/faixas/@${f.id}/clipes/@musica-1`);
    expect(cortesDoVideo(v)).toEqual([4000]);
  });
});
