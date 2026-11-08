// Dividir, copiar e crossfade de clipes de áudio (src/nucleo/clipes-audio.ts). O critério da divisão é medido em amostras:
// a mistura que o render faria (o mesmo posicionamento por quadro do VideoCenas e do loudness.ts) das duas metades,
// menos a do clipe inteiro, fica abaixo de −60 dB. O do crossfade, também: no meio, a soma fica a ±1 dB do nível de antes.
import jsonpatch, {type Operation} from 'fast-json-patch';
import {describe, expect, it} from 'vitest';
import {dbDeGanho, ganhoDaCurva, JANELA_MS, nivelDeReferencia, resolverAudio, volumeDoClipe, type ClipeAudio, type CurvaFade, type Envelope} from '../src/nucleo/audio';
import {novoDocCenas, resolverCenas, type DocCenas} from '../src/nucleo/cenas';
import {acharClipe, copiarClipe, crossfadeEntre, dividirClipe, EFEITO_ABAIXO_DA_VOZ_LU, nivelDaVoz, recusou, volumeDoEfeito, type Copia, type Crossfade, type Divisao} from '../src/nucleo/clipes-audio';
import type {LegendasCenas} from '../src/nucleo/legendas';

const TAXA = 48000;
const FPS = 30;

const gerador = (semente: number) => {
  let x = semente >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 0xffffffff - 0.5;
  };
};
const ruido = (segundos: number, semente: number, amplitude = 0.4) => {
  const r = gerador(semente);
  const out = new Float32Array(Math.round(segundos * TAXA));
  for (let i = 0; i < out.length; i++) out[i] = r() * 2 * amplitude;
  return out;
};

const doc = (clipes: ClipeAudio[], legendas?: LegendasCenas, papel: 'voz' | 'musica' = 'voz'): DocCenas => ({
  ...novoDocCenas({largura: 720, altura: 1280, fps: FPS}),
  cenas: [{id: 'c1', duracao_ms: 16000, blocos: []}],
  audio: {faixas: [{id: papel === 'voz' ? 'narracao' : 'musica', nome: papel === 'voz' ? 'Narração' : 'Música', papel, clipes}]},
  ...(legendas ? {legendas} : {}),
});

const aplicar = (d: DocCenas, patch: Operation[] | unknown[]): DocCenas => jsonpatch.applyPatch(structuredClone(d), patch as Operation[], true, false).newDocument;

/** A mistura mono que o render faria: cada clipe no quadro mais perto de `em`, pulando `corte_ms` em quadros, com o volume
 *  de cada quadro (volumeDoClipe) lido no quadro mais perto: a conta do VideoCenas e do medirMistura (loudness.ts). */
const mixar = (d: DocCenas, fontes: Record<string, Float32Array>, duracao_ms = 12000) => {
  const {audio} = resolverAudio(d.audio, duracao_ms);
  const q = (ms: number) => Math.round((ms / 1000) * FPS);
  const total = Math.round((q(duracao_ms) / FPS) * TAXA);
  const out = new Float32Array(total);
  for (const f of audio!.faixas) {
    if (f.mudo) continue;
    for (const c of f.clipes) {
      if (c.mudo || c.fora) continue;
      const de = q(c.em);
      const dur = Math.max(1, q(c.em + c.duracao_ms) - de);
      const ini = Math.round((de / FPS) * TAXA);
      const corte = Math.round((q(c.corte_ms) / FPS) * TAXA);
      const fim = Math.min(total, Math.round(((de + dur) / FPS) * TAXA));
      const fonte = fontes[c.arquivo];
      for (let s = ini; s < fim && corte + (s - ini) < fonte.length; s++) {
        const qd = Math.round(((s - ini) / TAXA) * FPS);
        out[s] += fonte[corte + (s - ini)] * volumeDoClipe(f, c, (qd / FPS) * 1000);
      }
    }
  }
  return out;
};

const rms = (x: Float32Array, de_ms: number, ate_ms: number) => {
  const a = Math.round((de_ms / 1000) * TAXA);
  const b = Math.round((ate_ms / 1000) * TAXA);
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
};
const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-12));
/** Diferença entre duas misturas, em dB abaixo da primeira (negativo: a diferença é menor). */
const diferencaDb = (a: Float32Array, b: Float32Array) => {
  const dif = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) dif[i] = a[i] - b[i];
  return db(rms(dif, 0, 12000)) - db(rms(a, 0, 12000));
};

