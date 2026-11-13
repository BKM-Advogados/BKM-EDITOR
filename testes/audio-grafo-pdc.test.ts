// M-07: compensação automática de latência (PDC) no grafo e atraso manual por faixa ("track delay"). Os testes de
// impulso usam um processador de latência artificial (atrasa e declara o atraso, como um lookahead) e conferem, amostra a
// amostra, que todo caminho chega junto ao somador: caminhos paralelos, envios aos retornos (por bloco e de buffer
// inteiro), sidechain numa segunda porta, estágios de adaptadores e stems coletados. Depois, o atraso manual no
// documento, pelo endereço da M-02 e pelo JSON Patch. Ver docs/audio-grafo.md (PDC e atraso manual).
import jsonpatch from 'fast-json-patch';
import {describe, expect, it} from 'vitest';
import {Grafo} from '../src/nucleo/audio-grafo/grafo';
import {executarOffline} from '../src/nucleo/audio-grafo/executor';
import {grafoDaMusica, renderizarMusicaGrafo} from '../src/nucleo/audio-grafo/musica';
import {AtrasoFaixa, Fonte, Ganho, Passa} from '../src/nucleo/audio-grafo/processadores';
import type {EstadoProcessador, Processador, ProcessadorInteiro} from '../src/nucleo/audio-grafo/tipos';
import type {FonteAudio} from '../src/nucleo/loudness';
import {resolverMusica, type DocMusica} from '../src/nucleo/musica';
import {lerParametro, patchDoParametro, PARAMETROS} from '../src/nucleo/musica-param';
import {ganhoDoSidechain, renderizarMusicaAntigo} from '../src/nucleo/musica-som';

const BLOCOS = [1, 7, 64, 128, 333];

/** Latência artificial: atrasa `l` amostras, multiplica por `g` e declara os `l` de latência (um lookahead de mentira). */
class Latente implements Processador {
  readonly tipo = 'latente';
  readonly entradas: number[];
  readonly saidas: number[];
  private linhas: Float32Array[] = [];
  private k = 0;
  constructor(readonly latencia: number, readonly g = 1, canais = 2) {
    this.entradas = [canais];
    this.saidas = [canais];
  }
  preparar() {
    this.linhas = this.entradas.flatMap((c) => Array.from({length: c}, () => new Float32Array(Math.max(1, this.latencia))));
  }
  processar(e: readonly (readonly Float32Array[])[], s: readonly Float32Array[][], n: number) {
    const l = this.latencia;
    let k = this.k;
    for (let c = 0; c < s[0].length; c++) {
      const x = e[0][c], y = s[0][c], linha = this.linhas[c];
      k = this.k;
      for (let i = 0; i < n; i++) {
        if (l === 0) y[i] = x[i] * this.g;
        else {
          y[i] = linha[k] * this.g;
          linha[k] = x[i];
          if (++k >= l) k = 0;
        }
      }
    }
    this.k = k;
  }
  resetar() {
    for (const x of this.linhas) x.fill(0);
    this.k = 0;
  }
  estado(): EstadoProcessador {
    return {};
  }
  restaurar() {}
}

/** Sidechain de exemplo: a saída é a entrada 0 vezes a entrada 1 (mono), amostra a amostra. Só sai algo onde os dois
 *  impulsos caem na mesma amostra. */
class Produto implements Processador {
  readonly tipo = 'produto';
  readonly entradas = [2, 1];
  readonly saidas = [2];
  readonly latencia = 0;
  preparar() {}
  processar(e: readonly (readonly Float32Array[])[], s: readonly Float32Array[][], n: number) {
    for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) s[0][c][i] = e[0][c][i] * e[1][0][i];
  }
  resetar() {}
  estado() {
    return {};
  }
  restaurar() {}
}

/** Retorno de buffer inteiro, de exemplo: passa direto (o que importa é a entrada chegar alinhada). */
class RetornoInteiro implements ProcessadorInteiro {
  readonly tipo = 'retorno_inteiro';
  readonly inteiro = true as const;
  readonly entradas = [2];
  readonly saidas = [2];
  processarTudo(e: Float32Array[][]) {
    return e;
  }
  resetar() {}
  estado() {
    return {};
  }
  restaurar() {}
}

const impulso = (n: number, em: number, canais = 2) => Array.from({length: canais}, () => {
  const x = new Float32Array(n);
  x[em] = 1;
  return x;
});

