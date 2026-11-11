// M10 (auditoria do MCP): criar_documento grava o estudio.json e o .estudio/selecao.json quase juntos. Se o pedido de
// seleção chega antes de a tela conhecer o documento novo, a tela relê a lista de documentos antes de aplicar, em vez
// de descartar o pedido em silêncio. E com duas animações, o seletor troca a aberta e zera a seleção e a agulha.
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {InfoProjeto} from '../src/compartilhado/api';
import type {EntradaDocumento} from '../src/nucleo/documentos';

const entrada = (id: string, modulo: EntradaDocumento['modulo']): EntradaDocumento => ({id, modulo, caminho: `${modulo}/${id}.json`, titulo: id});
const infoCom = (docs: EntradaDocumento[]) => ({raiz: '/proj', manifesto: {formato: 1, nome: 'P', documentos: docs}} as unknown as InfoProjeto);

let noDisco: InfoProjeto;
let pedido: unknown;
const estudio = {
  lerJson: vi.fn(async () => pedido),
  projetoAtual: vi.fn(async () => noDisco),
  lerDocumento: vi.fn(async () => ({doc: {camadas: []}, versao: '1'})),
  propsVideo: vi.fn(async () => ({props: {}})),
  comentarios: vi.fn(async () => []),
  diario: vi.fn(async () => []),
  pesquisa: vi.fn(async () => null),
};
(globalThis as unknown as {window: unknown}).window = {estudio};

const {abrirProjeto, aplicarSelecaoPedida, loja} = await import('../src/renderer/estado/loja');
const {trocarDocumento} = await import('../src/renderer/componentes/SeletorDocumento');

describe('seleção pedida pela IA', () => {
  beforeEach(async () => {
    const antes = infoCom([entrada('video', 'video'), entrada('animacao', 'animacao')]);
    noDisco = antes;
    await abrirProjeto({...antes, raiz: `/proj-${Math.random()}`} as InfoProjeto); // projeto "outro" zera o estado
    await abrirProjeto(antes);
    loja.definir({area: 'video', selecao: null, tempo_ms: 4200});
  });

  it('o pedido que chega antes do estudio.json não se perde: relê a lista e leva a tela à animação nova', async () => {
    noDisco = infoCom([entrada('video', 'video'), entrada('animacao', 'animacao'), entrada('animacao-2', 'animacao')]);
    pedido = {documento: 'animacao-2', caminhos: [], autor: 'agente', em: '2026-11-10T00:00:00Z'};
    await aplicarSelecaoPedida();
    const e = loja.get();
    expect(estudio.projetoAtual).toHaveBeenCalled();
    expect(e.area).toBe('animacao');
    expect(e.ativo.animacao).toBe('animacao-2');
    expect(e.tempo_ms).toBe(0);
    expect(e.selecao).toBeNull();
  });

  it('com tempo_ms e caminho, põe a agulha e seleciona', async () => {
    pedido = {documento: 'animacao', caminhos: ['/camadas/1'], tempo_ms: 1500, autor: 'agente'};
    await aplicarSelecaoPedida();
    const e = loja.get();
    expect(e.area).toBe('animacao');
    expect(e.tempo_ms).toBe(1500);
    expect(e.selecao).toEqual({documento: 'animacao', caminho: '/camadas/1'});
  });

  it('documento que não existe nem depois de reler: a tela fica onde está', async () => {
    pedido = {documento: 'nao-existe', caminhos: []};
    await aplicarSelecaoPedida();
    expect(loja.get().area).toBe('video');
  });

  it('o seletor de documento troca a animação aberta e zera a seleção e a agulha', () => {
    loja.definir({area: 'animacao', selecao: {documento: 'animacao', caminho: '/camadas/0'}, tempo_ms: 900});
    trocarDocumento('animacao', 'animacao-2');
    const e = loja.get();
    expect(e.ativo.animacao).toBe('animacao-2');
    expect(e.selecao).toBeNull();
    expect(e.tempo_ms).toBe(0);
  });
});
