// Narração gravada inteira dividida nas cenas (src/nucleo/narracao-inteira.ts, docs/narracao.md), com transcrições
// sintéticas (sem áudio): o alinhamento pelo texto das cenas, as pausas sem texto, o texto um pouco diferente do falado,
// mais cenas que frases, os cortes à mão e que nenhum corte cai no meio de palavra; depois o patch (um clipe da mesma
// gravação por cena, a duração das cenas, as legendas e a âncora de palavra) e a ferramenta MCP com prévia e Reverter.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import jsonpatch, {type Operation} from 'fast-json-patch';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {novoDocCenas, palavrasDaCena, resolverCenas, type DocCenas} from '../src/nucleo/cenas';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import type {PalavraLegenda} from '../src/nucleo/legendas';
import {ajustarCenasAFala, itensDaNarracao} from '../src/nucleo/narracao-cenas';
import {palavrasDoTexto, patchDaDivisao, proporDivisao, type PropostaDivisao} from '../src/nucleo/narracao-inteira';
import {classeDe} from '../src/nucleo/portao';
import {Projeto} from '../src/nucleo/projeto';

/** Uma gravação sintética: as frases em ordem, com a pausa depois de cada uma (ms) e 70 ms entre as palavras. */
const gravar = (frases: {texto: string; pausa?: number}[], inicio = 400): PalavraLegenda[] => {
  const out: PalavraLegenda[] = [];
  let t = inicio;
  for (const f of frases) {
    const ws = f.texto.split(/\s+/).filter(Boolean);
    ws.forEach((w, i) => {
      const dur = 90 + 45 * w.length;
      out.push({w, s: t, e: t + dur});
      t += dur + (i < ws.length - 1 ? 70 : (f.pausa ?? 700));
    });
  }
  return out;
};

const FRASES = [
  {texto: 'Recebeu proposta para mudar de cidade?', pausa: 650},
  {texto: 'A empresa precisa pagar a mudança e um adicional de vinte e cinco por cento.', pausa: 900},
  {texto: 'Se a transferência for definitiva, o adicional não é devido.', pausa: 800},
];

/** Nenhum trecho corta uma palavra: cada palavra fica inteira dentro de um trecho ou inteira fora; e os trechos não se
 *  sobrepõem. */
const conferirSemPalavraCortada = (p: PropostaDivisao, palavras: PalavraLegenda[]) => {
  const ts = p.trechos.filter((t) => t.de_ms !== null);
  const cortadas = ts.flatMap((t) => palavras.filter((w) => !(w.s >= t.de_ms! && w.e <= t.ate_ms!) && !(w.e <= t.de_ms! || w.s >= t.ate_ms!))
    .map((w) => `"${w.w}" (${w.s}–${w.e}) cortada pelo trecho da cena ${t.n} (${t.de_ms}–${t.ate_ms})`));
  expect(cortadas).toEqual([]);
  expect(ts.filter((t, i) => i > 0 && t.de_ms! < ts[i - 1].ate_ms!).map((t) => t.n)).toEqual([]);
  // e cada corte cai numa pausa: entre o fim de uma palavra e o começo da seguinte
  const ordem = [...palavras].sort((a, b) => a.s - b.s);
  expect(p.cortes.filter((c) => !ordem.some((w, i) => i > 0 && ordem[i - 1].e <= c.ms && c.ms <= w.s)).map((c) => c.ms)).toEqual([]);
};

/** As palavras de cada trecho, como texto. */
const falas = (p: PropostaDivisao) => p.trechos.map((t) => t.texto);

