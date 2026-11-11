// Tela cheia do monitor: o botão e o Ctrl+F levam o painel do monitor (data-monitor-tela-cheia) à tela cheia nas áreas
// Vídeo, Imagem e Animação; de novo, ou Esc, saem. O Ctrl+F não colide com outro atalho da casca.
import fs from 'node:fs';
import path from 'node:path';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const pedido = vi.fn(async () => undefined);
const saida = vi.fn(async () => undefined);
const monitor = {requestFullscreen: pedido};
const doc = {fullscreenElement: null as unknown, exitFullscreen: saida, querySelector: vi.fn((s: string) => (s === '[data-monitor-tela-cheia]' ? monitor : null))};
(globalThis as unknown as {document: unknown}).document = doc;

const {alternarTelaCheia, sairDaTelaCheia, MARCA_TELA_CHEIA} = await import('../src/renderer/componentes/TelaCheia');
const ler = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', ...p), 'utf8');

describe('tela cheia do monitor', () => {
  beforeEach(() => {
    pedido.mockClear();
    saida.mockClear();
    doc.fullscreenElement = null;
  });

  it('sem elemento dado, vai o monitor da área aberta; já em tela cheia, sai', () => {
    alternarTelaCheia();
    expect(pedido).toHaveBeenCalledTimes(1);
    doc.fullscreenElement = monitor;
    alternarTelaCheia();
    expect(saida).toHaveBeenCalledTimes(1);
    expect(pedido).toHaveBeenCalledTimes(1);
  });

  it('Esc só faz algo em tela cheia', () => {
    expect(sairDaTelaCheia()).toBe(false);
    doc.fullscreenElement = monitor;
    expect(sairDaTelaCheia()).toBe(true);
    expect(saida).toHaveBeenCalledTimes(1);
  });

  it('os três monitores têm a marca e o botão', () => {
    for (const arq of [['modulos', 'video', 'MonitorVideo.tsx'], ['modulos', 'imagem', 'MonitorImagem.tsx'], ['modulos', 'animacao', 'MonitorAnimacao.tsx']]) {
      const tsx = ler(...arq);
      expect(tsx).toContain(MARCA_TELA_CHEIA);
      expect(tsx).toContain('<BotaoTelaCheia />');
    }
  });

  it('Ctrl+F é o único atalho de "f" com Ctrl na casca', () => {
    const casca = ler('casca', 'Casca.tsx');
    expect(casca.match(/k === 'f'/g)).toHaveLength(1);
    expect(casca).toMatch(/k === 'f' && !digitando && COM_TELA_CHEIA/);
  });
});
