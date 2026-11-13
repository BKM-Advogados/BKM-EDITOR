// Onda B, tela inicial: "Salvar como modelo" (src/nucleo/pasta-modelos.ts). O projeto (ou um documento) vira um modelo na
// pasta de modelos da pessoa com os documentos e só a mídia que eles citam, sem diário, git, conversas, saidas/ nem
// pesquisa; criar a partir dele dá um projeto limpo (pastaLivre, CLAUDE.md e .gitignore novos), com o kit por cima se vier
// um; a pessoa renomeia e remove os dela, e os de fábrica não moram ali. A ferramenta salvar_como_modelo é "cartao".
// Tudo em pastas temporárias (definirPastaModelos, como o app faz com a das preferências).
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {DocCenas} from '../src/nucleo/cenas';
import {claudeMd, documentoNovo, gravarPlano, planoDoProjeto} from '../src/nucleo/criar-projeto';
import type {Manifesto} from '../src/nucleo/documentos';
import {registrarModelos} from '../src/nucleo/mcp-modelos';
import {registrarTrocaDeProjeto, trocadorSemApp} from '../src/nucleo/mcp-projeto';
import {MODELOS} from '../src/nucleo/modelos';
import {criarPastaDoModelo} from '../src/nucleo/novo-projeto';
import {PastaMarcas} from '../src/nucleo/pasta-marcas';
import {definirPastaModelos, midiaCitada, PastaModelos, pastaModelos} from '../src/nucleo/pasta-modelos';
import {classeDe} from '../src/nucleo/portao';
import {Projeto, serializar} from '../src/nucleo/projeto';

let tmp = '';
let raiz = '';
let pastaDosModelos = '';
let modelos: PastaModelos;
let projeto: Projeto;

const arquivosDe = (p: string, rel = ''): string[] =>
  existsSync(path.join(p, rel)) ? readdirSync(path.join(p, rel), {withFileTypes: true}).flatMap((d) => {
    const r = rel ? `${rel}/${d.name}` : d.name;
    return d.isDirectory() ? arquivosDe(p, r) : [r];
  }) : [];

beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-modelos-'));
  pastaDosModelos = path.join(tmp, 'modelos');
  definirPastaModelos(() => pastaDosModelos);
  modelos = new PastaModelos();
  // um projeto de vídeo 9:16 que cita uma imagem e uma fonte, com uma imagem sem uso, um segundo documento (imagem) e
  // tudo o que não pode ir para o modelo: diário, git, conversas, saidas/, pesquisa e comentários
  raiz = path.join(tmp, 'Campanha');
  gravarPlano(raiz, planoDoProjeto({nome: 'Campanha', modelo: 'video-branco', formato: {largura: 1080, altura: 1920}}));
  projeto = new Projeto(raiz);
  const doc = projeto.lerJson<DocCenas>('video/video.json').doc;
  doc.cenas[0].blocos.push({id: 'foto', tipo: 'imagem', x: 0.1, y: 0.1, largura: 0.8, altura: 0.4, src: 'midia/fotos/capa.png'});
  doc.cenas[0].blocos.push({id: 'sumida', tipo: 'imagem', x: 0.1, y: 0.6, largura: 0.8, altura: 0.2, src: 'midia/nao-existe.png'});
  (doc.tema as Record<string, unknown>).fontes_arquivos = [{familia: 'Minha Sans', arquivo: 'fontes/MinhaSans.ttf'}];
  writeFileSync(path.join(raiz, 'video', 'video.json'), serializar(doc));
  const m = projeto.manifesto();
  const {entrada, conteudo} = documentoNovo(m, 'imagem', {formato: {largura: 1080, altura: 1350}});
  writeFileSync(path.join(raiz, 'estudio.json'), serializar({...m, documentos: [...m.documentos, entrada]} satisfies Manifesto));
  mkdirSync(path.join(raiz, 'imagem'), {recursive: true});
  writeFileSync(path.join(raiz, entrada.caminho), serializar(conteudo));
  mkdirSync(path.join(raiz, 'midia', 'fotos'), {recursive: true});
  writeFileSync(path.join(raiz, 'midia', 'fotos', 'capa.png'), 'png de mentira');
  writeFileSync(path.join(raiz, 'midia', 'sobra.png'), 'nenhum documento cita');
  mkdirSync(path.join(raiz, 'fontes'), {recursive: true});
  writeFileSync(path.join(raiz, 'fontes', 'MinhaSans.ttf'), 'fonte de mentira');
  mkdirSync(path.join(raiz, '.git'), {recursive: true});
  writeFileSync(path.join(raiz, '.git', 'HEAD'), 'ref: refs/heads/main');
  mkdirSync(path.join(raiz, '.estudio', 'conversas'), {recursive: true});
  writeFileSync(path.join(raiz, '.estudio', 'diario.jsonl'), '{"seq":1}\n');
  writeFileSync(path.join(raiz, '.estudio', 'conversas', 'c1.json'), '{}');
  writeFileSync(path.join(raiz, '.estudio', 'miniatura.jpg'), 'jpg de mentira');
  mkdirSync(path.join(raiz, 'saidas'), {recursive: true});
  writeFileSync(path.join(raiz, 'saidas', 'video.mp4'), 'mp4');
  mkdirSync(path.join(raiz, 'pesquisa'), {recursive: true});
  writeFileSync(path.join(raiz, 'pesquisa', 'pesquisa.json'), '{}');
  writeFileSync(path.join(raiz, 'comentarios.json'), '[]');
});
afterAll(() => {
  definirPastaModelos(null);
  rmSync(tmp, {recursive: true, force: true});
});