describe('proporDivisao: com o texto das cenas', () => {
  it('alinha cada cena à frase dela e corta nas pausas entre as frases', () => {
    const ps = gravar(FRASES);
    const p = proporDivisao(ps, FRASES.map((f, i) => ({id: `c${i + 1}`, texto: f.texto})));
    expect(p.metodo).toBe('texto');
    expect(falas(p)).toEqual(FRASES.map((f) => f.texto));
    expect(p.trechos.every((t) => t.acerto === 1)).toBe(true);
    expect(p.cortes.map((c) => [c.entre, c.antes, c.depois])).toEqual([[[1, 2], 'cidade?', 'A'], [[2, 3], 'cento.', 'Se']]);
    expect(p.avisos).toEqual([]);
    // a margem: o trecho começa 200 ms antes da primeira palavra (a primeira cena, no máximo no zero do arquivo)
    expect(p.trechos[0].de_ms).toBe(200);
    expect(p.trechos[1].de_ms).toBe(ps[6].s - 200);
    conferirSemPalavraCortada(p, ps);
  });

  it('aguenta texto um pouco diferente do falado: acento, caixa, pontuação, palavra trocada, a mais e a menos', () => {
    const ps = gravar([{texto: 'Oi, gente.', pausa: 500}, ...FRASES]); // "Oi, gente" não está no texto
    const textos = [
      'recebeu PROPOSTA pra mudar de cidade', // "pra" no lugar de "para", sem o "?"
      'A empresa tem que pagar a mudanca e um adicional de 25 por cento.', // "tem que" no lugar de "precisa", sem acento, "25"
      'Se a transferencia for definitiva o adicional nao e devido, entendeu?', // palavra a mais no fim
    ];
    const p = proporDivisao(ps, textos.map((texto, i) => ({id: `c${i + 1}`, texto})));
    expect(p.metodo).toBe('texto');
    expect(falas(p)).toEqual([`Oi, gente. ${FRASES[0].texto}`, FRASES[1].texto, FRASES[2].texto]); // o que veio antes do texto fica na primeira cena
    expect(p.trechos[1].acerto!).toBeGreaterThan(0.7);
    expect(p.trechos[1].acerto!).toBeLessThan(1);
    conferirSemPalavraCortada(p, ps);
  });

  it('mais cenas que frases: a fronteira dentro da frase vem do texto, mesmo sem pausa longa', () => {
    const ps = gravar(FRASES);
    const textos = [FRASES[0].texto, 'A empresa precisa pagar a mudança', 'e um adicional de vinte e cinco por cento.', FRASES[2].texto];
    const p = proporDivisao(ps, textos.map((texto, i) => ({id: `c${i + 1}`, texto})));
    expect(falas(p)).toEqual(textos);
    expect(p.cortes[1]).toMatchObject({antes: 'mudança', depois: 'e', pausa_ms: 70});
    conferirSemPalavraCortada(p, ps);
  });

  it('cena sem texto no meio: as palavras entre as cenas com texto, cortadas nas pausas', () => {
    const ps = gravar(FRASES);
    const p = proporDivisao(ps, [{id: 'c1', texto: FRASES[0].texto}, {id: 'c2'}, {id: 'c3', texto: FRASES[2].texto}]);
    expect(p.metodo).toBe('misto');
    expect(falas(p)).toEqual(FRASES.map((f) => f.texto));
    expect(p.trechos.map((t) => t.metodo)).toEqual(['texto', 'pausas', 'texto']);
    conferirSemPalavraCortada(p, ps);
  });

  it('o texto de uma cena que não foi falado: aviso, e a cena vai pelas pausas', () => {
    const ps = gravar(FRASES);
    const p = proporDivisao(ps, [{id: 'c1', texto: FRASES[0].texto}, {id: 'c2', texto: 'Xyzw qwerty plimplim.'}, {id: 'c3', texto: FRASES[2].texto}]);
    expect(p.avisos).toEqual(['o texto da cena 2 não foi achado na gravação: ela foi pelas pausas']);
    expect(p.trechos.map((t) => t.metodo)).toEqual(['texto', 'pausas', 'texto']);
    expect(falas(p)).toEqual(FRASES.map((f) => f.texto));
    conferirSemPalavraCortada(p, ps);
  });
});

