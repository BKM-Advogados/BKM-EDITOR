// Onda B, frente 2: o Plano do vídeo (src/nucleo/plano-video.ts, mcp-plano.ts). O núcleo (ler, escrever, decidir,
// texto e próximo passo), o plano no Projeto (diário, Reverter, plano.json fora do aplicar_patch) e as três ferramentas
// pelo MCP: com o portão (app aberto, a pessoa confirma o aprovar_plano) e sem ele (stdio, a aprovação da conversa basta).
// E o guia: a seção "Planejar antes de montar" em todo módulo. Tudo em pasta temporária.
import {cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {claudeMd, guiaDoProjeto} from '../src/nucleo/criar-projeto';
import {INSTRUCOES_MCP} from '../src/nucleo/mcp-ia';
import {classeDe} from '../src/nucleo/portao';
import {ARQUIVO_PLANO, decidirPlano, escreverPlano, lerPlano, planoEmTexto, proximoPasso, type ConteudoPlano} from '../src/nucleo/plano-video';
import {Projeto} from '../src/nucleo/projeto';
import type {Modulo} from '../src/nucleo/documentos';

type Res = {isError?: boolean; content: {type: string; text: string}[]};
const textoDe = (r: unknown) => (r as Res).content.map((c) => c.text).join('\n');
const jsonDe = (r: unknown) => JSON.parse((r as Res).content[0].text);

const CONTEUDO: ConteudoPlano = {
  objetivo: '  Explicar férias proporcionais  ',
  publico: 'trabalhadores da indústria',
  formato_e_duracao: 'Reels 9:16, cerca de 40 s',
  roteiro: [
    {cena: 'Abertura', mostra: 'Título "Férias proporcionais"', fala: 'Você saiu da empresa antes de um ano?', duracao_s: 6},
    {cena: 'A regra', mostra: 'Número 1/12 por mês trabalhado', duracao_s: 12},
    {cena: 'Fecho', mostra: 'Frase de fecho', fala: '  ', duracao_s: 0},
  ],
  midia: {usar: ['midia/logo.png', ' '], falta: ['foto de uma fábrica']},
  narracao: 'narração por IA, voz calma',
  musica: 'trilha leve sob a voz',
  notas: 'supus Reels por ser o formato marcado',
};

let tmp = '';
const novoProjeto = (nome: string) => {
  const p = path.join(tmp, nome);
  cpSync(path.join(__dirname, 'fixtures', 'projeto'), p, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
  return p;
};
const conectar = async (raiz: string, origem: string, perguntar?: () => Promise<boolean>) => {
  const s = new McpServer({name: 'estudio', version: '0'});
  registrarFerramentas(s, new Projeto(raiz), 'agente', origem, undefined, undefined, perguntar ? {perguntar} : undefined);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await s.connect(a);
  const c = new Client({name: 'teste', version: '0'});
  await c.connect(b);
  return c;
};
const ARGS = {
  objetivo: 'Explicar férias proporcionais', publico: 'trabalhadores', formato_e_duracao: 'Reels 9:16, 40 s',
  roteiro: [{cena: 'Abertura', mostra: 'Título', duracao_s: 5}, {cena: 'Regra', mostra: '1/12 por mês', fala: 'A cada mês, 1/12.'}],
  midia_usar: ['midia/logo.png'], midia_falta: ['foto da fábrica'], narracao: 'voz da pessoa', musica: 'nenhuma',
};

beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-plano-'));
});
afterAll(() => rmSync(tmp, {recursive: true, force: true, maxRetries: 10, retryDelay: 100}));

