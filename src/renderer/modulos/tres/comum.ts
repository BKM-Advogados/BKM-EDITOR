// Peças comuns do módulo 3D: tipos de primitiva, valores padrão do material, arredondamento e leitura dos caminhos
// (/objetos/i, /luzes/i). Sem Three.js aqui, para a lista e o inspector não dependerem do motor.
import type {DocCena3D, Luz3D, Objeto3D, Vetor3} from '../../../nucleo/documentos';

export type TipoObjeto = Objeto3D['tipo'];
export type Transformacao = {posicao: Vetor3; rotacao: Vetor3; escala: Vetor3};

export const TIPOS: {tipo: TipoObjeto; nome: string}[] = [
  {tipo: 'caixa', nome: 'Caixa'},
  {tipo: 'esfera', nome: 'Esfera'},
  {tipo: 'cilindro', nome: 'Cilindro'},
  {tipo: 'cone', nome: 'Cone'},
  {tipo: 'toro', nome: 'Toro'},
  {tipo: 'plano', nome: 'Plano'},
];

// os mesmos padrões do MeshStandardMaterial, para o JSON sem o campo e a tela concordarem
export const PADRAO_METALICO = 0;
export const PADRAO_RUGOSIDADE = 1;
export const COR_NOVA = '#C88155';

export const GRAU = Math.PI / 180;

/** Três casas, sem -0. */
export const arred3 = (n: number) => Math.round(n * 1000) / 1000 || 0;
export const arredV = (v: readonly number[]): Vetor3 => [arred3(v[0]), arred3(v[1]), arred3(v[2])];
export const iguaisV = (a?: readonly number[], b?: readonly number[]) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

/** Vetor válido do documento ou o padrão (o JSON pode ter sido editado à mão). */
export const vetor = (v: unknown, padrao: Vetor3): Vetor3 =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as Vetor3) : padrao;

export const indiceEm = (caminho: string | undefined, lista: 'objetos' | 'luzes') => {
  const m = caminho?.match(lista === 'objetos' ? /^\/objetos\/(\d+)$/ : /^\/luzes\/(\d+)$/);
  return m ? Number(m[1]) : -1;
};

// um item que não é objeto (JSON à mão) vira {}: a posição na lista continua a do documento e `.id` não derruba nada
const comoObjeto = <T,>(x: unknown) => (x && typeof x === 'object' ? x : {}) as T;
export const objetosDe = (doc: DocCena3D | undefined): Objeto3D[] => (Array.isArray(doc?.objetos) ? doc.objetos : []).map((o) => comoObjeto<Objeto3D>(o));
export const luzesDe = (doc: DocCena3D | undefined) => (Array.isArray(doc?.luzes) ? doc.luzes : []).map((l) => comoObjeto<Luz3D>(l));

/** Primitiva nova com id e nome únicos e transformação padrão. */
export const novoObjeto = (doc: DocCena3D | undefined, tipo: TipoObjeto): Objeto3D => {
  const objetos = objetosDe(doc);
  const ids = new Set(objetos.map((o) => o.id));
  const nomes = new Set(objetos.map((o) => o.nome));
  const base = TIPOS.find((t) => t.tipo === tipo)?.nome ?? tipo;
  let n = 1;
  while (ids.has(n === 1 ? tipo : `${tipo}-${n}`) || nomes.has(n === 1 ? base : `${base} ${n}`)) n++;
  return {
    id: n === 1 ? tipo : `${tipo}-${n}`,
    nome: n === 1 ? base : `${base} ${n}`,
    tipo,
    posicao: [0, 0, 0],
    rotacao: [0, 0, 0],
    escala: [1, 1, 1],
    cor: COR_NOVA,
  };
};
