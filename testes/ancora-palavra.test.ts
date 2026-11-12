// Bloco preso a uma palavra no vídeo de cenas (Onda B, docs/carrossel-narrado.md): a âncora "palavra@ms" do roteiro do
// carrossel narrado (ancora-palavra.ts, a mesma do resolvedor do roteiro) e o `em_palavra`/`sai_palavra` do bloco,
// resolvidos pelas palavras das legendas que caem na cena. Sem fala transcrita ou sem achar a palavra, o bloco fica no
// tempo em ms, com aviso; nunca quebra. O MCP devolve o aviso no aplicar_patch.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {ancoraDaPalavra, deslocarAncora, escreverAncora, lerAncora, tempoDaAncora, type Palavra} from '../src/nucleo/ancora-palavra';
import {novoDocCenas, palavrasDaCena, resolverCenas, type BlocoCenas, type DocCenas} from '../src/nucleo/cenas';
import {dividirCena} from '../src/nucleo/cenas-dividir';
import {guiaDoProjeto} from '../src/nucleo/criar-projeto';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {Projeto} from '../src/nucleo/projeto';
import {resolverRoteiro} from '../src/nucleo/roteiro/resolver';

const FALA: Palavra[] = [
  {w: 'A', s: 100, e: 200},
  {w: 'Multa', s: 300, e: 800},
  {w: 'de', s: 850, e: 950},
  {w: '40%', s: 1000, e: 1500},
  {w: 'sobre', s: 1600, e: 1900},
  {w: 'a', s: 1950, e: 2000},
  {w: 'multa,', s: 2100, e: 2600},
  {w: 'rescisória.', s: 2700, e: 3400},
];