describe('o plano no núcleo', () => {
  it('escrever limpa os textos, tira o vazio, começa na revisão 1 e espera a pessoa', () => {
    const p = escreverPlano(null, CONTEUDO, 'Claude 1', '2026-11-12T10:00:00Z');
    expect(p).toMatchObject({formato: 1, estado: 'aguardando', revisao: 1, objetivo: 'Explicar férias proporcionais', escrito: {por: 'Claude 1'}});
    expect(p.roteiro[2]).toEqual({cena: 'Fecho', mostra: 'Frase de fecho'}); // fala em branco e duração 0 saem
    expect(p.midia).toEqual({usar: ['midia/logo.png'], falta: ['foto de uma fábrica']});
    expect(p.decisao).toBeUndefined();
  });

  it('recusa plano sem cena ou sem objetivo', () => {
    expect(() => escreverPlano(null, {...CONTEUDO, roteiro: []}, 'x', 'y')).toThrow(/pelo menos uma cena/);
    expect(() => escreverPlano(null, {...CONTEUDO, objetivo: '  '}, 'x', 'y')).toThrow(/objetivo/);
  });

  it('decidir: aprovar e ajustar a revisão vista; revisão velha é conflito; ajuste vazio e sem plano são recusados', () => {
    const p = escreverPlano(null, CONTEUDO, 'Claude 1', 'agora');
    expect(decidirPlano(p, 1, {decisao: 'aprovar'}, 'pessoa', 'depois')).toMatchObject({estado: 'aprovado', decisao: {por: 'pessoa', em: 'depois'}});
    const ajuste = decidirPlano(p, 1, {decisao: 'ajustar', ajuste: ' troque a música por nenhuma '}, 'pessoa', 'depois');
    expect(ajuste).toMatchObject({estado: 'ajustar', decisao: {ajuste: 'troque a música por nenhuma'}});
    expect(() => decidirPlano(p, 2, {decisao: 'aprovar'}, 'pessoa', 'x')).toThrow(/revisão 1; a vista era a 2/);
    expect(() => decidirPlano(p, 1, {decisao: 'ajustar', ajuste: ' '}, 'pessoa', 'x')).toThrow(/o que ajustar/);
    expect(() => decidirPlano(null, 1, {decisao: 'aprovar'}, 'pessoa', 'x')).toThrow(/não há plano/);
    // reescrever sobe a revisão, volta a aguardar e tira a decisão anterior
    const refeito = escreverPlano(ajuste, CONTEUDO, 'Claude 1', 'mais tarde');
    expect(refeito).toMatchObject({revisao: 2, estado: 'aguardando'});
    expect('decisao' in refeito).toBe(false);
  });

  it('ler tolera o arquivo: sem revisão (ou revertido a {}) não é plano; campos estranhos viram vazios', () => {
    expect(lerPlano({})).toBeNull();
    expect(lerPlano(null)).toBeNull();
    expect(lerPlano([])).toBeNull();
    const p = lerPlano({revisao: 3, estado: 'outro', roteiro: [null, {cena: 1, mostra: 'x', duracao_s: -1}], midia: {usar: 'a', falta: ['b', 2]}});
    expect(p).toMatchObject({revisao: 3, estado: 'aguardando', objetivo: '', roteiro: [{cena: '', mostra: 'x'}], midia: {usar: [], falta: ['b']}, escrito: {por: '?'}});
  });

  it('o texto mostra cada parte do plano e a soma do roteiro; o próximo passo segue o estado', () => {
    const p = escreverPlano(null, CONTEUDO, 'Claude 1', 'agora');
    const t = planoEmTexto(p);
    for (const s of ['Plano do vídeo (revisão 1, esperando a aprovação)', '**Objetivo:** Explicar férias proporcionais', '**Público:** trabalhadores',
      'Reels 9:16, cerca de 40 s (roteiro soma 18 s)', '1. **Abertura** (6 s): Título', 'Fala: "Você saiu', 'Vai usar: midia/logo.png', 'Falta: foto de uma fábrica',
      '**Narração:** narração por IA', '**Música:** trilha leve', '**Notas:** supus Reels']) expect(t).toContain(s);
    expect(proximoPasso(null)).toMatch(/até 3 perguntas/);
    expect(proximoPasso(p)).toMatch(/Não monte ainda.*aprovar_plano \{revisao: 1\}/);
    expect(proximoPasso(decidirPlano(p, 1, {decisao: 'aprovar'}, 'pessoa', 'x'))).toMatch(/^Plano aprovado/);
    expect(proximoPasso(decidirPlano(p, 1, {decisao: 'ajustar', ajuste: 'mais curto'}, 'pessoa', 'x'))).toMatch(/"mais curto".*não monte ainda/);
  });
});

