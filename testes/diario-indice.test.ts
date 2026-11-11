// O índice leve do diário (auditoria do núcleo, N7): o Ctrl+Z, o Reverter e o painel Histórico não leem mais o diário
// inteiro (que passa de dezenas de MB com as edições grandes do agente), o Histórico recebe as entradas sem os patches,
// e o índice acompanha o que outro processo grava e se refaz quando o arquivo é trocado.
import {appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {Projeto, serializar} from '../src/nucleo/projeto';

const pastas: string[] = [];
afterAll(() => pastas.forEach((p) => rmSync(p, {recursive: true, force: true})));

const projetoMinimo = () => {
  const pasta = mkdtempSync(path.join(tmpdir(), 'estudio-indice-'));
  pastas.push(pasta);
  writeFileSync(path.join(pasta, 'estudio.json'), serializar({formato: 1, nome: 't', documentos: [{id: 'd', modulo: '3d', caminho: 'd.json', titulo: 'D'}]}));
  writeFileSync(path.join(pasta, 'd.json'), serializar({itens: [], cor: 'a'}));
  mkdirSync(path.join(pasta, '.estudio'), {recursive: true});
  return {pasta, p: new Projeto(pasta)};
};

const PESSOA = {autor: 'pessoa', origem: 'interface'};
const CTRL_Z = {...PESSOA, como: {autor: 'pessoa', origem: 'desfazer'}};
const cor = (p: Projeto) => p.lerJson<{cor: string}>('d.json').doc.cor;
const linhaGrande = (seq: number, valor: string) => JSON.stringify({seq, em: '2026-11-10T00:00:00Z', documento: 'd.json', autor: 'agente', origem: 'A', rotulo: 'r',
  versao_antes: 'a', versao_depois: 'b', patch: [{op: 'replace', path: '/cor', value: valor}], inverso: [{op: 'replace', path: '/cor', value: valor}]});

describe('N7 diário grande', () => {
  it('com 20 mil entradas (~60 MB), Ctrl+Z e Histórico ficam abaixo de 50 ms', () => {
    const {p} = projetoMinimo();
    const grande = 'x'.repeat(1400);
    const linhas: string[] = [];
    for (let i = 1; i <= 20000; i++) linhas.push(linhaGrande(i, grande));
    writeFileSync(p.caminho('.estudio/diario.jsonl'), `${linhas.join('\n')}\n`);
    p.aplicarPatch({documento: 'd', patch: [{op: 'replace', path: '/cor', value: 'b'}], ...PESSOA});
    let t = performance.now();
    const lista = p.resumoDoDiario();
    const frio = performance.now() - t; // a primeira leitura monta o índice: só o começo e o fim de cada linha
    t = performance.now();
    p.resumoDoDiario();
    const historico = performance.now() - t;
    t = performance.now();
    const r = p.desfazerUltima(CTRL_Z);
    const ctrlZ = performance.now() - t;
    t = performance.now();
    p.diario(0, {tolerante: true}); // o que o Histórico fazia a cada edição (e o Ctrl+Z três vezes): ler e analisar tudo
    const tudo = performance.now() - t;
    console.log('N7', JSON.stringify({mb: Math.round(p.marcaDoDiario() / 1e6), indice_ms: Math.round(frio), historico_ms: Math.round(historico), ctrlZ_ms: Math.round(ctrlZ),
      diario_inteiro_ms: Math.round(tudo)}));
    expect(lista).toHaveLength(200);
    expect(r.ok).toBe(true);
    expect(cor(p)).toBe('a');
    // numa máquina livre: índice ~120 ms uma vez, Histórico ~5 ms e Ctrl+Z ~10 ms (antes 160–320 e 400–990 ms a cada vez);
    // com a suíte inteira rodando em paralelo os tempos sobem juntos, então a conta é relativa à leitura do diário inteiro
    expect(historico).toBeLessThan(Math.max(50, tudo / 4));
    expect(ctrlZ).toBeLessThan(Math.max(50, tudo / 4));
    expect(frio).toBeLessThan(tudo * 2 + 50);
  }, 30_000);

  it('o Histórico de 200 entradas de 190 KB pesa menos de 300 KB, e cada uma diz se é revertível e se foi revertida', () => {
    const {p} = projetoMinimo();
    const grade = 'p'.repeat(190 * 1024);
    for (let i = 0; i < 200; i++) p.aplicarPatch({documento: 'd', patch: [{op: 'replace', path: '/cor', value: `${grade}${i}`}], autor: 'agente', origem: 'A'});
    p.desfazerUltima({autor: 'agente', origem: 'A', como: {autor: 'agente', origem: 'A'}});
    const lista = p.resumoDoDiario();
    expect(lista).toHaveLength(200);
    expect(JSON.stringify(lista).length).toBeLessThan(300 * 1024);
    const ultima = lista.at(-1)!;
    expect(ultima).toMatchObject({desfaz: 200, tem_inverso: true, revertida: false});
    expect(lista.find((e) => e.seq === 200)).toMatchObject({revertida: true});
    expect(lista[0].resumo.startsWith('[{"op":"replace","path":"/cor"')).toBe(true);
    expect(lista[0].resumo.endsWith('…')).toBe(true);
    expect(lista[0]).not.toHaveProperty('patch');
    expect(lista[0]).not.toHaveProperty('inverso');
  });

  it('resumo curto vem inteiro; entrada sem inverso não é revertível; linha fora do formato e quebrada', () => {
    const {p} = projetoMinimo();
    p.aplicarPatch({documento: 'd', patch: [{op: 'replace', path: '/cor', value: 'b'}], ...PESSOA});
    p.aplicarPatch({documento: 'd', patch: [{op: 'replace', path: '/cor', value: 'b'}], ...PESSOA}); // sem efeito: inverso vazio
    // uma entrada de outra versão, com as chaves em outra ordem e espaços, e uma linha quebrada
    appendFileSync(p.caminho('.estudio/diario.jsonl'), `${JSON.stringify({inverso: [{op: 'replace', path: '/cor', value: 'b'}], patch: [{op: 'replace', path: '/cor', value: 'c'}],
      seq: 3, desfaz: 1, em: 'x', documento: 'd.json', autor: 'agente', origem: 'B', rotulo: 'antiga', versao_antes: '', versao_depois: ''}, null, 1).replace(/\n/g, ' ')}\n{"seq": 4, "em`);
    const lista = p.resumoDoDiario();
    expect(lista.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(lista[0]).toMatchObject({resumo: '[{"op":"replace","path":"/cor","value":"b"}]', tem_inverso: true, revertida: true});
    expect(lista[1]).toMatchObject({tem_inverso: false});
    expect(lista[2]).toMatchObject({desfaz: 1, rotulo: 'antiga', tem_inverso: true});
    expect(p.desfazerUltima(CTRL_Z)).toMatchObject({ok: false, mensagem: 'nada para desfazer'}); // 1 já revertida, 2 sem inverso
  });

  it('o índice vê o que outro processo acrescentou, inclusive a linha que ele ainda estava escrevendo', () => {
    const {pasta, p} = projetoMinimo();
    const outro = new Projeto(pasta); // o MCP da IDE, com o índice dele
    p.aplicarPatch({documento: 'd', patch: [{op: 'replace', path: '/cor', value: 'b'}], ...PESSOA});
    expect(p.resumoDoDiario().map((e) => e.seq)).toEqual([1]);
    outro.aplicarPatch({documento: 'd', patch: [{op: 'replace', path: '/cor', value: 'c'}], autor: 'agente', origem: 'mcp'});
    const linha = linhaGrande(3, 'z');
    appendFileSync(p.caminho('.estudio/diario.jsonl'), linha.slice(0, 40)); // pela metade
    expect(p.resumoDoDiario().map((e) => e.seq)).toEqual([1, 2]);
    appendFileSync(p.caminho('.estudio/diario.jsonl'), `${linha.slice(40)}\n`);
    expect(p.resumoDoDiario().map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(p.reverter(2, {autor: 'pessoa', origem: 'reverter'})).toMatchObject({ok: true});
    expect(cor(p)).toBe('b');
  });

  it('o índice se refaz quando o diário é trocado por outro ou encolhe', () => {
    const {p} = projetoMinimo();
    for (const c of ['b', 'c', 'd']) p.aplicarPatch({documento: 'd', patch: [{op: 'replace', path: '/cor', value: c}], ...PESSOA});
    expect(p.resumoDoDiario().map((e) => e.seq)).toEqual([1, 2, 3]);
    // outro arquivo no lugar (git, outra máquina), menor: só a primeira entrada, com outro rótulo
    const primeira = JSON.stringify({seq: 1, em: 'x', documento: 'd.json', autor: 'pessoa', origem: 'interface', rotulo: 'trocada', versao_antes: '', versao_depois: '',
      patch: [{op: 'replace', path: '/cor', value: 'd'}], inverso: [{op: 'replace', path: '/cor', value: 'a'}]});
    writeFileSync(p.caminho('.estudio/diario.jsonl'), `${primeira}\n`);
    expect(p.resumoDoDiario().map((e) => [e.seq, e.rotulo])).toEqual([[1, 'trocada']]);
    // reescrito no lugar com o mesmo tamanho de antes e conteúdo diferente
    const segunda = primeira.replace('"seq":1', '"seq":7');
    writeFileSync(p.caminho('.estudio/diario.jsonl'), `${segunda}\n`);
    expect(p.resumoDoDiario().map((e) => e.seq)).toEqual([7]);
    expect(p.desfazerUltima(CTRL_Z).ok).toBe(true);
    expect(cor(p)).toBe('a');
  });
});
