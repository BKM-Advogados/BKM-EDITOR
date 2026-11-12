// O contrato das ferramentas do MCP (auditoria MCP): a trava otimista do aplicar_patch (M9), a tela que vai até o
// documento criado e a ferramenta mostrar_documento (M10), o cartão do escolher_trilha (M11), os avisos de efeito
// inválido (M14), o ler_documento grande (M16) e o comentário ancorado no que existe (M18). Tudo em processo, sem build.
import {cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {claudeMd} from '../src/nucleo/criar-projeto';
import type {Modulo} from '../src/nucleo/documentos';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {INSTRUCOES_MCP} from '../src/nucleo/mcp-ia';
import {definirPastaTrilhas} from '../src/nucleo/pasta-trilhas';
import {classeDe} from '../src/nucleo/portao';
import {Projeto} from '../src/nucleo/projeto';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-contrato-'));
const pasta = path.join(tmp, 'proj');
let cliente: Client;
let projeto: Projeto;

type Res = {isError?: boolean; content: {text: string}[]};
const chamar = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await cliente.callTool({name, arguments: args})) as Res;
  const t = r.content.map((c) => c.text).join('\n');
  let dado: any = t;
  try {
    dado = JSON.parse(r.content[0]?.text ?? '');
  } catch {
    /* texto */
  }
  return {erro: Boolean(r.isError), dado, texto: t};
};