describe('o plano no projeto: diário, Reverter e fora do aplicar_patch', () => {
  it('cada escrita e decisão vai ao diário; reverter a decisão volta a aguardar, e reverter a primeira escrita apaga o plano', () => {
    const p = new Projeto(novoProjeto('diario'));
    expect(p.plano()).toBeNull();
    const quem = {autor: 'agente', origem: 'Claude 1', rotulo: 'plano do vídeo escrito'};
    p.alterarPlano((a) => escreverPlano(a, CONTEUDO, 'Claude 1', 'agora'), quem);
    p.alterarPlano((a) => decidirPlano(a, 1, {decisao: 'aprovar'}, 'pessoa', 'depois'), {autor: 'pessoa', origem: 'interface', rotulo: 'plano aprovado'});
    expect(p.plano()?.estado).toBe('aprovado');
    const [escrita, aprovacao] = p.diario().slice(-2);
    expect(escrita).toMatchObject({documento: ARQUIVO_PLANO, origem: 'Claude 1'});
    expect(aprovacao).toMatchObject({documento: ARQUIVO_PLANO, autor: 'pessoa', rotulo: 'plano aprovado'});
    expect(p.reverter(aprovacao.seq, {autor: 'pessoa', origem: 'reverter'}).ok).toBe(true);
    expect(p.plano()).toMatchObject({estado: 'aguardando', revisao: 1});
    expect(p.plano()?.decisao).toBeUndefined();
    expect(p.reverter(escrita.seq, {autor: 'pessoa', origem: 'reverter', forcar: true}).ok).toBe(true);
    expect(p.plano()).toBeNull();
  });

  it('decisão recusada não grava nem entra no diário', () => {
    const p = new Projeto(novoProjeto('recusa'));
    p.alterarPlano((a) => escreverPlano(a, CONTEUDO, 'Claude 1', 'agora'), {autor: 'agente', origem: 'Claude 1', rotulo: 'x'});
    const antes = readFileSync(path.join(p.raiz, ARQUIVO_PLANO), 'utf-8');
    const n = p.diario().length;
    expect(() => p.alterarPlano((a) => decidirPlano(a, 7, {decisao: 'aprovar'}, 'pessoa', 'x'), {autor: 'pessoa', origem: 'interface', rotulo: 'x'})).toThrow(/mudou/);
    expect(readFileSync(path.join(p.raiz, ARQUIVO_PLANO), 'utf-8')).toBe(antes);
    expect(p.diario().length).toBe(n);
  });

  it('o aplicar_patch não alcança o plano.json (não é documento do manifesto)', () => {
    const p = new Projeto(novoProjeto('patch'));
    writeFileSync(path.join(p.raiz, ARQUIVO_PLANO), '{"revisao": 1}\n');
    expect(() => p.arquivoDoDocumento(ARQUIVO_PLANO)).toThrow();
  });
});

