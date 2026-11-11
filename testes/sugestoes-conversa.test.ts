// A conversa vazia sugere pedidos da área em que a pessoa está (ux/pesquisa-ux-visual.md, item 8): antes eram três
// sugestões iguais em toda parte, e na Música e na Animação falavam de "bloco".
import {describe, expect, it} from 'vitest';
import {SUGESTOES} from '../src/renderer/paineis/Conversa';

describe('sugestões da conversa', () => {
  it('cada área tem as suas, e Música e Animação não falam de bloco', () => {
    for (const area of ['video', 'imagem', '3d', 'efeitos', 'musica', 'animacao'] as const) expect(SUGESTOES[area].length).toBeGreaterThanOrEqual(2);
    expect(SUGESTOES.musica.join(' ')).not.toMatch(/bloco/i);
    expect(SUGESTOES.animacao.join(' ')).not.toMatch(/bloco/i);
    expect(SUGESTOES.musica).toContain('Deixe a batida mais calma');
    expect(SUGESTOES.animacao).toContain('Faça o logo entrar girando');
  });
});
