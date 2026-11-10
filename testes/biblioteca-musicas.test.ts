// Biblioteca de músicas livres com curadoria (rodada 3, frente Som): a ficha de licença (nenhuma faixa NC, ND ou SA), a pasta
// de trilhas com as fichas, a trilha que não se copia de novo a cada uso (som-D12) e as ferramentas MCP listar_trilhas,
// escolher_trilha e creditos_das_musicas. O catálogo proposto (docs/musicas-livres-proposta.json) passa pelo mesmo validador.
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {arquivoDaFicha, creditosDas, linhaDeCredito, recusaDaLicenca, validarCatalogo, validarFicha, type FichaFaixa} from '../src/nucleo/biblioteca-musicas';
import {novoDocCenas, type DocCenas} from '../src/nucleo/cenas';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {definirPastaTrilhas, importarTrilha, lerFicha, listarTrilhas} from '../src/nucleo/pasta-trilhas';
import {Projeto} from '../src/nucleo/projeto';

const ficha = (extra: Record<string, unknown> = {}) => ({
  id: 'macleod-calma', titulo: 'Calma', autor: 'Fulano de Tal', url_pagina: 'https://exemplo.org/faixa/calma', licenca: 'CC-BY-4.0', url_licenca: 'https://creativecommons.org/licenses/by/4.0/',
  conferido_em: '2026-11-08', atribuicao: '“Calma” de Fulano de Tal (exemplo.org), CC BY 4.0', duracao_s: 120, humor: 'calmo', genero: 'ambiente', ...extra,
});

describe('ficha de licença', () => {
  it('aceita CC0, domínio público, CC BY 4.0 e 3.0; recusa NC, ND, SA e licença do site, com o motivo', () => {
    for (const l of ['CC0-1.0', 'PDM-1.0', 'CC-BY-4.0', 'CC-BY-3.0']) expect(recusaDaLicenca(l)).toBeNull();
    expect(recusaDaLicenca('CC BY-NC 4.0')).toMatch(/não comercial/);
    expect(recusaDaLicenca('CC-BY-NC-SA-4.0')).toMatch(/não comercial/);
    expect(recusaDaLicenca('CC-BY-ND-4.0')).toMatch(/derivações/);
    expect(recusaDaLicenca('cc by-sa 4.0')).toMatch(/compartilhar igual/);
    expect(recusaDaLicenca('Licença Pixabay')).toMatch(/não aceita/);
    expect(recusaDaLicenca('')).toMatch(/não diz a licença/);
  });

  it('a ficha completa passa; faltando campo, ou com crédito sem texto, não', () => {
    expect(validarFicha(ficha()).ficha).toMatchObject({id: 'macleod-calma', licenca: 'CC-BY-4.0', duracao_s: 120});
    expect(validarFicha(ficha({licenca: 'CC0-1.0', atribuicao: undefined})).ficha?.licenca).toBe('CC0-1.0');
    expect(validarFicha(ficha({atribuicao: undefined})).erros.join(' ')).toMatch(/exige o crédito/);
    expect(validarFicha(ficha({id: 'Com Espaço'})).erros.join(' ')).toMatch(/slug/);
    expect(validarFicha(ficha({url_pagina: 'http://sem-https.org'})).erros.join(' ')).toMatch(/url_pagina/);
    expect(validarFicha(ficha({conferido_em: '08/11/2026'})).erros.join(' ')).toMatch(/AAAA-MM-DD/);
    expect(validarFicha(ficha({sha256: 'abc'})).erros.join(' ')).toMatch(/sha256/);
    expect(validarFicha(ficha({licenca: 'CC-BY-NC-4.0'})).erros.join(' ')).toMatch(/não comercial/);
    expect(validarFicha(null).erros).toEqual(['a ficha não é um objeto']);
  });

  it('o catálogo separa as que servem das recusadas e recusa o id repetido', () => {
    const r = validarCatalogo({faixas: [ficha(), ficha({id: 'outra', licenca: 'CC-BY-ND-4.0'}), ficha(), ficha({id: 'zero', licenca: 'CC0-1.0', atribuicao: null})]});
    expect(r.faixas.map((f) => f.id)).toEqual(['macleod-calma', 'zero']);
    expect(r.recusadas.map((x) => x.id)).toEqual(['outra', 'macleod-calma']);
    expect(r.recusadas[1].erros).toEqual(['id repetido no catálogo']);
  });

  it('o crédito sai só para a licença que pede, e a mesma faixa não se repete', () => {
    const a = validarFicha(ficha()).ficha as FichaFaixa;
    const b = validarFicha(ficha({id: 'zero', licenca: 'CC0-1.0', atribuicao: undefined})).ficha as FichaFaixa;
    expect(linhaDeCredito(a)).toBe('“Calma” de Fulano de Tal (exemplo.org), CC BY 4.0 (CC BY 4.0: https://creativecommons.org/licenses/by/4.0/)');
    expect(linhaDeCredito(b)).toBeNull();
    const c = creditosDas([{arquivo: 'midia/a.mp3', ficha: a}, {arquivo: 'midia/a (2).mp3', ficha: a}, {arquivo: 'midia/b.mp3', ficha: b}]);
    expect(c.creditos.map((x) => x.titulo)).toEqual(['Calma', 'Calma']);
    expect(c.texto.split('\n')).toHaveLength(1);
  });

  it('o catálogo proposto (docs/musicas-livres-proposta.json), se existir, passa inteiro pelo validador: nenhuma faixa NC, ND ou SA', () => {
    const arq = path.join(__dirname, '..', 'docs', 'musicas-livres-proposta.json');
    if (!existsSync(arq)) return;
    const r = validarCatalogo(JSON.parse(readFileSync(arq, 'utf-8')));
    expect(r.recusadas).toEqual([]);
    expect(r.faixas.length).toBeGreaterThanOrEqual(1);
    for (const f of r.faixas) expect(['CC0-1.0', 'PDM-1.0', 'CC-BY-4.0', 'CC-BY-3.0']).toContain(f.licenca);
  });
});