describe('as ferramentas do plano pelo MCP', () => {
  it('ler sem plano, escrever, ler de novo: o mesmo plano, a revisão e o próximo passo; as mudanças voltam no resultado', async () => {
    const c = await conectar(novoProjeto('mcp'), 'Claude 1');
    expect(jsonDe(await c.callTool({name: 'ler_plano', arguments: {}}))).toMatchObject({existe: false, proximo_passo: expect.stringMatching(/escrever_plano/)});
    const r = await c.callTool({name: 'escrever_plano', arguments: ARGS});
    expect(jsonDe(r)).toMatchObject({existe: true, estado: 'aguardando', revisao: 1, plano: {midia: {usar: ['midia/logo.png'], falta: ['foto da fábrica']}, escrito: {por: 'Claude 1'}}});
    expect(textoDe(r)).toContain('"estudio_mudancas"'); // o portão põe a entrada do diário: o cartão oferece Reverter
    const lido = jsonDe(await c.callTool({name: 'ler_plano', arguments: {}}));
    expect(lido.texto).toContain('2. **Regra**: 1/12 por mês');
    expect(jsonDe(await c.callTool({name: 'escrever_plano', arguments: {...ARGS, musica: 'trilha leve'}})).revisao).toBe(2);
  });

  it('escrever_plano recusa roteiro vazio; aprovar_plano recusa revisão velha', async () => {
    const c = await conectar(novoProjeto('mcp-recusa'), 'Claude 1');
    expect((await c.callTool({name: 'escrever_plano', arguments: {...ARGS, roteiro: []}})).isError).toBe(true);
    await c.callTool({name: 'escrever_plano', arguments: ARGS});
    await c.callTool({name: 'escrever_plano', arguments: ARGS});
    const velho = await c.callTool({name: 'aprovar_plano', arguments: {revisao: 1}});
    expect(velho.isError).toBe(true);
    expect(textoDe(velho)).toMatch(/conflito: o plano mudou/);
  });

  it('aprovar_plano é da pessoa: com o app, o portão pergunta (negado não aprova); sem o app, a aprovação da conversa grava', async () => {
    expect(classeDe('aprovar_plano')).toBe('cartao');
    expect(classeDe('escrever_plano')).toBe('livre');
    expect(classeDe('ler_plano')).toBe('livre');
    const raiz = novoProjeto('mcp-portao');
    let resposta = false;
    let perguntas = 0;
    const app = await conectar(raiz, 'Claude 1', async () => (perguntas++, resposta));
    await app.callTool({name: 'escrever_plano', arguments: ARGS});
    expect((await app.callTool({name: 'aprovar_plano', arguments: {revisao: 1}})).isError).toBe(true);
    expect(new Projeto(raiz).plano()?.estado).toBe('aguardando');
    resposta = true;
    expect(jsonDe(await app.callTool({name: 'aprovar_plano', arguments: {revisao: 1}}))).toMatchObject({estado: 'aprovado', plano: {decisao: {por: 'pessoa, pela conversa (Claude 1)'}}});
    expect(perguntas).toBe(2);
    // sem portão (MCP por stdio da IDE ou do Claude Desktop com o app fechado)
    const raiz2 = novoProjeto('mcp-stdio');
    const ide = await conectar(raiz2, 'Claude Code (IDE)');
    await ide.callTool({name: 'escrever_plano', arguments: ARGS});
    expect(jsonDe(await ide.callTool({name: 'aprovar_plano', arguments: {revisao: 1}})).estado).toBe('aprovado');
  });
});

describe('o guia ensina a planejar', () => {
  const TODOS: Modulo[] = ['video', 'imagem', '3d', 'musica', 'animacao'];

  it('a seção vem antes de "Como trabalhar" em todo módulo, com as perguntas, o plano, a aprovação e o pedido pequeno', () => {
    for (const m of TODOS) {
      const md = claudeMd([m]);
      const i = md.indexOf('## Planejar antes de montar');
      expect(i).toBeGreaterThan(0);
      expect(i).toBeLessThan(md.indexOf('## Como trabalhar'));
      const secao = md.slice(i, md.indexOf('## Como trabalhar'));
      for (const s of ['No máximo 3 perguntas', 'sugestão de resposta', '`escrever_plano`', 'objetivo, público, formato e duração, roteiro cena a cena',
        '`ler_plano`', '`aprovado`', '`ajustar`', '`aprovar_plano` {revisao}', 'Nunca aprove por ela', 'Pedido pequeno não tem plano', 'trocar uma cor']) expect(secao).toContain(s);
      expect(secao).not.toMatch(/^\d+\. /m); // sem lista numerada fora de "Como trabalhar"
      expect(md).toContain('- `plano.json`: o Plano do vídeo');
    }
  });

  it('o mesmo texto no AGENTS.md e no GEMINI.md; as instruções do servidor também mandam planejar', () => {
    for (const arq of ['AGENTS.md', 'GEMINI.md'] as const) expect(guiaDoProjeto(['video'], arq)).toContain('## Planejar antes de montar');
    expect(INSTRUCOES_MCP).toMatch(/escrever_plano/);
    expect(INSTRUCOES_MCP).toMatch(/Pedido pequeno vai direto/);
  });
});
