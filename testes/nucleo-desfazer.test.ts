// Desfazer e reverter certos (auditoria do núcleo, fase F1): N14 (caminho com ".." no nome), N3 (diário com linha quebrada
// não trava quem lê, e concluir a transição não põe a música duas vezes), N2 (Ctrl+Z e Reverter em arquivo interno),
// N12 (refazer pelo reverter) e N11 (replace repetido no mesmo patch). As reproduções da auditoria afirmavam o defeito;
// aqui elas afirmam o comportamento certo.
import {appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {novoAudioCenas} from '../src/nucleo/audio';
import {novoDocCenas, type DocCenas} from '../src/nucleo/cenas';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {marcarMidia} from '../src/nucleo/midia-disco';
import {baseDoProjeto} from '../src/nucleo/musica-projeto';
import {gravarPrefsExportacaoNoDiario} from '../src/nucleo/prefs-exportacao';
import {Projeto, serializar} from '../src/nucleo/projeto';
import {ARQUIVO_TRANSICOES, concluirTransicao, levarPara, lerRegistro} from '../src/nucleo/transicoes';

const pastas: string[] = [];
afterAll(() => pastas.forEach((p) => rmSync(p, {recursive: true, force: true})));

/** Projeto mínimo: um documento `d` (d.json) com {itens: [], cor: "a"}. */
const projetoMinimo = (conteudo: unknown = {itens: [], cor: 'a'}) => {
  const pasta = mkdtempSync(path.join(tmpdir(), 'estudio-nucleo-'));
  pastas.push(pasta);
  writeFileSync(path.join(pasta, 'estudio.json'), serializar({formato: 1, nome: 't', documentos: [{id: 'd', modulo: '3d', caminho: 'd.json', titulo: 'D'}]}));
  writeFileSync(path.join(pasta, 'd.json'), serializar(conteudo));
  mkdirSync(path.join(pasta, '.estudio'), {recursive: true});
  return {pasta, p: new Projeto(pasta)};
};

const PESSOA = {autor: 'pessoa', origem: 'interface'};
const CTRL_Z = {...PESSOA, como: {autor: 'pessoa', origem: 'desfazer'}};
const cor = (p: Projeto) => p.lerJson<{cor: string}>('d.json').doc.cor;
const trocar = (p: Projeto, valor: string, quem = PESSOA) => p.aplicarPatch({documento: 'd', patch: [{op: 'replace', path: '/cor', value: valor}], ...quem});
const quebrar = (p: Projeto) => appendFileSync(p.caminho('.estudio/diario.jsonl'), '{"seq": 99, "em": "quebr'); // queda no meio da linha

describe('N14 caminho com ".." no começo do nome', () => {
  it('"..notas.json" é um arquivo do projeto; "../x" e "a/../../x" continuam fora', () => {
    const {pasta, p} = projetoMinimo();
    expect(p.caminho('..notas.json')).toBe(path.join(pasta, '..notas.json'));
    expect(() => p.caminho('../x')).toThrow(/fora do projeto/);
    expect(() => p.caminho('a/../../x')).toThrow(/fora do projeto/);
    expect(() => p.caminho('..')).toThrow(/fora do projeto/);
  });
});

describe('N3 linha quebrada no diário', () => {
  it('marcarMidia grava e registra sem lançar', () => {
    const {pasta, p} = projetoMinimo();
    mkdirSync(path.join(pasta, 'midia'));
    writeFileSync(path.join(pasta, 'midia', 'a.wav'), 'x');
    trocar(p, 'b');
    quebrar(p);
    const r = marcarMidia(p, 'midia/a.wav', {estado: 'boa'}, PESSOA);
    expect(r.seq).toBe(2);
    expect(JSON.parse(readFileSync(path.join(pasta, 'midia/marcas.json'), 'utf-8')).marcas['midia/a.wav']).toEqual({estado: 'boa'});
  });

  const projetoComVideo = () => {
    const {pasta} = projetoMinimo();
    const v = novoDocCenas({largura: 1080, altura: 1920, fps: 30});
    v.audio = novoAudioCenas();
    v.audio.faixas[1].clipes.push({id: 'clipe-2', arquivo: 'midia/cama.wav', em: 1000, duracao_ms: 4000});
    mkdirSync(path.join(pasta, 'video'));
    writeFileSync(path.join(pasta, 'estudio.json'), serializar({formato: 1, nome: 't', documentos: [{id: 'video', modulo: 'video', caminho: 'video/video.json', titulo: 'V'}]}));
    writeFileSync(path.join(pasta, 'video/video.json'), serializar(v));
    const p = new Projeto(pasta);
    const b = baseDoProjeto(p, 'pessoa', 'interface');
    const {transicao} = levarPara(b, {modulo: 'musica', alvo: {documento: 'video', caminho: `/audio/faixas/@${v.audio.faixas[1].id}`}, intencao: 'criar'});
    const clipes = () => p.lerJson<DocCenas>('video/video.json').doc.audio!.faixas.flatMap((f) => f.clipes).filter((c) => c.musica).length;
    const estado = () => lerRegistro(p.lerJson(ARQUIVO_TRANSICOES).doc).transicoes.find((t) => t.id === transicao)!.estado;
    return {p, b, transicao, clipes, estado};
  };

  it('concluirTransicao com a linha quebrada fecha a transição com um clipe só', () => {
    const {p, b, transicao, clipes, estado} = projetoComVideo();
    p.aplicarPatch({documento: 'video', patch: [{op: 'replace', path: '/cenas/0/duracao_ms', value: 4100}], ...PESSOA});
    quebrar(p);
    const r = concluirTransicao(b, {transicao});
    expect(clipes()).toBe(1);
    expect(estado()).toBe('concluida');
    expect(r.seqs).toContain(r.seq);
  });

  it('concluirTransicao que parou depois de aplicar (registro preso) não põe outro clipe na nova tentativa', () => {
    const {b, transicao, clipes, estado} = projetoComVideo();
    const gravar = b.gravarRegistro;
    let falhar = true;
    b.gravarRegistro = (r) => {
      if (falhar) {
        falhar = false;
        throw new Error('o arquivo está em uso por outro programa (OneDrive ou antivírus?)');
      }
      gravar(r);
    };
    expect(() => concluirTransicao(b, {transicao})).toThrow(/em uso/);
    expect(clipes()).toBe(1);
    expect(estado()).toBe('aberta');
    const r = concluirTransicao(b, {transicao}); // a pessoa clica "Concluir" de novo
    expect(clipes()).toBe(1);
    expect(estado()).toBe('concluida');
    expect(r.seqs).toHaveLength(1);
    expect(r.caminho).toMatch(/^\/audio\/faixas\/@.+\/clipes\/@.+/);
  });

  it('listar_mudancas e reverter do MCP funcionam com uma linha quebrada no meio do diário', async () => {
    const {p} = projetoMinimo();
    const servidor = new McpServer({name: 'estudio', version: '0'});
    registrarFerramentas(servidor, p, 'agente', 'teste');
    const [a, c] = InMemoryTransport.createLinkedPair();
    await servidor.connect(a);
    const cliente = new Client({name: 'teste', version: '0'});
    await cliente.connect(c);
    const chamar = async (name: string, args: Record<string, unknown>) => (await cliente.callTool({name, arguments: args})) as {isError?: boolean; content: {text: string}[]};
    trocar(p, 'b', {autor: 'agente', origem: 'teste'});
    quebrar(p);
    trocar(p, 'c', {autor: 'agente', origem: 'teste'});
    const lista = await chamar('listar_mudancas', {});
    expect(lista.isError).toBeFalsy();
    expect(JSON.parse(lista.content[0].text).map((e: {seq: number}) => e.seq)).toEqual([1, 2]);
    const r = await chamar('reverter', {seq: 2});
    expect(r.isError).toBeFalsy();
    expect(cor(p)).toBe('b');
    await cliente.close();
  });
});

describe('N2 Ctrl+Z e Reverter em arquivo que não é documento', () => {
  it('marcar uma tomada não trava o Ctrl+Z: desfaz a marca e depois a cor', () => {
    const {pasta, p} = projetoMinimo();
    mkdirSync(path.join(pasta, 'midia'));
    writeFileSync(path.join(pasta, 'midia', 'tomada.wav'), 'x');
    trocar(p, 'b');
    marcarMidia(p, 'midia/tomada.wav', {estado: 'boa'}, PESSOA);
    const r1 = p.desfazerUltima(CTRL_Z);
    expect(r1.ok).toBe(true);
    expect(JSON.parse(readFileSync(path.join(pasta, 'midia/marcas.json'), 'utf-8')).marcas['midia/tomada.wav']).toBeUndefined();
    const r2 = p.desfazerUltima(CTRL_Z);
    expect(r2.ok).toBe(true);
    expect(cor(p)).toBe('a');
  });

  it('o desfazer do agente depois de marca_dagua volta a marca d\'água', () => {
    const {p} = projetoMinimo();
    const AG = {autor: 'agente', origem: 'Claude 1'};
    trocar(p, 'z', AG);
    gravarPrefsExportacaoNoDiario(p, {marca_dagua: {youtube: {ativo: true}}} as never, {...AG, rotulo: "marca d'água"});
    expect(p.desfazerUltima({...AG, como: AG}).ok).toBe(true);
    expect(p.desfazerUltima({...AG, como: AG}).ok).toBe(true);
    expect(cor(p)).toBe('a');
  });

  it('Reverter uma entrada da pesquisa tira a fonte', () => {
    const {p} = projetoMinimo();
    p.alterarPesquisa((x) => {
      (x as {fontes: unknown[]}).fontes.push({id: 'f1'});
    }, {autor: 'agente', origem: 'Claude 1', rotulo: 'fonte'});
    const r = p.reverter(p.ultimaSeq(), {autor: 'pessoa', origem: 'reverter'});
    expect(r.ok).toBe(true);
    expect(p.pesquisa().fontes).toHaveLength(0);
  });

  it('aplicar_patch continua recusando arquivo interno (pesquisa/pesquisa.json)', () => {
    const {p} = projetoMinimo();
    p.alterarPesquisa(() => undefined, {autor: 'agente', origem: 'Claude 1', rotulo: 'vazia'});
    expect(() => p.aplicarPatch({documento: 'pesquisa/pesquisa.json', patch: [{op: 'add', path: '/fontes/-', value: {id: 'f9'}}], autor: 'agente', origem: 'A'}))
      .toThrow(/documento não achado/);
  });

  it('o Ctrl+Z pula a entrada de um documento que saiu do manifesto', () => {
    const {pasta, p} = projetoMinimo();
    trocar(p, 'b');
    writeFileSync(path.join(pasta, 'e.json'), serializar({x: 1}));
    const m = p.manifesto();
    writeFileSync(path.join(pasta, 'estudio.json'), serializar({...m, documentos: [...m.documentos, {id: 'e', modulo: '3d', caminho: 'e.json', titulo: 'E'}]}));
    p.aplicarPatch({documento: 'e', patch: [{op: 'replace', path: '/x', value: 2}], ...PESSOA});
    writeFileSync(path.join(pasta, 'estudio.json'), serializar(m)); // o documento e sai do projeto
    expect(p.desfazerUltima(CTRL_Z).ok).toBe(true);
    expect(cor(p)).toBe('a');
  });
});

describe('N12 refazer pelo reverter', () => {
  it('A, desfaz A, refaz: A volta a poder ser desfeita (Reverter e Ctrl+Z)', () => {
    const {p} = projetoMinimo();
    const a = trocar(p, 'b');
    const z = p.desfazerUltima(CTRL_Z);
    expect(z.ok).toBe(true);
    const refazer = p.reverter((z as {seq: number}).seq, {autor: 'pessoa', origem: 'reverter'});
    expect(refazer.ok).toBe(true);
    expect(cor(p)).toBe('b');
    expect(p.revertidas().has(a.entrada.seq)).toBe(false);
    expect(p.reverter(a.entrada.seq, {autor: 'pessoa', origem: 'reverter'}).ok).toBe(true);
    expect(cor(p)).toBe('a');
  });

  it('com 4 níveis (A, U(A), R(U), U\'(R)) A fica revertida e reverter(A) recusa', () => {
    const {p} = projetoMinimo();
    const a = trocar(p, 'b');
    const u = p.reverter(a.entrada.seq, {autor: 'pessoa', origem: 'reverter'}) as {seq: number};
    const r = p.reverter(u.seq, {autor: 'pessoa', origem: 'reverter'}) as {seq: number};
    expect(p.reverter(r.seq, {autor: 'pessoa', origem: 'reverter'}).ok).toBe(true);
    expect(cor(p)).toBe('a');
    expect(p.revertidas().has(a.entrada.seq)).toBe(true);
    expect(p.reverter(a.entrada.seq, {autor: 'pessoa', origem: 'reverter'})).toMatchObject({ok: false, mensagem: expect.stringMatching(/já foi revertida/)});
  });

  it('A, U(A), R(U) e Ctrl+Z: desfaz A de novo', () => {
    const {p} = projetoMinimo();
    trocar(p, 'b');
    const u = p.desfazerUltima(CTRL_Z) as {seq: number};
    p.reverter(u.seq, {autor: 'pessoa', origem: 'reverter'});
    expect(cor(p)).toBe('b');
    expect(p.desfazerUltima(CTRL_Z).ok).toBe(true);
    expect(cor(p)).toBe('a');
    expect(p.desfazerUltima(CTRL_Z)).toMatchObject({ok: false, mensagem: 'nada para desfazer'});
  });
});

describe('N11 reverter patch com o mesmo caminho trocado duas vezes', () => {
  it('replace /cor "x" e replace /cor "y" no mesmo patch reverte', () => {
    const {p} = projetoMinimo();
    const e = p.aplicarPatch({documento: 'd', patch: [{op: 'replace', path: '/cor', value: 'x'}, {op: 'replace', path: '/cor', value: 'y'}], autor: 'agente', origem: 'A'});
    expect(p.reverter(e.entrada.seq, {autor: 'pessoa', origem: 'reverter'})).toMatchObject({ok: true});
    expect(cor(p)).toBe('a');
  });

  it('replace de um filho e depois do pai reverte, mesmo com outra mudança em outro campo depois', () => {
    const {p} = projetoMinimo({itens: [], cor: 'a', a: {b: 1}});
    const e = p.aplicarPatch({documento: 'd', patch: [{op: 'replace', path: '/a/b', value: 2}, {op: 'replace', path: '/a', value: {b: 3}}], autor: 'agente', origem: 'A'});
    p.aplicarPatch({documento: 'd', patch: [{op: 'add', path: '/itens/-', value: 1}], ...PESSOA}); // a versão muda: vale o test
    expect(p.reverter(e.entrada.seq, {autor: 'pessoa', origem: 'reverter'})).toMatchObject({ok: true});
    expect(p.lerJson<{a: unknown}>('d.json').doc.a).toEqual({b: 1});
  });

  it('uma mudança de outra mão depois continua dando mudou_depois', () => {
    const {p} = projetoMinimo();
    const e = p.aplicarPatch({documento: 'd', patch: [{op: 'replace', path: '/cor', value: 'x'}, {op: 'replace', path: '/cor', value: 'y'}], autor: 'agente', origem: 'A'});
    trocar(p, 'outra');
    expect(p.reverter(e.entrada.seq, {autor: 'pessoa', origem: 'reverter'})).toMatchObject({ok: false, mudou_depois: true});
    expect(cor(p)).toBe('outra');
  });
});