describe('pasta dos modelos', () => {
  it('fica ao lado das marcas: a das preferências no app, ESTUDIO_MODELOS fora dele, ~/Estudio/meus-modelos sem nada (modelos/ é a do whisper)', () => {
    expect(pastaModelos()).toBe(pastaDosModelos);
    definirPastaModelos(null);
    const antes = process.env.ESTUDIO_MODELOS;
    process.env.ESTUDIO_MODELOS = path.join(tmp, 'outra');
    expect(pastaModelos()).toBe(path.join(tmp, 'outra'));
    delete process.env.ESTUDIO_MODELOS;
    expect(pastaModelos()).toBe(path.join(os.homedir(), 'Estudio', 'meus-modelos'));
    if (antes !== undefined) process.env.ESTUDIO_MODELOS = antes;
    definirPastaModelos(() => pastaDosModelos);
    expect(modelos.listar()).toEqual([]); // pasta que ainda não existe: lista vazia
  });

  it('acha a mídia citada em qualquer lugar do documento, só em midia/ e fontes/, sem sair da pasta', () => {
    expect(midiaCitada({a: 'midia/x.png', b: [{c: 'fontes/F.ttf'}, 'video/video.json', 'midia/../fora.txt', 'texto midia/y.png'], d: 'midia\\z.wav'}))
      .toEqual(['fontes/F.ttf', 'midia/x.png', 'midia/z.wav']);
  });
});

