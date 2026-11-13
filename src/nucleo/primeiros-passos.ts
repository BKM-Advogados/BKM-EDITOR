// Primeiros passos: a lista curta de quem abre um projeto pela primeira vez. Cada passo se marca sozinho pelo estado do
// projeto (mídia em midia/, texto escrito, o Claude no diário) ou do editor (a prévia tocou, a exportação terminou),
// nunca por um clique no guia. O que já se marcou fica nas preferências do app (memoria.ts), junto com o "Não mostrar
// mais": quem fez uma vez não vê de novo em outro projeto. Puro: a casca junta os fatos e desenha.
import type {Modulo} from './documentos';
import {ehDocCenas, novoBlocoCenas, TIPOS_BLOCO_CENAS, type TipoBlocoCenas} from './cenas';

export type IdPasso = 'midia' | 'texto' | 'previa' | 'claude' | 'exportar';

export const PASSOS: {id: IdPasso; titulo: string; dica: string}[] = [
  {id: 'midia', titulo: 'Trazer uma mídia', dica: 'Arraste uma foto, um vídeo ou um áudio para o painel Mídia (ou para o monitor).'},
  {id: 'texto', titulo: 'Escrever o texto da primeira cena', dica: 'Clique no título no monitor e troque o texto de exemplo nas Propriedades.'},
  {id: 'previa', titulo: 'Tocar a prévia', dica: 'Espaço toca e pausa; J, K e L mudam a velocidade.'},
  {id: 'claude', titulo: 'Pedir algo ao Claude', dica: 'No painel Claude, peça uma mudança: ela aparece marcada no monitor, com Desfazer.'},
  {id: 'exportar', titulo: 'Exportar', dica: 'O botão Exportar, no alto à direita, grava o arquivo na pasta saidas do projeto.'},
];

export const IDS_PASSOS: IdPasso[] = PASSOS.map((p) => p.id);

/** O que as preferências guardam: os passos já feitos (em qualquer projeto) e se a pessoa dispensou a lista. */
export type EstadoPassos = {feitos: IdPasso[]; dispensado: boolean};

export const PASSOS_VAZIO: EstadoPassos = {feitos: [], dispensado: false};

/** Lido das preferências: o que não é passo conhecido sai; repetido conta uma vez; na ordem da lista. */
export const normalizarPassos = (x: unknown): EstadoPassos => {
  const o = (x && typeof x === 'object' ? x : {}) as {feitos?: unknown; dispensado?: unknown};
  const lidos = new Set(Array.isArray(o.feitos) ? o.feitos.filter((f): f is IdPasso => typeof f === 'string') : []);
  return {feitos: IDS_PASSOS.filter((id) => lidos.has(id)), dispensado: o.dispensado === true};
};

/** Os fatos que a casca junta do projeto e do editor. */
export type FatosDosPassos = {
  midias: number; // arquivos em midia/ (o índice do painel Mídia)
  documentos: {modulo: Modulo; doc: unknown}[]; // os documentos já lidos
  diario: {autor: string; revertida?: boolean}[]; // o diário do projeto (os resumos que a loja guarda)
  tocou: boolean; // a prévia tocou nesta sessão
  exportou: boolean; // uma exportação terminou bem nesta sessão
};

// os textos de exemplo dos documentos e blocos novos: trocar um deles é "escrever o texto"
const EXEMPLOS = new Set<string>([
  ...(Object.keys(TIPOS_BLOCO_CENAS) as TipoBlocoCenas[]).flatMap((t) => {
    const b = novoBlocoCenas(t, 'x');
    return [b.texto, b.rotulo, ...(b.itens ?? [])].filter((s): s is string => Boolean(s));
  }),
  'Seu título', 'Seu texto', 'Novo texto', 'Texto',
].map((s) => s.trim().toLowerCase()));

const escrito = (s: unknown): boolean => typeof s === 'string' && s.trim() !== '' && !EXEMPLOS.has(s.trim().toLowerCase());

const camadasDe = (doc: unknown): unknown[] => {
  const d = doc as {camadas?: unknown; paginas?: unknown} | null;
  const raiz = Array.isArray(d?.camadas) ? d!.camadas : [];
  const paginas = Array.isArray(d?.paginas) ? (d!.paginas as {camadas?: unknown}[]).flatMap((p) => (Array.isArray(p?.camadas) ? p.camadas : [])) : [];
  return [...raiz, ...paginas];
};

/** Há texto escrito pela pessoa (ou pelo Claude): na primeira cena de um vídeo de cenas; numa imagem ou animação sem
 *  vídeo de cenas no projeto, numa camada de texto. O texto de exemplo do documento novo não conta. */
export const temTextoEscrito = (documentos: FatosDosPassos['documentos']): boolean => {
  const cenas = documentos.filter((d) => d.modulo === 'video' && ehDocCenas(d.doc));
  if (cenas.length) {
    return cenas.some(({doc}) => {
      const primeira = ehDocCenas(doc) ? doc.cenas[0] : undefined;
      return (primeira?.blocos ?? []).some((b) => escrito(b.texto) || escrito(b.rotulo) || (b.itens ?? []).some(escrito));
    });
  }
  return documentos.some(({modulo, doc}) => (modulo === 'imagem' || modulo === 'animacao')
    && camadasDe(doc).some((c) => (c as {tipo?: unknown})?.tipo === 'texto' && escrito((c as {texto?: unknown}).texto)));
};

/** Os passos que os fatos de agora mostram feitos. */
export const passosFeitosAgora = (f: FatosDosPassos): IdPasso[] => {
  const feito: Record<IdPasso, boolean> = {
    midia: f.midias > 0,
    texto: temTextoEscrito(f.documentos),
    previa: f.tocou,
    claude: f.diario.some((e) => e.autor === 'agente'),
    exportar: f.exportou,
  };
  return IDS_PASSOS.filter((id) => feito[id]);
};

/** Junta o que se marcou agora ao que as preferências guardam. Devolve o mesmo objeto quando nada novo se marcou (a
 *  casca só grava as preferências quando muda). Passo feito não se desmarca: apagar a mídia depois não volta a lista. */
export const juntarPassos = (estado: EstadoPassos, agora: IdPasso[]): EstadoPassos => {
  const novos = agora.filter((id) => !estado.feitos.includes(id));
  if (!novos.length) return estado;
  const todos = new Set([...estado.feitos, ...novos]);
  return {...estado, feitos: IDS_PASSOS.filter((id) => todos.has(id))};
};

/** A lista aparece enquanto a pessoa não dispensou e falta algum passo. */
export const mostrarPassos = (estado: EstadoPassos): boolean => !estado.dispensado && estado.feitos.length < IDS_PASSOS.length;

/** "2 de 5". */
export const andamentoPassos = (estado: EstadoPassos): string => `${estado.feitos.length} de ${IDS_PASSOS.length}`;
