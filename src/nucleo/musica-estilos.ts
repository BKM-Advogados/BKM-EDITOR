// Padrões de bateria da casa, para começar uma batida com um gesto (criar_padrao com estilo, e o menu do sequenciador).
// Um compasso de 4/4 em 16 passos; cada linha é uma peça e os números são os passos (0 a 15) em que ela toca, com a
// força. Escritos aqui à mão, sem amostra nem MIDI de terceiros.
import type {NotaMusica, PecaBateria} from './musica';

type Linha = {peca: PecaBateria; passos: number[]; forca?: number; acentos?: number[]};
export type Estilo = {id: string; nome: string; bpm: number; linhas: Linha[]};

const oitavas = [0, 2, 4, 6, 8, 10, 12, 14];
const dezesseis = Array.from({length: 16}, (_, i) => i);

export const ESTILOS: Estilo[] = [
  {id: 'basico', nome: 'Básico', bpm: 100, linhas: [
    {peca: 'bumbo', passos: [0, 8], forca: 110},
    {peca: 'caixa', passos: [4, 12], forca: 105},
    {peca: 'chimbal_fechado', passos: oitavas, forca: 80, acentos: [0, 4, 8, 12]},
  ]},
  {id: 'pop', nome: 'Pop', bpm: 110, linhas: [
    {peca: 'bumbo', passos: [0, 6, 8, 10], forca: 110},
    {peca: 'caixa', passos: [4, 12], forca: 100},
    {peca: 'palma', passos: [4, 12], forca: 85},
    {peca: 'chimbal_fechado', passos: oitavas, forca: 75, acentos: [2, 6, 10, 14]},
  ]},
  {id: 'eletronico', nome: 'Eletrônico (quatro no chão)', bpm: 124, linhas: [
    {peca: 'bumbo', passos: [0, 4, 8, 12], forca: 115},
    {peca: 'palma', passos: [4, 12], forca: 95},
    {peca: 'chimbal_aberto', passos: [2, 6, 10, 14], forca: 80},
    {peca: 'chimbal_fechado', passos: [1, 3, 5, 7, 9, 11, 13, 15], forca: 55},
  ]},
  {id: 'dembow', nome: 'Dembow', bpm: 95, linhas: [
    {peca: 'bumbo', passos: [0, 4, 8, 12], forca: 110},
    {peca: 'caixa', passos: [3, 6, 11, 14], forca: 100},
    {peca: 'chimbal_fechado', passos: oitavas, forca: 65},
  ]},
  {id: 'trap', nome: 'Trap', bpm: 140, linhas: [
    {peca: 'bumbo', passos: [0, 7, 10], forca: 115},
    {peca: 'palma', passos: [8], forca: 105},
    {peca: 'caixa', passos: [8], forca: 90},
    {peca: 'chimbal_fechado', passos: dezesseis, forca: 60, acentos: [0, 4, 8, 12]},
  ]},
  {id: 'calmo', nome: 'Calmo (para fundo de fala)', bpm: 85, linhas: [
    {peca: 'bumbo', passos: [0, 10], forca: 85},
    {peca: 'aro', passos: [4, 12], forca: 70},
    {peca: 'shaker', passos: oitavas, forca: 50, acentos: [2, 6, 10, 14]},
  ]},
];

/** As notas de um estilo, num compasso de `bpc` batidas (o estilo é escrito em 4/4: noutro compasso, corta ou repete). */
export const padraoDoEstilo = (id: string, bpc = 4): {dur: number; notas: NotaMusica[]} => {
  const e = ESTILOS.find((x) => x.id === id);
  if (!e) throw new Error(`estilo desconhecido: ${id} (${ESTILOS.map((x) => x.id).join(', ')})`);
  const notas: NotaMusica[] = [];
  for (let volta = 0; volta * 4 < bpc; volta++) {
    for (const l of e.linhas) {
      for (const p of l.passos) {
        const em = volta * 4 + p / 4;
        if (em >= bpc) continue;
        notas.push({peca: l.peca, em, forca: Math.min(127, (l.forca ?? 100) + (l.acentos?.includes(p) ? 15 : 0))});
      }
    }
  }
  notas.sort((a, b) => a.em - b.em);
  return {dur: bpc, notas};
};
