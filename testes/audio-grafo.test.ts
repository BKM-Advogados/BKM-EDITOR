// O núcleo do grafo de áudio (M-01): ordem topológica estável, soma em ordem fixa, portas múltiplas (sidechain e
// multi-saída), PDC, automação amostra a amostra, estágios dos adaptadores de buffer inteiro, cache por chave e estado
// serializável. O oráculo contra o motor antigo está em audio-grafo-oraculo.test.ts. Ver docs/audio-grafo.md.
import {describe, expect, it} from 'vitest';
import {Grafo} from '../src/nucleo/audio-grafo/grafo';
import {executarOffline} from '../src/nucleo/audio-grafo/executor';
import {Atraso, Fonte, Ganho, Passa, VolumePan, panLei} from '../src/nucleo/audio-grafo/processadores';
import type {EstadoProcessador, Processador, ProcessadorInteiro} from '../src/nucleo/audio-grafo/tipos';
import {geradorDe} from '../src/nucleo/musica-som';

const ruido = (n: number, semente: number) => {
  const g = geradorDe(semente);
  return Float32Array.from({length: n}, () => g());
};
const estereo = (n: number, semente: number) => [ruido(n, semente), ruido(n, semente + 100)];
const impulso = (n: number, em: number, canais = 1) => Array.from({length: canais}, () => {
  const x = new Float32Array(n);
  x[em] = 1;
  return x;
});

/** Duck por sidechain, de exemplo: entrada 0 (estéreo) × (1 − |sidechain|), entrada 1 mono; a saída 1 devolve o sidechain. */
class Duck implements Processador {
  readonly tipo = 'duck';
  readonly entradas = [2, 1];
  readonly saidas = [2, 1];
  readonly latencia = 0;
  preparar() {}
  processar(e: readonly (readonly Float32Array[])[], s: readonly Float32Array[][], n: number) {
    for (let i = 0; i < n; i++) {
      const g = 1 - Math.abs(e[1][0][i]);
      s[0][0][i] = e[0][0][i] * g;
      s[0][1][i] = e[0][1][i] * g;
      s[1][0][i] = e[1][0][i];
    }
  }
  resetar() {}
  estado() {
    return {};
  }
  restaurar() {}
}

/** Adaptador de exemplo: soma acumulada (só faz sentido com o buffer inteiro). */
class Acumula implements ProcessadorInteiro {
  readonly tipo = 'acumula';
  readonly inteiro = true as const;
  readonly entradas = [1];
  readonly saidas = [1];
  chamadas = 0;
  processarTudo(e: Float32Array[][]) {
    this.chamadas++;
    const x = e[0][0];
    for (let i = 1; i < x.length; i++) x[i] = x[i] + x[i - 1];
    return e;
  }
  resetar() {}
  estado(): EstadoProcessador {
    return {chamadas: this.chamadas};
  }
  restaurar() {}
}

/** Conta quantas vezes processou (para ver o que o cache poupou). */
class Contador extends Passa {
  vezes = 0;
  processar(e: readonly (readonly Float32Array[])[], s: readonly Float32Array[][], n: number) {
    this.vezes++;
    super.processar(e, s, n);
  }
}

describe('montagem', () => {
  it('recusa id repetido, porta inexistente, canais diferentes, parâmetro não declarado e ciclo', () => {
    const g = new Grafo();
    g.no('a', new Passa(2));
    g.no('b', new Passa(2));
    g.no('m', new Passa(1));
    expect(() => g.no('a', new Passa(2))).toThrow(/já existe/);
    expect(() => g.ligar('a', {no: 'b', porta: 1})).toThrow(/não tem a entrada 1/);
    expect(() => g.ligar('a', 'm')).toThrow(/2 canais/);
    expect(() => g.no('p', new Passa(2), {params: {ganho: 1}})).toThrow(/não tem o parâmetro/);
    g.ligar('a', 'b');
    g.ligar('b', 'a');
    expect(() => g.ordemTopologica()).toThrow(/ciclo/);
  });

  it('ordem topológica estável: empate desfeito pela ordem de entrada', () => {
    const g = new Grafo();
    for (const id of ['z', 'y', 'x', 'saida']) g.no(id, new Passa(2));
    g.ligar('x', 'saida');
    g.ligar('z', 'saida');
    g.ligar('y', 'saida');
    expect(g.ordemTopologica()).toEqual(['z', 'y', 'x', 'saida']);
  });
});