/** MEDIR=1 npx vitest run testes/clipes-audio.test.ts imprime os números que as notas citam. */
const mostrar = (...a: unknown[]) => {
  if (process.env.MEDIR) console.info('[medida]', ...a);
};

const ok = <T,>(x: T | {erro: string}): T => {
  if (recusou(x)) throw new Error(x.erro);
  return x as T;
};

describe('dividir clipe de áudio', () => {
  const narracao = ruido(6, 11);
  const clipe = (extra: Partial<ClipeAudio> = {}): ClipeAudio => ({id: 'n1', arquivo: 'midia/narracao.wav', em: 500, corte_ms: 710, duracao_ms: 4000, ...extra});

  it('as duas metades somadas menos o clipe inteiro ficam abaixo de −60 dB, com o começo e o corte fora da grade de quadros', () => {
    const antes = doc([clipe()]);
    const r = ok<Divisao>(dividirClipe(antes, 'n1', 1537));
    const depois = aplicar(antes, r.patch);
    const inteiro = mixar(antes, {'midia/narracao.wav': narracao});
    const metades = mixar(depois, {'midia/narracao.wav': narracao});
    mostrar('dividir: metades − inteiro =', diferencaDb(inteiro, metades).toFixed(1), 'dB');
    expect(diferencaDb(inteiro, metades)).toBeLessThan(-60);
    // o corte é um número inteiro de quadros depois do começo do clipe (31 quadros = 1033,333 ms)
    expect(r.primeiro.duracao_ms).toBeCloseTo(31 * (1000 / FPS), 2);
    expect(r.segundo.em).toBeCloseTo(500 + 31 * (1000 / FPS), 2);
    expect(r.segundo.corte_ms).toBeCloseTo(710 + 31 * (1000 / FPS), 2);
    expect(r.primeiro.duracao_ms + r.segundo.duracao_ms).toBeCloseTo(4000, 2);
    expect(depois.audio!.faixas[0].clipes.map((c) => c.id)).toEqual(['n1', 'n1-1']);
  });

  it('o mesmo com fade de entrada e de saída, cada um dentro da sua metade', () => {
    const antes = doc([clipe({fade_in_ms: 300, fade_out_ms: 400, volume: 0.8})]);
    const r = ok<Divisao>(dividirClipe(antes, 'n1', 2480));
    const depois = aplicar(antes, r.patch);
    expect(r.avisos).toEqual([]);
    expect(r.primeiro.fade_in_ms).toBe(300);
    expect(r.primeiro.fade_out_ms).toBeUndefined();
    expect(r.segundo.fade_in_ms).toBeUndefined();
    expect(r.segundo.fade_out_ms).toBe(400);
    expect(diferencaDb(mixar(antes, {'midia/narracao.wav': narracao}), mixar(depois, {'midia/narracao.wav': narracao}))).toBeLessThan(-60);
  });

  it('o controle do teste: um corte em ms, fora da grade, deixa a soma longe do original', () => {
    const antes = doc([clipe()]);
    // 31,4 quadros depois do começo: o quadro de entrada arredonda para baixo e o do corte do arquivo, para cima
    const d = 31.4 * (1000 / FPS);
    const torta = doc([clipe({duracao_ms: d}), clipe({id: 'n2', em: 500 + d, corte_ms: 710 + d, duracao_ms: 4000 - d})]);
    const longe = diferencaDb(mixar(antes, {'midia/narracao.wav': narracao}), mixar(torta, {'midia/narracao.wav': narracao}));
    mostrar('dividir fora da grade: metades − inteiro =', longe.toFixed(1), 'dB');
    expect(longe).toBeGreaterThan(-40);
  });

  it('a segunda metade leva volume, mudo e a voz limpa com o que ela mediu', () => {
    const limpeza = {intensidade: 'media' as const, ruido_antes_db: -50, ruido_depois_db: -62, voz_antes_db: -20, voz_depois_db: -20.5};
    const antes = doc([clipe({volume: 0.6, arquivo: 'midia/narracao.wav.limpo.wav', original: 'midia/narracao.wav', limpeza, nome: 'Tomada 2'})]);
    const r = ok<Divisao>(dividirClipe(antes, 'n1', 2000));
    expect(r.segundo).toMatchObject({volume: 0.6, arquivo: 'midia/narracao.wav.limpo.wav', original: 'midia/narracao.wav', limpeza, nome: 'Tomada 2'});
    expect(r.primeiro).toMatchObject({volume: 0.6, original: 'midia/narracao.wav', limpeza});
  });

  it('recusa o corte fora do clipe ou a menos de 100 ms de uma ponta, e o clipe que não existe', () => {
    const antes = doc([clipe()]);
    expect(recusou(dividirClipe(antes, 'n1', 530))).toBe(true);
    expect(recusou(dividirClipe(antes, 'n1', 4450))).toBe(true);
    expect(recusou(dividirClipe(antes, 'n1', 9000))).toBe(true);
    expect(recusou(dividirClipe(antes, 'n9', 2000))).toBe(true);
    expect(recusou(dividirClipe(antes, 'n1', NaN))).toBe(true);
  });

  it('avisa quando o fade passa do corte', () => {
    const r = ok<Divisao>(dividirClipe(doc([clipe({fade_in_ms: 1500})]), 'n1', 1000));
    expect(r.avisos.join(' ')).toMatch(/fade de entrada/);
  });

  it('a divisão desfaz: o inverso do patch devolve o documento de antes', () => {
    const antes = doc([clipe()]);
    const r = ok<Divisao>(dividirClipe(antes, 'n1', 2000));
    const depois = aplicar(antes, r.patch);
    expect(acharClipe(depois, 'n1-1')).not.toBeNull();
    // remover a segunda metade e restaurar o primeiro clipe é o que o diário guarda como inverso
    const volta = aplicar(depois, [{op: 'remove', path: r.caminho_segundo}, {op: 'replace', path: '/audio/faixas/0/clipes/0', value: antes.audio!.faixas[0].clipes[0]}]);
    expect(volta).toEqual(antes);
  });
});

