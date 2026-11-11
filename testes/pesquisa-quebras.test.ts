// C13 (auditoria de conteúdo): na comparação exata, quebras seguidas (linha em branco entre parágrafos, comum em texto
// puro e PDF) contavam como dois espaços, e o trecho de dois parágrafos caía para "parecido". Agora valem um espaço só,
// no texto e no trecho, e os índices devolvidos continuam os do texto como gravado.
import {describe, expect, it} from 'vitest';
import {acharTrecho, hashTexto, normalizar} from '../src/nucleo/pesquisa';

describe('C13: quebras seguidas valem um espaço (dos dois lados)', () => {
  const casos: [string, string][] = [
    ['Art. 1º O empregado.\n\nParágrafo único. Vale.', 'Art. 1º O empregado. Parágrafo único. Vale.'],
    ['Art. 1º O empregado.\nParágrafo único. Vale.', 'Art. 1º O empregado.\n\nParágrafo único. Vale.'],
    ['x\n\n\nArt. 1º O empregado.\n\nParágrafo único. Vale.\n\nfim', 'O empregado.\nParágrafo'],
    ['Art. 1º O empregado.  \n \n  Parágrafo único.', 'O empregado. Parágrafo único.'],
  ];

  it('os casos dão "exato", com os índices certos no texto original', () => {
    for (const [texto, trecho] of casos) {
      const r = acharTrecho(texto, trecho);
      expect(r.achado, JSON.stringify([texto, trecho])).toBe('exato');
      const achado = texto.slice(r.inicio, r.fim).replace(/\s+/g, ' ');
      expect(achado).toBe(trecho.replace(/\s+/g, ' '));
    }
  });

  it('uma quebra só continua exata, e o que não está no texto continua "nao"', () => {
    expect(acharTrecho('Art. 1º O empregado.\nParágrafo único. Vale.', 'Art. 1º O empregado. Parágrafo único. Vale.').achado).toBe('exato');
    expect(acharTrecho('Art. 1º O empregado.\n\nParágrafo único.', 'Art. 2º').achado).toBe('nao');
  });

  it('normalizar e hashTexto não mudam: as quebras ficam no texto guardado', () => {
    expect(normalizar('a\n\nb')).toBe('a\n\nb');
    expect(hashTexto('a\n\nb')).not.toBe(hashTexto('a\nb'));
  });
});
