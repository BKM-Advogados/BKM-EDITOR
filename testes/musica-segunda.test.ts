// Uma segunda música pela interface: o seletor do topo da lista da Música oferece "Nova música…" mesmo com uma só, e o
// monitor, com uma música aberta e o pedido de criar outra, mostra os modelos com a volta para a aberta.
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {InfoProjeto} from '../src/compartilhado/api';
import type {EntradaDocumento} from '../src/nucleo/documentos';
import {novaMusica} from '../src/nucleo/musica';

// sem DOM: a leitura das lojas na renderização estática é a leitura direta do estado
vi.mock('react', async (original) => {
  const r = await original<typeof import('react')>();
  return {...r, default: r, useSyncExternalStore: (_: unknown, ler: () => unknown) => ler()};
});

const entrada = (id: string, titulo: string): EntradaDocumento => ({id, modulo: 'musica', caminho: `musica/${id}.json`, titulo});
const infoCom = (docs: EntradaDocumento[]) => ({raiz: '/proj', manifesto: {formato: 1, nome: 'P', documentos: docs}} as unknown as InfoProjeto);
const estudio = {
  lerJsonOpcional: vi.fn(async () => null),
  projetoAtual: vi.fn(async () => null),
  lerDocumento: vi.fn(async () => ({doc: novaMusica(), versao: '1'})),
  comentarios: vi.fn(async () => []),
  diario: vi.fn(async () => []),
  pesquisa: vi.fn(async () => null),
};
(globalThis as unknown as {window: unknown}).window = {estudio, addEventListener: () => {}, removeEventListener: () => {}};

const {abrirProjeto, loja} = await import('../src/renderer/estado/loja');
const {SeletorDocumento} = await import('../src/renderer/componentes/SeletorDocumento');
const {musica} = await import('../src/renderer/modulos/musica/estado');
const {MonitorMusica} = await import('../src/renderer/modulos/musica/Monitor');

const novo = {rotulo: 'Nova música…', acao: () => {}};

describe('segunda música', () => {
  beforeEach(async () => {
    await abrirProjeto(infoCom([entrada('trilha', 'Trilha')]));
    loja.definir((e) => ({ativo: {...e.ativo, musica: 'trilha'}, docs: {...e.docs, trilha: {doc: novaMusica(), versao: '1'}}}) as never);
    musica.definir({escolhendoModelo: false});
  });

  it('com uma música só, o seletor aparece com o botão de criar outra (e some sem ele)', () => {
    expect(renderToStaticMarkup(React.createElement(SeletorDocumento, {modulo: 'musica'}))).toBe('');
    const html = renderToStaticMarkup(React.createElement(SeletorDocumento, {modulo: 'musica', novo}));
    expect(html).toContain('Nova música…');
  });

  it('com duas, o seletor troca e o botão fica compacto', async () => {
    await abrirProjeto(infoCom([entrada('trilha', 'Trilha'), entrada('calma', 'Calma')]));
    const html = renderToStaticMarkup(React.createElement(SeletorDocumento, {modulo: 'musica', novo}));
    expect(html).toContain('Música aberta');
    expect(html).toContain('aria-label="Nova música…"');
  });

  it('o monitor mostra os modelos com a volta para a música aberta', () => {
    expect(renderToStaticMarkup(React.createElement(MonitorMusica))).not.toContain('Nova música neste projeto');
    musica.definir({escolhendoModelo: true});
    const html = renderToStaticMarkup(React.createElement(MonitorMusica));
    expect(html).toContain('Nova música neste projeto');
    expect(html).toContain('Batida');
    expect(html).toContain('Voltar para “Trilha”');
  });
});