beforeAll(async () => {
  cpSync(path.join(__dirname, 'fixtures', 'projeto'), pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
  projeto = new Projeto(pasta);
  const servidor = new McpServer({name: 'estudio', version: '0'});
  registrarFerramentas(servidor, projeto, 'agente', 'teste');
  const [a, b] = InMemoryTransport.createLinkedPair();
  await servidor.connect(a);
  cliente = new Client({name: 'teste', version: '0'});
  await cliente.connect(b);
});

afterAll(async () => {
  await cliente?.close();
  rmSync(tmp, {recursive: true, force: true});
});

describe('trava otimista e formato do documento (M9)', () => {
  it('versao_base vazia é recusada pelo esquema e não grava', async () => {
    const antes = readFileSync(path.join(pasta, '3d', 'cena.json'), 'utf-8');
    const r = await chamar('aplicar_patch', {documento: 'cena3d', versao_base: '', patch: [{op: 'replace', path: '/objetos/0/cor', value: '#000000'}]});
    expect(r.erro).toBe(true);
    expect(r.texto).toMatch(/versao/);
    expect(readFileSync(path.join(pasta, '3d', 'cena.json'), 'utf-8')).toBe(antes);
  });

  it('no núcleo, "" confere a versão (conflito); sem versao_base passa, como na tela e no reverter', () => {
    expect(() => projeto.aplicarPatch({documento: 'cena3d', versao_base: '', patch: [{op: 'replace', path: '/fundo', value: '#010101'}], autor: 'agente', origem: 't'}))
      .toThrow(/o documento mudou/);
    const r = projeto.aplicarPatch({documento: 'cena3d', patch: [{op: 'replace', path: '/fundo', value: '#020202'}], autor: 'pessoa', origem: 'interface'});
    expect(r.versao).toBeTruthy();
    projeto.reverter(r.entrada.seq, {autor: 'pessoa', origem: 'interface'});
  });

  it('um patch não troca o documento por algo que não é objeto nem o tira do módulo dele', async () => {
    const versao = (await chamar('ler_documento', {documento: 'cena3d'})).dado.versao;
    const raiz = await chamar('aplicar_patch', {documento: 'cena3d', versao_base: versao, patch: [{op: 'replace', path: '', value: 42}]});
    expect(raiz.erro).toBe(true);
    expect(raiz.texto).toMatch(/objeto JSON/);
    const semObjetos = await chamar('aplicar_patch', {documento: 'cena3d', versao_base: versao, patch: [{op: 'remove', path: '/objetos'}]});
    expect(semObjetos.erro).toBe(true);
    expect(semObjetos.texto).toMatch(/deixaria de ser uma cena 3D/);
    const img = await chamar('ler_documento', {documento: 'capa'});
    const semCamadas = await chamar('aplicar_patch', {documento: 'capa', versao_base: img.dado.versao, patch: [{op: 'remove', path: '/camadas'}]});
    expect(semCamadas.texto).toMatch(/deixaria de ser uma imagem/);
    expect(typeof JSON.parse(readFileSync(path.join(pasta, '3d', 'cena.json'), 'utf-8'))).toBe('object');
  });

  it('o roteiro antigo do vídeo (que não é de cenas) continua editável', async () => {
    const lido = await chamar('ler_documento', {documento: 'carrossel'});
    expect(lido.dado.conteudo.tipo).not.toBe('cenas');
    const r = await chamar('aplicar_patch', {documento: 'carrossel', versao_base: lido.dado.versao, patch: [{op: 'add', path: '/nota_teste', value: 'ok'}]});
    expect(r.erro, r.texto).toBe(false);
  });
});



describe('documento criado vai para a tela; mostrar_documento (M10)', () => {
  const selecao = () => JSON.parse(readFileSync(path.join(pasta, '.estudio', 'selecao.json'), 'utf-8'));
  const apagarSelecao = () => rmSync(path.join(pasta, '.estudio', 'selecao.json'), {force: true});

  it('criar_documento e criar_animacao levam a tela ao documento novo por padrão', async () => {
    apagarSelecao();
    const img = await chamar('criar_documento', {modulo: 'imagem', titulo: 'Nova'});
    expect(img.erro, img.texto).toBe(false);
    expect(img.dado).toMatchObject({ok: true, mostrado: true});
    expect(selecao()).toMatchObject({documento: img.dado.id, caminhos: [], autor: 'agente'});
    const anim = await chamar('criar_animacao', {titulo: 'Abertura'});
    expect(anim.erro, anim.texto).toBe(false);
    expect(anim.dado).toMatchObject({ok: true, mostrado: true});
    expect(selecao()).toMatchObject({documento: anim.dado.documento, caminhos: []});
  });

  it('com mostrar: false, cria sem mexer na tela', async () => {
    apagarSelecao();
    const r = await chamar('criar_documento', {modulo: '3d', titulo: 'Quieta', mostrar: false});
    expect(r.dado).toMatchObject({ok: true, mostrado: false});
    const a = await chamar('criar_animacao', {titulo: 'Quieta', mostrar: false});
    expect(a.dado).toMatchObject({ok: true, mostrado: false});
    expect(existsSync(path.join(pasta, '.estudio', 'selecao.json'))).toBe(false);
  });

  it('criar_documento com largura sem altura dá erro em vez de ignorar', async () => {
    const r = await chamar('criar_documento', {modulo: 'imagem', largura: 800});
    expect(r.erro).toBe(true);
    expect(r.texto).toMatch(/largura e altura juntas/);
  });

  it('mostrar_documento grava o pedido com caminho e tempo; documento ou caminho inexistente dá nao_achado', async () => {
    const r = await chamar('mostrar_documento', {documento: 'capa', caminho: '/camadas/0', tempo_ms: 1200});
    expect(r.dado).toMatchObject({ok: true, documento: 'capa', modulo: 'imagem'});
    expect(selecao()).toMatchObject({documento: 'capa', caminhos: ['/camadas/0'], tempo_ms: 1200, autor: 'agente'});
    expect((await chamar('mostrar_documento', {documento: 'imagem/capa.json'})).dado).toMatchObject({documento: 'capa'});
    const sem = await chamar('mostrar_documento', {documento: 'nao-existe'});
    expect(sem.erro).toBe(true);
    expect(sem.texto).toMatch(/^nao_achado:/);
    const semCaminho = await chamar('mostrar_documento', {documento: 'capa', caminho: '/camadas/999'});
    expect(semCaminho.erro).toBe(true);
    expect(semCaminho.texto).toMatch(/^nao_achado: o caminho \/camadas\/999 não existe/);
  });
});

describe('o guia do projeto cobre as ferramentas (M13)', () => {
  // ferramentas de um módulo só: aparecem no guia de um projeto com aquele módulo; as outras aparecem em qualquer guia
  const DO_MODULO: Record<string, Modulo[]> = {
    ...Object.fromEntries(['criar_animacao', 'adicionar_camada_animacao', 'animar', 'pixelizar_imagem', 'efeito_pixel', 'ver_animacao'].map((n) => [n, ['animacao']])),
    ...Object.fromEntries(['ler_musica', 'arranjar', 'medir_musica', 'por_no_video', 'levar_para', 'concluir_transicao', 'cancelar_transicao', 'trocar_kit', 'criar_padrao',
      'escrever_notas', 'editar_notas', 'aplicar_progressao', 'gerar_notas', 'encaixar_no_video', 'exportar_musica', 'importar_midi', 'licencas_do_projeto'].map((n) => [n, ['musica']])),
    ...Object.fromEntries(['transcrever', 'ler_legendas', 'editar_legenda', 'exportar_legendas', 'importar_legendas', 'propor_cortes_fala', 'aplicar_cortes_fala',
      'preparar_teleprompter', 'adicionar_clipe_audio', 'dividir_clipe', 'copiar_clipe', 'crossfade', 'listar_trilhas', 'escolher_trilha', 'creditos_das_musicas',
      'marca_dagua', 'medir_contraste_marca', 'vozes_narracao', 'configurar_narracao', 'pronuncias_narracao', 'narrar', 'ajustar_cenas_a_fala'].map((n) => [n, ['video']])),
    ...Object.fromEntries(['ver_quadro', 'ver_cenas', 'ver_trecho'].map((n) => [n, ['video', 'animacao']])), // frente IDE: prévias do vídeo
    ...Object.fromEntries(['remover_fundo', 'selecionar_camadas', 'alinhar_camadas', 'distribuir_camadas', 'agrupar_camadas', 'desagrupar_camadas', 'travar_camadas',
      'destravar_camadas', 'buscar_icone', 'inserir_icone', 'inserir_linha', 'fazer_lista', 'ver_marca', 'cor_da_marca', 'fonte_da_marca'].map((n) => [n, ['imagem']])),
    ...Object.fromEntries(['ler_fonte', 'anotar_fonte', 'registrar_fato', 'listar_pesquisa', 'texto_da_fonte', 'checar_texto'].map((n) => [n, ['video', 'imagem']])),
    aplicar_marca: ['video', 'imagem', 'animacao'],
    ...Object.fromEntries(['medir_loudness', 'medir_envelope', 'limpar_voz'].map((n) => [n, ['video']])), ver_imagem: ['imagem'], ver_cena_3d: ['3d'], // frente 3 do MCP
  };
  const TODOS: Modulo[] = ['video', 'imagem', '3d', 'musica', 'animacao'];

  it('cada ferramenta registrada está no guia dos módulos dela', async () => {
    const {tools} = await cliente.listTools();
    const faltam: string[] = [];
    for (const {name} of tools) {
      for (const m of DO_MODULO[name] ?? TODOS) if (!claudeMd([m]).includes(`\`${name}`)) faltam.push(`${name} (${m})`);
    }
    expect(faltam).toEqual([]);
  });

  it('a frase do criar_documento cita os 5 módulos e o mostrar; as instruções citam música e animação', () => {
    const frase = claudeMd(['3d']).split('\n').find((l) => l.includes('`criar_documento` cria'))!;
    for (const m of ['vídeo de cenas', 'imagem', 'cena 3D', 'música', 'animação']) expect(frase).toContain(m);
    expect(claudeMd(['3d'])).toContain('`mostrar: false`');
    expect(INSTRUCOES_MCP).toMatch(/música e animação/);
  });

  it('kit de marca na animação e seção de Música só onde cabem', () => {
    expect(claudeMd(['animacao'])).toMatch(/Na animação grava o `tema`/);
    expect(claudeMd(['musica'])).toContain('## Música');
    expect(claudeMd(['video'])).not.toContain('## Música');
  });
});

describe('escolher_trilha pede a permissão da pessoa (M11)', () => {
  const trilhas = path.join(tmp, 'trilhas');
  afterAll(() => definirPastaTrilhas(null));

  it('é da classe cartão; negado, nada vai para midia/', async () => {
    expect(classeDe('escolher_trilha')).toBe('cartao');
    mkdirSync(trilhas, {recursive: true});
    writeFileSync(path.join(trilhas, 'minha.wav'), 'bytes minha');
    definirPastaTrilhas(() => trilhas);
    const video = (await chamar('criar_documento', {modulo: 'video', titulo: 'Com trilha', mostrar: false})).dado.id as string;
    const perguntas: string[] = [];
    const servidor = new McpServer({name: 'estudio', version: '0'});
    registrarFerramentas(servidor, projeto, 'agente', 'teste', undefined, undefined, {perguntar: async (p) => (perguntas.push(p.ferramenta), false)});
    const [a, b] = InMemoryTransport.createLinkedPair();
    await servidor.connect(a);
    const c = new Client({name: 'negado', version: '0'});
    await c.connect(b);
    const r = (await c.callTool({name: 'escolher_trilha', arguments: {documento: video, trilha: 'minha'}})) as Res;
    expect(r.isError).toBe(true);
    expect(perguntas).toEqual(['escolher_trilha']);
    expect(readdirSync(path.join(pasta, 'midia')).filter((f) => f.startsWith('minha'))).toEqual([]);
    await c.close();
  });
});

describe('efeito inválido volta como aviso (M14)', () => {
  it('aplicar_patch com tipo de efeito que não existe na imagem devolve o aviso', async () => {
    const lido = await chamar('ler_documento', {documento: 'capa'});
    const op = lido.dado.conteudo.efeitos === undefined
      ? {op: 'add', path: '/efeitos', value: [{id: 'e9', tipo: 'explosao', valor: 'muito'}]}
      : {op: 'add', path: '/efeitos/-', value: {id: 'e9', tipo: 'explosao', valor: 'muito'}};
    const r = await chamar('aplicar_patch', {documento: 'capa', versao_base: lido.dado.versao, patch: [op]});
    expect(r.erro, r.texto).toBe(false);
    expect(r.dado.avisos.join('\n')).toMatch(/explosao/);
  });
});

describe('comentário ancorado no que existe (M18)', () => {
  it('objeto inexistente e tempo negativo dão erro e não criam comentário', async () => {
    const antes = projeto.comentarios().length;
    const r = await chamar('criar_comentario', {documento: 'capa', texto: 'olhe aqui', objeto: '/camadas/999'});
    expect(r.erro).toBe(true);
    expect(r.texto).toMatch(/não existe em capa/);
    expect((await chamar('criar_comentario', {documento: 'capa', texto: 'olhe aqui', tempo_ms: -5000})).erro).toBe(true);
    expect(projeto.comentarios().length).toBe(antes);
    const ok = await chamar('criar_comentario', {documento: 'capa', texto: 'olhe aqui', objeto: '/camadas/0', tempo_ms: 0});
    expect(ok.erro, ok.texto).toBe(false);
  });
});

describe('ler_documento num documento grande (M16)', () => {
  it('uma animação de 2 MB com grades volta abaixo de 200 KB, com versão e aviso; o caminho lê a grade inteira', async () => {
    const id = (await chamar('criar_animacao', {titulo: 'Grande', mostrar: false})).dado.documento as string;
    const rel = projeto.arquivoDoDocumento(id);
    const {doc, versao} = projeto.lerJson<{camadas: unknown[]}>(rel);
    const celulas = '0123456789abcdef'.repeat(1024); // 128x128
    const camadas = Array.from({length: 120}, (_, i) => ({id: `px-${i}`, nome: `Pixel ${i}`, tipo: 'pixel', x: 0, y: 0, largura: 256, altura: 256,
      tamanho_pixel: 2, progresso: 1, efeito: 'aleatorio', semente: 1, grade: {colunas: 128, linhas: 128, paleta: ['#000000', '#FFFFFF'], celulas}}));
    projeto.aplicarPatch({documento: rel, versao_base: versao, patch: [{op: 'replace', path: '/camadas', value: [...doc.camadas, ...camadas]}], autor: 'pessoa', origem: 'teste'});
    expect(readFileSync(path.join(pasta, rel), 'utf-8').length).toBeGreaterThan(1_900_000);
    const r = await chamar('ler_documento', {documento: id});
    expect(r.texto.length).toBeLessThan(200_000);
    expect(r.dado.versao).toBe(projeto.lerJson(rel).versao);
    expect(r.dado.aviso).toMatch(/120 grade/);
    const n = doc.camadas.length;
    expect(r.dado.conteudo.camadas[n].grade).toMatchObject({colunas: 128, linhas: 128, celulas: expect.stringMatching(/^<16384 células/)});
    expect(r.dado.aviso).toContain(`/camadas/${n}/grade/celulas`);
    const uma = await chamar('ler_documento', {documento: id, caminho: `/camadas/${n}/grade/celulas`});
    expect(uma.dado).toMatchObject({conteudo: celulas, versao: r.dado.versao});
  });

  it('documento pequeno vem inteiro, sem aviso', async () => {
    const r = await chamar('ler_documento', {documento: 'capa'});
    expect(r.dado.aviso).toBeUndefined();
    expect(Array.isArray(r.dado.conteudo.camadas)).toBe(true);
  });
});
