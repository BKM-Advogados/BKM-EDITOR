// Lâmina: dividir uma cena do vídeo de cenas em duas no tempo da cabeça (Ctrl+K, o "Add Edit" do Premiere). A primeira
// fica com os blocos que começam antes do corte, a segunda com os que começam depois (tempos contados do novo começo), e
// um bloco que atravessa o corte vai para as duas, aparado em `sai` numa e em `em` na outra. A segunda cena nasce com
// ids novos (comIdsNovos), como uma cena duplicada. Sai como JSON Patch, o mesmo caminho das outras edições (diário,
// desfazer, o Claude vê). Fica fora de cenas.ts de propósito: este arquivo só lê o modelo.
import {comIdsNovos, DURACAO_CENA_PADRAO, type BlocoCenas, type CenaCenas, type DocCenas} from './cenas';
import type {OperacaoPatch} from './documentos';

/** Menor pedaço que pode sobrar de cada lado do corte (o resolvedor não aceita cena abaixo de 300 ms). */
export const PEDACO_MIN_MS = 300;

export type Divisao = {indice: number; primeira: CenaCenas; segunda: CenaCenas; patch: OperacaoPatch[]};

const numero = (v: unknown, padrao: number) => (typeof v === 'number' && Number.isFinite(v) ? v : padrao);

/**
 * Divide a cena `idCena` em `tMs` (ms contados do começo da cena). Devolve null quando a cena não existe ou quando o
 * corte cai a menos de PEDACO_MIN_MS de uma das pontas: não haveria o que dividir.
 */
export const dividirCena = (doc: DocCenas, idCena: string, tMs: number): Divisao | null => {
  const cenas = Array.isArray(doc.cenas) ? doc.cenas : [];
  const indice = cenas.findIndex((c) => c.id === idCena);
  if (indice < 0) return null;
  const cena = cenas[indice];
  const dur = numero(cena.duracao_ms, DURACAO_CENA_PADRAO);
  const t = Math.round(tMs);
  if (!(t >= PEDACO_MIN_MS && dur - t >= PEDACO_MIN_MS)) return null;

  const antes: BlocoCenas[] = [];
  const depois: BlocoCenas[] = [];
  for (const b of Array.isArray(cena.blocos) ? cena.blocos : []) {
    const em = Math.max(0, numero(b.em, 0));
    const sai = b.sai === undefined ? undefined : numero(b.sai, dur);
    if (em >= t) {
      // começa depois do corte: vai inteiro para a segunda, com os tempos contados do novo começo
      depois.push({...b, em: em - t, ...(sai !== undefined ? {sai: Math.max(em - t, sai - t)} : {})});
    } else if (sai === undefined || sai > t) {
      // atravessa o corte: fica nas duas; na primeira acaba no corte (sai explícito vira o fim dela, sem sai já é o fim),
      // na segunda começa no zero
      antes.push(sai === undefined ? b : {...b, sai: t});
      depois.push({...b, em: 0, ...(sai !== undefined ? {sai: sai - t} : {})});
    } else antes.push(b); // termina antes do corte
  }
  const primeira: CenaCenas = {...cena, duracao_ms: t, blocos: antes};
  const segunda = comIdsNovos<CenaCenas>({...cena, duracao_ms: dur - t, blocos: depois}, doc, 'cena');
  const patch: OperacaoPatch[] = [
    {op: 'test', path: `/cenas/${indice}/id`, value: cena.id},
    {op: 'replace', path: `/cenas/${indice}`, value: primeira},
    {op: 'add', path: `/cenas/${indice + 1}`, value: segunda},
  ];
  return {indice, primeira, segunda, patch};
};
