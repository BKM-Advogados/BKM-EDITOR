// Esquema versionado do documento de música (M-02 em docs/musica-daw.md): o campo `formato` diz a versão, e cada mudança de
// esquema entra aqui como um migrador puro de um formato para o seguinte. Regras:
// - um migrador nunca muda o som (A4): o documento migrado renderiza o mesmo PCM que o original (os testes conferem);
// - os migradores são encadeados (0 → 1 → 2 …) e cada um é idempotente: migrar o que já está no formato de chegada não
//   muda nada;
// - puro: não toca no documento recebido (trabalha numa cópia) e não lê disco; quem grava é quem chama, pelo mesmo JSON
//   Patch com diário (patchDaMigracao);
// - documento de formato mais novo que este app conhece não é mexido: volta igual, com aviso (abrir num Estúdio velho não
//   estraga o que um novo escreveu).
import jsonpatch, {type Operation} from 'fast-json-patch';
import {FORMATO_MUSICA} from './musica';

/** O formato que este app escreve; os documentos lidos sobem até ele. */
export const FORMATO_ATUAL: number = FORMATO_MUSICA;

type Doc = Record<string, unknown>;

export type Migrador = {
  de: number;
  para: number;
  /** Uma linha para o diário e para o aviso da tela. */
  descricao: string;
  /** Recebe uma cópia (pode mexer nela) no formato `de` e devolve o documento no formato `para`. */
  migrar: (doc: Doc) => Doc;
};

/** A cadeia, em ordem. Formato 0 = documento sem `formato` (ou com um valor que não é inteiro), anterior ao campo. */
export const MIGRADORES: Migrador[] = [
  {
    de: 0,
    para: 1,
    descricao: 'documento sem "formato": passa a dizer formato 1 (o resto fica como está)',
    migrar: (doc) => ({...doc, formato: 1}),
  },
];

/** O formato que o documento diz ter: 0 sem o campo ou com valor que não é inteiro não negativo. */
export const formatoDe = (doc: unknown): number => {
  const f = doc && typeof doc === 'object' ? (doc as Doc).formato : undefined;
  return typeof f === 'number' && Number.isInteger(f) && f >= 0 ? f : 0;
};

export type ResultadoMigracao = {
  /** O documento no formato atual (o mesmo objeto recebido quando nada mudou). */
  doc: Doc;
  de: number;
  para: number;
  /** As descrições dos migradores aplicados, em ordem. */
  aplicados: string[];
  mudou: boolean;
  /** Formato mais novo que este app: o documento volta sem mudança. */
  futuro: boolean;
  avisos: string[];
};

/** Leva o documento ao FORMATO_ATUAL pela cadeia. Puro e idempotente: migrar(migrar(d).doc) não muda mais nada. */
export const migrarMusica = (doc: unknown, cadeia: Migrador[] = MIGRADORES, alvo: number = FORMATO_ATUAL): ResultadoMigracao => {
  const original = (doc && typeof doc === 'object' ? doc : {}) as Doc;
  const de = formatoDe(original);
  const avisos: string[] = [];
  const bruto = original.formato;
  if (bruto !== undefined && formatoDe(original) === 0 && bruto !== 0) avisos.push(`o formato ${JSON.stringify(bruto)} não é um número inteiro; lido como documento sem formato`);
  if (de > alvo) {
    avisos.push(`o documento é do formato ${de}, mais novo que o deste Estúdio (${alvo}); fica como está e pode haver campos que este app não entende`);
    return {doc: original, de, para: de, aplicados: [], mudou: false, futuro: true, avisos};
  }
  let atual = original;
  let f = de;
  const aplicados: string[] = [];
  while (f < alvo) {
    const m = cadeia.find((x) => x.de === f);
    if (!m) throw new Error(`falta o migrador do formato ${f} da música`);
    if (m.para <= f) throw new Error(`o migrador do formato ${f} não avança (vai para ${m.para})`);
    if (atual === original) atual = structuredClone(original);
    atual = m.migrar(atual);
    f = m.para;
    aplicados.push(m.descricao);
  }
  return {doc: atual, de, para: f, aplicados, mudou: atual !== original, futuro: false, avisos};
};

/** O JSON Patch que leva o documento gravado ao formato atual (vazio se já está), para passar pelo aplicar_patch com
 *  diário, com a versão base de quem leu: a migração vira uma entrada do Histórico como qualquer outra. */
export const patchDaMigracao = (doc: unknown): Operation[] => {
  const r = migrarMusica(doc);
  return r.mudou ? jsonpatch.compare(doc as object, r.doc) : [];
};
