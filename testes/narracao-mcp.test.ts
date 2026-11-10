// Narração por IA de ponta a ponta, sem rede: o serviço com o HTTP falso grava os WAVs em midia/narracao/<hash>.wav (cache),
// o envelope ao lado (ducking na hora) e o patch no diário; e as ferramentas MCP (vozes_narracao, configurar_narracao,
// pronuncias_narracao, narrar com e sem prévia, ajustar_cenas_a_fala) com o portão de permissão.
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {ehEnvelope} from '../src/nucleo/audio';
import {novoDocCenas, resolverCenas, type DocCenas} from '../src/nucleo/cenas';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {lerWav16, type ProvedorNarracao} from '../src/nucleo/narracao';
import {itensDaNarracao} from '../src/nucleo/narracao-cenas';
import {gerarNarracao, previaDaNarracao, type ServicoNarracao} from '../src/nucleo/narracao-servico';
import type {PedidoPortao} from '../src/nucleo/portao';
import {Projeto} from '../src/nucleo/projeto';
import {custoNarracao} from '../src/main/ia/precos';
import {CHAVE_GEMINI, CHAVE_TTS, criarGoogleFalso} from './fixtures/narracao-falsa';

let pasta = '';
let projeto: Projeto;

const docInicial = (): DocCenas => ({
  ...novoDocCenas({largura: 1080, altura: 1920, fps: 30}),
  cenas: [
    {id: 'c1', duracao_ms: 4000, blocos: [], narracao: {texto: 'Bem-vindo ao treinamento do PIN.'}},
    {id: 'c2', duracao_ms: 2000, blocos: [], narracao: {texto: 'Fale com o RH antes de bater o ponto, todos os dias.'}},
    {id: 'c3', duracao_ms: 2000, blocos: []},
  ],
  narracao: {pronuncias: [{de: 'PIN', para: 'pin'}]},
  audio: {faixas: [{id: 'musica', nome: 'Música', papel: 'musica', ducking: {ativo: true, alvo_lu: 20}, clipes: [{id: 'm1', arquivo: 'midia/trilha.wav', em: 0, duracao_ms: 8000}]}]},
});

beforeEach(() => {
  pasta = mkdtempSync(path.join(tmpdir(), 'estudio-narracao-'));
  mkdirSync(path.join(pasta, 'video'), {recursive: true});
  mkdirSync(path.join(pasta, 'midia'), {recursive: true});
  writeFileSync(path.join(pasta, 'midia', 'trilha.wav'), 'trilha de mentira');
  writeFileSync(path.join(pasta, 'estudio.json'), JSON.stringify({formato: 1, nome: 'Narração', documentos: [{id: 'video', modulo: 'video', caminho: 'video/video.json', titulo: 'Ponto'}]}));
  writeFileSync(path.join(pasta, 'video', 'video.json'), JSON.stringify(docInicial()));
  projeto = new Projeto(pasta);
});
afterEach(() => rmSync(pasta, {recursive: true, force: true}));

const lerVideo = () => projeto.lerJson<DocCenas>('video/video.json').doc;
const servicoCom = (f: typeof fetch, chaves: Partial<Record<ProvedorNarracao, string>> = {gemini: CHAVE_GEMINI, 'google-tts': CHAVE_TTS}) => {
  const usos: unknown[] = [];
  const s: ServicoNarracao = {chave: (p) => chaves[p], fetch: f, custo: (p, m, x) => custoNarracao(p, m, x, new Date('2026-11-10')), aoUso: (...a) => usos.push(a)};
  return {s, usos};
};

