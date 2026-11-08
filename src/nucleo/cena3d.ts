// Leitura validada da cena 3D (tres-efeitos-D12): o JSON pode ter sido escrito à mão ou pela IA, e um campo com o tipo
// errado (intensidade "2" em texto, posição como objeto, tipo de luz que não existe) não pode derrubar a janela. A função
// devolve a cena pronta para a tela e o motor desenharem, com a mesma ordem e o mesmo tamanho das listas do documento
// (os caminhos /objetos/i e /luzes/i continuam batendo), e a lista do que foi corrigido, com o caminho e o valor certo,
// para o inspetor avisar e oferecer "Corrigir". Puro: sem React nem Three.js.
import type {DocCena3D, Luz3D, Objeto3D, Vetor3} from './documentos';

export type ProblemaCena3D = {caminho: string; texto: string; valor: unknown};
export type CenaLida = {doc: DocCena3D; problemas: ProblemaCena3D[]};

const TIPOS_OBJETO: Objeto3D['tipo'][] = ['caixa', 'esfera', 'cilindro', 'cone', 'toro', 'plano'];
const TIPOS_LUZ: Luz3D['tipo'][] = ['ambiente', 'direcional', 'ponto'];

export const CAMERA_PADRAO = {posicao: [4, 3, 6] as Vetor3, alvo: [0, 0, 0] as Vetor3, fov: 40};
export const FOV_MIN = 1;
export const FOV_MAX = 179;
const POSICAO_LUZ_PADRAO: Vetor3 = [3, 5, 3];

const numeroDe = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const ehObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const mostrar = (v: unknown) => {
  const t = JSON.stringify(v);
  return t === undefined ? 'sem valor' : t.length > 40 ? `${t.slice(0, 37)}…` : t;
};

/** Vetor de 3 números: aceita números em texto; qualquer outra forma é inválida (null). */
const vetorDe = (v: unknown): Vetor3 | null => {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const n = v.map(numeroDe);
  return n.every((x) => x !== null) ? (n as Vetor3) : null;
};

