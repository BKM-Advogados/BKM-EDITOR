// Música, bordas (auditoria de conteúdo): C7 (encaixe "cortes" com música vazia dava dur NaN), C8 (dividir deixava
// pedaço de duração 0 ou menor que 1/16), C9 (nota fora de 0–127 dava a volta no MIDI) e C12 (cortesDoVideo não usava a
// duração que o resolvedor usa).
import {describe, expect, it} from 'vitest';
import {encaixarNoVideo} from '../src/nucleo/musica-encaixe';
import {editarArranjo} from '../src/nucleo/musica-acoes';
import {gravarMidi, lerMidi} from '../src/nucleo/midi';
import {musicaParaMidi} from '../src/nucleo/musica-midi';
import {cortesDoVideo} from '../src/nucleo/musica-video';
import {encaixarNaEscala} from '../src/nucleo/musica-teoria';
import {DUR_MIN, novaMusica, resolverMusica, type DocMusica} from '../src/nucleo/musica';
import {duracaoDaCena, novoDocCenas, resolverCenas, type DocCenas} from '../src/nucleo/cenas';

const comBateria = (): DocMusica => {
  const d = novaMusica();
  d.canais.push({id: 'bateria', nome: 'Bateria', tipo: 'bateria', faixa_mixer: 'bateria'});
  d.padroes.push({id: 'p1', canal: 'bateria', dur: 4, notas: [{peca: 'bumbo', em: 0}]});
  d.arranjo.clipes.push({id: 'c1', canal: 'bateria', em: 0, dur: 4, padrao: 'p1'});
  return d;
};

const comLead = (nota: number): DocMusica => {
  const d = novaMusica();
  d.canais.push({id: 'lead', nome: 'Lead', tipo: 'sintetizador', faixa_mixer: 'lead', preset: 'lead'});
  d.padroes.push({id: 'p1', canal: 'lead', dur: 4, notas: [{nota: 60, em: 0, dur: 1}, {nota, em: 1, dur: 1}]});
  d.arranjo.clipes.push({id: 'c1', canal: 'lead', em: 0, dur: 4, padrao: 'p1'});
  return d;
};

describe('C7: encaixe "cortes" com música vazia e vídeo de uma cena', () => {
  it('não grava seção com dur NaN: as seções ficam como estavam, e o aviso diz por quê', () => {
    const video = novoDocCenas({largura: 1080, altura: 1920, fps: 30});
    const ed = encaixarNoVideo(novaMusica(), video, {modo: 'cortes'});
    const op = ed.patch.find((p) => p.path === '/secoes') as {value: {dur: number}[]};
    expect(op.value.every((s) => Number.isFinite(s.dur))).toBe(true);
    expect(op.value).toEqual([]);
    expect(ed.avisos?.join(' ')).toMatch(/não tem cortes/);
  });
});

describe('C8: dividir confere os dois pedaços depois de arredondar', () => {
  it('corte rente à ponta (0,0001 do começo ou do fim) é recusado com a faixa válida', () => {
    expect(() => editarArranjo(comBateria(), {acao: 'dividir', clipe: 'c1', em: 0.0001})).toThrow(/menor que 1\/16/);
    expect(() => editarArranjo(comBateria(), {acao: 'dividir', clipe: 'c1', em: 3.9999})).toThrow(/menor que 1\/16/);
    expect(() => editarArranjo(comBateria(), {acao: 'dividir', clipe: 'c1', em: 0.01})).toThrow(/entre 0.0625 e 3.9375/);
  });

  it('no limite de 1/16 passa, e os dois pedaços somam o clipe', () => {
    const ed = editarArranjo(comBateria(), {acao: 'dividir', clipe: 'c1', em: DUR_MIN});
    const dur = ed.patch.find((p) => p.path === '/arranjo/clipes/0/dur') as {value: number};
    const segundo = ed.patch.find((p) => p.op === 'add') as {value: {em: number; dur: number}};
    expect(dur.value).toBe(DUR_MIN);
    expect(segundo.value).toMatchObject({em: DUR_MIN, dur: 4 - DUR_MIN});
  });
});

describe('C9: nota fora de 0–127 não dá a volta no MIDI', () => {
  it('gravarMidi deixa de fora 130 e -1 (antes viravam 2 e 127)', () => {
    const bytes = gravarMidi({ppq: 480, trilhas: [{canal: 0, notas: [{tick: 0, dur: 480, nota: 130, forca: 100}, {tick: 480, dur: 480, nota: -1, forca: 100}, {tick: 960, dur: 480, nota: 64, forca: 100}]}], marcadores: []});
    expect(lerMidi(bytes).trilhas[0].notas.map((n) => n.nota)).toEqual([64]);
  });

  it('musicaParaMidi filtra e avisa; o resolvedor avisa', () => {
    const d = comLead(140);
    expect(resolverMusica(d).avisos.join(' ')).toMatch(/fora de 0 a 127/);
    const r = musicaParaMidi(d);
    expect(lerMidi(r.bytes).trilhas[0].notas.map((n) => n.nota)).toEqual([60]);
    expect(r.avisos.join(' ')).toMatch(/1 nota\(s\) fora de 0 a 127/);
    expect(resolverMusica(comLead(64)).avisos.join(' ')).not.toMatch(/fora de 0 a 127/);
  });

  it('encaixarNaEscala fica dentro de 0 a 127', () => {
    for (let n = 115; n <= 140; n++) {
      const e = encaixarNaEscala(n, 'C', 'maior');
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(127);
    }
    expect(encaixarNaEscala(127, 'C#', 'maior')).toBeLessThanOrEqual(127);
    expect(encaixarNaEscala(-3, 'C', 'maior')).toBe(0);
    expect(encaixarNaEscala(61, 'C', 'maior')).toBe(62); // empate segue para cima
  });
});

describe('C12: cortesDoVideo usa a duração do resolvedor', () => {
  it('cena sem duracao_ms (padrão) e cena curta (vai a 300): os mesmos cortes do resolvedor', () => {
    const video = {tipo: 'cenas', formato: {largura: 1080, altura: 1920, fps: 30}, tema: {}, cenas: [
      {id: 'a', duracao_ms: 100, blocos: []}, {id: 'b', blocos: []}, {id: 'c', duracao_ms: 4000, blocos: []},
    ]} as unknown as DocCenas;
    const verdade = resolverCenas(video).props.cenas.slice(1).map((c) => c.t_in);
    expect(cortesDoVideo(video)).toEqual(verdade);
    expect(verdade).toEqual([300, 4300]);
    expect(duracaoDaCena({})).toBe(4000);
    expect(duracaoDaCena({duracao_ms: 1e9})).toBe(600000);
  });
});