describe('salvar como modelo', () => {
  it('leva os documentos e só a mídia citada; o diário, o git, as conversas, saidas/ e a pesquisa ficam', () => {
    const m = modelos.salvar(projeto, {nome: 'Campanha semanal', descricao: 'post da semana'});
    expect(m).toMatchObject({id: 'campanha-semanal', nome: 'Campanha semanal', descricao: 'post da semana', modulo: 'video', largura: 1080, altura: 1920, de_projeto: 'Campanha'});
    expect(m.documentos.map((d) => d.modulo)).toEqual(['video', 'imagem']);
    expect(m.copiados.sort()).toEqual(['fontes/MinhaSans.ttf', 'midia/fotos/capa.png']);
    expect(m.faltando).toEqual(['midia/nao-existe.png']);
    expect(m.miniatura).toMatch(/^data:image\/jpeg;base64,/);
    expect(arquivosDe(m.pasta).sort()).toEqual(['miniatura.jpg', 'modelo.json', 'projeto/estudio.json', 'projeto/fontes/MinhaSans.ttf', 'projeto/imagem/imagem.json',
      'projeto/midia/fotos/capa.png', 'projeto/video/video.json']);
    expect(readFileSync(path.join(m.pasta, 'projeto', 'video', 'video.json'), 'utf-8')).toBe(readFileSync(path.join(raiz, 'video', 'video.json'), 'utf-8'));
    // nada de pasta temporária esquecida
    expect(readdirSync(pastaDosModelos)).toEqual(['campanha-semanal']);
  });

  it('só o documento ativo: o manifesto do modelo tem só ele, e a mídia é só a dele', () => {
    const m = modelos.salvar(projeto, {nome: 'Capa de post', documento: 'imagem'});
    expect(m).toMatchObject({id: 'capa-de-post', modulo: 'imagem', largura: 1080, altura: 1350});
    expect(m.documentos.map((d) => d.id)).toEqual(['imagem']);
    expect(m.copiados).toEqual([]);
    expect(m.miniatura).toBeUndefined(); // a miniatura é do projeto inteiro
    expect(arquivosDe(m.pasta).sort()).toEqual(['modelo.json', 'projeto/estudio.json', 'projeto/imagem/imagem.json']);
  });

  it('nome repetido ganha outro id; nome vazio e documento que não há são recusados', () => {
    expect(modelos.salvar(projeto, {nome: 'Campanha semanal'}).id).toBe('campanha-semanal-2');
    expect(() => modelos.salvar(projeto, {nome: '   '})).toThrow(/nome/);
    expect(() => modelos.salvar(projeto, {nome: 'X', documento: 'nao-existe'})).toThrow();
  });
});

describe('a pessoa renomeia e remove os dela; os de fábrica não moram aqui', () => {
  it('lista por nome, renomeia sem trocar a pasta e remove a pasta inteira', () => {
    expect(modelos.listar().map((m) => m.nome)).toEqual(['Campanha semanal', 'Campanha semanal', 'Capa de post']);
    const r = modelos.renomear('campanha-semanal-2', 'Campanha do mês');
    expect(r).toMatchObject({id: 'campanha-semanal-2', nome: 'Campanha do mês'});
    expect(modelos.listar().map((m) => m.nome)).toEqual(['Campanha do mês', 'Campanha semanal', 'Capa de post']);
    modelos.remover('campanha-semanal-2');
    expect(existsSync(path.join(pastaDosModelos, 'campanha-semanal-2'))).toBe(false);
    expect(modelos.listar().map((m) => m.id)).toEqual(['campanha-semanal', 'capa-de-post']);
  });

  it('modelo de fábrica e id que sai da pasta são recusados', () => {
    for (const f of MODELOS) {
      expect(() => modelos.renomear(f.id, 'outro')).toThrow(/não achado/);
      expect(() => modelos.remover(f.id)).toThrow(/não achado/);
    }
    for (const id of ['..', '../fora', 'a/b', '.oculto', '']) expect(() => modelos.remover(id)).toThrow(/inválido/);
  });

  it('modelo.json ilegível fica fora da lista sem derrubar os outros', () => {
    mkdirSync(path.join(pastaDosModelos, 'quebrado'), {recursive: true});
    writeFileSync(path.join(pastaDosModelos, 'quebrado', 'modelo.json'), '{não é json');
    expect(modelos.listar().map((m) => m.id)).toEqual(['campanha-semanal', 'capa-de-post']);
    rmSync(path.join(pastaDosModelos, 'quebrado'), {recursive: true});
  });
});

