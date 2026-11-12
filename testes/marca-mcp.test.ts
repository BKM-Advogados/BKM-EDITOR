// Frente 2 do MCP: os kits de marca da pessoa pelas ferramentas (src/nucleo/mcp-marca-edicao.ts): listar, criar (em branco
// ou cópia), editar, importar logo e fonte, e o kit editado chegando ao documento por aplicar_marca. A pasta dos kits é
// temporária (definirPastaMarcas, como o app faz com a das preferências).
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {marcaEditada} from '../src/nucleo/mcp-marca-edicao';
import {MARCA_NEUTRO} from '../src/nucleo/marca';
import {definirPastaMarcas} from '../src/nucleo/pasta-marcas';
import {classeDe} from '../src/nucleo/portao';
import {Projeto} from '../src/nucleo/projeto';

type Res = {isError?: boolean; content: {type: string; text: string}[]};
const textoDe = (r: unknown) => (r as Res).content.map((c) => c.text).join('\n');
const jsonDe = (r: unknown) => JSON.parse((r as Res).content[0].text);

let tmp = '';
let marcas = '';
let fora = '';
let raiz = '';
let c: Client;

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-marca-mcp-'));
  marcas = path.join(tmp, 'marcas');
  fora = path.join(tmp, 'fora');
  mkdirSync(fora, {recursive: true});
  writeFileSync(path.join(fora, 'logo do escritório.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  writeFileSync(path.join(fora, 'Archivo-Bold.ttf'), Buffer.from('nao e uma fonte de verdade'));
  writeFileSync(path.join(fora, 'leia-me.txt'), 'x');
  definirPastaMarcas(() => marcas);
  raiz = path.join(tmp, 'proj');
  cpSync(path.join(__dirname, 'fixtures', 'projeto'), raiz, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
  const s = new McpServer({name: 'estudio', version: '0'});
  registrarFerramentas(s, new Projeto(raiz), 'agente', 'teste');
  const [a, b] = InMemoryTransport.createLinkedPair();
  await s.connect(a);
  c = new Client({name: 'teste', version: '0'});
  await c.connect(b);
});

afterAll(async () => {
  await c?.close();
  definirPastaMarcas(null);
  rmSync(tmp, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
});

describe('kits de marca pelo MCP', () => {
  it('listar_marcas cria o neutro de fábrica e mostra cores e fontes; é livre, as outras são cartão', async () => {
    const r = jsonDe(await c.callTool({name: 'listar_marcas', arguments: {}}));
    expect(r.marcas[0]).toMatchObject({id: 'neutro', nome: 'Neutro', cores: {fundo: MARCA_NEUTRO.cores.fundo}});
    expect(r.marcas[0].pasta).toBeUndefined(); // o caminho no disco não vai para a IA
    expect(classeDe('listar_marcas')).toBe('livre');
    for (const n of ['criar_marca', 'editar_marca', 'importar_logo_marca', 'importar_fonte_marca']) expect(classeDe(n)).toBe('cartao');
  });

  it('criar_marca em branco, editar cores, fontes e assinatura; texto vazio apaga; nada a mudar e cor inválida são recusados', async () => {
    const criada = jsonDe(await c.callTool({name: 'criar_marca', arguments: {nome: 'Escritório Silva'}}));
    expect(criada.marca).toMatchObject({id: 'escritorio-silva', nome: 'Escritório Silva', cores: {fundo: MARCA_NEUTRO.cores.fundo}});
    expect(existsSync(path.join(marcas, 'escritorio-silva', 'marca.json'))).toBe(true);
    const editada = jsonDe(await c.callTool({name: 'editar_marca', arguments: {marca: 'escritorio-silva', destaque: '#c8a24b', fundo: '#0B1F33',
      fonte_titulo: 'Archivo', assinatura: '@silva.adv', notas: 'tons de azul e dourado'}}));
    expect(editada.marca).toMatchObject({cores: {destaque: '#C8A24B', fundo: '#0B1F33'}, fontes: {titulo: 'Archivo'}, assinatura: '@silva.adv'});
    expect(editada.avisos).toBeUndefined();
    const semNota = jsonDe(await c.callTool({name: 'editar_marca', arguments: {marca: 'escritorio-silva', notas: '', fonte_texto: 'Fonte Inventada'}}));
    expect(semNota.marca.notas).toBeUndefined();
    expect(semNota.marca.assinatura).toBe('@silva.adv');
    expect(semNota.avisos[0]).toMatch(/Fonte Inventada.*importar_fonte_marca/);
    expect((await c.callTool({name: 'editar_marca', arguments: {marca: 'escritorio-silva'}})).isError).toBe(true);
    expect((await c.callTool({name: 'editar_marca', arguments: {marca: 'escritorio-silva', fundo: 'azul'}})).isError).toBe(true);
    expect((await c.callTool({name: 'editar_marca', arguments: {marca: 'nao-existe', fundo: '#000000'}})).isError).toBe(true);
    expect((await c.callTool({name: 'editar_marca', arguments: {marca: '../fora', fundo: '#000000'}})).isError).toBe(true);
  });

  it('importar logo e fonte copiam para a pasta do kit; extensão errada é recusada; a cópia de um kit leva logo e fontes', async () => {
    const comLogo = jsonDe(await c.callTool({name: 'importar_logo_marca', arguments: {marca: 'escritorio-silva', caminho: path.join(fora, 'logo do escritório.png')}}));
    expect(comLogo.marca.logo).toBe('logo.png');
    expect(readFileSync(path.join(marcas, 'escritorio-silva', 'logo.png'))).toEqual(readFileSync(path.join(fora, 'logo do escritório.png')));
    expect((await c.callTool({name: 'importar_logo_marca', arguments: {marca: 'escritorio-silva', caminho: path.join(fora, 'leia-me.txt')}})).isError).toBe(true);
    const comFonte = jsonDe(await c.callTool({name: 'importar_fonte_marca', arguments: {marca: 'escritorio-silva', caminho: path.join(fora, 'Archivo-Bold.ttf')}}));
    expect(comFonte.marca.fontes.arquivos).toEqual([{familia: 'Archivo', arquivo: 'fontes/Archivo-Bold.ttf', peso: 700}]);
    expect(existsSync(path.join(marcas, 'escritorio-silva', 'fontes', 'Archivo-Bold.ttf'))).toBe(true);
    const dita = jsonDe(await c.callTool({name: 'importar_fonte_marca', arguments: {marca: 'escritorio-silva', caminho: path.join(fora, 'Archivo-Bold.ttf'),
      familia: 'Silva Sans', peso: 600}}));
    expect(dita.marca.fontes.arquivos).toEqual([{familia: 'Silva Sans', arquivo: 'fontes/Archivo-Bold.ttf', peso: 600}]);
    expect((await c.callTool({name: 'importar_fonte_marca', arguments: {marca: 'escritorio-silva', caminho: path.join(fora, 'leia-me.txt')}})).isError).toBe(true);
    const copia = jsonDe(await c.callTool({name: 'criar_marca', arguments: {nome: 'Silva 2', a_partir_de: 'escritorio-silva'}}));
    expect(copia.marca).toMatchObject({id: 'silva-2', nome: 'Silva 2', logo: 'logo.png', cores: {destaque: '#C8A24B'}});
    expect(existsSync(path.join(marcas, 'silva-2', 'fontes', 'Archivo-Bold.ttf'))).toBe(true);
  });

  it('o kit editado chega ao documento com aplicar_marca', async () => {
    const r = jsonDe(await c.callTool({name: 'aplicar_marca', arguments: {id: 'escritorio-silva', documento: 'capa'}}));
    expect(r).toMatchObject({ok: true, marca: 'escritorio-silva', documento: 'capa'});
    const vista = textoDe(await c.callTool({name: 'ver_marca', arguments: {documento: 'capa'}}));
    expect(vista).toMatch(/Escritório Silva/);
    expect(vista).toMatch(/#C8A24B/);
    expect(new Projeto(raiz).diario().slice(-1)[0]).toMatchObject({rotulo: 'kit de marca: Escritório Silva', origem: 'teste'});
  });

  it('marcaEditada só muda o que vier e apaga mono vazio', () => {
    const m = {...MARCA_NEUTRO, id: 'x', fontes: {...MARCA_NEUTRO.fontes, mono: 'IBM Plex Mono'}};
    const e = marcaEditada(m, {fonte_mono: '', suave: '#123456'});
    expect(e.fontes.mono).toBeUndefined();
    expect(e.cores).toEqual({...MARCA_NEUTRO.cores, suave: '#123456'});
    expect(e.nome).toBe(MARCA_NEUTRO.nome);
  });
});
