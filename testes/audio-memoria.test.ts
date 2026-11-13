// Memória do motor (M-04): fontes lidas por trecho, instrumentos e curvas por trecho iguais aos de buffer inteiro, o
// executor com armazém (memória e disco) e com a saída bloco a bloco, e o cache em disco com LRU. Tudo tem que dar o mesmo
// PCM: os hashes de referência da M0 continuam valendo. Ver docs/audio-grafo.md, "Memória".
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, truncateSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {armazemDeMemoria, fonteDeMemoria, fontePorTrechos} from '../src/nucleo/audio-grafo/amostras';
import {executarOffline} from '../src/nucleo/audio-grafo/executor';
import {Grafo} from '../src/nucleo/audio-grafo/grafo';
import {audioPorTrecho, bateriaPorTrecho, curvaDaAutomacao, curvaDoSidechain, sintetizadorPorTrecho} from '../src/nucleo/audio-grafo/instrumentos';
import {grafoDaMusica, renderizarMusicaGrafo} from '../src/nucleo/audio-grafo/musica';
import {Fonte, Ganho} from '../src/nucleo/audio-grafo/processadores';
import type {Processador} from '../src/nucleo/audio-grafo/tipos';
import {abrirWav} from '../src/nucleo/amostras-wav';
import {CacheAudioDisco, PASTA_CACHE_AUDIO, cacheAudioDoProjeto, tetoDoAmbiente, TETO_CACHE_AUDIO} from '../src/nucleo/cache-audio';
import {audiosDaMusica, resolverMusica, type DocMusica} from '../src/nucleo/musica';
import {hashDoPcm} from '../src/nucleo/musica-hash';
import {geradorDe, ganhoDaAutomacao, ganhoDoSidechain, renderAudio, renderBateria, renderSintetizador, TAXA_MUSICA} from '../src/nucleo/musica-som';
import {lerWav} from '../src/main/ffmpeg-som';
import type {FonteAudio} from '../src/nucleo/loudness';

const PASTA = path.join(__dirname, 'fixtures', 'musica-referencia');
const nomes = readdirSync(PASTA).filter((f) => f.endsWith('.json') && f !== 'hashes.json').map((f) => f.replace(/\.json$/, '')).sort();
const HASHES = JSON.parse(readFileSync(path.join(PASTA, 'hashes.json'), 'utf8')) as {musicas: Record<string, {pcm_sha256: string}>};
const lerDoc = (nome: string) => JSON.parse(readFileSync(path.join(PASTA, `${nome}.json`), 'utf8')) as DocMusica;
const fontesDe = (doc: DocMusica): Record<string, FonteAudio> =>
  Object.fromEntries(audiosDaMusica(doc).map((a) => [a, lerWav(readFileSync(path.join(PASTA, a)))]));

const pastas: string[] = [];
const pastaTemp = () => {
  const p = mkdtempSync(path.join(tmpdir(), 'estudio-cache-audio-'));
  pastas.push(p);
  return p;
};
afterAll(() => {
  for (const p of pastas) rmSync(p, {recursive: true, force: true});
});

const mesmoPcm = (a: readonly Float32Array[], b: readonly Float32Array[], onde: string) => {
  expect(a.length, `${onde}: canais`).toBe(b.length);
  for (let k = 0; k < a.length; k++) {
    expect(a[k].length, `${onde}: amostras`).toBe(b[k].length);
    const ua = new Uint32Array(a[k].buffer, a[k].byteOffset, a[k].length), ub = new Uint32Array(b[k].buffer, b[k].byteOffset, b[k].length);
    let i = 0;
    while (i < ua.length && ua[i] === ub[i]) i++;
    expect(i === ua.length ? 'igual' : `difere na amostra ${i}: ${a[k][i]} contra ${b[k][i]}`, `${onde}: canal ${k}`).toBe('igual');
  }
};

/** Junta um RenderTrecho em pedaços de tamanhos variados (1, 2, 3... e um grande no fim). */
const juntar = (fazer: (de: number, ate: number) => Float32Array[], n: number, tamanhos: number[]) => {
  const out = [new Float32Array(n), new Float32Array(n)];
  let i = 0, k = 0;
  while (i < n) {
    const ate = Math.min(n, i + tamanhos[k++ % tamanhos.length]);
    const t = fazer(i, ate);
    out[0].set(t[0], i);
    out[1].set(t[1], i);
    i = ate;
  }
  return out;
};