describe('criar a partir do modelo', () => {
  it('copia documentos e mídia para uma pasta nova, com CLAUDE.md e .gitignore novos e sem histórico', () => {
    const destino = path.join(tmp, 'projetos');
    const {raiz: novo, nome} = criarPastaDoModelo({modelos, id: 'campanha-semanal', pasta: destino});
    expect(nome).toBe('Campanha semanal');
    expect(path.basename(novo)).toBe('Campanha semanal');
    const p = new Projeto(novo);
    expect(p.manifesto().nome).toBe('Campanha semanal');
    expect(p.manifesto().documentos.map((d) => d.id)).toEqual(['video', 'imagem']);
    expect(readFileSync(path.join(novo, 'video', 'video.json'), 'utf-8')).toBe(readFileSync(path.join(raiz, 'video', 'video.json'), 'utf-8'));
    expect(readFileSync(path.join(novo, 'midia', 'fotos', 'capa.png'), 'utf-8')).toBe('png de mentira');
    expect(existsSync(path.join(novo, 'fontes', 'MinhaSans.ttf'))).toBe(true);
    expect(readFileSync(path.join(novo, 'CLAUDE.md'), 'utf-8')).toBe(claudeMd(['video', 'imagem']));
    expect(existsSync(path.join(novo, '.gitignore'))).toBe(true);
    for (const fora of ['.git', '.estudio/diario.jsonl', '.estudio/conversas', 'midia/sobra.png', 'pesquisa', 'comentarios.json', 'saidas/video.mp4', 'modelo.json', 'miniatura.jpg']) {
      expect(existsSync(path.join(novo, fora)), fora).toBe(false);
    }
    // a segunda vez é outra pasta, com o nome dito
    const dois = criarPastaDoModelo({modelos, id: 'campanha-semanal', pasta: destino});
    expect(path.basename(dois.raiz)).toBe('Campanha semanal (2)');
    expect(path.basename(criarPastaDoModelo({modelos, id: 'capa-de-post', nome: 'Post de sexta', pasta: destino}).raiz)).toBe('Post de sexta');
  });

  it('com um kit de marca, o tema dos documentos vira o do kit, como nos modelos de fábrica', () => {
    const marcas = new PastaMarcas({pasta: () => path.join(tmp, 'marcas')});
    const kit = marcas.criar('Kit de teste');
    marcas.gravar({...kit, cores: {...kit.cores, destaque: '#C0FFEE'}});
    const {raiz: novo} = criarPastaDoModelo({modelos, id: 'campanha-semanal', nome: 'Com kit', marca: marcas.ler(kit.id), pasta: path.join(tmp, 'projetos')});
    expect(new Projeto(novo).lerJson<DocCenas>('video/video.json').doc.tema.destaque).toBe('#C0FFEE');
  });

  it('modelo que não existe é recusado', () => {
    expect(() => criarPastaDoModelo({modelos, id: 'nao-existe', pasta: path.join(tmp, 'projetos')})).toThrow(/não achado/);
  });
});

describe('salvar_como_modelo pelo MCP', () => {
  it('é da classe cartão e grava na mesma pasta de modelos', async () => {
    expect(classeDe('salvar_como_modelo')).toBe('cartao');
    const s = new McpServer({name: 'estudio', version: '0'});
    registrarModelos(s, projeto);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await s.connect(a);
    const c = new Client({name: 'teste', version: '0'});
    await c.connect(b);
    const r = (await c.callTool({name: 'salvar_como_modelo', arguments: {nome: 'Pelo agente', documento: 'video'}})) as {isError?: boolean; content: {text: string}[]};
    expect(r.isError).toBeFalsy();
    const dado = JSON.parse(r.content[0].text);
    expect(dado).toMatchObject({ok: true, modelo: {id: 'pelo-agente', modulo: 'video', largura: 1080, altura: 1920}, copiados: ['fontes/MinhaSans.ttf', 'midia/fotos/capa.png']});
    expect(dado.aviso).toMatch(/midia\/nao-existe\.png/);
    expect(modelos.listar().map((m) => m.id)).toContain('pelo-agente');
    const vazio = (await c.callTool({name: 'salvar_como_modelo', arguments: {nome: 'X', documento: 'nao-existe'}})) as {isError?: boolean};
    expect(vazio.isError).toBe(true);
    await c.close();
  });
});