/** Cada canal é zero fora de `em` e vale `v` em `em`. */
const soImpulso = (canais: Float32Array[], em: number, v: number, onde: string) => {
  for (let c = 0; c < canais.length; c++) {
    const fora = [...canais[c]].map((x, i) => [i, x] as const).filter(([i, x]) => i !== em && x !== 0);
    expect({em: canais[c][em], fora: fora.slice(0, 3)}, `${onde}, canal ${c}`).toEqual({em: v, fora: []});
  }
};

describe('PDC: impulso com latência artificial', () => {
  for (const bloco of BLOCOS) {
    it(`caminhos paralelos de latências diferentes chegam juntos ao somador (bloco ${bloco})`, () => {
      const n = 1200, em = 250;
      const g = new Grafo();
      g.no('imp', new Fonte(impulso(n, em)));
      g.no('soma', new Passa(2));
      // latências 0, 3, 129 (mais que um bloco) e 300 + 41 em série; cada caminho com um ganho distinto (1, 2, 4, 8)
      g.no('a', new Latente(0, 1));
      g.no('b', new Latente(3, 2));
      g.no('c', new Latente(129, 4));
      g.no('d1', new Latente(300, 8));
      g.no('d2', new Latente(41, 1));
      for (const x of ['a', 'b', 'c', 'd1']) g.ligar('imp', x);
      g.ligar('d1', 'd2');
      for (const x of ['a', 'b', 'c', 'd2']) g.ligar(x, 'soma');
      const r = executarOffline(g, {taxa: 48000, n, saida: 'soma', bloco, coletar: ['a', 'c', 'd2']});
      expect(r.latencia).toBe(341);
      soImpulso(r.canais, em, 15, 'soma');
      // o que se coleta no meio do caminho (os stems) também sai no tempo da música
      soImpulso(r.coletados.a, em, 1, 'a');
      soImpulso(r.coletados.c, em, 4, 'c');
      soImpulso(r.coletados.d2, em, 8, 'd2');
    });
  }

  for (const bloco of [1, 128, 333]) {
    it(`envios aos retornos: faixas de latências diferentes, retorno com latência própria, tudo junto no master (bloco ${bloco})`, () => {
      const n = 2000, em = 600;
      for (const retornoInteiro of [false, true]) {
        const g = new Grafo();
        g.no('canal:a', new Fonte(impulso(n, em)));
        g.no('canal:b', new Fonte(impulso(n, em)));
        g.no('faixa:a', new Latente(90, 1)); // uma faixa com um lookahead de 90 amostras
        g.no('faixa:b', new Latente(0, 2));
        g.no('retorno', retornoInteiro ? new RetornoInteiro() : new Latente(17, 1), {soma: 'zero'});
        g.no('master', new Passa(2), {soma: 'zero'});
        g.ligar('canal:a', 'faixa:a');
        g.ligar('canal:b', 'faixa:b');
        g.ligar('faixa:a', 'retorno', {ganho: 0.5});
        g.ligar('faixa:b', 'retorno', {ganho: 0.25});
        g.ligar('faixa:a', 'master');
        g.ligar('faixa:b', 'master');
        g.ligar('retorno', 'master', {ganho: 4});
        const r = executarOffline(g, {taxa: 48000, n, saida: 'master', bloco, coletar: ['faixa:a', 'faixa:b', 'retorno']});
        const onde = retornoInteiro ? 'retorno inteiro' : 'retorno por bloco';
        // a: 1, b: 2, retorno: (0,5·1 + 0,25·2)·4 = 4
        soImpulso(r.coletados.retorno, em, 1, `${onde}: retorno`);
        soImpulso(r.coletados['faixa:a'], em, 1, `${onde}: faixa a`);
        soImpulso(r.coletados['faixa:b'], em, 2, `${onde}: faixa b`);
        soImpulso(r.canais, em, 7, `${onde}: master`);
      }
    });
  }

  for (const [principal, lateral] of [[0, 77], [77, 0], [200, 13]]) {
    it(`sidechain numa segunda porta: principal com ${principal} e lateral com ${lateral} amostras de latência`, () => {
      const n = 1000, em = 300;
      const g = new Grafo();
      g.no('musica', new Fonte(impulso(n, em)));
      g.no('bumbo', new Fonte(impulso(n, em, 1)));
      g.no('p', new Latente(principal, 3));
      g.no('l', new Latente(lateral, 5, 1));
      g.no('duck', new Produto());
      g.ligar('musica', 'p');
      g.ligar('bumbo', 'l');
      g.ligar('p', 'duck');
      g.ligar('l', {no: 'duck', porta: 1});
      for (const bloco of BLOCOS) soImpulso(executarOffline(g, {taxa: 48000, n, saida: 'duck', bloco}).canais, em, 15, `bloco ${bloco}`);
    });
  }

  it('latência antes e depois de um adaptador de buffer inteiro, com um caminho que passa por fora dele', () => {
    const n = 1500, em = 400;
    const g = new Grafo();
    g.no('imp', new Fonte(impulso(n, em)));
    g.no('antes', new Latente(55, 1));
    g.no('inteiro', new RetornoInteiro());
    g.no('depois', new Latente(130, 2));
    g.no('fora', new Latente(9, 10));
    g.no('soma', new Passa(2));
    g.ligar('imp', 'antes');
    g.ligar('antes', 'inteiro');
    g.ligar('inteiro', 'depois');
    g.ligar('imp', 'fora');
    g.ligar('depois', 'soma');
    g.ligar('fora', 'soma');
    for (const bloco of BLOCOS) {
      const r = executarOffline(g, {taxa: 48000, n, saida: 'soma', bloco, coletar: ['antes', 'fora']});
      expect(r.estagios).toBe(2);
      soImpulso(r.canais, em, 12, `bloco ${bloco}`);
      soImpulso(r.coletados.antes, em, 1, `antes, bloco ${bloco}`);
      soImpulso(r.coletados.fora, em, 10, `fora, bloco ${bloco}`);
    }
  });

  it('a automação de um nó depois da latência segue no tempo da música (o ganho cai no impulso)', () => {
    const n = 800, em = 200;
    const g = new Grafo();
    g.no('imp', new Fonte(impulso(n, em)));
    g.no('lento', new Latente(64, 1));
    // a curva só vale 3 na amostra do impulso: se o nó lesse a curva no tempo do executor, sairia 0
    g.no('ganho', new Ganho(2), {params: {ganho: {curva: Float32Array.from({length: n}, (_, i) => (i === em ? 3 : 0))}}});
    g.ligar('imp', 'lento');
    g.ligar('lento', 'ganho');
    for (const bloco of BLOCOS) soImpulso(executarOffline(g, {taxa: 48000, n, saida: 'ganho', bloco}).canais, em, 3, `bloco ${bloco}`);
  });
});