export const lerCena3d = (x: unknown): CenaLida => {
  const problemas: ProblemaCena3D[] = [];
  const avisar = (caminho: string, texto: string, valor: unknown) => problemas.push({caminho, texto, valor});
  const raiz = ehObjeto(x) ? x : {};

  /** Número: texto numérico vira número (avisa); outra coisa vale o padrão (avisa) ou, sem padrão, sai (undefined). */
  const num = (caminho: string, rotulo: string, v: unknown, padrao: number | undefined, faixa?: [number, number]): number | undefined => {
    if (v === undefined || v === null) return padrao;
    const n = numeroDe(v);
    if (n === null) {
      avisar(caminho, `${rotulo}: ${mostrar(v)} não é número${padrao === undefined ? '' : `; usando ${padrao}`}`, padrao);
      return padrao;
    }
    const preso = faixa ? Math.min(faixa[1], Math.max(faixa[0], n)) : n;
    if (typeof v !== 'number' || preso !== n) avisar(caminho, `${rotulo}: ${mostrar(v)} lido como ${preso}`, preso);
    return preso;
  };
  const vet = (caminho: string, rotulo: string, v: unknown, padrao: Vetor3 | undefined): Vetor3 | undefined => {
    if (v === undefined || v === null) return padrao;
    const r = vetorDe(v);
    if (!r) {
      avisar(caminho, `${rotulo}: ${mostrar(v)} não é [x, y, z]${padrao ? `; usando ${mostrar(padrao)}` : ''}`, padrao);
      return padrao;
    }
    if (!Array.isArray(v) || v.some((e) => typeof e !== 'number')) avisar(caminho, `${rotulo}: ${mostrar(v)} lido como ${mostrar(r)}`, r);
    return r;
  };
  const texto = (caminho: string, rotulo: string, v: unknown, padrao: string): string => {
    if (typeof v === 'string' && v) return v;
    if (v !== undefined && v !== null) avisar(caminho, `${rotulo}: ${mostrar(v)} não é texto; usando ${mostrar(padrao)}`, padrao);
    return padrao;
  };

  const objetos = (Array.isArray(raiz.objetos) ? raiz.objetos : []).map((bruto, i): Objeto3D => {
    const c = `/objetos/${i}`;
    const o = ehObjeto(bruto) ? bruto : {};
    if (!ehObjeto(bruto)) avisar(c, `objeto ${i + 1}: não é um objeto`, undefined);
    const id = typeof o.id === 'string' && o.id ? o.id : `objeto-${i + 1}`;
    const tipo = TIPOS_OBJETO.includes(o.tipo as Objeto3D['tipo']) ? (o.tipo as Objeto3D['tipo']) : 'caixa';
    if (ehObjeto(bruto) && o.tipo !== tipo) avisar(`${c}/tipo`, `${id}: tipo ${mostrar(o.tipo)} não existe (${TIPOS_OBJETO.join(', ')}); usando "caixa"`, 'caixa');
    const metalico = num(`${c}/metalico`, `${id} metálico`, o.metalico, undefined, [0, 1]);
    const rugosidade = num(`${c}/rugosidade`, `${id} rugosidade`, o.rugosidade, undefined, [0, 1]);
    const gira = vet(`${c}/gira`, `${id} gira`, o.gira, undefined);
    return {
      id,
      nome: texto(`${c}/nome`, `${id} nome`, o.nome, id),
      tipo,
      posicao: vet(`${c}/posicao`, `${id} posição`, o.posicao, [0, 0, 0])!,
      rotacao: vet(`${c}/rotacao`, `${id} rotação`, o.rotacao, [0, 0, 0])!,
      escala: vet(`${c}/escala`, `${id} escala`, o.escala, [1, 1, 1])!,
      cor: texto(`${c}/cor`, `${id} cor`, o.cor, '#808080'),
      ...(metalico !== undefined ? {metalico} : {}),
      ...(rugosidade !== undefined ? {rugosidade} : {}),
      ...(typeof o.visivel === 'boolean' ? {visivel: o.visivel} : {}),
      ...(gira ? {gira} : {}),
    };
  });

  const luzes = (Array.isArray(raiz.luzes) ? raiz.luzes : []).map((bruto, i): Luz3D => {
    const c = `/luzes/${i}`;
    const l = ehObjeto(bruto) ? bruto : {};
    if (!ehObjeto(bruto)) avisar(c, `luz ${i + 1}: não é um objeto`, undefined);
    const id = typeof l.id === 'string' && l.id ? l.id : `luz-${i + 1}`;
    const tipo = TIPOS_LUZ.includes(l.tipo as Luz3D['tipo']) ? (l.tipo as Luz3D['tipo']) : 'ambiente';
    if (ehObjeto(bruto) && l.tipo !== tipo) avisar(`${c}/tipo`, `${id}: tipo ${mostrar(l.tipo)} não existe (${TIPOS_LUZ.join(', ')}); usando "ambiente"`, 'ambiente');
    const posicao = tipo === 'ambiente' ? undefined : vet(`${c}/posicao`, `${id} posição`, l.posicao, POSICAO_LUZ_PADRAO);
    return {
      id,
      tipo,
      cor: texto(`${c}/cor`, `${id} cor`, l.cor, '#ffffff'),
      intensidade: num(`${c}/intensidade`, `${id} intensidade`, l.intensidade, 1, [0, 100])!,
      ...(posicao ? {posicao} : {}),
    };
  });

  const cam = ehObjeto(raiz.camera) ? raiz.camera : undefined;
  const camera = cam
    ? {
      posicao: vet('/camera/posicao', 'câmera posição', cam.posicao, CAMERA_PADRAO.posicao)!,
      alvo: vet('/camera/alvo', 'câmera alvo', cam.alvo, CAMERA_PADRAO.alvo)!,
      fov: num('/camera/fov', 'câmera fov', cam.fov, CAMERA_PADRAO.fov, [FOV_MIN, FOV_MAX])!,
    }
    : undefined;
  if (raiz.camera !== undefined && !cam) avisar('/camera', `câmera: ${mostrar(raiz.camera)} não é um objeto`, undefined);

  const doc = {
    formato: 1 as const,
    fundo: texto('/fundo', 'fundo', raiz.fundo, '#000000'),
    ...(camera ? {camera} : {}),
    luzes,
    objetos,
  } as DocCena3D;
  return {doc, problemas};
};