describe('fonte de amostras por trecho', () => {
  it('lê qualquer intervalo igual ao buffer inteiro, com silêncio fora, e só faz os trechos lidos', () => {
    const g = geradorDe(4);
    const n = 10_000;
    const inteiro = [Float32Array.from({length: n}, () => g()), Float32Array.from({length: n}, () => g())];
    const feitos: number[] = [];
    const f = fontePorTrechos({canais: 2, n, trecho: 777, fazer: (de, ate) => {
      feitos.push(de);
      return inteiro.map((c) => c.slice(de, ate));
    }});
    const m = fonteDeMemoria(inteiro);
    const a = [new Float32Array(3100), new Float32Array(3100)], b = [new Float32Array(3100), new Float32Array(3100)];
    for (const [ini, qtd] of [[-50, 100], [0, 1], [776, 2], [5000, 2999], [9990, 100], [-3000, 3000], [n, 10], [123, 2900]]) {
      a[0].fill(9); a[1].fill(9); b[0].fill(9); b[1].fill(9);
      f.ler(ini, qtd, a, 50);
      m.ler(ini, qtd, b, 50);
      mesmoPcm(a, b, `ler(${ini}, ${qtd})`);
      expect(a[0][49]).toBe(9); // não escreve antes do off
    }
    expect(new Set(feitos).size).toBeLessThan(Math.ceil(n / 777)); // só os trechos lidos
  });

  it('armazém na memória: LRU com teto em bytes', () => {
    const a = armazemDeMemoria(3 * 2 * 100 * 4);
    const um = (v: number) => [new Float32Array(100).fill(v), new Float32Array(100).fill(v)];
    for (const k of ['a', 'b', 'c']) {
      const gr = a.gravar(k, 2, 100)!;
      gr.escrever(um(1), 0, 60);
      gr.escrever(um(1), 60, 40);
      gr.concluir();
    }
    expect(a.abrir('a', 2, 100)).not.toBeNull(); // 'a' passa a ser o mais recente
    const gr = a.gravar('d', 2, 100)!;
    gr.escrever(um(2), 0, 100);
    gr.concluir();
    expect(a.chaves()).toEqual(['c', 'a', 'd']);
    expect(a.abrir('a', 2, 99)).toBeNull(); // outro tamanho não casa
    expect(a.gravar('grande', 2, 1000)).toBeNull();
  });
});

describe('instrumentos e curvas por trecho = buffer inteiro', () => {
  for (const nome of nomes) {
    it(`${nome}: cada canal, em pedaços de 1 amostra a 1 minuto`, () => {
      const doc = lerDoc(nome);
      const fontes = fontesDe(doc);
      const {musica: m} = resolverMusica(doc);
      const n = Math.ceil(m.duracao_s * TAXA_MUSICA);
      for (const canal of m.canais) {
        const antes = new Set<string>(), agora = new Set<string>();
        const inteiro = canal.tipo === 'bateria' ? renderBateria(m, canal, n, TAXA_MUSICA, new Map())
          : canal.tipo === 'sintetizador' ? renderSintetizador(m, canal, n, TAXA_MUSICA) : renderAudio(m, canal, n, TAXA_MUSICA, fontes, antes);
        const fazer = canal.tipo === 'bateria' ? bateriaPorTrecho(m, canal, n, TAXA_MUSICA, new Map())
          : canal.tipo === 'sintetizador' ? sintetizadorPorTrecho(m, canal, n, TAXA_MUSICA) : audioPorTrecho(m, canal, n, TAXA_MUSICA, fontes, agora);
        mesmoPcm(juntar(fazer, n, [1, 2, 3, 4096, 129, 48_000 * 60]), inteiro, `${nome}/${canal.id}`);
        expect([...agora]).toEqual([...antes]);
      }
    });
  }

  it('sidechain e automação: antes do começo, no meio e depois do fim', () => {
    const n = 50_000, taxa = TAXA_MUSICA;
    const disparos = [0, 0.1, 0.1005, 0.4, 0.9, 1.2];
    const sc = {quanto_db: 9, ataque_ms: 4, soltura_ms: 180};
    const pontos = [{s: 0.1, db: -6}, {s: 0.5, db: 2}, {s: 0.5, db: -20}, {s: 0.9, db: 0}];
    for (const [inteira, curva] of [[ganhoDoSidechain(disparos, sc, n, taxa), curvaDoSidechain(disparos, sc, n, taxa)],
      [ganhoDaAutomacao(pontos, n, taxa), curvaDaAutomacao(pontos, n, taxa)], [ganhoDaAutomacao([], n, taxa), curvaDaAutomacao([], n, taxa)]] as const) {
      const fn = curva as (i: number, q: number, o: Float32Array) => void;
      for (const [ini, qtd] of [[-300, 128], [0, 128], [-5, 10], [20_000, 7000], [49_990, 128], [60_000, 3], [13, 1], [0, n]]) {
        const out = new Float32Array(qtd);
        fn(ini, qtd, out);
        const esperado = Float32Array.from({length: qtd}, (_, i) => inteira[Math.min(n - 1, Math.max(0, ini + i))]);
        mesmoPcm([out], [esperado], `curva (${ini}, ${qtd})`);
      }
    }
  });
});

