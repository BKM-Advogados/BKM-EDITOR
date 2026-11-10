// O IPC da narração por IA (src/main/ipc-narracao.ts) sem o Electron: os handlers registrados num "lidar" falso, com o
// cofre em memória e o HTTP falso. Gerar pela tela grava como edição da pessoa (o Ctrl+Z desfaz), o andamento vai à tela,
// a amostra fica guardada (a mesma não é paga duas vezes), as vozes ficam na sessão, e a chave nunca volta à tela.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {novoDocCenas, type DocCenas} from '../src/nucleo/cenas';
import {itensDaNarracao} from '../src/nucleo/narracao-cenas';
import {Projeto} from '../src/nucleo/projeto';
import {CofreMemoria} from '../src/main/ia/chaves';
import {ConfiguracaoIA} from '../src/main/ia/config';
import {definirCofre} from '../src/main/ipc-ia';
import {registrarIpcNarracao, type CanaisNarracao} from '../src/main/ipc-narracao';
import {CHAVE_GEMINI, criarGoogleFalso} from './fixtures/narracao-falsa';

const CANAIS: CanaisNarracao = {estado: 'e', gravarChave: 'gc', apagarChave: 'ac', vozes: 'v', previa: 'p', gerar: 'g', cancelar: 'c', andamento: 'a', amostra: 'am'};
let pasta = '';
let projeto: Projeto;
let cofre: CofreMemoria;
let config: ConfiguracaoIA;

const montar = (aoEnviar?: (canal: string, a: any, handlers: Map<string, (...a: any[]) => unknown>) => void) => {
  const handlers = new Map<string, (...a: any[]) => unknown>();
  const enviados: [string, unknown][] = [];
  const g = criarGoogleFalso();
  registrarIpcNarracao({lidar: (canal, f) => void handlers.set(canal, f as never), canais: CANAIS, ouvir: (canal, f) => void handlers.set(canal, f),
    enviar: (canal, a) => (enviados.push([canal, a]), aoEnviar?.(canal, a, handlers)), projeto: () => projeto, pasta: path.join(pasta, 'userData-ia'), buscar: g.fetch});
  const chamar = async (canal: string, ...a: unknown[]) => handlers.get(canal)!(...a) as any;
  return {chamar, enviados, g};
};

beforeEach(() => {
  pasta = mkdtempSync(path.join(tmpdir(), 'estudio-narracao-ipc-'));
  mkdirSync(path.join(pasta, 'projeto', 'video'), {recursive: true});
  const raiz = path.join(pasta, 'projeto');
  writeFileSync(path.join(raiz, 'estudio.json'), JSON.stringify({formato: 1, nome: 'IPC', documentos: [{id: 'video', modulo: 'video', caminho: 'video/video.json', titulo: 'V'}]}));
  const doc: DocCenas = {...novoDocCenas({largura: 1080, altura: 1920, fps: 30}), cenas: [
    {id: 'c1', duracao_ms: 4000, blocos: [], narracao: {texto: 'Primeira fala.'}}, {id: 'c2', duracao_ms: 4000, blocos: [], narracao: {texto: 'Segunda fala.'}}]};
  writeFileSync(path.join(raiz, 'video', 'video.json'), JSON.stringify(doc));
  projeto = new Projeto(raiz);
  cofre = new CofreMemoria();
  config = new ConfiguracaoIA(path.join(pasta, 'userData-ia'));
  definirCofre(cofre, config);
});
afterEach(() => rmSync(pasta, {recursive: true, force: true}));

describe('IPC da narração por IA', () => {
  it('estado sem a chave; prévia sem rede; gerar como edição da pessoa, com andamento, uso do mês e Ctrl+Z', async () => {
    const {chamar, enviados, g} = montar();
    expect((await chamar('e')).gemini.pronto).toBe(false);
    cofre.gravar('gemini', CHAVE_GEMINI);
    const e = await chamar('e');
    expect(e.gemini).toMatchObject({pronto: true, origem: 'cofre', final: '1234'});
    expect(JSON.stringify(e)).not.toContain(CHAVE_GEMINI);
    const p = await chamar('p', 'video');
    expect(p.total).toMatchObject({a_gerar: 2, vao_a_api: 2});
    expect(g.pedidos).toHaveLength(0);
    const r = await chamar('g', 'video');
    expect(r).toMatchObject({ok: true, geradas: [{n: 1}, {n: 2}]});
    expect(JSON.stringify(r)).not.toContain(CHAVE_GEMINI);
    expect(enviados.filter(([c]) => c === 'a').map(([, a]) => (a as {fase: string}).fase)).toContain('pronto');
    expect(projeto.diario().at(-1)).toMatchObject({autor: 'pessoa', origem: 'interface'});
    expect(config.usoDoMes()['gemini-tts']).toMatchObject({turnos: 2, entrada: 40, saida: 200});
    // o Ctrl+Z da tela (desfazerUltima da pessoa) tira as falas de uma vez
    expect(projeto.desfazerUltima({autor: 'pessoa', origem: 'interface', como: {autor: 'pessoa', origem: 'desfazer'}}).ok).toBe(true);
    expect(itensDaNarracao(projeto.lerJson<DocCenas>('video/video.json').doc).map((i) => i.estado)).toEqual(['pendente', 'pendente']);
    // gerar de novo sai do cache: nenhum pedido a mais ao Google
    const antes = g.sinteses().length;
    expect((await chamar('g', 'video')).geradas.every((x: {do_cache: boolean}) => x.do_cache)).toBe(true);
    expect(g.sinteses()).toHaveLength(antes);
  });

  it('sem a chave, gerar diz onde pôr; uma geração por vez', async () => {
    const {chamar} = montar();
    await expect(chamar('g', 'video')).rejects.toThrow(/Configurações › IA › Gemini/);
    cofre.gravar('gemini', CHAVE_GEMINI);
    const primeira = chamar('g', 'video');
    await expect(chamar('g', 'video')).rejects.toThrow(/já há uma narração sendo gerada/);
    await primeira;
  });

  it('a amostra é paga uma vez: a segunda vem do arquivo guardado; as vozes ficam na sessão', async () => {
    cofre.gravar('gemini', CHAVE_GEMINI);
    const {chamar, g} = montar();
    const a1 = await chamar('am', {voz: 'Kore'});
    expect(a1.do_cache).toBe(false);
    expect(a1.wav.byteLength).toBeGreaterThan(44);
    expect(a1.custo_usd).toBeGreaterThan(0);
    const a2 = await chamar('am', {voz: 'Kore'});
    expect(a2.do_cache).toBe(true);
    expect(g.sinteses()).toHaveLength(1);
    expect((await chamar('am', {voz: 'Puck'})).do_cache).toBe(false); // outra voz, outra amostra
    await chamar('v', 'gemini');
    await chamar('v', 'gemini');
    expect(g.pedidos.filter((p) => p.url.includes('/voices'))).toHaveLength(1);
    await chamar('v', 'gemini', true);
    expect(g.pedidos.filter((p) => p.url.includes('/voices'))).toHaveLength(2);
  });

  it('cancelar pelo canal da tela para entre uma cena e outra', async () => {
    cofre.gravar('gemini', CHAVE_GEMINI);
    // a tela clica em Cancelar quando a primeira fala fica pronta
    const {chamar} = montar((canal, a, h) => canal === 'a' && a.fase === 'gerando' && a.feitas === 1 && h.get('c')!());
    const r = await chamar('g', 'video');
    expect(r).toMatchObject({ok: false, cancelado: true, erro: 'cancelado depois de 1 de 2'});
    expect(r.geradas).toHaveLength(1);
  });
});
