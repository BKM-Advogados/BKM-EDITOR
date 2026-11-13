// Chip de formato sobre o monitor (Onda B, frente do editor): o rótulo pelo destino para cada formato de formatos.ts,
// o "Personalizado L×A", quando o chip só informa (animação de formato fixo, roteiro antigo, 3D) e o que a troca grava.
import {describe, expect, it} from 'vitest';
import {chipDoFormato, formatoFixoNoModulo, nomeCurto, rotuloDoFormato, rotuloDoPreset, trocaDeFormato} from '../src/nucleo/chip-formato';
import {novoDocCenas} from '../src/nucleo/cenas';
import {FORMATOS_IMAGEM, FORMATOS_VIDEO} from '../src/nucleo/formatos';

const cenas = (largura: number, altura: number, fps = 30) => novoDocCenas({largura, altura, fps});
const imagem = (largura: number, altura: number) => ({formato: 1, largura, altura, fundo: '#000', camadas: [], efeitos: []});
const animacao = (largura: number, altura: number) => ({formato: 1, largura, altura, fps: 30, duracao_ms: 5000, fundo: '#000', camadas: []});

describe('rótulo do chip', () => {
  it('cada formato de vídeo pelo destino', () => {
    expect(FORMATOS_VIDEO.map(rotuloDoPreset)).toEqual(['Reels 9:16', 'Feed 4:5', 'Quadrado 1:1', 'YouTube 16:9']);
  });

  it('cada formato de imagem pelo destino; o A4 sem proporção repetida', () => {
    expect(FORMATOS_IMAGEM.map(rotuloDoPreset)).toEqual(['Post retrato 4:5', 'Post quadrado 1:1', 'Story 9:16', 'Miniatura 16:9', 'LinkedIn 1,91:1', 'A4']);
  });

  it('o nome curto corta no primeiro "e", "do" ou "para"', () => {
    expect(nomeCurto({nome: 'Reels e Shorts'})).toBe('Reels');
    expect(nomeCurto({nome: 'YouTube e apresentação'})).toBe('YouTube');
    expect(nomeCurto({nome: 'Miniatura do YouTube'})).toBe('Miniatura');
    expect(nomeCurto({nome: 'A4 para imprimir'})).toBe('A4');
    expect(nomeCurto({nome: 'Feed'})).toBe('Feed');
  });

  it('tamanho fora da lista é Personalizado L×A', () => {
    expect(rotuloDoFormato(FORMATOS_VIDEO, 1200, 800)).toBe('Personalizado 1200×800');
    expect(rotuloDoFormato(FORMATOS_VIDEO, 1080, 1350)).toBe('Feed 4:5');
    // o mesmo tamanho tem nome diferente na lista da imagem
    expect(rotuloDoFormato(FORMATOS_IMAGEM, 1080, 1920)).toBe('Story 9:16');
  });
});

describe('chip do documento', () => {
  it('vídeo de cenas: rótulo, medidas na dica e as quatro opções com a atual marcada', () => {
    const c = chipDoFormato('video', cenas(1080, 1920))!;
    expect(c.rotulo).toBe('Reels 9:16');
    expect(c.trocavel).toBe(true);
    expect(c.dica).toContain('1080×1920 · 30 qps');
    expect(c.opcoes.map((o) => o.id)).toEqual(['reels', 'feed', 'quadrado', 'youtube']);
    expect(c.opcoes.filter((o) => o.atual).map((o) => o.id)).toEqual(['reels']);
  });

  it('vídeo de cenas em tamanho livre: Personalizado, sem opção atual, e troca', () => {
    const c = chipDoFormato('video', cenas(1200, 800))!;
    expect(c.rotulo).toBe('Personalizado 1200×800');
    expect(c.trocavel).toBe(true);
    expect(c.opcoes.some((o) => o.atual)).toBe(false);
  });

  it('documento de vídeo sem formato é o carrossel 9:16 de antes', () => {
    expect(chipDoFormato('video', {tipo: 'cenas', cenas: []})!.rotulo).toBe('Reels 9:16');
  });

  it('roteiro antigo do carrossel só informa', () => {
    const c = chipDoFormato('video', {meta: {titulo: 'x'}, slides: []})!;
    expect(c.rotulo).toBe('Reels 9:16');
    expect(c.trocavel).toBe(false);
    expect(c.motivo).toMatch(/1080×1920/);
    expect(c.opcoes).toEqual([]);
  });

  it('imagem usa a lista da imagem e troca', () => {
    const c = chipDoFormato('imagem', imagem(1080, 1350))!;
    expect(c.rotulo).toBe('Post retrato 4:5');
    expect(c.trocavel).toBe(true);
    expect(c.opcoes).toHaveLength(FORMATOS_IMAGEM.length);
  });

  it('animação: todo modelo de animação tem formato_fixo, então o chip só informa', () => {
    expect(formatoFixoNoModulo('animacao')).toBe(true);
    expect(formatoFixoNoModulo('video')).toBe(false);
    const c = chipDoFormato('animacao', animacao(1920, 1080))!;
    expect(c.rotulo).toBe('YouTube 16:9');
    expect(c.trocavel).toBe(false);
    expect(c.motivo).toMatch(/modelo/);
    expect(c.dica).toContain('30 qps');
  });

  it('3D só informa; música e documento não lido não têm chip', () => {
    const c = chipDoFormato('3d', {objetos: []})!;
    expect(c.trocavel).toBe(false);
    expect(c.rotulo).toMatch(/3D/);
    expect(chipDoFormato('musica', {})).toBeNull();
    expect(chipDoFormato('video', undefined)).toBeNull();
    expect(chipDoFormato('imagem', {camadas: []})).toBeNull();
  });
});

describe('troca de formato', () => {
  it('vídeo grava /formato inteiro e mantém o fps', () => {
    const t = trocaDeFormato('video', cenas(1080, 1920, 25), 'youtube')!;
    expect(t.rotulo).toBe('formato YouTube 16:9');
    expect(t.mudancas).toEqual([{caminho: '/formato', valor: {largura: 1920, altura: 1080, fps: 25}}]);
  });

  it('imagem grava só o lado que muda', () => {
    expect(trocaDeFormato('imagem', imagem(1080, 1350), 'quadrado')!.mudancas).toEqual([{caminho: '/altura', valor: 1080}]);
    expect(trocaDeFormato('imagem', imagem(1080, 1350), 'linkedin')!.mudancas).toEqual([{caminho: '/largura', valor: 1200}, {caminho: '/altura', valor: 627}]);
  });

  it('nada a gravar: o mesmo formato, id que não existe, ou onde só informa', () => {
    expect(trocaDeFormato('video', cenas(1080, 1920), 'reels')).toBeNull();
    expect(trocaDeFormato('video', cenas(1080, 1920), 'cinema')).toBeNull();
    expect(trocaDeFormato('animacao', animacao(1920, 1080), 'reels')).toBeNull();
    expect(trocaDeFormato('3d', {}, 'reels')).toBeNull();
  });
});