describe('âncora de palavra', () => {
  it('acha a primeira palavra que começa com o texto, a partir do ms, sem acento, caixa ou pontuação', () => {
    expect(tempoDaAncora('multa@0', FALA)).toMatchObject({ms: 300, palavra: {w: 'Multa'}});
    expect(tempoDaAncora('multa@301', FALA)).toMatchObject({ms: 2100, palavra: {w: 'multa,'}});
    expect(tempoDaAncora('rescis@0', FALA)).toMatchObject({ms: 2700}); // começo da palavra basta
    expect(tempoDaAncora('RESCISÓRIA@0', FALA)).toMatchObject({ms: 2700});
  });

  it('"$" ancora no fim da palavra e "+N"/"-N" desloca', () => {
    expect(tempoDaAncora('multa$@0', FALA)).toMatchObject({ms: 800});
    expect(tempoDaAncora('multa@0+120', FALA)).toMatchObject({ms: 420});
    expect(tempoDaAncora('multa$@1000+50', FALA)).toMatchObject({ms: 2650});
    expect(tempoDaAncora('sobre@0-100', FALA)).toMatchObject({ms: 1500});
  });

  it('palavra não achada, sem palavras e âncora mal escrita voltam com o motivo, sem exceção', () => {
    const r = tempoDaAncora('fgts@0', FALA);
    expect('erro' in r && r.erro).toMatch(/não achei "fgts" a partir de 0 ms \(perto: A@100 Multa@300/);
    expect(tempoDaAncora('multa@5000', FALA)).toEqual({erro: 'não achei "multa" a partir de 5000 ms'});
    expect(tempoDaAncora('multa@0', [])).toEqual({erro: 'sem palavras transcritas'});
    expect(tempoDaAncora('multa', FALA)).toMatchObject({erro: expect.stringMatching(/^âncora mal escrita/)});
    expect(() => lerAncora('multa')).toThrow(/âncora mal escrita/);
  });

  it('escreve, desloca e cria a âncora de uma palavra no formato que lê', () => {
    expect(escreverAncora(lerAncora('multa$@1000+50'))).toBe('multa$@1000+50');
    expect(escreverAncora(lerAncora('multa@0-80'))).toBe('multa@0-80');
    expect(deslocarAncora('multa@2500+120', -2000)).toBe('multa@500+120');
    expect(deslocarAncora('multa@300', -2000)).toBe('multa@0');
    expect(deslocarAncora('sem arroba', -2000)).toBe('sem arroba');
    expect(ancoraDaPalavra(FALA[6])).toBe('multa@2100');
    expect(ancoraDaPalavra(FALA[6], true)).toBe('multa$@2100');
    expect(ancoraDaPalavra({w: 'R$', s: 10.6, e: 20})).toBe('r@10');
    expect(ancoraDaPalavra({w: '…', s: 0, e: 1})).toBeNull();
    // a âncora criada acha a mesma palavra
    for (const p of FALA) expect(tempoDaAncora(ancoraDaPalavra(p)!, FALA)).toMatchObject({ms: p.s});
  });

  it('o roteiro do carrossel narrado continua recusando a âncora que não acha', () => {
    const roteiro = {fonte: 'midia/x.mp4', palavras: 'x.json', rotulo_partes: 'PARTE', cenas: [
      {tipo: 'gancho' as const, blocos: []},
      {tipo: 'duvida' as const, inicio: 'fgts@0', blocos: []},
    ]};
    expect(() => resolverRoteiro(roteiro, FALA)).toThrow(/âncora não achada: 'fgts' a partir de 0 ms/);
  });
});

// duas cenas de 3 s; as legendas trazem a fala no tempo do vídeo: "a multa" na primeira cena e "a multa é sua" na segunda
const bloco = (id: string, extra: Partial<BlocoCenas> = {}): BlocoCenas => ({id, tipo: 'texto', texto: id, x: 0.1, y: 0.4, largura: 0.8, em: 500, ...extra});
const video = (blocos: BlocoCenas[], comLegendas = true): DocCenas => ({
  ...novoDocCenas({largura: 1080, altura: 1920, fps: 30}),
  cenas: [
    {id: 'c1', duracao_ms: 3000, blocos: [bloco('c1-texto')]},
    {id: 'c2', duracao_ms: 3000, blocos},
  ],
  ...(comLegendas ? {legendas: {segmentos: [
    {id: 'leg-1', em: 200, sai: 1200, texto: 'a multa', palavras: [{w: 'a', s: 200, e: 300}, {w: 'multa', s: 400, e: 1000}]},
    {id: 'leg-2', em: 3200, sai: 5600, texto: 'a multa é sua', palavras: [{w: 'a', s: 3200, e: 3300}, {w: 'multa', s: 3400, e: 4000},
      {w: 'é', s: 4100, e: 4200}, {w: 'sua.', s: 4300, e: 5600}]},
  ]}} : {}),
});
const doBloco = (doc: DocCenas, id: string) => resolverCenas(doc).props.cenas.flatMap((c) => c.blocos).find((b) => b.id === id)!;

describe('bloco preso a uma palavra no vídeo de cenas', () => {
  it('as palavras da cena são as das legendas que começam nela, com o tempo contado do começo da cena', () => {
    const {props} = resolverCenas(video([]));
    const [c1, c2] = props.cenas;
    expect(palavrasDaCena(props.legendas_cenas, c1.t_in, c1.t_out).map((p) => [p.w, p.s, p.e])).toEqual([['a', 200, 300], ['multa', 400, 1000]]);
    expect(palavrasDaCena(props.legendas_cenas, c2.t_in, c2.t_out).map((p) => [p.w, p.s, p.e])).toEqual([['a', 200, 300], ['multa', 400, 1000],
      ['é', 1100, 1200], ['sua', 1300, 2600]]); // o texto do segmento manda na palavra (palavrasDe)
    expect(palavrasDaCena(undefined, 0, 3000)).toEqual([]);
  });

  it('em_palavra põe a entrada no começo da palavra da própria cena, e sai_palavra com "$" no fim dela', () => {
    const doc = video([bloco('b', {em: 0, em_palavra: 'multa@0', sai_palavra: 'sua$@0'})]);
    const b = doBloco(doc, 'b');
    expect([b.em, b.sai]).toEqual([3000 + 400, 3000 + 2600]);
    expect(resolverCenas(doc).avisos).toEqual([]);
    // o ms da âncora é da cena: "é@0" acha o "é" da segunda cena, não o que viria depois na primeira
    expect(doBloco(video([bloco('b', {em_palavra: 'e@0'})]), 'b').em).toBe(3000 + 1100);
  });

  it('o deslocamento soma depois da palavra e o tempo resolvido fica dentro da cena', () => {
    expect(doBloco(video([bloco('b', {em_palavra: 'multa@0+150'})]), 'b').em).toBe(3000 + 550);
    expect(doBloco(video([bloco('b', {em_palavra: 'a@0-900'})]), 'b').em).toBe(3000); // não entra antes da cena
    const longe = video([bloco('b', {em_palavra: 'sua@0+5000'})]);
    expect(doBloco(longe, 'b').em).toBe(6000);
    expect(resolverCenas(longe).avisos).toContain('o bloco 1 da cena 2 entra depois do fim da cena');
    const curto = video([bloco('b', {em: 0, sai_palavra: 'a$@0'})]);
    expect(doBloco(curto, 'b').sai).toBe(3000 + 300);
  });

  it('palavra não achada: o bloco fica no tempo em ms e o aviso diz por quê', () => {
    const doc = video([bloco('b', {em: 700, em_palavra: 'fgts@0'})]);
    const r = resolverCenas(doc);
    expect(doBloco(doc, 'b').em).toBe(3000 + 700);
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toMatch(/^o bloco 1 da cena 2 entra preso a "fgts@0", mas não achei "fgts" a partir de 0 ms \(perto: a@200 multa@400.*\): entra no tempo em ms$/);
  });

  it('sem fala transcrita: o bloco fica no tempo em ms, com aviso que pede a transcrição', () => {
    const doc = video([bloco('b', {em: 700, sai: 2000, em_palavra: 'multa@0', sai_palavra: 'sua$@0'})], false);
    const b = doBloco(doc, 'b');
    expect([b.em, b.sai]).toEqual([3700, 5000]);
    expect(resolverCenas(doc).avisos).toEqual([
      'o bloco 1 da cena 2 entra preso a "multa@0", mas a cena não tem fala transcrita (transcreva a fala para gerar as legendas): entra no tempo em ms',
      'o bloco 1 da cena 2 sai preso a "sua$@0", mas a cena não tem fala transcrita (transcreva a fala para gerar as legendas): sai no tempo em ms',
    ]);
  });

  it('âncora mal escrita ou que não é texto vira aviso, não erro', () => {
    const doc = video([bloco('b', {em_palavra: 'multa'}), bloco('c', {em_palavra: 42 as unknown as string})]);
    const r = resolverCenas(doc);
    expect(doBloco(doc, 'b').em).toBe(3500);
    expect(doBloco(doc, 'c').em).toBe(3500);
    expect(r.avisos[0]).toMatch(/^o bloco 1 da cena 2 entra preso a "multa", mas âncora mal escrita/);
    expect(r.avisos[1]).toMatch(/^o bloco 2 da cena 2 entra preso a uma palavra, mas a âncora não é um texto/);
  });

  it('a palavra anda com o clipe de voz: a legenda deslocada leva o bloco junto', () => {
    const doc: DocCenas = {
      ...video([bloco('b', {em_palavra: 'sua@0'})]),
      audio: {faixas: [{id: 'voz', nome: 'Voz', papel: 'voz', clipes: [{id: 'n1', arquivo: 'midia/voz.wav', em: 3300, corte_ms: 0, duracao_ms: 2600}]}]},
    };
    // as legendas da segunda cena nasceram com o clipe em 3000; ele andou 300 ms depois
    doc.legendas!.segmentos[1].clipe = 'n1';
    doc.legendas!.origens = [{clipe: 'n1', arquivo: 'midia/voz.wav', palavras: 'midia/voz.wav.palavras.json', em: 3000, corte_ms: 0}];
    expect(doBloco(doc, 'b').em).toBe(3000 + 1300 + 300);
  });

  it('a lâmina conta a âncora do novo começo da cena e larga a ponta que o corte define', () => {
    const doc = video([
      bloco('depois', {em: 1500, em_palavra: 'sua@1000', sai_palavra: 'sua$@1000+100'}),
      bloco('atravessa', {em: 0, sai: 2500, em_palavra: 'a@0', sai_palavra: 'sua$@1200'}),
    ]);
    const r = dividirCena(doc, 'c2', 1000)!;
    expect(r.primeira.blocos.map((b) => [b.id, b.em_palavra, b.sai_palavra])).toEqual([['atravessa', 'a@0', undefined]]);
    const [depois, atravessa] = r.segunda.blocos;
    expect([depois.em, depois.em_palavra, depois.sai_palavra]).toEqual([500, 'sua@0', 'sua$@0+100']);
    expect([atravessa.em, atravessa.em_palavra, atravessa.sai_palavra]).toEqual([0, undefined, 'sua$@200']);
    // depois do corte, o bloco continua na mesma palavra do vídeo
    const cortado: DocCenas = {...doc, cenas: [doc.cenas[0], r.primeira, r.segunda]};
    const antes = doBloco(doc, 'depois');
    const agora = resolverCenas(cortado).props.cenas[2].blocos[0];
    expect([agora.em, agora.sai]).toEqual([antes.em, antes.sai]);
  });

  it('o guia do projeto explica a âncora', () => {
    expect(guiaDoProjeto(['video'], 'CLAUDE.md')).toContain('`em_palavra` (e `sai_palavra`) "palavra@ms"');
  });
});

describe('MCP: a âncora pelo aplicar_patch', () => {
  let pasta = '';
  let cliente: Client;
  const VIDEO = 'video/video.json';
  beforeAll(async () => {
    pasta = mkdtempSync(path.join(tmpdir(), 'estudio-ancora-palavra-'));
    mkdirSync(path.join(pasta, 'video'), {recursive: true});
    writeFileSync(path.join(pasta, 'estudio.json'), JSON.stringify({formato: 1, nome: 'Âncora', documentos: [{id: 'video', modulo: 'video', caminho: VIDEO, titulo: 'Vídeo'}]}));
    writeFileSync(path.join(pasta, VIDEO), JSON.stringify(video([bloco('b')])));
    const projeto = new Projeto(pasta);
    const servidor = new McpServer({name: 'estudio', version: 'teste'});
    registrarFerramentas(servidor, projeto, 'agente', 'teste');
    const [a, b] = InMemoryTransport.createLinkedPair();
    cliente = new Client({name: 'teste', version: '1'});
    await Promise.all([servidor.connect(a), cliente.connect(b)]);
  });
  afterAll(async () => {
    await cliente?.close();
    rmSync(pasta, {recursive: true, force: true});
  });
  const chamar = async (name: string, args: Record<string, unknown>) => {
    const r = (await cliente.callTool({name, arguments: args})) as {isError?: boolean; content: {text: string}[]};
    expect(r.isError, r.content[0]?.text).toBeFalsy();
    return JSON.parse(r.content[0].text);
  };

  it('prende o bloco a uma palavra e devolve o aviso quando a palavra não está na fala da cena', async () => {
    const lido = await chamar('ler_documento', {documento: 'video'});
    const ok = await chamar('aplicar_patch', {documento: 'video', versao_base: lido.versao,
      patch: [{op: 'add', path: '/cenas/1/blocos/0/em_palavra', value: 'multa@0'}]});
    expect(ok.avisos).toBeUndefined();
    const ruim = await chamar('aplicar_patch', {documento: 'video', versao_base: ok.versao,
      patch: [{op: 'test', path: '/cenas/1/blocos/0/em_palavra', value: 'multa@0'}, {op: 'replace', path: '/cenas/1/blocos/0/em_palavra', value: 'fgts@0'}]});
    expect(ruim.avisos).toEqual([expect.stringMatching(/^o bloco 1 da cena 2 entra preso a "fgts@0", mas não achei "fgts"/)]);
  });
});