describe('AtrasoFaixa', () => {
  it('positivo atrasa sem declarar latência; negativo declara latência e o PDC adianta a faixa contra as outras', () => {
    const n = 1000, em = 500;
    for (const d of [-130, -1, 0, 1, 37, 129]) {
      const g = new Grafo();
      g.no('a', new Fonte(impulso(n, em)));
      g.no('b', new Fonte(impulso(n, em)));
      g.no('atraso', new AtrasoFaixa(d));
      g.no('outra', new Ganho(2), {params: {ganho: 2}});
      g.no('soma', new Passa(2), {soma: 'zero'});
      g.ligar('a', 'atraso');
      g.ligar('b', 'outra');
      g.ligar('atraso', 'soma');
      g.ligar('outra', 'soma');
      expect(new AtrasoFaixa(d).latencia).toBe(Math.max(0, -d));
      for (const bloco of [1, 64, 128]) {
        const r = executarOffline(g, {taxa: 48000, n, saida: 'soma', bloco, coletar: ['atraso', 'outra']});
        soImpulso(r.coletados.atraso, em + d, 1, `d = ${d}, bloco ${bloco}: a faixa atrasada`);
        soImpulso(r.coletados.outra, em, 2, `d = ${d}, bloco ${bloco}: a outra`);
        if (d === 0) soImpulso(r.canais, em, 3, 'd = 0: soma');
        else {
          expect(r.canais[0][em + d]).toBe(1);
          expect(r.canais[0][em]).toBe(2);
        }
      }
    }
  });

  it('recusa amostras que não são inteiras', () => {
    expect(() => new AtrasoFaixa(1.5)).toThrow(/inteiro/);
  });
});

// ---------- o atraso manual no documento de música ----------

const TAXA = 48000;
/** Um áudio em memória: um impulso (ou um valor constante) estéreo de `s` segundos. */
const fonteImpulso = (s: number, em: number): FonteAudio => ({taxa: TAXA, canais: impulso(Math.round(s * TAXA), em)});
const fonteConstante = (s: number, v: number): FonteAudio => ({taxa: TAXA, canais: [new Float32Array(Math.round(s * TAXA)).fill(v), new Float32Array(Math.round(s * TAXA)).fill(v)]});