describe('executor', () => {
  it('soma em ordem fixa, com o ganho de cada ligação, e uma ligação só passa intacta (−0 incluído)', () => {
    const n = 1000;
    const a = estereo(n, 1), b = estereo(n, 2), c = estereo(n, 3);
    a[0][5] = -0;
    const g = new Grafo();
    for (const [id, x] of [['a', a], ['b', b], ['c', c]] as const) g.no(id, new Fonte(x));
    g.no('soma', new Passa(2));
    g.no('um', new Passa(2));
    g.no('zero', new Passa(2), {soma: 'zero'});
    g.ligar('b', 'soma', {ganho: 0.5});
    g.ligar('a', 'soma');
    g.ligar('c', 'soma', {ganho: 0.25});
    g.ligar('a', 'um');
    g.ligar('a', 'zero');
    const r = executarOffline(g, {taxa: 48000, n, saida: 'soma', coletar: ['um', 'zero'], bloco: 64});
    for (let k = 0; k < 2; k++) for (let i = 0; i < n; i++) {
      const esperado = Math.fround(Math.fround(Math.fround(b[k][i] * 0.5) + a[k][i]) + c[k][i] * 0.25);
      expect(r.canais[k][i]).toBe(esperado);
    }
    expect(Object.is(r.coletados.um[0][5], -0)).toBe(true);
    expect(Object.is(r.coletados.zero[0][5], 0)).toBe(true);
  });

  it('o tamanho do bloco não muda nada', () => {
    const n = 5003;
    const monta = () => {
      const g = new Grafo();
      g.no('src', new Fonte(estereo(n, 4)));
      g.no('vp', new VolumePan(), {params: {volume_db: -3, pan: 0.3}});
      g.no('atr', new Atraso(17));
      g.no('soma', new Passa(2));
      g.ligar('src', 'vp');
      g.ligar('vp', 'atr');
      g.ligar('vp', 'soma');
      g.ligar('atr', 'soma', {ganho: 0.7});
      return g;
    };
    const ref = executarOffline(monta(), {taxa: 48000, n, saida: 'soma', bloco: 128}).canais;
    for (const bloco of [1, 3, 64, 4096, 10000]) {
      const r = executarOffline(monta(), {taxa: 48000, n, saida: 'soma', bloco}).canais;
      expect(r.map((c) => Array.from(c)), `bloco ${bloco}`).toEqual(ref.map((c) => Array.from(c)));
    }
  });

  it('portas múltiplas: sidechain numa entrada, segunda saída ligada adiante', () => {
    const n = 300;
    const g = new Grafo();
    g.no('musica', new Fonte(estereo(n, 5)));
    const sc = new Float32Array(n).fill(0.25);
    g.no('bumbo', new Fonte([sc]));
    g.no('duck', new Duck());
    g.no('sc_out', new Passa(1));
    g.ligar('musica', 'duck');
    g.ligar('bumbo', {no: 'duck', porta: 1});
    g.ligar({no: 'duck', porta: 1}, 'sc_out');
    const m = estereo(n, 5);
    const r = executarOffline(g, {taxa: 48000, n, saida: 'duck', coletar: ['sc_out']});
    expect(r.canais[1][10]).toBe(Math.fround(m[1][10] * 0.75));
    expect(Array.from(r.coletados.sc_out[0])).toEqual(Array.from(sc));
  });

  it('PDC: um caminho com latência e outro sem chegam juntos (impulso), e o atraso da saída é descartado', () => {
    const n = 1000;
    const g = new Grafo();
    g.no('imp', new Fonte(impulso(n, 100, 2)));
    g.no('lento', new Atraso(37)); // um processador com latência declarada de 37 amostras
    g.no('mais_lento', new Atraso(5));
    g.no('soma', new Passa(2));
    g.ligar('imp', 'lento');
    g.ligar('lento', 'mais_lento');
    g.ligar('imp', 'soma');
    g.ligar('mais_lento', 'soma');
    const r = executarOffline(g, {taxa: 48000, n, saida: 'soma', bloco: 32});
    expect(r.latencia).toBe(42);
    for (const c of r.canais) {
      expect(c[100]).toBe(2);
      expect(c.reduce((s, v) => s + Math.abs(v), 0)).toBe(2);
    }
  });

  it('automação amostra a amostra por endereço, no tempo da música mesmo depois de latência', () => {
    const n = 777;
    const curva = Float32Array.from({length: n}, (_, i) => i / n);
    const g = new Grafo();
    g.no('um', new Fonte([new Float32Array(n).fill(1), new Float32Array(n).fill(1)]));
    g.no('atr', new Atraso(50));
    g.no('ganho', new Ganho(2), {params: {ganho: {endereco: 'faixa:x/volume_db', valor: 0.5}}});
    g.ligar('um', 'atr');
    g.ligar('atr', 'ganho');
    // sem automação registrada vale o valor
    expect(executarOffline(g, {taxa: 48000, n, saida: 'ganho'}).canais[0][400]).toBe(0.5);
    g.automatizar('faixa:x/volume_db', curva);
    const r = executarOffline(g, {taxa: 48000, n, saida: 'ganho', bloco: 100});
    expect(Array.from(r.canais[0])).toEqual(Array.from(curva));
    // a curva também pode ser uma função (preenche o bloco a partir de `inicio`)
    g.automatizar('faixa:x/volume_db', (inicio, k, out) => {
      for (let i = 0; i < k; i++) out[i] = (inicio + i) % 2;
    });
    const r2 = executarOffline(g, {taxa: 48000, n, saida: 'ganho', bloco: 33});
    expect(Array.from(r2.canais[1].subarray(0, 6))).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it('o pan do VolumePan com curva amostra a amostra dá a mesma conta do constante', () => {
    const n = 256;
    const x = estereo(n, 9);
    const g = new Grafo();
    g.no('src', new Fonte(x));
    g.no('vp', new VolumePan(), {params: {volume_db: -2, pan: {curva: new Float32Array(n).fill(-0.5)}}});
    g.ligar('src', 'vp');
    const r = executarOffline(g, {taxa: 48000, n, saida: 'vp'});
    const gdb = Math.pow(10, -2 / 20), [gl] = panLei(Math.fround(-0.5));
    expect(r.canais[0][7]).toBe(Math.fround(x[0][7] * (gdb * gl)));
  });

  it('adaptador de buffer inteiro: estágios, entrada alinhada mesmo com latência antes, saída como fonte depois', () => {
    const n = 2000;
    const x = ruido(n, 11);
    const g = new Grafo();
    g.no('src', new Fonte([x]));
    g.no('atr', new Atraso(64, 1));
    g.no('meio', new Ganho(1), {params: {ganho: 0.5}});
    const ac = new Acumula();
    g.no('acumula', ac);
    g.no('depois', new Ganho(1), {params: {ganho: 2}});
    g.ligar('src', 'atr');
    g.ligar('atr', 'meio');
    g.ligar('meio', 'acumula');
    g.ligar('acumula', 'depois');
    const r = executarOffline(g, {taxa: 48000, n, saida: 'depois', bloco: 128});
    expect(r.estagios).toBe(2);
    expect(ac.chamadas).toBe(1);
    let s = 0;
    for (let i = 0; i < n; i++) {
      s = Math.fround(s + Math.fround(x[i] * 0.5));
      expect(r.canais[0][i]).toBe(Math.fround(s * 2));
    }
  });

  it('cache por chave: o nó guardado não roda, nem o que só ele usava', () => {
    const n = 500;
    const monta = (cont: Contador) => {
      const g = new Grafo();
      g.no('src', new Fonte(estereo(n, 12)));
      g.no('cara', cont, {chave: 'cara:1'});
      g.no('saida', new Ganho(2), {params: {ganho: 0.5}});
      g.ligar('src', 'cara');
      g.ligar('cara', 'saida');
      return g;
    };
    const cache = new Map<string, unknown>();
    const c1 = new Contador(2), c2 = new Contador(2);
    const a = executarOffline(monta(c1), {taxa: 48000, n, saida: 'saida', cache});
    const b = executarOffline(monta(c2), {taxa: 48000, n, saida: 'saida', cache});
    expect(c1.vezes).toBeGreaterThan(0);
    expect(c2.vezes).toBe(0);
    expect([...b.chavesUsadas]).toEqual(['cara:1']);
    expect(Array.from(b.canais[0])).toEqual(Array.from(a.canais[0]));
  });

  it('estado serializável: parar no meio, guardar em JSON, restaurar noutro e continuar dá o mesmo', () => {
    const n = 1000, meio = 437;
    const x = estereo(n, 13);
    const corrido = new Atraso(91);
    const out = [new Float32Array(n), new Float32Array(n)];
    corrido.processar([x], [out], n);
    const a = new Atraso(91);
    const parte = [new Float32Array(meio), new Float32Array(meio)];
    a.processar([x.map((c) => c.subarray(0, meio))], [parte], meio);
    const b = new Atraso(91);
    b.restaurar(JSON.parse(JSON.stringify(a.estado())) as EstadoProcessador);
    const resto = [new Float32Array(n - meio), new Float32Array(n - meio)];
    b.processar([x.map((c) => c.subarray(meio))], [resto], n - meio);
    expect(Array.from(resto[1])).toEqual(Array.from(out[1].subarray(meio)));
    b.resetar();
    expect(b.estado().k).toBe(0);
  });
});
