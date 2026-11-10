// listar_midia e marcar_midia pelo MCP (frente Casca, rodada 3): o painel e a IA veem a mesma lista.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {gravarPlano, planoDoProjeto} from '../src/nucleo/criar-projeto';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {Projeto} from '../src/nucleo/projeto';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-mcp-midia-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));

const destino = gravarPlano(path.join(tmp, 'projeto'), planoDoProjeto({nome: 'Mídia MCP', modelo: 'video-branco'}));
const escrever = (rel: string, dados: Buffer | string) => {
  mkdirSync(path.dirname(path.join(destino, rel)), {recursive: true});
  writeFileSync(path.join(destino, rel), dados);
};

let cliente: Client;
const chamar = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await cliente.callTool({name, arguments: args})) as {isError?: boolean; content: {text: string}[]};
  const t = r.content[0].text;
  let dado: any = t;
  try {
    dado = JSON.parse(t);
  } catch {
    /* mensagem de erro em texto */
  }
  return {erro: Boolean(r.isError), dado};
};

beforeAll(async () => {
  const servidor = new McpServer({name: 'estudio', version: '0'});
  registrarFerramentas(servidor, new Projeto(destino), 'agente', 'teste');
  const [a, b] = InMemoryTransport.createLinkedPair();
  await servidor.connect(a);
  cliente = new Client({name: 'teste', version: '0'});
  await cliente.connect(b);
});

describe('listar_midia', () => {
  it('projeto sem mídia diz o que fazer', async () => {
    const r = await chamar('listar_midia');
    expect(r.erro).toBe(false);
    expect(r.dado).toMatchObject({total_no_projeto: 0, achados: 0, arquivos: []});
    expect(r.dado.aviso).toMatch(/midia\/ está vazia/);
  });

  it('lista com tipo, tamanho, derivados sob o original e onde é usada', async () => {
    escrever('midia/narracao.wav', Buffer.alloc(100));
    escrever('midia/narracao.wav.palavras.json', '{}');
    escrever('midia/foto.png', Buffer.alloc(100));
    escrever('midia/tomadas/c2.mp4', Buffer.alloc(100));
    const p = new Projeto(destino);
    const doc = p.manifesto().documentos[0];
    const lido = p.lerJson(doc.caminho);
    p.aplicarPatch({
      documento: doc.id,
      versao_base: lido.versao,
      autor: 'pessoa',
      origem: 'interface',
      patch: [{op: 'add', path: '/cenas/0/blocos/-', value: {id: 'foto', tipo: 'imagem', src: 'midia/foto.png', ajuste: 'cobrir', em: 0, sai: 1000, x: 0, y: 0, largura: 1, altura: 1}}],
    });
    const r = await chamar('listar_midia');
    expect(r.dado).toMatchObject({total_no_projeto: 3, achados: 3, mostrados: 3});
    const por = (c: string) => r.dado.arquivos.find((a: {caminho: string}) => a.caminho === c);
    expect(por('midia/narracao.wav')).toMatchObject({tipo: 'audio', derivados: [{tipo: 'transcrição', caminho: 'midia/narracao.wav.palavras.json'}]});
    expect(por('midia/foto.png').usada_em).toEqual([doc.id]);
    expect(por('midia/tomadas/c2.mp4').usada_em).toBeUndefined();
    expect(r.dado.arquivos.some((a: {caminho: string}) => a.caminho.endsWith('.palavras.json'))).toBe(false);
  });

  it('filtros, busca e limite', async () => {
    expect((await chamar('listar_midia', {tipo: 'video'})).dado.arquivos.map((a: {caminho: string}) => a.caminho)).toEqual(['midia/tomadas/c2.mp4']);
    expect((await chamar('listar_midia', {busca: 'transcrito'})).dado.arquivos.map((a: {caminho: string}) => a.caminho)).toEqual(['midia/narracao.wav']);
    expect((await chamar('listar_midia', {pasta: 'midia/tomadas'})).dado.achados).toBe(1);
    const so1 = (await chamar('listar_midia', {limite: 1})).dado;
    expect(so1).toMatchObject({achados: 3, mostrados: 1});
    expect((await chamar('listar_midia', {tipo: 'ninguem'})).erro).toBe(true); // valor fora da lista é recusado pelo esquema
  });
});

describe('marcar_midia', () => {
  it('marca, anota e aparece na lista, com o seq do diário', async () => {
    const r = await chamar('marcar_midia', {caminho: 'midia/tomadas/c2.mp4', estado: 'boa', nota: 'a do gancho'});
    expect(r.erro).toBe(false);
    expect(r.dado).toMatchObject({documento: 'midia/marcas.json', caminho: 'midia/tomadas/c2.mp4', marca: {estado: 'boa', nota: 'a do gancho'}});
    expect(typeof r.dado.seq).toBe('number');
    const lista = (await chamar('listar_midia', {marca: 'boa'})).dado;
    expect(lista.arquivos).toEqual([expect.objectContaining({caminho: 'midia/tomadas/c2.mp4', marca: 'boa', nota: 'a do gancho'})]);
    expect((await chamar('listar_midia', {marca: 'sem_marca'})).dado.achados).toBe(2);
    const diario = (await chamar('listar_mudancas', {desde: r.dado.seq - 1})).dado as {seq: number; autor: string; origem: string}[];
    expect(diario.find((e) => e.seq === r.dado.seq)).toMatchObject({autor: 'agente', origem: 'teste'});
  });

  it('estado "nenhuma" tira a marca; só a nota também vale', async () => {
    const tirou = await chamar('marcar_midia', {caminho: 'midia/tomadas/c2.mp4', estado: 'nenhuma', nota: ''});
    expect(tirou.dado.marca).toBeNull();
    const nota = await chamar('marcar_midia', {caminho: 'midia/foto.png', nota: 'usar na capa'});
    expect(nota.dado.marca).toEqual({nota: 'usar na capa'});
  });

  it('recusa o que não dá: sem estado nem nota, fora de midia/, derivado, arquivo inexistente', async () => {
    expect((await chamar('marcar_midia', {caminho: 'midia/foto.png'})).erro).toBe(true);
    expect((await chamar('marcar_midia', {caminho: 'estudio.json', estado: 'boa'})).dado).toMatch(/só se marca arquivo de midia/);
    expect((await chamar('marcar_midia', {caminho: 'midia/narracao.wav.palavras.json', estado: 'boa'})).dado).toMatch(/marque o original/);
    expect((await chamar('marcar_midia', {caminho: 'midia/nao-existe.wav', estado: 'boa'})).dado).toMatch(/não achado/);
    expect((await chamar('marcar_midia', {caminho: 'midia/foto.png', estado: 'otima'})).erro).toBe(true);
  });

  it('o esquema das duas ferramentas não tem campo livre (z.any) nem união solta, para qualquer provedor de IA', async () => {
    const {tools} = await cliente.listTools();
    for (const nome of ['listar_midia', 'marcar_midia']) {
      const schema = tools.find((t) => t.name === nome)!.inputSchema as {properties: Record<string, Record<string, unknown>>};
      for (const [campo, def] of Object.entries(schema.properties)) {
        expect(Object.keys(def).length, `${nome}.${campo} sem tipo`).toBeGreaterThan(0);
        expect(def.anyOf ?? def.oneOf, `${nome}.${campo} é união solta`).toBeUndefined();
      }
    }
    expect(tools.find((t) => t.name === 'listar_midia')!.description!.length).toBeLessThan(420);
  });
});