const docBase = (atrasos: {a?: number; b?: number} = {}): DocMusica => ({
  tipo: 'musica', titulo: 'pdc', bpm: 120, compasso: [4, 4], formato: 1,
  canais: [{id: 'a', nome: 'A', tipo: 'audio', faixa_mixer: 'a'}, {id: 'b', nome: 'B', tipo: 'audio', faixa_mixer: 'b'}],
  padroes: [],
  arranjo: {clipes: [{id: 'ca', canal: 'a', em: 0, dur: 4, audio: 'a.wav'}, {id: 'cb', canal: 'b', em: 0, dur: 4, audio: 'b.wav'}]},
  mixer: {faixas: [{id: 'a', volume_db: 0, pan: 0, reverb: 0.3, ...(atrasos.a !== undefined ? {atraso_ms: atrasos.a} : {})},
    {id: 'b', volume_db: -6, pan: 0.3, ...(atrasos.b !== undefined ? {atraso_ms: atrasos.b} : {})}],
  master: {volume_db: 0, reverb: {tamanho: 0.5, amortecimento: 0.5, volume_db: -3}}},
} as DocMusica);

const fontes = {'a.wav': fonteImpulso(2, 30000), 'b.wav': fonteImpulso(2, 40000)};

/** `x` deslocado de `d` amostras (positivo atrasa), com zeros onde não há o que trazer. */
const deslocado = (x: Float32Array, d: number) => Float32Array.from(x, (_, i) => (i - d >= 0 && i - d < x.length ? x[i - d] : 0));
const mesmo = (a: Float32Array[], b: Float32Array[], onde: string) => {
  for (let c = 0; c < a.length; c++) {
    let i = 0;
    while (i < a[c].length && Object.is(a[c][i], b[c][i])) i++;
    expect(i === a[c].length ? 'igual' : `difere na amostra ${i}: ${a[c][i]} contra ${b[c][i]}`, `${onde}, canal ${c}`).toBe('igual');
  }
};

