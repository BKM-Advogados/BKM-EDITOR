// Um Chrome por exportação (auditoria de render, R10): o navegador abre no primeiro destino e serve a todos (medir com o
// selectComposition e renderizar com o renderMedia), com a escala no próprio Chrome; outra escala abre outro, e o
// encerrarRender fecha o que abriu. O Remotion vai de mentira: só conta as aberturas e o que chega a cada chamada.
import {describe, expect, it, vi} from 'vitest';

const r = vi.hoisted(() => ({abertos: [] as {escala?: number; fechado: boolean}[], usados: [] as unknown[]}));
vi.mock('@remotion/renderer', () => ({
  openBrowser: async (_b: string, o: {forceDeviceScaleFactor?: number}) => {
    const n = {escala: o.forceDeviceScaleFactor, fechado: false, close: async () => void (n.fechado = true)};
    r.abertos.push(n);
    return n;
  },
  selectComposition: async (o: {puppeteerInstance?: unknown}) => (r.usados.push(o.puppeteerInstance), {durationInFrames: 30, fps: 30}),
  renderMedia: async (o: {puppeteerInstance?: unknown}) => void r.usados.push(o.puppeteerInstance),
}));
const {encerrarRender, renderizarVideo} = await import('../src/main/exportar');

describe('R10 · um Chrome por exportação', () => {
  it('dois destinos na mesma escala usam o mesmo Chrome; outra escala troca; encerrar fecha', async () => {
    const p = {serveUrl: 'x', browserExecutable: null, binariesDirectory: null};
    const props = {composicao: 'Animacao'};
    await renderizarVideo(p, {props, arquivo: '/tmp/a.mp4'}, () => undefined);
    await renderizarVideo(p, {props, arquivo: '/tmp/b.mp4'}, () => undefined);
    expect(r.abertos).toHaveLength(1);
    expect(r.usados).toHaveLength(4);
    expect(new Set(r.usados).size).toBe(1);
    expect(r.usados[0]).toBe(r.abertos[0]);
    await renderizarVideo(p, {props, arquivo: '/tmp/c.mp4', escala: 2}, () => undefined);
    expect(r.abertos.map((n) => [n.escala, n.fechado])).toEqual([[1, true], [2, false]]);
    await encerrarRender(p);
    expect(r.abertos[1].fechado).toBe(true);
    await encerrarRender(p); // de novo: nada a fechar
  });
});
