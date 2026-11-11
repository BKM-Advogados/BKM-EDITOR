// Camada de pixel com grade recusada (acima do teto ou inválida) sumia em silêncio da prévia e da exportação: a tela
// agora avisa, com o motivo. A conta só lê o documento.
import {describe, expect, it} from 'vitest';
import {camadasDescartadas, novaAnimacao, novaCamadaAnimacao} from '../src/nucleo/animacao';
import {MAX_LADO_GRADE_DOCUMENTO} from '../src/nucleo/animacao-pixel';

const pixel = (id: string, grade: unknown, nome?: string) => ({...novaCamadaAnimacao('pixel', id), ...(nome ? {nome} : {}), grade});
const comCamadas = (camadas: unknown[]) => ({...novaAnimacao(1080, 1080), camadas});

describe('camadas descartadas', () => {
  it('grade válida, grande dentro do teto ou consertável: nenhuma descartada', () => {
    const doc = comCamadas([
      novaCamadaAnimacao('texto', 't'),
      pixel('ok', {colunas: 637, linhas: 301, paleta: ['#FFFFFF'], celulas: '.'.repeat(637 * 301)}),
      pixel('curta', {colunas: 4, linhas: 4, paleta: ['#FFFFFF'], celulas: '00'}), // completada com vazio, não some
      {...novaCamadaAnimacao('pixel', 'sem-grade'), grade: undefined},
    ]);
    expect(camadasDescartadas(doc)).toEqual([]);
  });

  it('acima do teto e inválida: o índice, o nome e o motivo de cada uma', () => {
    const doc = comCamadas([
      novaCamadaAnimacao('texto', 't'),
      pixel('ceu', {colunas: MAX_LADO_GRADE_DOCUMENTO + 1, linhas: 300, paleta: [], celulas: ''}, 'Céu'),
      pixel('sol', {colunas: 2.5, linhas: 4, paleta: [], celulas: ''}, 'Sol'),
      pixel('lua', 'não é grade'),
      pixel('nuvem', {colunas: 3, linhas: 3, paleta: []}),
    ]);
    const antes = JSON.stringify(doc);
    const r = camadasDescartadas(doc);
    expect(r.map((c) => [c.indice, c.id])).toEqual([[1, 'ceu'], [2, 'sol'], [3, 'lua'], [4, 'nuvem']]);
    expect(r[0]).toMatchObject({nome: 'Céu', motivo: `grade de ${MAX_LADO_GRADE_DOCUMENTO + 1}×300, acima do máximo de ${MAX_LADO_GRADE_DOCUMENTO} por lado`});
    expect(r[1].motivo).toMatch(/^grade inválida: colunas e linhas precisam ser inteiros/);
    expect(r[2].motivo).toBe('grade inválida: não é um objeto');
    expect(r[3].motivo).toBe('grade inválida: sem "celulas"');
    expect(JSON.stringify(doc)).toBe(antes); // o documento não muda
  });

  it('documento estranho não derruba', () => {
    expect(camadasDescartadas(null)).toEqual([]);
    expect(camadasDescartadas({camadas: 'x'})).toEqual([]);
    expect(camadasDescartadas({camadas: [null, {grade: 1}]})).toEqual([{indice: 1, id: 'camada', nome: 'Camada', motivo: 'grade inválida: não é um objeto'}]);
  });
});