describe('gerar com cache', () => {
  it('gera as cenas com texto, grava WAV, envelope e ficha em midia/narracao e põe as falas no vídeo com uma entrada no diário', async () => {
    const g = criarGoogleFalso();
    const {s, usos} = servicoCom(g.fetch);
    const andamento: unknown[] = [];
    const r = await gerarNarracao(projeto, s, {autor: 'pessoa', origem: 'interface', andamento: (a) => andamento.push(a)});
    expect(r.ok).toBe(true);
    expect(r.geradas.map((x) => [x.n, x.do_cache])).toEqual([[1, false], [2, false]]);
    expect(r.sem_texto).toEqual([3]); // a cena 3 não tem fala
    expect(g.sinteses()).toHaveLength(2);
    expect(g.sinteses()[0].corpo.contents[0].parts[0].text).toBe('Bem-vindo ao treinamento do pin.'); // a pronúncia antes do provedor
    for (const x of r.geradas) {
      expect(x.arquivo).toMatch(/^midia\/narracao\/[0-9a-f]{20}\.wav$/);
      expect(lerWav16(new Uint8Array(readFileSync(path.join(pasta, x.arquivo))))).toMatchObject({taxa: 24000});
      const env = JSON.parse(readFileSync(path.join(pasta, `${x.arquivo}.envelope.json`), 'utf-8'));
      expect(ehEnvelope(env)).toBe(true);
      expect(env.fonte.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.parse(readFileSync(path.join(pasta, '.estudio', 'narracao', `${path.basename(x.arquivo, '.wav')}.json`), 'utf-8'))).toMatchObject({provedor: 'gemini', voz: 'Charon',
        texto: expect.any(String)});
    }
    const doc = lerVideo();
    expect(itensDaNarracao(doc).map((i) => i.estado)).toEqual(['gerada', 'gerada', 'sem_texto']);
    const fala1 = doc.audio!.faixas.flatMap((f) => f.clipes).find((c) => c.narracao_ia?.cena === 'c1')!;
    expect(fala1.em).toBe(300);
    expect(doc.audio!.faixas.find((f) => f.clipes.some((c) => c.narracao_ia))?.papel).toBe('voz');
    const diario = projeto.diario();
    expect(diario).toHaveLength(1);
    expect(diario[0]).toMatchObject({autor: 'pessoa', origem: 'interface', rotulo: 'narração por IA: 2 cenas'});
    expect(r.custo_usd).toBeGreaterThan(0);
    expect(usos).toHaveLength(2);
    expect(andamento.at(-1)).toMatchObject({fase: 'pronto', feitas: 2, total: 2});
    expect(r.avisos.join(' ')).toMatch(/fala da cena 2 .* passa do fim da cena/); // 2 s de cena para uma fala longa
  });

  it('nada mudou: nada vai ao Google; mudou só a cena 2: só ela vai; o clipe apagado volta do cache sem chamar a API', async () => {
    const g = criarGoogleFalso();
    const {s} = servicoCom(g.fetch);
    await gerarNarracao(projeto, s, {autor: 'pessoa', origem: 'interface'});
    expect(g.sinteses()).toHaveLength(2);
    const r0 = await gerarNarracao(projeto, s, {autor: 'pessoa', origem: 'interface'});
    expect(r0.geradas).toEqual([]);
    expect(r0.avisos[0]).toMatch(/nada a gerar/);
    expect(g.sinteses()).toHaveLength(2);
    // texto novo na cena 2
    const {versao} = projeto.lerJson('video/video.json');
    projeto.aplicarPatch({documento: 'video/video.json', versao_base: versao, autor: 'pessoa', origem: 'interface', patch: [{op: 'replace', path: '/cenas/1/narracao/texto', value: 'Bata o ponto.'}]});
    expect(itensDaNarracao(lerVideo()).map((i) => i.estado)).toEqual(['gerada', 'desatualizada', 'sem_texto']);
    const r1 = await gerarNarracao(projeto, s, {autor: 'pessoa', origem: 'interface'});
    expect(r1.geradas.map((x) => x.n)).toEqual([2]);
    expect(g.sinteses()).toHaveLength(3);
    expect(g.sinteses()[2].corpo.contents[0].parts[0].text).toBe('Bata o ponto.');
    // volta ao texto antigo: está no cache
    const lido = projeto.lerJson('video/video.json');
    projeto.aplicarPatch({documento: 'video/video.json', versao_base: lido.versao, autor: 'pessoa', origem: 'interface',
      patch: [{op: 'replace', path: '/cenas/1/narracao/texto', value: 'Fale com o RH antes de bater o ponto, todos os dias.'}]});
    const r2 = await gerarNarracao(projeto, s, {autor: 'pessoa', origem: 'interface'});
    expect(r2.geradas).toMatchObject([{n: 2, do_cache: true}]);
    expect(g.sinteses()).toHaveLength(3);
    // refazer: outra tomada, vai ao Google mesmo com o cache
    await gerarNarracao(projeto, s, {cenas: ['c1'], refazer: true, autor: 'pessoa', origem: 'interface'});
    expect(g.sinteses()).toHaveLength(4);
  });

  it('o envelope gravado faz o ducking da música valer na hora (sem a tela medir)', async () => {
    const g = criarGoogleFalso();
    await gerarNarracao(projeto, servicoCom(g.fetch).s, {autor: 'pessoa', origem: 'interface'});
    const doc = lerVideo();
    const envelopes = Object.fromEntries(doc.audio!.faixas.flatMap((f) => f.clipes).filter((c) => c.narracao_ia)
      .map((c) => [c.arquivo, JSON.parse(readFileSync(path.join(pasta, `${c.arquivo}.envelope.json`), 'utf-8'))]));
    const musica = resolverCenas(doc, {envelopes}).props.audio!.faixas.find((f) => f.papel === 'musica')!.clipes[0];
    expect(musica.ducking).toBeDefined();
    expect(musica.ducking!.voz_db).not.toBeNull(); // a voz foi medida
    expect(Math.min(...musica.ducking!.ganho)).toBeLessThan(0.5);
  });

  it('chave ausente: diz onde pôr a chave e não grava nada; chave recusada: erro em pt-BR, nada no vídeo', async () => {
    const g = criarGoogleFalso();
    await expect(gerarNarracao(projeto, servicoCom(g.fetch, {}).s, {autor: 'pessoa', origem: 'interface'})).rejects.toMatchObject({tipo: 'sem_chave',
      message: expect.stringMatching(/falta a chave do Gemini TTS .*Configurações › IA/)});
    expect(g.pedidos).toHaveLength(0);
    const r = await gerarNarracao(projeto, servicoCom(g.fetch, {gemini: 'AIzaERRADA9999'}).s, {autor: 'pessoa', origem: 'interface'});
    expect(r).toMatchObject({ok: false, tipo_erro: 'chave', geradas: []});
    expect(r.erro).toMatch(/foi recusada pelo Google/);
    expect(r.erro).not.toContain('AIzaERRADA9999');
    expect(existsSync(path.join(pasta, 'midia', 'narracao'))).toBe(false);
    expect(projeto.diario()).toHaveLength(0);
  });

  it('erro no meio (cota): o que já foi gerado entra no vídeo, e o erro volta', async () => {
    let n = 0;
    const g = criarGoogleFalso({respostas: [(p) => (p.metodo === 'POST' && ++n === 2 ? new Response(JSON.stringify({error: {code: 429, message: 'Quota', status: 'RESOURCE_EXHAUSTED'}}), {status: 429}) : undefined)]});
    const r = await gerarNarracao(projeto, servicoCom(g.fetch).s, {autor: 'pessoa', origem: 'interface'});
    expect(r).toMatchObject({ok: false, tipo_erro: 'cota'});
    expect(r.geradas.map((x) => x.n)).toEqual([1]);
    expect(itensDaNarracao(lerVideo()).map((i) => i.estado)).toEqual(['gerada', 'pendente', 'sem_texto']);
  });

  it('cancelar entre uma cena e outra', async () => {
    const parar = new AbortController();
    const g = criarGoogleFalso();
    const r = await gerarNarracao(projeto, servicoCom(g.fetch).s, {autor: 'pessoa', origem: 'interface', sinal: parar.signal,
      andamento: (a) => a.fase === 'gerando' && a.feitas === 1 && parar.abort()});
    expect(r.cancelado).toBe(true);
    expect(r.geradas).toHaveLength(1);
  });

  it('Cloud TTS: a mesma máquina, com a voz Chirp e a velocidade', async () => {
    const lido = projeto.lerJson('video/video.json');
    projeto.aplicarPatch({documento: 'video/video.json', versao_base: lido.versao, autor: 'pessoa', origem: 'interface',
      patch: [{op: 'replace', path: '/narracao', value: {provedor: 'google-tts', voz: 'Kore', velocidade: 1.2}}]});
    const g = criarGoogleFalso();
    const r = await gerarNarracao(projeto, servicoCom(g.fetch).s, {cenas: ['1'], autor: 'pessoa', origem: 'interface'});
    expect(r).toMatchObject({ok: true, provedor: 'google-tts', voz: 'pt-BR-Chirp3-HD-Kore'});
    expect(g.sinteses()[0].corpo).toEqual({input: {text: 'Bem-vindo ao treinamento do PIN.'}, voice: {languageCode: 'pt-BR', name: 'pt-BR-Chirp3-HD-Kore'},
      audioConfig: {audioEncoding: 'LINEAR16', speakingRate: 1.2}});
  });

  it('prévia: o texto final, os caracteres e o custo, sem rede', () => {
    const p = previaDaNarracao(projeto, 'video', lerVideo(), {}, servicoCom(criarGoogleFalso().fetch).s);
    expect(p.itens.map((i) => [i.n, i.texto_final, i.caracteres, i.vai_a_api])).toEqual([[1, 'Bem-vindo ao treinamento do pin.', 32, true],
      [2, 'Fale com o RH antes de bater o ponto, todos os dias.', 52, true]]);
    expect(p.total).toMatchObject({a_gerar: 2, vao_a_api: 2, caracteres: 84, tabela: '10/11/2026'});
    expect(p.total.custo_usd).toBeGreaterThan(0);
    expect(p.total.custo_usd).toBeLessThan(0.01);
    expect(p.sem_texto).toEqual([3]);
    expect(p.tem_chave).toBe(true);
  });
});