describe('atraso manual da faixa (track delay) no documento', () => {
  it('sem o campo, ou com 0, o PCM é o mesmo do motor antigo e não entra nó de atraso', () => {
    const antigo = renderizarMusicaAntigo(docBase(), fontes, {porFaixa: true});
    for (const d of [docBase(), docBase({a: 0, b: 0})]) {
      const r = renderizarMusicaGrafo(d, fontes, {porFaixa: true});
      mesmo(r.canais, antigo.canais, 'mistura');
      mesmo(r.faixas!.a, antigo.faixas!.a, 'faixa a');
      mesmo(r.retornos!.reverb!, antigo.retornos!.reverb!, 'reverb');
      expect([...grafoDaMusica(d, fontes).grafo.nos.keys()].some((id) => id.endsWith('/atraso'))).toBe(false);
    }
  });

  for (const ms of [10, -10, 2.5, -250]) {
    it(`${ms} ms desloca a faixa (e o que ela manda ao reverb) e não mexe nas outras`, () => {
      const d = Math.round((ms * TAXA) / 1000);
      const zero = renderizarMusicaGrafo(docBase(), fontes, {porFaixa: true});
      const r = renderizarMusicaGrafo(docBase({a: ms}), fontes, {porFaixa: true});
      expect(grafoDaMusica(docBase({a: ms}), fontes).grafo.nos.has('faixa:a/atraso')).toBe(true);
      mesmo(r.faixas!.a, zero.faixas!.a.map((x) => deslocado(x, d)), 'faixa a');
      mesmo(r.faixas!.b, zero.faixas!.b, 'faixa b');
      // o impulso da faixa a cai d amostras antes ou depois, exatamente
      expect(r.faixas!.a[0][30000 + d]).toBe(zero.faixas!.a[0][30000]);
      // o reverb é linear e começa calado: com o envio deslocado, a volta sai deslocada igual
      // (adiantada, a cauda do fim vem a mais: compara até onde o render de 0 ms chega)
      const ate = r.retornos!.reverb![0].length - Math.max(0, -d);
      mesmo(r.retornos!.reverb!.map((x) => x.subarray(0, ate)), zero.retornos!.reverb!.map((x) => deslocado(x, d).subarray(0, ate)), 'reverb');
    });
  }

  it('as duas faixas com o mesmo atraso negativo: a mistura inteira sai adiantada, igual', () => {
    const d = Math.round((-20 * TAXA) / 1000);
    const doc = (a?: number) => ({...docBase({a, b: a}), mixer: {...docBase({a, b: a}).mixer, master: {volume_db: 0, limitador: {ativo: false}}}}) as DocMusica;
    const zero = renderizarMusicaGrafo(doc(), fontes, {porFaixa: true});
    const r = renderizarMusicaGrafo(doc(-20), fontes, {porFaixa: true});
    const ate = r.canais[0].length + d; // a cauda do reverb que entra no fim vem a mais
    mesmo(r.canais.map((x) => x.subarray(0, ate)), zero.canais.map((x) => deslocado(x, d).subarray(0, ate)), 'mistura');
  });

  it('o sidechain segue o atraso da faixa do canal que dispara', () => {
    const doc = (atraso?: number): DocMusica => ({
      tipo: 'musica', titulo: 'sc', bpm: 120, compasso: [4, 4], formato: 1,
      canais: [{id: 'bateria', nome: 'Bateria', tipo: 'bateria', faixa_mixer: 'bateria', kit: 'eletronico'}, {id: 'cama', nome: 'Cama', tipo: 'audio', faixa_mixer: 'cama'}],
      padroes: [{id: 'p', nome: 'p', canal: 'bateria', dur: 4, passos: 16, notas: [{peca: 'bumbo', em: 1}, {peca: 'bumbo', em: 3}]}],
      arranjo: {clipes: [{id: 'c1', canal: 'bateria', em: 0, dur: 4, padrao: 'p'}, {id: 'c2', canal: 'cama', em: 0, dur: 4, audio: 'dc.wav'}]},
      mixer: {faixas: [{id: 'bateria', volume_db: 0, pan: 0, ...(atraso !== undefined ? {atraso_ms: atraso} : {})},
        {id: 'cama', volume_db: 0, pan: 0, sidechain: {de: 'bateria', quanto_db: 12}}]},
    } as DocMusica);
    const f = {'dc.wav': fonteConstante(2, 0.5)};
    const zero = renderizarMusicaGrafo(doc(), f, {porFaixa: true});
    for (const ms of [15, -15]) {
      const d = Math.round((ms * TAXA) / 1000);
      const r = renderizarMusicaGrafo(doc(ms), f, {porFaixa: true});
      mesmo(r.faixas!.bateria, zero.faixas!.bateria.map((x) => deslocado(x, d)), `bateria (${ms} ms)`);
      // a cama não anda, mas o abaixamento anda junto com o bumbo: compara com a curva deslocada
      const m = resolverMusica(doc(ms)).musica;
      const curva = ganhoDoSidechain([m.seg_por_batida, 3 * m.seg_por_batida], {quanto_db: 12, ataque_ms: 5, soltura_ms: 180}, r.faixas!.cama[0].length, TAXA, d);
      const pico = (x: Float32Array) => x.indexOf(Math.min(...x));
      expect(pico(r.faixas!.cama[0]) - pico(zero.faixas!.cama[0]), `${ms} ms`).toBe(d);
      expect(pico(r.faixas!.cama[0])).toBe(pico(curva));
    }
  });

  it('pelo endereço da M-02 e pelo JSON Patch: lê, escreve, traz para dentro da faixa e o motor lê', () => {
    const def = PARAMETROS.find((p) => p.modelo === 'faixa:*/atraso_ms')!;
    expect({min: def.min, max: def.max, padrao: def.padrao, unidade: def.unidade, automatizavel: def.automatizavel}).toEqual({min: -500, max: 500, padrao: 0, unidade: 'ms', automatizavel: false});
    const doc = docBase();
    const lido = lerParametro(doc, 'faixa:a/atraso_ms');
    expect(lido.ok && lido.valor.valor).toBe(0);
    const p = patchDoParametro(doc, 'faixa:a/atraso_ms', -12.5);
    if (!p.ok) throw new Error('patch recusado');
    expect(p.valor.patch).toEqual([{op: 'add', path: '/mixer/faixas/0/atraso_ms', value: -12.5}]);
    const novo = jsonpatch.applyPatch(structuredClone(doc), p.valor.patch).newDocument as DocMusica;
    expect(resolverMusica(novo).musica.faixas[0].atraso_ms).toBe(-12.5);
    expect(grafoDaMusica(novo, fontes).grafo.nos.has('faixa:a/atraso')).toBe(true);
    // fora da faixa volta para dentro, com aviso; o motor também limita o que vier direto no JSON
    const fora = patchDoParametro(doc, 'faixa:a/atraso_ms', 900);
    expect(fora.ok && fora.valor.valor).toBe(500);
    expect(fora.ok && fora.valor.avisos.length).toBeGreaterThan(0);
    expect(resolverMusica(docBase({a: -9000})).musica.faixas[0].atraso_ms).toBe(-500);
    // uma faixa que só existe pelo canal nasce no patch
    const soCanal = {...doc, mixer: {faixas: []}} as DocMusica;
    const q = patchDoParametro(soCanal, 'faixa:b/atraso_ms', 5);
    expect(q.ok && q.valor.patch.map((o) => o.path)).toEqual(['/mixer/faixas/-', '/mixer/faixas/0/atraso_ms']);
  });
});