describe('dividir e copiar levam as legendas do clipe', () => {
  const palavras = (lista: [string, number, number][]) => lista.map(([w, s, e]) => ({w, s, e}));
  const legendas = (): LegendasCenas => ({
    segmentos: [
      {id: 'leg-1', em: 1000, sai: 2200, texto: 'Olá a todos', clipe: 'n1', palavras: palavras([['Olá', 1000, 1400], ['a', 1400, 1500], ['todos', 1600, 2200]])},
      {id: 'leg-2', em: 2800, sai: 4200, texto: 'o FGTS é um direito', clipe: 'n1', palavras: palavras([['o', 2800, 2900], ['FGTS', 2950, 3400], ['é', 3500, 3600], ['um', 3700, 3900], ['direito', 3950, 4200]])},
      {id: 'leg-3', em: 5000, sai: 6500, texto: 'Fim da explicação', clipe: 'n1', palavras: palavras([['Fim', 5000, 5300], ['da', 5300, 5500], ['explicação', 5600, 6500]])},
      {id: 'leg-4', em: 100, sai: 900, texto: 'Importada à mão'},
    ],
    origens: [{clipe: 'n1', arquivo: 'midia/narracao.wav', palavras: 'midia/narracao.wav.palavras.json', em: 1000, corte_ms: 500}],
  });
  const base = () => doc([{id: 'n1', arquivo: 'midia/narracao.wav', em: 1000, corte_ms: 500, duracao_ms: 6000}], legendas());
  const naTela = (d: DocCenas) => (resolverCenas(d).props.legendas_cenas?.segmentos ?? []).map((s) => ({texto: s.texto, palavras: s.palavras.map((p): [string, number, number] => [p.w, p.s, p.e])}));
  const palavrasNaTela = (d: DocCenas) => naTela(d).flatMap((s) => s.palavras);

  it('dividir: as legendas na tela são as mesmas palavras nos mesmos tempos, e a que o corte atravessa é partida na palavra do corte', () => {
    const antes = base();
    const r = ok<Divisao>(dividirClipe(antes, 'n1', 3500));
    const depois = aplicar(antes, r.patch);
    expect(palavrasNaTela(depois)).toEqual(palavrasNaTela(antes));
    expect(r.legendas).toEqual({levadas_ao_segundo: 1, partidas: 1});
    const por = depois.legendas!.segmentos;
    expect(por.map((s) => [s.id, s.texto, s.clipe])).toEqual([
      ['leg-1', 'Olá a todos', 'n1'], ['leg-2', 'o FGTS', 'n1'], ['leg-5', 'é um direito', 'n1-1'], ['leg-3', 'Fim da explicação', 'n1-1'], ['leg-4', 'Importada à mão', undefined],
    ]);
    expect(depois.legendas!.origens!.map((o) => o.clipe)).toEqual(['n1', 'n1-1']);
    expect(depois.legendas!.origens![1]).toMatchObject({em: 1000, corte_ms: 500, arquivo: 'midia/narracao.wav'});
  });

  it('dividir: a segunda metade, movida 2 s adiante, leva as legendas dela e deixa as da primeira', () => {
    const antes = base();
    const depois = aplicar(antes, ok<Divisao>(dividirClipe(antes, 'n1', 3500)).patch);
    const movido = aplicar(depois, [{op: 'replace', path: '/audio/faixas/0/clipes/1/em', value: ok<Divisao>(dividirClipe(antes, 'n1', 3500)).segundo.em + 2000}]);
    const antesPal = palavrasNaTela(depois);
    const depoisPal = palavrasNaTela(movido);
    expect(depoisPal.filter((p) => p[1] < 3500)).toEqual(antesPal.filter((p) => (p[1] as number) < 3500));
    const daSegunda = antesPal.filter((p) => (p[1] as number) >= 3500).map((p) => [p[0], (p[1] as number) + 2000, (p[2] as number) + 2000]);
    expect(depoisPal.filter((p) => (p[1] as number) >= 3500)).toEqual(daSegunda);
  });

  it('dividir um clipe sem legendas não toca nas legendas', () => {
    const d = doc([{id: 'n1', arquivo: 'midia/narracao.wav', em: 0, duracao_ms: 4000}]);
    const r = ok<Divisao>(dividirClipe(d, 'n1', 2000));
    expect(r.patch.some((o) => o.path.startsWith('/legendas'))).toBe(false);
  });

  it('copiar: a cópia traz as legendas, deslocadas, e anda com a cópia', () => {
    const antes = base();
    const r = ok<Copia>(copiarClipe(antes, 'n1'));
    const depois = aplicar(antes, r.patch);
    expect(r.copia.em).toBe(7000);
    expect(r.legendas_copiadas).toBe(3);
    const original = palavrasNaTela(antes);
    const doClipe = original.filter((p) => (p[1] as number) >= 1000);
    const todas = palavrasNaTela(depois);
    expect(todas.filter((p) => (p[1] as number) < 7000)).toEqual(original);
    expect(todas.filter((p) => (p[1] as number) >= 7000)).toEqual(doClipe.map((p) => [p[0], (p[1] as number) + 6000, (p[2] as number) + 6000]));
    expect(depois.legendas!.segmentos).toHaveLength(7);
    // mover a cópia 1 s para a frente leva as legendas dela
    const movida = aplicar(depois, [{op: 'replace', path: '/audio/faixas/0/clipes/1/em', value: 8000}]);
    expect(palavrasNaTela(movida).filter((p) => (p[1] as number) >= 7000)).toEqual(doClipe.map((p) => [p[0], (p[1] as number) + 7000, (p[2] as number) + 7000]));
  });

  it('copiar para outro tempo e copiar clipe sem legendas', () => {
    const r = ok<Copia>(copiarClipe(base(), 'n1', {em_ms: 9000}));
    expect(r.copia.em).toBe(9000);
    const sem = ok<Copia>(copiarClipe(doc([{id: 'n1', arquivo: 'midia/narracao.wav', em: 0, duracao_ms: 4000}]), 'n1'));
    expect(sem.patch.some((o) => o.path.startsWith('/legendas'))).toBe(false);
    expect(sem.copia).toMatchObject({id: 'n1-1', em: 4000});
    expect(recusou(copiarClipe(base(), 'n1', {em_ms: -5}))).toBe(true);
    expect(recusou(copiarClipe(base(), 'nao-existe'))).toBe(true);
  });
});

