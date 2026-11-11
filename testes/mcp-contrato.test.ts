// O contrato das ferramentas do MCP (auditoria MCP): a trava otimista do aplicar_patch (M9), a tela que vai até o
// documento criado e a ferramenta mostrar_documento (M10), o cartão do escolher_trilha (M11), os avisos de efeito
// inválido (M14), o ler_documento grande (M16) e o comentário ancorado no que existe (M18). Tudo em processo, sem build.
import {cpSync, existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
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