describe('render canônico com memória limitada', () => {
  it('os documentos de referência rodam num estágio só (nenhum efeito de buffer inteiro)', () => {
    for (const nome of nomes) {
      const doc = lerDoc(nome);
      const gm = grafoDaMusica(doc, fontesDe(doc));
      const r = executarOffline(gm.grafo, {taxa: gm.taxa, n: gm.n, saida: gm.saida});
      expect(r.estagios, nome).toBe(1);
    }
  });

  it('o tamanho do trecho dos canais não muda o hash de referência', () => {
    for (const nome of ['batida', 'sintetizadores-audio']) {
      const doc = lerDoc(nome);
      for (const trecho of [500, 48_000, 1 << 22]) expect(hashDoPcm(renderizarMusicaGrafo(doc, fontesDe(doc), {trecho}).canais), `${nome}, trecho ${trecho}`).toBe(HASHES.musicas[nome].pcm_sha256);
    }
  });

  it('armazém: o segundo render lê as faixas guardadas e dá o mesmo PCM, stems e retornos', () => {
    const doc = lerDoc('trilha-video');
    const fontes = fontesDe(doc);
    const armazem = armazemDeMemoria();
    const ref = renderizarMusicaGrafo(doc, fontes, {porFaixa: true});
    const a = renderizarMusicaGrafo(doc, fontes, {porFaixa: true, armazem});
    expect(armazem.chaves().length).toBeGreaterThan(2);
    const b = renderizarMusicaGrafo(doc, fontes, {porFaixa: true, armazem});
    for (const [r, onde] of [[a, 'gravando'], [b, 'lendo']] as const) {
      mesmoPcm(r.canais, ref.canais, `${onde}: mistura`);
      for (const id of Object.keys(ref.faixas!)) mesmoPcm(r.faixas![id], ref.faixas![id], `${onde}: faixa ${id}`);
      for (const k of Object.keys(ref.retornos!) as ('reverb' | 'delay')[]) mesmoPcm(r.retornos![k]!, ref.retornos![k]!, `${onde}: retorno ${k}`);
      expect(r.limitador_db).toBe(ref.limitador_db);
    }
    expect(hashDoPcm(b.canais)).toBe(HASHES.musicas['trilha-video'].pcm_sha256);
    // mudar o volume de uma faixa só refaz aquela (e os retornos para onde ela manda)
    const d2 = structuredClone(doc) as DocMusica & {mixer: {faixas: {volume_db?: number}[]}};
    d2.mixer.faixas[0].volume_db = (d2.mixer.faixas[0].volume_db ?? 0) - 3;
    const gm = grafoDaMusica(d2, fontes);
    const r = executarOffline(gm.grafo, {taxa: gm.taxa, n: gm.n, saida: gm.saida, armazem});
    expect(r.armazem.lidas.length).toBeGreaterThan(0);
    expect(r.armazem.gravadas.length).toBeGreaterThan(0);
    mesmoPcm(r.canais, renderizarMusicaGrafo(d2, fontes).canais, 'volume mudado');
  });

  it('saída bloco a bloco (aoBloco): o mesmo PCM, sem juntar a mistura', () => {
    const doc = lerDoc('delay-limitador');
    const fontes = fontesDe(doc);
    const ref = renderizarMusicaGrafo(doc, fontes);
    for (const armazem of [undefined, armazemDeMemoria()]) {
      for (let vez = 0; vez < 2; vez++) {
        const gm = grafoDaMusica(doc, fontes);
        const junto = [new Float32Array(gm.n), new Float32Array(gm.n)];
        let proximo = 0;
        const r = executarOffline(gm.grafo, {taxa: gm.taxa, n: gm.n, saida: gm.saida, armazem, aoBloco: (c, ini, qtd) => {
          expect(ini).toBe(proximo);
          proximo += qtd;
          junto[0].set(c[0].subarray(0, qtd), ini);
          junto[1].set(c[1].subarray(0, qtd), ini);
        }});
        expect(r.canais).toEqual([]);
        expect(proximo).toBe(gm.n);
        mesmoPcm(junto, ref.canais, `aoBloco${armazem ? ' com armazém' : ''}, vez ${vez}`);
      }
    }
  });

  it('um render que falha não deixa nada guardado pela metade', () => {
    class Quebra implements Processador {
      readonly tipo = 'quebra';
      readonly entradas = [1];
      readonly saidas = [1];
      readonly latencia = 0;
      vezes = 0;
      preparar() {}
      processar(e: readonly (readonly Float32Array[])[], s: readonly Float32Array[][], n: number) {
        if (++this.vezes > 3) throw new Error('quebrou');
        s[0][0].set(e[0][0].subarray(0, n));
      }
      resetar() {}
      estado() {
        return {};
      }
      restaurar() {}
    }
    const pasta = pastaTemp();
    const disco = new CacheAudioDisco(pasta, {teto_bytes: 1e9});
    const g = new Grafo();
    g.no('src', new Fonte([new Float32Array(5000).fill(0.5)]));
    g.no('meio', new Ganho(1), {params: {ganho: 0.5}, chave: 'meio:1'});
    g.no('q', new Quebra());
    g.ligar('src', 'meio');
    g.ligar('meio', 'q');
    expect(() => executarOffline(g, {taxa: 48000, n: 5000, saida: 'q', armazem: disco})).toThrow('quebrou');
    expect(readdirSync(pasta)).toEqual([]);
  });
});

