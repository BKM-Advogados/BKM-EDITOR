// Rodada 3, frente C: o granulado do PNG é o da prévia (tres-efeitos-D6).
import {describe, expect, it} from 'vitest';
import {GRANULADO, sementeDoGranulado, svgDoGranulado} from '../src/nucleo/efeitos';

describe('granulado: um gerador só (D6)', () => {
  it('o SVG do PNG leva a frequência, as oitavas e a semente da prévia', () => {
    const svg = svgDoGranulado(1080, 1350, 1080, 1350, sementeDoGranulado(0));
    expect(svg).toContain(`baseFrequency="${GRANULADO.frequencia}"`);
    expect(svg).toContain(`numOctaves="${GRANULADO.oitavas}"`);
    expect(svg).toContain('type="fractalNoise"');
    expect(svg).toContain('seed="0"');
    expect(GRANULADO).toEqual({frequencia: 0.9, oitavas: 2});
  });

  it('a escala da exportação aumenta o arquivo e mantém o grão em unidades do documento', () => {
    const um = svgDoGranulado(1080, 1350, 1080, 1350, 0);
    const dois = svgDoGranulado(1080, 1350, 2160, 2700, 0);
    expect(um).toContain('width="1080" height="1350" viewBox="0 0 1080 1350"');
    expect(dois).toContain('width="2160" height="2700" viewBox="0 0 1080 1350"'); // mesmo viewBox: o grão dobra de tamanho com a imagem
    expect(dois.replace(/width="2160" height="2700"/, 'width="1080" height="1350"')).toBe(um);
  });

  it('a semente é a do quadro, como na prévia do vídeo, e sempre a mesma para o mesmo quadro', () => {
    expect(sementeDoGranulado(0)).toBe(0);
    expect(sementeDoGranulado(1000)).toBe(3);
    expect(sementeDoGranulado(1000)).toBe(sementeDoGranulado(1000));
    expect(sementeDoGranulado(-5)).toBe(5);
  });
});
