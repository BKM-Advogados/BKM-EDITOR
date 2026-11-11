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

  // id repetido (a IA duplica a caixa sem trocar o id): o segundo vira `id-2`, `id-3`…, para o objeto aparecer na cena e dar para
  // editar; o aviso leva o caminho e o id novo, e Corrigir grava (tres-efeitos-D11)
  const unico = (usados: Set<string>, id: string, caminho: string, rotulo: string) => {
    if (!usados.has(id)) {
      usados.add(id);
      return id;
    }
    let n = 2;
    while (usados.has(`${id}-${n}`)) n++;
    const novo = `${id}-${n}`;
    usados.add(novo);
    avisar(`${caminho}/id`, `${rotulo} ${id} repetido: este passa a ${novo}`, novo);
    return novo;
  };
  const idsObjetos = new Set<string>();
  const idsLuzes = new Set<string>();
  const objetos = (Array.isArray(raiz.objetos) ? raiz.objetos : []).map((bruto, i): Objeto3D => {
    const c = `/objetos/${i}`;
    const o = ehObjeto(bruto) ? bruto : {};
    if (!ehObjeto(bruto)) avisar(c, `objeto ${i + 1}: não é um objeto`, undefined);
    const id = unico(idsObjetos, typeof o.id === 'string' && o.id ? o.id : `objeto-${i + 1}`, c, 'objeto');
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
    const id = unico(idsLuzes, typeof l.id === 'string' && l.id ? l.id : `luz-${i + 1}`, c, 'luz');
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

/** A cena 3D que o app cria num documento novo: câmera, ambiente e sol, um chão e a caixa que gira na prévia. */
export const novoDoc3d = (): DocCena3D => ({
  formato: 1,
  fundo: '#111418',
  camera: {posicao: [4, 3, 6], alvo: [0, 0.5, 0], fov: 40},
  luzes: [
    {id: 'ambiente', tipo: 'ambiente', cor: '#ffffff', intensidade: 0.5},
    {id: 'sol', tipo: 'direcional', cor: '#ffffff', intensidade: 1.6, posicao: [5, 8, 4]},
  ],
  objetos: [
    {id: 'chao', nome: 'Chão', tipo: 'plano', posicao: [0, 0, 0], rotacao: [-90, 0, 0], escala: [8, 8, 1], cor: '#2a2f36'},
    {id: 'caixa', nome: 'Caixa', tipo: 'caixa', posicao: [0, 0.75, 0], rotacao: [0, 25, 0], escala: [1.5, 1.5, 1.5], cor: '#B4B4B4', gira: [0, 20, 0]},
  ],
});

/** Intensidade de partida de cada tipo de luz: a ambiente e a direcional em unidades do Three.js; a de ponto em candelas (cai com o
 *  quadrado da distância, então 60 a uns 8 de distância dá a claridade de um sol de 1,6). Ao trocar o tipo de uma luz que ainda tem
 *  a intensidade padrão do tipo antigo, o inspetor põe a do novo (tres-efeitos-D9). */
export const INTENSIDADE_PADRAO_LUZ: Record<Luz3D['tipo'], number> = {ambiente: 0.5, direcional: 1.6, ponto: 60};

/** Rotação em graus (Euler XYZ) mais perto de `referencia` que dá a mesma orientação que `nova`. O gizmo gira o objeto pelo
 *  quaternion, e o Three devolve o Euler com o ângulo Y preso entre −90° e 90°: um giro de 125° em Y volta como [180, 55, 180], que é
 *  a mesma pose mas é lida como outra coisa (o inspetor mostra 180, 55, 180; o rótulo do arrasto mostra o delta errado; e a prévia
 *  animada soma o giro ao Y desse Euler, que equivale a girar ao contrário). Toda orientação tem duas formas, (x, y, z) e
 *  (x+180, 180−y, z+180), cada uma com voltas de 360° em cada eixo: fica a que está mais perto da rotação que o objeto tinha
 *  (tres-efeitos-D10). */
export const rotacaoMaisPerto = (nova: Vetor3, referencia: Vetor3): Vetor3 => {
  const formas: Vetor3[] = [nova, [nova[0] + 180, 180 - nova[1], nova[2] + 180]];
  let melhor = nova;
  let menor = Infinity;
  for (const f of formas) {
    const v = f.map((a, i) => a + 360 * Math.round((referencia[i] - a) / 360)) as Vetor3;
    const custo = v.reduce((s, a, i) => s + Math.abs(a - referencia[i]), 0);
    if (custo < menor - 1e-9) {
      menor = custo;
      melhor = v;
    }
  }
  return melhor;
};