describe('cache de áudio em disco', () => {
  it('guarda, lê por trecho e dá o hash de referência; o segundo render não refaz as faixas', () => {
    const raiz = pastaTemp();
    const disco = cacheAudioDoProjeto(raiz, {teto_bytes: 1e9});
    expect(disco.pasta).toBe(path.join(raiz, PASTA_CACHE_AUDIO));
    for (const nome of nomes) {
      const doc = lerDoc(nome);
      const fontes = fontesDe(doc);
      for (let vez = 0; vez < 2; vez++) {
        const gm = grafoDaMusica(doc, fontes);
        const r = executarOffline(gm.grafo, {taxa: gm.taxa, n: gm.n, saida: gm.saida, armazem: disco});
        expect(hashDoPcm(r.canais), `${nome}, vez ${vez}`).toBe(HASHES.musicas[nome].pcm_sha256);
        if (vez === 0) expect(r.armazem.lidas, nome).toEqual([]);
        else {
          expect(r.armazem.gravadas, nome).toEqual([]);
          expect(r.armazem.lidas.length, nome).toBeGreaterThan(0);
        }
      }
    }
    expect(readdirSync(disco.pasta).every((f) => f.endsWith('.f32'))).toBe(true);
  });

  it('LRU: passou do teto, sai o usado há mais tempo; ler renova a vez', () => {
    const pasta = pastaTemp();
    const um = 2 * 10_000 * 4 + 16;
    const disco = new CacheAudioDisco(pasta, {teto_bytes: 3 * um + 10});
    const guardar = (k: string, v: number) => {
      const gr = disco.gravar(k, 2, 10_000)!;
      const x = [new Float32Array(10_000).fill(v), new Float32Array(10_000).fill(-v)];
      for (let i = 0; i < 10_000; i += 128) gr.escrever(x, i, Math.min(128, 10_000 - i), i);
      gr.concluir();
    };
    const antigo = (k: string, s: number) => utimesSync(disco.arquivo(k), new Date(Date.now() - s * 1000), new Date(Date.now() - s * 1000));
    guardar('a', 1);
    antigo('a', 30);
    guardar('b', 2);
    antigo('b', 20);
    guardar('c', 3);
    antigo('c', 10);
    const f = disco.abrir('a', 2, 10_000)!; // 'a' vira o mais recente
    const buf = [new Float32Array(300), new Float32Array(300)];
    f.ler(9_900, 300, buf);
    f.fechar!();
    expect([buf[0][0], buf[1][99], buf[0][100]]).toEqual([1, -1, 0]);
    guardar('d', 4);
    expect(existsSync(disco.arquivo('b'))).toBe(false);
    expect(['a', 'c', 'd'].every((k) => existsSync(disco.arquivo(k)))).toBe(true);
    expect(disco.bytes()).toBeLessThanOrEqual(disco.teto);
    // um item maior que metade do teto não entra; outro tamanho e arquivo cortado não casam
    expect(disco.gravar('grande', 2, 30_000)).toBeNull();
    expect(disco.abrir('a', 2, 9_999)).toBeNull();
    truncateSync(disco.arquivo('c'), 1000);
    expect(disco.abrir('c', 2, 10_000)).toBeNull();
    disco.limpar();
    expect(disco.bytes()).toBe(0);
  });

  it('teto pelo ambiente (ESTUDIO_CACHE_AUDIO_MB; 0 desliga) e .tmp esquecido sai', () => {
    expect(tetoDoAmbiente({})).toBe(TETO_CACHE_AUDIO);
    expect(tetoDoAmbiente({ESTUDIO_CACHE_AUDIO_MB: '512'})).toBe(512 * 1024 ** 2);
    expect(tetoDoAmbiente({ESTUDIO_CACHE_AUDIO_MB: 'x'})).toBe(TETO_CACHE_AUDIO);
    const pasta = pastaTemp();
    const desligado = new CacheAudioDisco(pasta, {teto_bytes: 0});
    expect(desligado.gravar('a', 2, 10)).toBeNull();
    const disco = new CacheAudioDisco(pasta, {teto_bytes: 1e6});
    const velho = path.join(pasta, 'x.f32.123.abc.tmp');
    writeFileSync(velho, 'x');
    utimesSync(velho, new Date(Date.now() - 2 * 86400_000), new Date(Date.now() - 2 * 86400_000));
    disco.aparar();
    expect(existsSync(velho)).toBe(false);
    expect(statSync(pasta).isDirectory()).toBe(true);
  });
});