describe('pasta de trilhas com fichas', () => {
  let raiz = '';
  let pasta = '';
  let projetoPasta = '';
  const escreverFaixa = (rel: string, conteudo: string, f?: unknown) => {
    const abs = path.join(pasta, rel);
    mkdirSync(path.dirname(abs), {recursive: true});
    writeFileSync(abs, conteudo);
    if (f !== undefined) writeFileSync(arquivoDaFicha(abs), typeof f === 'string' ? f : JSON.stringify(f));
    return abs;
  };
  beforeAll(() => {
    raiz = mkdtempSync(path.join(tmpdir(), 'estudio-trilhas-'));
    pasta = path.join(raiz, 'trilhas');
    projetoPasta = path.join(raiz, 'projeto');
    mkdirSync(path.join(projetoPasta, 'midia'), {recursive: true});
    writeFileSync(path.join(projetoPasta, 'estudio.json'), JSON.stringify({formato: 1, nome: 'Trilhas', documentos: []}));
    escreverFaixa('calma.mp3', 'bytes da calma', ficha());
    escreverFaixa('nc/proibida.mp3', 'bytes proibidos', ficha({id: 'proibida', licenca: 'CC-BY-NC-4.0'}));
    escreverFaixa('minha.wav', 'bytes minhas');
    escreverFaixa('quebrada.mp3', 'bytes', '{isto não é json');
  });
  afterAll(() => rmSync(raiz, {recursive: true, force: true}));

  it('lista com a ficha de cada faixa: a que serve, a recusada, a sem ficha e a ficha ilegível', () => {
    const lista = listarTrilhas(pasta);
    const por = Object.fromEntries(lista.map((t) => [t.nome, t]));
    expect(por.calma.ficha).toMatchObject({licenca: 'CC-BY-4.0', autor: 'Fulano de Tal'});
    expect(por.proibida.recusa).toMatch(/não comercial/);
    expect(por.proibida.ficha).toBeUndefined();
    expect(por.minha.ficha).toBeUndefined();
    expect(por.minha.recusa).toBeUndefined();
    expect(por.quebrada.recusa).toMatch(/ilegível/);
    expect(lerFicha(path.join(pasta, 'minha.wav'))).toEqual({});
  });

  it('som-D12: a mesma trilha usada várias vezes vira uma cópia só em midia/, com a ficha; outra com o mesmo nome ganha (2)', () => {
    const p = new Projeto(projetoPasta);
    const calma = path.join(pasta, 'calma.mp3');
    expect(importarTrilha(p, pasta, calma)).toBe('midia/calma.mp3');
    expect(importarTrilha(p, pasta, calma)).toBe('midia/calma.mp3');
    expect(importarTrilha(p, pasta, calma)).toBe('midia/calma.mp3');
    expect(readdirSync(path.join(projetoPasta, 'midia')).filter((n) => n.startsWith('calma'))).toEqual(['calma.mp3', 'calma.mp3.ficha.json']);
    expect(validarFicha(JSON.parse(readFileSync(path.join(projetoPasta, 'midia', 'calma.mp3.ficha.json'), 'utf-8'))).ficha?.id).toBe('macleod-calma');
    // bytes diferentes, mesmo nome: não é a mesma trilha
    const outra = escreverFaixa('outras/calma.mp3', 'outros bytes de calma');
    expect(importarTrilha(p, pasta, outra)).toBe('midia/calma (2).mp3');
    expect(importarTrilha(p, pasta, outra)).toBe('midia/calma (2).mp3');
  });

  it('recusa a trilha de ficha NC e a de fora da pasta', () => {
    const p = new Projeto(projetoPasta);
    expect(() => importarTrilha(p, pasta, path.join(pasta, 'nc', 'proibida.mp3'))).toThrow(/foi recusada: .*não comercial/);
    expect(() => importarTrilha(p, pasta, path.join(raiz, 'projeto', 'midia', 'calma.mp3'))).toThrow(/pasta de trilhas/);
    expect(existsSync(path.join(projetoPasta, 'midia', 'proibida.mp3'))).toBe(false);
  });
});

