// Arranjo padrão dos painéis (ux/pesquisa-ux-visual.md, itens 2 e 21): na Imagem e no 3D da tela grande o Claude nasce
// com largura de verdade, e no vídeo vertical da tela pequena a lista de cenas tem grupo próprio (não vira um ícone atrás
// das propriedades) e o Claude fica em até 42% da largura.
import {describe, expect, it} from 'vitest';

type Chamada = {id: string; position?: {referencePanel?: string; direction?: string}; initialWidth?: number};
const falso = () => {
  const paineis: Chamada[] = [];
  const tamanhos: Record<string, number[]> = {};
  const painel = (id: string) => ({api: {setSize: ({width}: {width: number}) => (tamanhos[id] ??= []).push(width), setActive: () => undefined, setTitle: () => undefined}});
  const api = {
    addPanel: (o: Chamada) => (paineis.push(o), painel(o.id)),
    getPanel: (id: string) => (paineis.some((p) => p.id === id) ? painel(id) : undefined),
  };
  return {api, paineis, tamanhos};
};
const janela = (w: number, h: number) => ((globalThis as unknown as {window: unknown}).window = {innerWidth: w, innerHeight: h});

const {layoutPadrao, CHAVE} = await import('../src/renderer/casca/arranjos');

describe('arranjo padrão', () => {
  it('Imagem na tela grande: o Claude entra por último e com largura', () => {
    janela(1920, 1080);
    const f = falso();
    layoutPadrao(f.api as never, 'imagem', 'P', 'V');
    const ordem = f.paineis.map((p) => p.id);
    expect(ordem.indexOf('terminal')).toBeGreaterThan(ordem.indexOf('inspector'));
    expect(f.tamanhos.terminal?.[0]).toBeGreaterThanOrEqual(480);
  });

  it('vídeo vertical na tela pequena: a lista tem grupo próprio e o Claude fica em até 42%', () => {
    janela(1366, 768);
    const f = falso();
    layoutPadrao(f.api as never, 'video', 'C', 'V');
    const lista = f.paineis.find((p) => p.id === 'lista')!;
    expect(lista.position?.direction).not.toBe('within');
    const monitor = f.tamanhos.monitor?.at(-1) ?? 0;
    expect(1366 - monitor - 200 - 290).toBeLessThanOrEqual(Math.round(1366 * 0.42) + 8);
  });

  it('Música na tela pequena: canais em coluna de altura total à esquerda, Claude e propriedades estreitos à direita', () => {
    janela(1366, 768);
    const f = falso();
    layoutPadrao(f.api as never, 'musica', 'C', 'V');
    const por = (id: string) => f.paineis.find((p) => p.id === id)!;
    expect(por('lista').position).toEqual({direction: 'left'}); // na raiz: altura total, vizinha do monitor e da linha
    expect(por('linha').position).toEqual({referencePanel: 'monitor', direction: 'below'});
    expect(por('inspector').position).toEqual({referencePanel: 'terminal', direction: 'below'});
    const direita = por('terminal').initialWidth!;
    expect(direita).toBeLessThanOrEqual(Math.round(1366 * 0.28));
    expect(f.tamanhos.monitor?.at(-1)).toBeGreaterThanOrEqual(1366 - 224 - direita - 8);
  });

  it('a chave dos arranjos gravados subiu (os quebrados não voltam); a da Música subiu sozinha', () => {
    expect(CHAVE('video', 'C', 'V')).toBe('estudio:layout:v9:video:C:V');
    expect(CHAVE('musica', 'C', 'V')).toBe('estudio:layout:v10:musica:C');
  });
});