describe('WAV lido por trecho (base do sampler)', () => {
  /** Um WAV com `nc` canais em `bits` (formato 1 = PCM, 3 = float; extensível opcional) e um bloco "LIST" antes do "data". */
  const wav = (nc: number, n: number, bits: number, formato: 1 | 3, extensivel = false) => {
    const g = geradorDe(bits + nc);
    const bpa = bits / 8, dados = n * nc * bpa;
    const fmtTam = extensivel ? 40 : 16;
    const b = Buffer.alloc(12 + 8 + fmtTam + 8 + 6 + 8 + dados);
    b.write('RIFF', 0, 'ascii');
    b.writeUInt32LE(b.length - 8, 4);
    b.write('WAVE', 8, 'ascii');
    let p = 12;
    b.write('fmt ', p, 'ascii');
    b.writeUInt32LE(fmtTam, p + 4);
    b.writeUInt16LE(extensivel ? 0xfffe : formato, p + 8);
    b.writeUInt16LE(nc, p + 10);
    b.writeUInt32LE(44100, p + 12);
    b.writeUInt16LE(bits, p + 22);
    if (extensivel) b.writeUInt16LE(formato, p + 8 + 24);
    p += 8 + fmtTam;
    b.write('LIST', p, 'ascii');
    b.writeUInt32LE(6, p + 4);
    p += 14;
    b.write('data', p, 'ascii');
    b.writeUInt32LE(dados, p + 4);
    p += 8;
    for (let i = 0; i < n * nc; i++, p += bpa) {
      const x = g() * 0.999;
      if (formato === 3) b.writeFloatLE(x, p);
      else if (bits === 16) b.writeInt16LE(Math.round(x * 32767), p);
      else if (bits === 24) b.writeIntLE(Math.round(x * 8388607), p, 3);
      else b.writeInt32LE(Math.round(x * 2147483647), p);
    }
    return b;
  };

  it('dá os mesmos valores do lerWav em 16, 24 e 32 bits, float e extensível, lendo só o que se pede', () => {
    const pasta = pastaTemp();
    const casos = [[2, 16, 1, false], [1, 24, 1, false], [2, 32, 1, true], [3, 32, 3, false], [2, 32, 3, true]] as const;
    for (const [nc, bits, formato, ext] of casos) {
      const arq = path.join(pasta, `t-${nc}-${bits}-${formato}-${ext}.wav`);
      writeFileSync(arq, wav(nc, 5000, bits, formato, ext));
      const inteiro = lerWav(readFileSync(arq));
      const f = abrirWav(arq, {trecho: 1000});
      expect([f.canais, f.n, f.taxa, f.bits]).toEqual([nc, 5000, 44100, bits]);
      const juntos = Array.from({length: nc}, () => new Float32Array(5000));
      for (let i = 0; i < 5000; i += 333) f.ler(i, Math.min(333, 5000 - i), juntos, i);
      mesmoPcm(juntos, inteiro.canais, `${bits} bits, formato ${formato}${ext ? ', extensível' : ''}`);
      const fora = Array.from({length: nc}, () => new Float32Array(10).fill(7));
      f.ler(4995, 10, fora);
      expect(Array.from(fora[0].subarray(5))).toEqual([0, 0, 0, 0, 0]);
      f.fechar!();
      expect(() => f.ler(0, 1, fora)).toThrow();
    }
    writeFileSync(path.join(pasta, 'nao.wav'), 'isto não é um wav');
    expect(() => abrirWav(path.join(pasta, 'nao.wav'))).toThrow('não é um WAV');
  });
});