describe('curvas de fade', () => {
  it('linear e suave somam ganho 1 nos dois lados do crossfade; potência soma potência 1', () => {
    for (let u = 0; u <= 1.0001; u += 0.05) {
      expect(ganhoDaCurva('linear', u) + ganhoDaCurva('linear', 1 - u)).toBeCloseTo(1, 9);
      expect(ganhoDaCurva('suave', u) + ganhoDaCurva('suave', 1 - u)).toBeCloseTo(1, 9);
      expect(ganhoDaCurva('potencia', u) ** 2 + ganhoDaCurva('potencia', 1 - u) ** 2).toBeCloseTo(1, 9);
    }
    for (const c of ['linear', 'suave', 'potencia'] as CurvaFade[]) {
      expect(ganhoDaCurva(c, 0)).toBeCloseTo(0, 9);
      expect(ganhoDaCurva(c, 1)).toBeCloseTo(1, 9);
    }
    expect(ganhoDaCurva('potencia', 0.5)).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it('o resolvedor repassa a curva do clipe, e o clipe sem curva continua linear', () => {
    const d = doc([{id: 'a', arquivo: 'midia/a.wav', em: 0, duracao_ms: 2000, fade_out_ms: 1000, fade_out_curva: 'potencia'}, {id: 'b', arquivo: 'midia/b.wav', em: 0, duracao_ms: 2000, fade_out_ms: 1000}], undefined, 'musica');
    const {audio} = resolverAudio(d.audio, 12000);
    const [a, b] = audio!.faixas[0].clipes;
    expect(a.fade_out_curva).toBe('potencia');
    expect(b.fade_out_curva).toBeUndefined();
    expect(volumeDoClipe(audio!.faixas[0], a, 1500)).toBeCloseTo(Math.sin((0.5 * Math.PI) / 2), 6);
    expect(volumeDoClipe(audio!.faixas[0], b, 1500)).toBeCloseTo(0.5, 6);
  });
});

describe('crossfade', () => {
  const A = ruido(10, 21);
  const B = ruido(9, 22);
  const fontes = {'midia/a.wav': A, 'midia/b.wav': B};
  const duracoes = {'midia/a.wav': 10000, 'midia/b.wav': 9000};
  const musica = (extra: Partial<ClipeAudio> = {}) => doc([
    {id: 'a', arquivo: 'midia/a.wav', em: 0, duracao_ms: 6000},
    {id: 'b', arquivo: 'midia/b.wav', em: 6000, corte_ms: 3000, duracao_ms: 6000, ...extra},
  ], undefined, 'musica');

  it('potência igual: no meio da sobreposição o nível fica a ±1 dB do de antes, e a linear cai uns 3 dB', () => {
    const antes = musica();
    const r = ok<Crossfade>(crossfadeEntre(antes, {de: 'a', para: 'b', duracao_ms: 2000}, duracoes));
    expect(r.curva).toBe('potencia'); // padrão da faixa de música
    const depois = aplicar(antes, r.patch);
    const mix = mixar(depois, fontes);
    const nivel = db(rms(mix, 4000, 5000)); // só a primeira música
    for (const [de, ate] of [[6400, 6600], [6900, 7100], [7400, 7600]]) {
      mostrar(`crossfade potência ${de}–${ate} ms:`, (db(rms(mix, de, ate)) - nivel).toFixed(2), 'dB');
      expect(Math.abs(db(rms(mix, de, ate)) - nivel)).toBeLessThan(1);
    }
    const linear = aplicar(antes, ok<Crossfade>(crossfadeEntre(antes, {de: 'a', para: 'b', duracao_ms: 2000, curva: 'linear'}, duracoes)).patch);
    mostrar('crossfade linear no meio:', (db(rms(mixar(linear, fontes), 6900, 7100)) - nivel).toFixed(2), 'dB');
    expect(db(rms(mixar(linear, fontes), 6900, 7100)) - nivel).toBeLessThan(-2.5);
  });

  it('estender usa a sobra do arquivo e não mexe no resto; o segundo clipe segue no mesmo lugar', () => {
    const r = ok<Crossfade>(crossfadeEntre(musica(), {de: 'a', para: 'b', duracao_ms: 2000, modo: 'estender'}, duracoes));
    expect(r.de).toMatchObject({em: 0, duracao_ms: 8000, fade_out_ms: 2000, fade_out_curva: 'potencia'});
    expect(r.para).toMatchObject({em: 6000, corte_ms: 3000, duracao_ms: 6000, fade_in_ms: 2000, fade_in_curva: 'potencia'});
  });

  it('estender também usa o começo do segundo clipe, quando a cauda do primeiro não chega', () => {
    const r = ok<Crossfade>(crossfadeEntre(musica(), {de: 'a', para: 'b', duracao_ms: 2000, modo: 'estender'}, {'midia/a.wav': 7000, 'midia/b.wav': 9000}));
    expect(r.de.duracao_ms).toBe(7000);
    expect(r.para).toMatchObject({em: 5000, corte_ms: 2000, duracao_ms: 7000});
    expect(r.mudancas).toHaveLength(2);
  });

  it('sobrepor puxa o segundo clipe para trás; auto cai nisso quando o arquivo não tem sobra', () => {
    const r = ok<Crossfade>(crossfadeEntre(musica({corte_ms: 0}), {de: 'a', para: 'b', duracao_ms: 1500, modo: 'sobrepor'}));
    expect(r.para).toMatchObject({em: 4500, corte_ms: 0, duracao_ms: 6000, fade_in_ms: 1500});
    expect(r.de.duracao_ms).toBe(6000);
    const auto = ok<Crossfade>(crossfadeEntre(musica({corte_ms: 0}), {de: 'a', para: 'b', duracao_ms: 1500}, {'midia/a.wav': 6000, 'midia/b.wav': 9000}));
    expect(auto.para.em).toBe(4500);
    expect(auto.mudancas.join(' ')).toMatch(/não havia som sobrando/);
    const estrito = crossfadeEntre(musica({corte_ms: 0}), {de: 'a', para: 'b', duracao_ms: 1500, modo: 'estender'}, {'midia/a.wav': 6000, 'midia/b.wav': 9000});
    expect(recusou(estrito)).toBe(true);
  });

  it('clipes que já se sobrepõem mais do que o pedido: o primeiro encurta, o segundo fica', () => {
    const d = doc([{id: 'a', arquivo: 'midia/a.wav', em: 0, duracao_ms: 6000}, {id: 'b', arquivo: 'midia/b.wav', em: 4000, duracao_ms: 5000}], undefined, 'musica');
    const r = ok<Crossfade>(crossfadeEntre(d, {de: 'a', para: 'b', duracao_ms: 1000}));
    expect(r.de.duracao_ms).toBe(5000);
    expect(r.para.em).toBe(4000);
  });

  it('a ordem dos ids não importa, a linear não grava curva, e a voz usa linear por padrão', () => {
    const r = ok<Crossfade>(crossfadeEntre(musica(), {de: 'b', para: 'a', duracao_ms: 2000, curva: 'linear'}, duracoes));
    expect(r.de.id).toBe('a');
    expect(r.de.fade_out_curva).toBeUndefined();
    const voz = doc([{id: 'a', arquivo: 'midia/a.wav', em: 0, duracao_ms: 6000}, {id: 'b', arquivo: 'midia/b.wav', em: 6000, corte_ms: 3000, duracao_ms: 6000}], undefined, 'voz');
    expect(ok<Crossfade>(crossfadeEntre(voz, {de: 'a', para: 'b', duracao_ms: 500}, duracoes)).curva).toBe('linear');
  });

  it('recusa clipes de faixas diferentes, o mesmo clipe, tempo curto ou longo demais e curva desconhecida', () => {
    const d = musica();
    d.audio!.faixas.push({id: 'efeitos', nome: 'Efeitos', papel: 'efeitos', clipes: [{id: 'e', arquivo: 'midia/e.wav', em: 0, duracao_ms: 1000}]});
    expect(recusou(crossfadeEntre(d, {de: 'a', para: 'e', duracao_ms: 500}))).toBe(true);
    expect(recusou(crossfadeEntre(d, {de: 'a', para: 'a', duracao_ms: 500}))).toBe(true);
    expect(recusou(crossfadeEntre(d, {de: 'a', para: 'b', duracao_ms: 10}))).toBe(true);
    expect(recusou(crossfadeEntre(d, {de: 'a', para: 'b', duracao_ms: 7000}, duracoes))).toBe(true);
    expect(recusou(crossfadeEntre(d, {de: 'a', para: 'b', duracao_ms: 500, curva: 'estranha' as CurvaFade}))).toBe(true);
    expect(recusou(crossfadeEntre(d, {de: 'a', para: 'nao-existe', duracao_ms: 500}))).toBe(true);
  });
});

describe('efeito na medida da casa (som-D4) e música sobre música (som-D7)', () => {
  const env = (duracao_ms: number, nivel: number): Envelope => ({versao: 2, janela_ms: JANELA_MS, duracao_ms, db: new Array(Math.ceil(duracao_ms / JANELA_MS)).fill(nivel)});

  it('som-D4: o efeito entra com o volume que o deixa 20 LU abaixo da voz medida', () => {
    const d = doc([{id: 'n1', arquivo: 'midia/narracao.wav', em: 0, duracao_ms: 5000, volume: 0.9}]);
    const envs = {'midia/narracao.wav': env(5000, -22)};
    const { audio } = resolverAudio(d.audio, 12000, envs);
    const voz = nivelDaVoz(audio);
    expect(voz).toBeCloseTo(-22 + dbDeGanho(0.9), 6); // a mediana da voz com o volume do clipe
    const whoosh = env(800, -3); // normalizado perto de 0 dBFS
    const v = volumeDoEfeito(nivelDeReferencia(whoosh), voz);
    mostrar('efeito: volume', v, '→', (nivelDeReferencia(whoosh)! + dbDeGanho(v) - voz!).toFixed(2), 'LU em relação à voz');
    expect(v).toBeLessThan(0.05);
    expect(Math.abs(nivelDeReferencia(whoosh)! + dbDeGanho(v) - (voz! - EFEITO_ABAIXO_DA_VOZ_LU))).toBeLessThan(0.5);
  });

  it('som-D4: sem voz medida conta a voz típica; efeito que já é baixo não sobe; sem medida, 100 %', () => {
    expect(nivelDaVoz(undefined)).toBeNull();
    expect(volumeDoEfeito(-3, null)).toBeLessThan(0.02);
    expect(volumeDoEfeito(-55, -22)).toBe(1); // já está abaixo do alvo: não se sobe o volume
    expect(volumeDoEfeito(undefined, -22)).toBe(1);
    expect(volumeDoEfeito(-3, -22, 18)).toBeGreaterThan(volumeDoEfeito(-3, -22, 23)); // 18 LU abaixo é mais alto que 23
  });

  it('som-D7: duas músicas juntas na faixa avisam; com o crossfade cobrindo a sobreposição, não', () => {
    const juntas = doc([{id: 'm1', arquivo: 'midia/a.wav', em: 0, duracao_ms: 12000}, {id: 'm2', arquivo: 'midia/b.wav', em: 0, duracao_ms: 9000}], undefined, 'musica');
    expect(resolverAudio(juntas.audio, 12000).avisos.join(' ')).toMatch(/tocam juntas por 9 s/);
    // a segunda entra na cabeça (4 s) e a primeira desce em crossfade: o que a interface faz com a faixa cheia
    const virtual = doc([{id: 'm1', arquivo: 'midia/a.wav', em: 0, duracao_ms: 12000}, {id: 'm2', arquivo: 'midia/b.wav', em: 4000, duracao_ms: 8000, fade_out_ms: 1500}], undefined, 'musica');
    const r = ok<Crossfade>(crossfadeEntre(virtual, {de: 'm1', para: 'm2', duracao_ms: 1500}, {'midia/a.wav': 12000}));
    expect(r.de).toMatchObject({duracao_ms: 5500, fade_out_ms: 1500, fade_out_curva: 'potencia'});
    expect(r.para).toMatchObject({em: 4000, fade_in_ms: 1500, fade_in_curva: 'potencia'});
    const depois = aplicar(virtual, r.patch);
    expect(resolverAudio(depois.audio, 12000).avisos.filter((a) => /tocam juntas/.test(a))).toEqual([]);
    // a mistura: antes de 4 s só a primeira, depois só a segunda
    const A = ruido(12, 31);
    const B = ruido(12, 32);
    const mix = mixar(depois, {'midia/a.wav': A, 'midia/b.wav': B});
    expect(db(rms(mix, 2000, 3000)) - db(rms(A, 2000, 3000))).toBeCloseTo(0, 1);
    expect(db(rms(mix, 7000, 8000)) - db(rms(B, 7000, 8000) )).toBeCloseTo(0, 1);
  });
});