describe('MCP: biblioteca de trilhas', () => {
  let raiz = '';
  let projeto: Projeto;
  let cliente: Client;
  const chamar = async (name: string, args: Record<string, unknown>) => {
    const r = (await cliente.callTool({name, arguments: args})) as {isError?: boolean; content: {text: string}[]};
    const t = r.content[0]?.text ?? '';
    return {erro: Boolean(r.isError), texto: t, json: r.isError ? null : JSON.parse(t)};
  };
  const lerVideo = () => projeto.lerJson<DocCenas>('video/video.json').doc;

  beforeAll(async () => {
    raiz = mkdtempSync(path.join(tmpdir(), 'estudio-mcp-trilhas-'));
    const pasta = path.join(raiz, 'trilhas');
    mkdirSync(pasta, {recursive: true});
    writeFileSync(path.join(pasta, 'calma.mp3'), 'bytes da calma');
    writeFileSync(arquivoDaFicha(path.join(pasta, 'calma.mp3')), JSON.stringify(ficha()));
    writeFileSync(path.join(pasta, 'zero.mp3'), 'bytes do zero');
    writeFileSync(arquivoDaFicha(path.join(pasta, 'zero.mp3')), JSON.stringify(ficha({id: 'zero', titulo: 'Zero', licenca: 'CC0-1.0', atribuicao: undefined, duracao_s: 3, humor: 'animado'})));
    writeFileSync(path.join(pasta, 'nao.mp3'), 'bytes do nao');
    writeFileSync(arquivoDaFicha(path.join(pasta, 'nao.mp3')), JSON.stringify(ficha({id: 'nao', licenca: 'CC-BY-ND-4.0'})));
    writeFileSync(path.join(pasta, 'minha.wav'), 'bytes minha');
    definirPastaTrilhas(() => pasta);
    const projetoPasta = path.join(raiz, 'projeto');
    mkdirSync(path.join(projetoPasta, 'video'), {recursive: true});
    mkdirSync(path.join(projetoPasta, 'midia'), {recursive: true});
    writeFileSync(path.join(projetoPasta, 'estudio.json'), JSON.stringify({formato: 1, nome: 'MCP trilhas', documentos: [{id: 'video', modulo: 'video', caminho: 'video/video.json', titulo: 'V'}]}));
    writeFileSync(path.join(projetoPasta, 'video', 'video.json'), JSON.stringify({...novoDocCenas({largura: 1080, altura: 1920, fps: 30}), cenas: [{id: 'c', duracao_ms: 20000, blocos: []}]}));
    projeto = new Projeto(projetoPasta);
    const servidor = new McpServer({name: 'estudio', version: 'teste'});
    registrarFerramentas(servidor, projeto, 'agente', 'teste');
    const [a, b] = InMemoryTransport.createLinkedPair();
    cliente = new Client({name: 'teste', version: '1'});
    await Promise.all([servidor.connect(a), cliente.connect(b)]);
  });
  afterAll(() => {
    definirPastaTrilhas(null);
    rmSync(raiz, {recursive: true, force: true});
  });

  it('listar_trilhas mostra a licença, o crédito e as marcas de sem ficha e recusada', async () => {
    const r = await chamar('listar_trilhas', {});
    const por = Object.fromEntries(r.json.trilhas.map((t: {id: string}) => [t.id, t]));
    expect(por['macleod-calma']).toMatchObject({licenca: 'CC-BY-4.0', autor: 'Fulano de Tal', humor: 'calmo', duracao_s: 120});
    expect(por.minha).toMatchObject({sem_ficha: true});
    expect(por.nao.recusada).toMatch(/derivações/);
    expect((await chamar('listar_trilhas', {so_com_ficha: true})).json.trilhas.map((t: {id: string}) => t.id)).not.toContain('minha');
    expect((await chamar('listar_trilhas', {busca: 'calmo'})).json.trilhas.map((t: {id: string}) => t.id)).toEqual(['macleod-calma']);
  });

  it('escolher_trilha copia uma vez, põe o clipe na música com o tamanho da ficha e devolve o crédito', async () => {
    const r = await chamar('escolher_trilha', {documento: 'video', trilha: 'macleod-calma'});
    expect(r.erro).toBe(false);
    expect(r.json).toMatchObject({ok: true, arquivo: 'midia/calma.mp3', licenca: 'CC-BY-4.0', clipe: {em: 0, duracao_ms: 20000}});
    expect(r.json.creditar).toMatch(/Fulano de Tal/);
    expect(lerVideo().audio!.faixas.find((f) => f.papel === 'musica')!.clipes[0]).toMatchObject({arquivo: 'midia/calma.mp3', nome: 'Calma'});
    // a mesma trilha de novo: não copia outra vez (som-D12), e o clipe novo entra por cima, com o aviso
    const de_novo = await chamar('escolher_trilha', {documento: 'video', trilha: 'Calma'});
    expect(de_novo.json.arquivo).toBe('midia/calma.mp3');
    expect(readdirSync(path.join(raiz, 'projeto', 'midia')).filter((n) => /^calma/.test(n)).sort()).toEqual(['calma.mp3', 'calma.mp3.ficha.json']);
  });

  it('recusa a trilha de licença ND, a que não existe e a ambígua; a sem ficha entra com o aviso', async () => {
    expect((await chamar('escolher_trilha', {documento: 'video', trilha: 'nao'})).texto).toMatch(/foi recusada/);
    expect((await chamar('escolher_trilha', {documento: 'video', trilha: 'fantasma'})).texto).toMatch(/não achada/);
    const sem = await chamar('escolher_trilha', {documento: 'video', trilha: 'minha', duracao_ms: 4000});
    // a sem ficha e sem envelope não tem tamanho: pede o app medir
    expect(sem.erro).toBe(true);
    expect(sem.texto).toMatch(/duracao_ms/);
    const efeito = await chamar('escolher_trilha', {documento: 'video', trilha: 'zero', papel: 'efeitos'});
    expect(efeito.json).toMatchObject({ok: true, licenca: 'CC0-1.0', clipe: {duracao_ms: 3000}});
    expect(efeito.json.creditar).toBeNull();
  });

  it('creditos_das_musicas junta os créditos das músicas do vídeo e diz quais não têm ficha', async () => {
    const r = await chamar('creditos_das_musicas', {documento: 'video'});
    expect(r.json.creditos).toHaveLength(1);
    expect(r.json.texto).toMatch(/Fulano de Tal/);
    expect(r.json.sem_ficha).toBeUndefined();
  });
});