// ---------- MCP ----------
const conectar = async (servico?: ServicoNarracao, perguntas?: PedidoPortao[]) => {
  const servidor = new McpServer({name: 'estudio', version: 'teste'});
  const portao = perguntas ? {perguntar: async (p: PedidoPortao) => (perguntas.push(p), true)} : undefined;
  registrarFerramentas(servidor, projeto, 'agente', 'teste', undefined, undefined, portao, servico);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const cliente = new Client({name: 'teste', version: '1'});
  await Promise.all([servidor.connect(a), cliente.connect(b)]);
  return cliente;
};
const chamar = async (cliente: Client, name: string, args: Record<string, unknown> = {}) => {
  const r = (await cliente.callTool({name, arguments: args})) as {isError?: boolean; content: {text: string}[]};
  const texto = r.content[0]?.text ?? '';
  return {erro: Boolean(r.isError), texto, tudo: r.content.map((x) => x.text).join('\n'), json: r.isError ? null : JSON.parse(texto)};
};

describe('MCP da narração', () => {
  it('as ferramentas que vão à rede pedem o cartão; narrar com previa: true não pede e não sai do PC', async () => {
    const g = criarGoogleFalso();
    const perguntas: PedidoPortao[] = [];
    const c = await conectar(servicoCom(g.fetch).s, perguntas);
    const ferramentas = (await c.listTools()).tools;
    for (const nome of ['vozes_narracao', 'narrar']) expect(ferramentas.find((t) => t.name === nome)?.annotations?.openWorldHint).toBe(true);
    for (const nome of ['configurar_narracao', 'pronuncias_narracao', 'ajustar_cenas_a_fala']) expect(ferramentas.some((t) => t.name === nome)).toBe(true);
    const p = await chamar(c, 'narrar', {previa: true});
    expect(p.erro).toBe(false);
    expect(perguntas).toHaveLength(0);
    expect(g.pedidos).toHaveLength(0);
    expect(p.json.itens[0].texto_final).toBe('Bem-vindo ao treinamento do pin.');
    expect(p.json.total.custo_usd).toBeGreaterThan(0);
    expect(p.json.cenas.map((x: {estado: string}) => x.estado)).toEqual(['pendente', 'pendente', 'sem_texto']);
    const r = await chamar(c, 'narrar', {cenas: ['c1']});
    expect(perguntas.map((x) => x.ferramenta)).toEqual(['narrar']);
    expect(perguntas[0].motivo).toMatch(/gerar a narração com a IA do Google/);
    expect(r.json).toMatchObject({ok: true, geradas: [{n: 1, do_cache: false}]});
    expect(r.json.proximo.join(' ')).toMatch(/transcrever/);
    expect(r.tudo).toContain('estudio_mudancas'); // o portão juntou o seq: Ver e Reverter no cartão
    await chamar(c, 'vozes_narracao', {provedor: 'google-tts'});
    expect(perguntas.map((x) => x.ferramenta)).toEqual(['narrar', 'vozes_narracao']);
  });

  it('vozes_narracao: Gemini (prontas + estendidas) e Cloud TTS (da chave)', async () => {
    const g = criarGoogleFalso();
    const c = await conectar(servicoCom(g.fetch).s);
    const gem = await chamar(c, 'vozes_narracao');
    expect(gem.json.provedor).toBe('gemini');
    expect(gem.json.vozes).toHaveLength(31);
    const tts = await chamar(c, 'vozes_narracao', {provedor: 'google-tts'});
    expect(tts.json.vozes.map((v: {id: string}) => v.id)).toEqual(['pt-BR-Chirp3-HD-Charon', 'pt-BR-Chirp3-HD-Kore']);
  });

  it('sem o serviço (MCP fora do app e sem variável): a prévia funciona e o resto avisa', async () => {
    const c = await conectar();
    expect((await chamar(c, 'narrar', {previa: true})).json.aviso).toMatch(/não tem o serviço de narração/);
    const r = await chamar(c, 'narrar');
    expect(r.erro).toBe(true);
    expect(r.texto).toMatch(/GEMINI_API_KEY/);
  });

  it('chave recusada no narrar: erro claro para a IA', async () => {
    const g = criarGoogleFalso();
    const c = await conectar(servicoCom(g.fetch, {gemini: 'AIzaERRADA0000'}).s);
    const r = await chamar(c, 'narrar');
    expect(r.erro).toBe(true);
    expect(r.texto).toMatch(/a chave do Gemini foi recusada pelo Google/);
  });

  it('pronuncias_narracao: lê, define, tira, testa e diz quais cenas desatualizaram', async () => {
    const g = criarGoogleFalso();
    const c = await conectar(servicoCom(g.fetch).s);
    expect((await chamar(c, 'pronuncias_narracao')).json.pronuncias).toEqual([{de: 'PIN', para: 'pin'}]);
    await chamar(c, 'narrar');
    const r = await chamar(c, 'pronuncias_narracao', {definir: [{de: 'RH', para: 'erre agá'}], testar: 'O RH e o PIN'});
    expect(r.json.pronuncias).toEqual([{de: 'PIN', para: 'pin'}, {de: 'RH', para: 'erre agá'}]);
    expect(r.json.teste.texto).toBe('O erre agá e o pin');
    expect(r.json.cenas_desatualizadas).toEqual([2]);
    const t = await chamar(c, 'pronuncias_narracao', {tirar: ['PIN']});
    expect(t.json.pronuncias).toEqual([{de: 'RH', para: 'erre agá'}]);
    expect(t.json.cenas_desatualizadas).toEqual([1]);
    expect(projeto.diario().filter((e) => /dicionário de pronúncia/.test(e.rotulo))).toHaveLength(2);
  });

  it('configurar_narracao muda só o que veio e avisa das falas desatualizadas', async () => {
    const g = criarGoogleFalso();
    const c = await conectar(servicoCom(g.fetch).s);
    await chamar(c, 'narrar');
    const r = await chamar(c, 'configurar_narracao', {voz: 'Kore', estilo: 'calmo e didático'});
    expect(r.json.narracao).toMatchObject({provedor: 'gemini', voz: 'Kore', estilo: 'calmo e didático', folga_ms: 300});
    expect(r.json.desatualizadas).toBe(2);
    expect(lerVideo().narracao?.pronuncias).toEqual([{de: 'PIN', para: 'pin'}]); // o dicionário ficou
    const t = await chamar(c, 'configurar_narracao', {provedor: 'google-tts'});
    expect(t.json.narracao).toMatchObject({provedor: 'google-tts', voz: 'pt-BR-Chirp3-HD-Kore', velocidade: 1});
    expect(lerVideo().narracao?.modelo).toBeUndefined();
  });

  it('ajustar_cenas_a_fala: a cena dura a fala + margem, com uma entrada no diário que o Reverter desfaz', async () => {
    const g = criarGoogleFalso();
    const c = await conectar(servicoCom(g.fetch).s);
    expect((await chamar(c, 'ajustar_cenas_a_fala')).json.nada).toMatch(/nenhuma cena tem fala gerada/);
    await chamar(c, 'narrar');
    const antes = lerVideo();
    const r = await chamar(c, 'ajustar_cenas_a_fala', {margem_ms: 400});
    expect(r.json.ok).toBe(true);
    const depois = lerVideo();
    const falas = depois.audio!.faixas.flatMap((f) => f.clipes).filter((x) => x.narracao_ia);
    for (const f of falas) {
      const i = depois.cenas.findIndex((x) => x.id === f.narracao_ia!.cena);
      expect(depois.cenas[i].duracao_ms).toBe(300 + f.duracao_ms + 400);
    }
    expect(itensDaNarracao(depois).every((i) => !i.clipe || i.clipe.em + i.clipe.duracao_ms <= i.t_out)).toBe(true);
    const seq = projeto.diario().at(-1)!.seq;
    expect(projeto.reverter(seq, {autor: 'pessoa', origem: 'reverter'})).toMatchObject({ok: true});
    expect(lerVideo().cenas.map((x) => x.duracao_ms)).toEqual(antes.cenas.map((x) => x.duracao_ms));
    expect(lerVideo().audio).toEqual(antes.audio);
  });

  it('o que o app aplica à mão no clipe gerado (volume, fade) fica quando a cena é gerada de novo', async () => {
    const g = criarGoogleFalso();
    const c = await conectar(servicoCom(g.fetch).s);
    await chamar(c, 'narrar');
    const lido = projeto.lerJson<DocCenas>('video/video.json');
    const fi = lido.doc.audio!.faixas.findIndex((f) => f.clipes.some((x) => x.narracao_ia));
    projeto.aplicarPatch({documento: 'video/video.json', versao_base: lido.versao, autor: 'pessoa', origem: 'interface', patch: [{op: 'add', path: `/audio/faixas/${fi}/clipes/0/volume`, value: 0.8}]});
    await chamar(c, 'narrar', {cenas: ['1'], refazer: true});
    expect(lerVideo().audio!.faixas[fi].clipes[0]).toMatchObject({volume: 0.8, narracao_ia: {cena: 'c1'}});
  });

  it('apagar o WAV do cache deixa a cena desatualizada, e narrar põe de volta', async () => {
    const g = criarGoogleFalso();
    const c = await conectar(servicoCom(g.fetch).s);
    const r = await chamar(c, 'narrar', {cenas: ['1']});
    unlinkSync(path.join(pasta, r.json.geradas[0].arquivo));
    expect((await chamar(c, 'narrar', {previa: true})).json.cenas[0]).toMatchObject({estado: 'desatualizada'});
    await chamar(c, 'narrar');
    expect(existsSync(path.join(pasta, r.json.geradas[0].arquivo))).toBe(true);
  });
});
