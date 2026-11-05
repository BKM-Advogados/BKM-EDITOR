// Estado da interface: projeto aberto, área, documentos carregados (com a versão de cada um), seleção, tempo,
// comentários e diário. Toda mudança de documento sai daqui como JSON Patch para o processo principal; quando o arquivo
// muda no disco (pela interface ou pelo agente no terminal), o documento é relido e a tela acompanha.
import {useRef, useSyncExternalStore} from 'react';
import type {InfoProjeto, PropsVideo} from '../../compartilhado/api';
import type {Comentario, EntradaDiario, Modulo, OperacaoPatch} from '../../nucleo/documentos';
import type {Efeito} from '../../nucleo/efeitos';

export type Area = 'video' | 'imagem' | '3d' | 'efeitos';
export type Lido = {doc: any; versao: string};
export type Selecao = {documento: string; caminho: string} | null;

export type Estado = {
  info: InfoProjeto | null;
  area: Area;
  ativo: Partial<Record<Modulo, string>>; // documento aberto em cada módulo
  alvoEfeitos?: string; // documento cujos efeitos a área Efeitos edita
  docs: Record<string, Lido>;
  props: Record<string, PropsVideo>; // props resolvidas dos vídeos
  selecao: Selecao;
  tempo_ms: number;
  comentarios: Comentario[];
  diario: EntradaDiario[];
  modoComentario: boolean;
  comentarioAberto?: string;
  aviso?: {texto: string; tipo: 'ok' | 'erro' | 'info'; em: number};
  ultimaMudancaAgente?: number; // seq da última mudança do agente vista
  previaEfeitos?: {documento: string; efeitos: Efeito[]}; // controle deslizante sendo arrastado, antes do patch
};

let estado: Estado = {info: null, area: 'video', ativo: {}, docs: {}, props: {}, selecao: null, tempo_ms: 0, comentarios: [], diario: [], modoComentario: false};
const ouvintes = new Set<() => void>();

export const loja = {
  get: () => estado,
  definir(p: Partial<Estado> | ((e: Estado) => Partial<Estado>)) {
    estado = {...estado, ...(typeof p === 'function' ? p(estado) : p)};
    ouvintes.forEach((f) => f());
  },
  assinar(f: () => void) {
    ouvintes.add(f);
    return () => {
      ouvintes.delete(f);
    };
  },
};

// lista ou objeto montado no seletor (filter, ?? []) volta como o mesmo valor se o conteúdo não mudou; sem isso o React
// entende que o estado mudou a cada leitura e entra em laço
const rasoIgual = (a: unknown, b: unknown) => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
};

export const useLoja = <T,>(sel: (e: Estado) => T): T => {
  const ultimo = useRef<{v: T} | null>(null);
  const ler = () => {
    const v = sel(estado);
    if (ultimo.current && rasoIgual(ultimo.current.v, v)) return ultimo.current.v;
    ultimo.current = {v};
    return v;
  };
  return useSyncExternalStore(loja.assinar, ler);
};

export const avisar = (texto: string, tipo: 'ok' | 'erro' | 'info' = 'info') => loja.definir({aviso: {texto, tipo, em: Date.now()}});

const entradaDe = (id: string) => estado.info?.manifesto.documentos.find((d) => d.id === id);
export const documentosDe = (m: Modulo) => estado.info?.manifesto.documentos.filter((d) => d.modulo === m) ?? [];

// ---------- carga ----------
export const carregarDoc = async (id: string) => {
  const lido = await window.estudio.lerDocumento(id);
  loja.definir((e) => ({docs: {...e.docs, [id]: lido}}));
  if (entradaDe(id)?.modulo === 'video') {
    const p = await window.estudio.propsVideo(id);
    loja.definir((e) => ({props: {...e.props, [id]: p}}));
  }
};