describe('proporDivisao: gravação longa', () => {
  it('60 cenas, 1.500 palavras, com erros de transcrição e pausas irregulares: cada cena com a fala dela, em pouco tempo', () => {
    let semente = 7;
    const sorte = () => ((semente = (semente * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const vocab = ['trabalho', 'empresa', 'direito', 'salário', 'férias', 'contrato', 'jornada', 'acordo', 'prazo', 'pagamento', 'horas', 'extras', 'aviso',
      'prévio', 'demissão', 'justa', 'causa', 'fundo', 'garantia', 'seguro', 'a', 'o', 'de', 'que', 'com', 'para', 'não', 'é', 'um', 'uma'];
    const cenas = Array.from({length: 60}, (_, i) => {
      const n = 18 + Math.floor(sorte() * 14);
      const ws = Array.from({length: n}, () => vocab[Math.floor(sorte() * vocab.length)]);
      return {id: `c${i + 1}`, texto: `${ws.join(' ')}.`};
    });
    // o que o whisper ouviu: uma palavra em vinte trocada, uma em trinta a menos, pausas entre as cenas de 280 a 900 ms
    const ps: PalavraLegenda[] = [];
    const donos: number[] = [];
    let t = 300;
    cenas.forEach((c, i) => {
      const ws = c.texto.split(' ');
      ws.forEach((w, j) => {
        if (sorte() < 1 / 30) return;
        const ouvida = sorte() < 1 / 20 ? 'xxx' : w;
        const dur = 80 + 40 * ouvida.length;
        ps.push({w: ouvida, s: t, e: t + dur});
        donos.push(i);
        t += dur + (j < ws.length - 1 ? Math.floor(sorte() * 180) : 280 + Math.floor(sorte() * 620));
      });
    });
    expect(ps.length).toBeGreaterThan(1400);
    const t0 = performance.now();
    const p = proporDivisao(ps, cenas);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(p.metodo).toBe('texto');
    const errados = p.trechos.flatMap((tr) => (tr.palavras ? intervaloDe(tr.palavras).filter((k) => donos[k] !== tr.n - 1) : [])).length;
    expect(errados).toBeLessThanOrEqual(3); // no máximo uma ou outra palavra na fronteira
    conferirSemPalavraCortada(p, ps);
  });
});
const intervaloDe = ([a, b]: [number, number]) => Array.from({length: b - a + 1}, (_, i) => a + i);

describe('proporDivisao: sem texto', () => {
  it('corta nas pausas mais longas, até o número de cenas', () => {
    const ps = gravar(FRASES);
    const p = proporDivisao(ps, [{id: 'a'}, {id: 'b'}, {id: 'c'}]);
    expect(p.metodo).toBe('pausas');
    expect(falas(p)).toEqual(FRASES.map((f) => f.texto));
    conferirSemPalavraCortada(p, ps);
    // duas cenas: a maior pausa (900 ms, depois de "cento.")
    expect(falas(proporDivisao(ps, [{id: 'a'}, {id: 'b'}]))).toEqual([`${FRASES[0].texto} ${FRASES[1].texto}`, FRASES[2].texto]);
  });

  it('mais cenas que frases: as que sobram ficam sem fala, com aviso, e nada é cortado no meio da frase', () => {
    const ps = gravar(FRASES);
    const p = proporDivisao(ps, ['a', 'b', 'c', 'd', 'e'].map((id) => ({id})));
    expect(falas(p)).toEqual([...FRASES.map((f) => f.texto), '', '']);
    expect(p.trechos.slice(3).every((t) => t.de_ms === null && t.palavras === null)).toBe(true);
    expect(p.avisos.some((a) => /cenas 4, 5 ficaram sem fala/.test(a))).toBe(true);
    conferirSemPalavraCortada(p, ps);
  });

  it('a pausa depois de ponto final vale mais que uma pausa do mesmo tamanho no meio da frase', () => {
    const ps = gravar([{texto: 'Primeira parte, com vírgula', pausa: 420}, {texto: 'continua aqui.', pausa: 400}, {texto: 'Segunda frase.'}]);
    expect(falas(proporDivisao(ps, [{id: 'a'}, {id: 'b'}]))).toEqual(['Primeira parte, com vírgula continua aqui.', 'Segunda frase.']);
  });

  it('o fim do último trecho não passa do fim do arquivo', () => {
    const ps = gravar(FRASES);
    const fim = ps.at(-1)!.e + 50;
    expect(proporDivisao(ps, [{id: 'a'}], {duracao_ms: fim}).trechos[0].ate_ms).toBe(fim);
    // a transcrição que passa do fim (de outra tomada, mais longa): as palavras de depois do fim ficam de fora, com aviso
    const curta = proporDivisao(ps, [{id: 'a'}, {id: 'b'}, {id: 'c'}], {duracao_ms: ps[20].e + 300});
    expect(curta.trechos.filter((t) => t.palavras).map((t) => t.texto)).toEqual([FRASES[0].texto, FRASES[1].texto]);
    expect(curta.avisos.some((a) => /depois do fim do arquivo/.test(a))).toBe(true);
  });
});

describe('proporDivisao: cortes à mão e palavras fora de ordem', () => {
  it('cada corte vai para a pausa mais perto; dentro de uma palavra, para o lado mais perto', () => {
    const ps = gravar(FRASES);
    const meioDeMudar = (ps[3].s + ps[3].e) / 2 - 10; // "mudar": um pouco antes do meio
    const p = proporDivisao(ps, [{id: 'a'}, {id: 'b'}, {id: 'c'}], {cortes: [meioDeMudar, ps[6].s - 300]});
    expect(p.metodo).toBe('cortes');
    expect(p.trechos.map((t) => t.palavras)).toEqual([[0, 2], [3, 5], [6, ps.length - 1]]);
    conferirSemPalavraCortada(p, ps);
  });

  it('palavras sobrepostas ou fora de ordem (o whisper às vezes faz) viram uma lista em ordem, sem corte dentro de palavra', () => {
    const ps = gravar(FRASES);
    const baguncadas = [...ps].reverse().map((w, i) => (i % 5 === 0 ? {...w, e: w.e + 120} : w)); // fim passando da seguinte
    const p = proporDivisao(baguncadas, FRASES.map((f, i) => ({id: `c${i + 1}`, texto: f.texto})));
    expect(falas(p)).toEqual(FRASES.map((f) => f.texto));
    for (const t of p.trechos) expect(t.ate_ms!).toBeGreaterThan(t.de_ms!);
  });

  it('o texto da cena perde as pausas e o destaque antes de comparar', () => {
    expect(palavrasDoTexto('Fale com o **RH** [pausa] antes <short pause> de bater o ponto.')).toEqual(['fale', 'com', 'o', 'rh', 'antes', 'de', 'bater', 'o', 'ponto']);
  });

  it('sem palavras ou sem cenas: erro claro', () => {
    expect(() => proporDivisao([], [{id: 'a'}])).toThrow(/transcreva/);
    expect(() => proporDivisao(gravar(FRASES), [])).toThrow(/não tem cenas/);
  });
});

// ---------- aplicar no vídeo de cenas ----------

const GRAVACAO = 'midia/narracao-inteira.wav';
const CAMINHO_PALAVRAS = `${GRAVACAO}.palavras.json`;
const aplicar = (doc: DocCenas, patch: unknown[]) => jsonpatch.applyPatch(structuredClone(doc), patch as Operation[], true, false).newDocument as DocCenas;

const docComGravacao = (): DocCenas => ({
  ...novoDocCenas({largura: 1080, altura: 1920, fps: 30}),
  cenas: [
    {id: 'c1', duracao_ms: 4000, blocos: [], narracao: {texto: FRASES[0].texto}},
    {id: 'c2', duracao_ms: 4000, blocos: [{id: 'b1', tipo: 'texto', texto: 'Adicional', x: 0.1, y: 0.5, largura: 0.8, em: 0, em_palavra: 'adicional@0'}],
      narracao: {texto: FRASES[1].texto}},
    {id: 'c3', duracao_ms: 4000, blocos: [], narracao: {texto: FRASES[2].texto}},
  ],
  audio: {faixas: [
    {id: 'voz', nome: 'Narração', papel: 'voz', clipes: [{id: 'inteira', arquivo: GRAVACAO, em: 0, duracao_ms: 12000, volume: 0.8}]},
    {id: 'musica', nome: 'Música', papel: 'musica', clipes: [{id: 'm1', arquivo: 'midia/trilha.wav', em: 0, duracao_ms: 12000}]},
  ]},
  legendas: {segmentos: [{id: 'leg-1', em: 400, sai: 2000, texto: 'velha', clipe: 'inteira'}], origens: [{clipe: 'inteira', arquivo: GRAVACAO, palavras: CAMINHO_PALAVRAS, em: 0, corte_ms: 0}]},
});

describe('patchDaDivisao', () => {
  const ps = gravar(FRASES);
  const dividir = (doc: DocCenas, o: {clipe?: string; margem_ms?: number} = {clipe: 'inteira'}) => {
    const proposta = proporDivisao(ps, doc.cenas.map((c) => ({id: c.id, texto: c.narracao?.texto})));
    return {proposta, r: patchDaDivisao(doc, {arquivo: GRAVACAO, proposta, palavras: ps, caminhoPalavras: CAMINHO_PALAVRAS, ...o})};
  };

  it('cada cena toca o trecho dela da mesma gravação, com a duração ajustada à fala, e o clipe inteiro sai', () => {
    const doc = docComGravacao();
    const {proposta, r} = dividir(doc);
    const d = aplicar(doc, r.patch);
    const voz = d.audio!.faixas.find((f) => f.id === 'voz')!;
    expect(voz.clipes.map((c) => c.id)).not.toContain('inteira');
    expect(voz.clipes).toHaveLength(3);
    voz.clipes.forEach((c, i) => {
      const t = proposta.trechos[i];
      expect(c).toMatchObject({arquivo: GRAVACAO, corte_ms: t.de_ms, duracao_ms: t.ate_ms! - t.de_ms!, volume: 0.8, narracao_gravada: {cena: `c${i + 1}`}});
      // folga 300 + trecho + margem 500
      expect(d.cenas[i].duracao_ms).toBe(300 + c.duracao_ms + 500);
    });
    const tempos = resolverCenas(d).props.cenas;
    voz.clipes.forEach((c, i) => expect(c.em).toBe(tempos[i].t_in + 300));
    expect(r.mudancas.map((m) => m.n)).toEqual([1, 2, 3]);
    // a música andou com as cenas (a conta do "ajustar as cenas à fala")
    expect(d.audio!.faixas.find((f) => f.id === 'musica')!.clipes.length).toBeGreaterThan(0);
    // estado: as cenas estão "gravadas", e a IA não as gera sem ser pedida
    expect(itensDaNarracao(d).map((i) => i.estado)).toEqual(['gravada', 'gravada', 'gravada']);
    // ajustar de novo não muda nada
    expect(ajustarCenasAFala(d).patch).toEqual([]);
  });

  it('as legendas saem da transcrição, por trecho, e a âncora de palavra acha a fala de cada cena', () => {
    const doc = docComGravacao();
    const {r} = dividir(doc);
    const d = aplicar(doc, r.patch);
    expect(d.legendas!.segmentos.some((s) => s.texto === 'velha')).toBe(false); // as do clipe inteiro saíram
    expect(new Set(d.legendas!.segmentos.map((s) => s.clipe))).toEqual(new Set(d.audio!.faixas[0].clipes.map((c) => c.id)));
    expect(d.legendas!.origens!.map((o) => o.clipe).sort()).toEqual(d.audio!.faixas[0].clipes.map((c) => c.id).sort());
    const {props, avisos} = resolverCenas(d);
    expect(avisos.filter((a) => /legenda|preso/.test(a))).toEqual([]);
    props.cenas.forEach((c, i) => {
      const ws = palavrasDaCena(props.legendas_cenas, c.t_in, c.t_out).map((p) => p.w).join(' ');
      expect(ws).toBe(FRASES[i].texto);
    });
    // o bloco da cena 2 entra em "adicional", 300 ms de folga + 200 de margem depois do começo da cena + o tempo da palavra no trecho
    const c2 = props.cenas[1];
    const adicional = ps.find((p) => p.w === 'adicional')!;
    const trecho = d.audio!.faixas[0].clipes[1];
    expect(c2.blocos[0].em).toBe(c2.t_in + 300 + (adicional.s - trecho.corte_ms!));
  });

  it('sem clipe no vídeo: os trechos vão para a faixa de voz vazia, ou para uma faixa nova', () => {
    const doc = {...docComGravacao(), legendas: undefined};
    doc.audio!.faixas[0].clipes = [];
    const d = aplicar(doc, dividir(doc, {}).r.patch);
    expect(d.audio!.faixas[0].clipes.map((c) => c.narracao_gravada?.cena)).toEqual(['c1', 'c2', 'c3']);
    expect(d.legendas!.segmentos.length).toBeGreaterThan(0);
    const outra = docComGravacao();
    outra.audio!.faixas[0].clipes = [{id: 'outra-voz', arquivo: 'midia/entrevista.wav', em: 0, duracao_ms: 2000}];
    const d2 = aplicar(outra, dividir(outra, {}).r.patch);
    expect(d2.audio!.faixas[0].clipes.map((c) => c.id)).toEqual(['outra-voz']); // a outra voz fica
    expect(d2.audio!.faixas.at(-1)).toMatchObject({papel: 'voz', nome: 'Narração'});
    expect(d2.audio!.faixas.at(-1)!.clipes).toHaveLength(3);
  });

  it('dividir de novo troca os trechos da divisão anterior, sem duplicar; a fala por IA da cena sai com aviso', () => {
    const doc = docComGravacao();
    const d = aplicar(doc, dividir(doc).r.patch);
    d.audio!.faixas.push({id: 'ia', nome: 'Narração IA', papel: 'voz', clipes: [{id: 'fala-1', arquivo: 'midia/narracao/x.wav', em: 300, duracao_ms: 1000, narracao_ia: {cena: 'c1', hash: 'x'}}]});
    const {r} = dividir(d, {});
    const d2 = aplicar(d, r.patch);
    expect(d2.audio!.faixas.flatMap((f) => f.clipes).filter((c) => c.narracao_gravada)).toHaveLength(3);
    expect(d2.audio!.faixas.flatMap((f) => f.clipes).some((c) => c.narracao_ia)).toBe(false);
    expect(r.avisos.some((a) => /fala por IA da cena 1 saiu/.test(a))).toBe(true);
    expect(d2.legendas!.segmentos.filter((s) => s.clipe).length).toBe(d.legendas!.segmentos.length);
  });

  it('a cena sem fala na proposta fica como estava', () => {
    const doc = docComGravacao();
    doc.cenas.push({id: 'c4', duracao_ms: 2500, blocos: []});
    for (const c of doc.cenas) delete c.narracao;
    const proposta = proporDivisao(ps, doc.cenas.map((c) => ({id: c.id})));
    expect(proposta.trechos[3].de_ms).toBeNull();
    const d = aplicar(doc, patchDaDivisao(doc, {arquivo: GRAVACAO, proposta, palavras: ps, caminhoPalavras: CAMINHO_PALAVRAS, clipe: 'inteira'}).patch);
    expect(d.cenas[3].duracao_ms).toBe(2500);
    expect(itensDaNarracao(d).map((i) => i.estado)).toEqual(['gravada', 'gravada', 'gravada', 'sem_texto']);
  });
});

// ---------- MCP ----------

let pasta = '';
let projeto: Projeto;
beforeEach(() => {
  pasta = mkdtempSync(path.join(tmpdir(), 'estudio-narracao-inteira-'));
  mkdirSync(path.join(pasta, 'video'), {recursive: true});
  mkdirSync(path.join(pasta, 'midia'), {recursive: true});
  writeFileSync(path.join(pasta, GRAVACAO), 'gravação de mentira');
  writeFileSync(path.join(pasta, 'midia', 'trilha.wav'), 'trilha de mentira');
  writeFileSync(path.join(pasta, 'estudio.json'), JSON.stringify({formato: 1, nome: 'Narração inteira', documentos: [{id: 'video', modulo: 'video', caminho: 'video/video.json', titulo: 'Mudança'}]}));
  writeFileSync(path.join(pasta, 'video', 'video.json'), JSON.stringify(docComGravacao()));
  projeto = new Projeto(pasta);
});
afterEach(() => rmSync(pasta, {recursive: true, force: true}));

const conectar = async () => {
  const servidor = new McpServer({name: 'estudio', version: 'teste'});
  registrarFerramentas(servidor, projeto, 'agente', 'teste');
  const [a, b] = InMemoryTransport.createLinkedPair();
  const cliente = new Client({name: 'teste', version: '1'});
  await Promise.all([servidor.connect(a), cliente.connect(b)]);
  return cliente;
};
const chamar = async (cliente: Client, name: string, args: Record<string, unknown> = {}) => {
  const r = (await cliente.callTool({name, arguments: args})) as {isError?: boolean; content: {text: string}[]};
  const texto = r.content[0]?.text ?? '';
  return {erro: Boolean(r.isError), texto, json: r.isError ? null : JSON.parse(texto)};
};
const lerVideo = () => projeto.lerJson<DocCenas>('video/video.json').doc;

describe('MCP dividir_narracao', () => {
  it('é livre no portão', () => {
    expect(classeDe('dividir_narracao')).toBe('livre');
  });

  it('sem transcrição, pede o transcrever; a prévia não grava; aplicar vai ao diário e o Reverter desfaz', async () => {
    const c = await conectar();
    const sem = await chamar(c, 'dividir_narracao', {previa: true});
    expect(sem.erro).toBe(true);
    expect(sem.texto).toMatch(/transcrever \{arquivo: "midia\/narracao-inteira.wav"\}/);
    writeFileSync(path.join(pasta, CAMINHO_PALAVRAS), JSON.stringify({versao: 2, fonte: {tamanho: 20}, palavras: gravar(FRASES)}));
    const antes = lerVideo();
    const p = await chamar(c, 'dividir_narracao', {previa: true});
    expect(p.erro).toBe(false);
    expect(p.json).toMatchObject({arquivo: GRAVACAO, clipe: 'inteira', metodo: 'texto'});
    expect(p.json.trechos.map((t: {texto: string}) => t.texto)).toEqual(FRASES.map((f) => f.texto));
    expect(p.json.cortes).toHaveLength(2);
    expect(lerVideo()).toEqual(antes);
    expect(projeto.diario()).toHaveLength(0);

    const r = await chamar(c, 'dividir_narracao');
    expect(r.erro).toBe(false);
    expect(r.json.clipes).toHaveLength(3);
    expect(r.json.legendas).toBeGreaterThan(0);
    const depois = lerVideo();
    expect(itensDaNarracao(depois).map((i) => i.estado)).toEqual(['gravada', 'gravada', 'gravada']);
    expect(projeto.diario()).toHaveLength(1);
    expect(projeto.diario()[0].rotulo).toBe('narração gravada dividida em 3 cenas');
    expect(projeto.reverter(projeto.diario()[0].seq, {autor: 'pessoa', origem: 'reverter'})).toMatchObject({ok: true});
    expect(lerVideo()).toEqual(antes);
  });

  it('cortes à mão no lugar da proposta; arquivo que não está no vídeo nem no projeto dá erro claro', async () => {
    const c = await conectar();
    const ps = gravar(FRASES);
    writeFileSync(path.join(pasta, CAMINHO_PALAVRAS), JSON.stringify({versao: 2, fonte: {tamanho: 20}, palavras: ps}));
    const p = await chamar(c, 'dividir_narracao', {previa: true, cortes: [ps[3].s - 20]});
    expect(p.json.metodo).toBe('cortes');
    expect(p.json.trechos[0].texto).toBe('Recebeu proposta para');
    expect(p.json.trechos[2].sem_fala).toBe(true);
    const fora = await chamar(c, 'dividir_narracao', {previa: true, arquivo: 'midia/nao-existe.wav'});
    expect(fora.erro).toBe(true);
    expect(fora.texto).toMatch(/não está no projeto/);
  });
});