describe('criar projeto a partir de um modelo seu pelo MCP', () => {
  const conectar = async (pastaProjetos: string) => {
    const s = new McpServer({name: 'estudio', version: '0'});
    registrarModelos(s, projeto);
    registrarTrocaDeProjeto(s, trocadorSemApp({pastaProjetos, atual: () => null, usar: () => undefined, modelos}));
    const [a, b] = InMemoryTransport.createLinkedPair();
    await s.connect(a);
    const c = new Client({name: 'teste', version: '0'});
    await c.connect(b);
    return c;
  };
  const jsonDe = (r: unknown) => JSON.parse((r as {content: {text: string}[]}).content[0].text);

  it('listar_modelos é livre e mostra os modelos da pessoa; criar_projeto {modelo_proprio} cria a partir de um', async () => {
    expect(classeDe('listar_modelos')).toBe('livre');
    const destino = path.join(tmp, 'projetos-mcp');
    const c = await conectar(destino);
    const lista = jsonDe(await c.callTool({name: 'listar_modelos', arguments: {}}));
    expect(lista.modelos.map((m: {id: string}) => m.id)).toEqual(modelos.listar().map((m) => m.id));
    expect(lista.modelos.length).toBeGreaterThan(0);
    const id = lista.modelos[0].id as string;
    expect(lista.modelos[0]).toMatchObject({id, nome: modelos.ler(id).nome, modulo: modelos.ler(id).modulo});
    const r = jsonDe(await c.callTool({name: 'criar_projeto', arguments: {modelo_proprio: id, nome: 'Do meu modelo'}}));
    expect(r).toMatchObject({ok: true, nome: 'Do meu modelo', pasta: path.join(destino, 'Do meu modelo')});
    expect(existsSync(path.join(destino, 'Do meu modelo', 'estudio.json'))).toBe(true);
    expect(r.documentos.length).toBe(modelos.ler(id).documentos.length);
    await c.close();
  });

  it('id inexistente dá erro claro, sem criar pasta; modelo_proprio com modelo ou formato é recusado', async () => {
    const destino = path.join(tmp, 'projetos-mcp-erro');
    const c = await conectar(destino);
    const nada = (await c.callTool({name: 'criar_projeto', arguments: {modelo_proprio: 'nao-existe'}})) as {isError?: boolean; content: {text: string}[]};
    expect(nada.isError).toBe(true);
    expect(nada.content[0].text).toMatch(/modelo não achado: nao-existe/);
    expect(existsSync(destino) ? readdirSync(destino) : []).toEqual([]);
    const dois = (await c.callTool({name: 'criar_projeto', arguments: {modelo_proprio: 'x', modelo: 'video-branco'}})) as {isError?: boolean; content: {text: string}[]};
    expect(dois.isError).toBe(true);
    expect(dois.content[0].text).toMatch(/modelo_proprio/);
    const fmt = (await c.callTool({name: 'criar_projeto', arguments: {modelo_proprio: 'x', formato: 'reels'}})) as {isError?: boolean};
    expect(fmt.isError).toBe(true);
    await c.close();
  });

  it('com a pasta de modelos vazia, listar_modelos avisa em vez de falhar', async () => {
    const vazia = new PastaModelos({pasta: () => path.join(tmp, 'sem-modelos')});
    const s = new McpServer({name: 'estudio', version: '0'});
    registrarModelos(s, projeto, vazia);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await s.connect(a);
    const c = new Client({name: 'teste', version: '0'});
    await c.connect(b);
    const r = jsonDe(await c.callTool({name: 'listar_modelos', arguments: {}}));
    expect(r.modelos).toEqual([]);
    expect(r.aviso).toMatch(/salvar_como_modelo/);
    await c.close();
  });
});