export const carregarComentarios = async () => loja.definir({comentarios: await window.estudio.comentarios()});
export const carregarDiario = async () => {
  const diario = await window.estudio.diario();
  const ultimaAgente = [...diario].reverse().find((d) => d.autor === 'agente');
  const anterior = estado.ultimaMudancaAgente;
  loja.definir({diario, ultimaMudancaAgente: ultimaAgente?.seq});
  if (ultimaAgente && anterior !== undefined && ultimaAgente.seq !== anterior) avisar(`Agente: ${ultimaAgente.rotulo}`, 'info');
};

export const abrirProjeto = async (info: InfoProjeto) => {
  const ativo: Estado['ativo'] = {};
  for (const d of info.manifesto.documentos) ativo[d.modulo] ??= d.id;
  loja.definir({info, ativo, alvoEfeitos: ativo.video, docs: {}, props: {}, selecao: null, tempo_ms: 0, ultimaMudancaAgente: undefined});
  await Promise.all([...info.manifesto.documentos.map((d) => carregarDoc(d.id)), carregarComentarios(), carregarDiario()]);
};

/** Liga a tela ao disco: o arquivo que mudou é relido. */
export const observarProjeto = () =>
  window.estudio.aoMudar(({arquivo}) => {
    const info = estado.info;
    if (!info) return;
    if (arquivo === 'comentarios.json') return void carregarComentarios();
    if (arquivo.startsWith('.estudio/diario')) return void carregarDiario();
    if (arquivo === 'estudio.json') return void window.estudio.projetoAtual().then((i) => i && abrirProjeto(i));
    for (const d of info.manifesto.documentos) {
      const doc = estado.docs[d.id]?.doc as {palavras?: string} | undefined;
      if (d.caminho === arquivo || doc?.palavras === arquivo) void carregarDoc(d.id);
    }
  });

// ---------- edição ----------
const pedacos = (caminho: string) => caminho.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
export const valorEm = (doc: unknown, caminho: string): any =>
  pedacos(caminho).reduce<any>((o, k) => (o == null ? undefined : o[k]), doc);

/** Patch que troca um valor: confere o valor antigo (test) para não pisar no que o agente mudou por baixo. */
export const patchTrocar = (doc: unknown, caminho: string, valor: unknown): OperacaoPatch[] => {
  const antigo = valorEm(doc, caminho);
  if (antigo === undefined) return valor === undefined ? [] : [{op: 'add', path: caminho, value: valor}];
  if (valor === undefined) return [{op: 'test', path: caminho, value: antigo}, {op: 'remove', path: caminho}];
  return [{op: 'test', path: caminho, value: antigo}, {op: 'replace', path: caminho, value: valor}];
};

export const aplicar = async (documento: string, patch: OperacaoPatch[], rotulo?: string) => {
  if (!patch.length) return true;
  const lido = estado.docs[documento];
  try {
    const r = await window.estudio.aplicarPatch({documento, versao_base: lido?.versao, patch, rotulo});
    await carregarDoc(documento);
    void carregarDiario();
    return Boolean(r);
  } catch (e) {
    const msg = String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    avisar(msg.includes('mudou') ? 'O documento mudou por outra mão (agente?). Recarreguei; refaça a edição.' : msg, 'erro');
    await carregarDoc(documento);
    return false;
  }
};

export const trocar = (documento: string, caminho: string, valor: unknown, rotulo?: string) =>
  aplicar(documento, patchTrocar(estado.docs[documento]?.doc, caminho, valor), rotulo ?? `${caminho.split('/').pop()} em ${caminho}`);

export const desfazer = async () => {
  const r = await window.estudio.desfazer();
  avisar(r.mensagem, r.ok ? 'ok' : 'erro');
};

export const selecionar = (s: Selecao) => loja.definir({selecao: s});

export const comentar = async (documento: string, texto: string, alvo: Comentario['alvo']) => {
  const c = await window.estudio.novoComentario({documento, texto, alvo});
  await carregarComentarios();
  avisar(`Comentário ${c.id} criado. O agente vê com listar_comentarios.`, 'ok');
  return c;
};
