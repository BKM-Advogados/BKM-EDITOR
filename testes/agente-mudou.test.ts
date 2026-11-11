// "O Claude mudou isto" no lugar (ux/pesquisa-ux-visual.md, item 10): as mudanças do agente saem do diário com o
// documento, o objeto tocado e o valor de antes, ficam 30 s e somem quando revertidas.
import {describe, expect, it} from 'vitest';
import type {EntradaDiario, EntradaDocumento} from '../src/nucleo/documentos';
import {camposMudados, JANELA_AGENTE_MS, juntarMudancas, mudancasNovas, mudouEm, objetoDoCaminho, objetosMudados, textoDoValor} from '../src/renderer/estado/agente';

const docs: EntradaDocumento[] = [{id: 'video', modulo: 'video', caminho: 'video/video.json', titulo: 'Vídeo 9:16'}];
const entrada = (seq: number, autor: string, patch: EntradaDiario['patch'], inverso: EntradaDiario['inverso'], extra: Partial<EntradaDiario> = {}): EntradaDiario =>
  ({seq, em: '2026-11-10T10:00:00Z', documento: 'video/video.json', autor, origem: 'Claude 1', rotulo: `#${seq}`, versao_antes: 'a', versao_depois: 'b', patch, inverso, ...extra});

describe('mudanças do agente', () => {
  const diario = [
    entrada(1, 'pessoa', [{op: 'replace', path: '/cenas/0/nome', value: 'A'}], [{op: 'replace', path: '/cenas/0/nome', value: ''}]),
    entrada(2, 'agente', [{op: 'test', path: '/cenas/1/blocos/0/tam', value: 0.08}, {op: 'replace', path: '/cenas/1/blocos/0/tam', value: 0.12}],
      [{op: 'replace', path: '/cenas/1/blocos/0/tam', value: 0.08}]),
    entrada(3, 'agente', [{op: 'add', path: '/cenas/0/blocos/0/sombra', value: true}], [{op: 'remove', path: '/cenas/0/blocos/0/sombra'}]),
  ];

  it('só as do agente depois do que já foi visto, com o objeto e o valor de antes', () => {
    expect(mudancasNovas(diario, undefined, docs, 0)).toEqual([]); // primeira leitura do projeto: nada aparece
    const novas = mudancasNovas(diario, 1, docs, 1000);
    expect(novas.map((m) => m.seq)).toEqual([2, 3]);
    expect(novas[0]).toMatchObject({documento: 'video', titulo: 'Vídeo 9:16', caminhos: ['/cenas/1/blocos/0/tam']});
    expect(novas[0].antes['/cenas/1/blocos/0/tam']).toEqual({tinha: true, valor: 0.08});
    expect(novas[1].antes['/cenas/0/blocos/0/sombra']).toEqual({tinha: false});
    expect(textoDoValor(novas[0].antes['/cenas/1/blocos/0/tam'])).toBe('0,08');
    expect(textoDoValor(novas[1].antes['/cenas/0/blocos/0/sombra'])).toBe('não tinha');
  });

  it('marca o bloco, a camada e o objeto certos', () => {
    expect(objetoDoCaminho('/cenas/1/blocos/0/tam')).toBe('/cenas/1/blocos/0');
    expect(objetoDoCaminho('/paginas/2/camadas/3/cor')).toBe('/paginas/2/camadas/3');
    expect(objetoDoCaminho('/camadas/0/trilhas')).toBe('/camadas/0');
    const m = mudancasNovas(diario, 1, docs, 0);
    expect(mudouEm(m, 'video', '/cenas/1/blocos/0')).toBe(true);
    expect(mudouEm(m, 'video', '/cenas/1/blocos/1')).toBe(false);
    expect(mudouEm(m, 'video', '')).toBe(false);
    expect(mudouEm(m, 'outro', '/cenas/1/blocos/0')).toBe(false);
    expect(objetosMudados(m, 'video').sort()).toEqual(['/cenas/0/blocos/0', '/cenas/1/blocos/0']);
    expect(camposMudados(m, 'video', '/cenas/1/blocos/0')).toMatchObject([{campo: 'tam', antes: {tinha: true, valor: 0.08}}]);
  });

  it('ficam 30 s e saem quando revertidas', () => {
    const m = mudancasNovas(diario, 1, docs, 1000);
    expect(juntarMudancas([], m, new Set(), 2000)).toHaveLength(2);
    expect(juntarMudancas([], m, new Set([2]), 2000).map((x) => x.seq)).toEqual([3]);
    expect(juntarMudancas(m, m, new Set(), 2000)).toHaveLength(2); // seq repetido não duplica
    expect(juntarMudancas(m, [], new Set(), 1000 + JANELA_AGENTE_MS + 1)).toEqual([]);
    // a reversão em si (desfaz) não vira marca
    expect(mudancasNovas([...diario, entrada(4, 'agente', [], [], {desfaz: 2})], 3, docs, 0)).toEqual([]);
  });
});

describe('Histórico agrupado', async () => {
  const {agruparDiario, diferencasDa, resumoDoGrupo} = await import('../src/renderer/estado/agente');
  const em = (s: number) => new Date(Date.UTC(2026, 10, 10, 10, 0, s)).toISOString();
  const e = (seq: number, autor: string, origem: string, s: number): EntradaDiario => ({...entrada(seq, autor, [{op: 'replace', path: '/cenas/0/blocos/0/x', value: 0.2}],
    [{op: 'replace', path: '/cenas/0/blocos/0/x', value: 0.1}]), origem, em: em(s)});

  it('junta as entradas seguidas do mesmo autor e da mesma conversa; a mais nova primeiro', () => {
    const g = agruparDiario([e(1, 'pessoa', 'interface', 0), e(2, 'agente', 'Claude 1', 10), e(3, 'agente', 'Claude 1', 20), e(4, 'agente', 'Claude 2', 25),
      e(5, 'pessoa', 'interface', 30), e(6, 'pessoa', 'interface', 400)], docs);
    expect(g.map((x) => x.entradas.map((y) => y.seq))).toEqual([[6], [5], [4], [3, 2], [1]]);
    expect(resumoDoGrupo(g[3])).toBe('2 mudanças em Vídeo 9:16');
  });

  it('cada entrada diz o antes → depois por campo', () => {
    expect(diferencasDa(e(1, 'agente', 'x', 0))).toEqual([{campo: 'x', caminho: '/cenas/0/blocos/0/x', antes: {tinha: true, valor: 0.1}, depois: {tinha: true, valor: 0.2}}]);
  });
});
