// Estado da interface: projeto aberto, área, documentos carregados (com a versão de cada um), seleção, tempo,
// comentários, diário e a pesquisa (só leitura: pesquisa/pesquisa.json). Toda mudança de documento sai daqui como JSON Patch para o processo principal; quando o arquivo
// muda no disco (pela interface ou pelo agente no terminal), o documento é relido e a tela acompanha.
import {useRef, useSyncExternalStore} from 'react';
import type {InfoProjeto, PropsVideo} from '../../compartilhado/api';
import type {Comentario, DocImagem, EntradaDiario, Modulo, OperacaoPatch} from '../../nucleo/documentos';
import type {Efeito} from '../../nucleo/efeitos';
import type {Pesquisa} from '../../nucleo/pesquisa'; // só o tipo: pesquisa.ts usa node:crypto
import {indicePagina, paginasDe} from '../../nucleo/carrossel';

export type Area = 'video' | 'imagem' | '3d' | 'efeitos';
export type Lido = {doc: any; versao: string};
export type Selecao = {documento: string; caminho: string} | null;
export type TipoAviso = 'ok' | 'erro' | 'info' | 'agente';
export type Aviso = {texto: string; tipo: TipoAviso; em: number};

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
  pesquisa: Pesquisa | null; // null = ainda não lida; a interface só mostra, quem grava é o Claude pelo MCP
  erroPesquisa?: string; // pesquisa/pesquisa.json não pôde ser lido: o painel mostra o motivo em vez de "carregando"
  fatoAberto?: string; // fato pedido de fora do painel Pesquisa (etiqueta do inspetor): o painel vem à frente e mostra
  aviso?: Aviso;
  zoomLinha: number | null; // pixels por segundo da linha do tempo; null = ajustar à janela (vale no Vídeo e em Efeitos)
  ultimaMudancaAgente?: number; // seq da última mudança do agente vista
  previaEfeitos?: {documento: string; efeitos: Efeito[]}; // controle deslizante sendo arrastado, antes do patch
  // "Descreva o vídeo para o Claude" da tela inicial: vai para uma conversa nova quando a casca abrir
  pedidoClaude?: {texto: string; rotulo: string; contexto: string};
  paginaAtiva: Partial<Record<string, string>>; // imagem com várias páginas: id da página ativa, por documento
};

const INICIAL: Estado = {info: null, area: 'video', ativo: {}, docs: {}, props: {}, selecao: null, tempo_ms: 0, comentarios: [], diario: [], modoComentario: false, zoomLinha: null,
  paginaAtiva: {}, pesquisa: null, erroPesquisa: undefined, fatoAberto: undefined}; // os opcionais da pesquisa ficam aqui para a troca de projeto zerá-los
let estado: Estado = INICIAL;
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

// o aviso fica 4 s no rodapé (no lugar das dicas de tecla) e some; erro fica 9 s; o seguinte reinicia a contagem
export const VALIDADE_AVISO_MS = 4000;
let validadeAviso: ReturnType<typeof setTimeout> | undefined;
export const avisar = (texto: string, tipo: TipoAviso = 'info') => {
  const aviso = {texto, tipo, em: Date.now()};
  loja.definir({aviso});
  clearTimeout(validadeAviso);
  validadeAviso = setTimeout(() => loja.get().aviso === aviso && loja.definir({aviso: undefined}), tipo === 'erro' ? 9000 : VALIDADE_AVISO_MS);
};

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
// a pesquisa chega depois de o projeto trocar? descarta (a resposta é do projeto anterior)
export const carregarPesquisa = async () => {
  const raiz = estado.info?.raiz;
  try {
    const pesquisa = await window.estudio.pesquisa();
    if (estado.info?.raiz === raiz) loja.definir({pesquisa, erroPesquisa: undefined});
  } catch (e) {
    // a última pesquisa lida fica na tela; sem nenhuma, o painel mostra o motivo
    if (estado.info?.raiz === raiz) loja.definir({erroPesquisa: mensagemDe(e)});
  }
};
// "ver o fato" de fora do painel (etiqueta do inspetor): marca o fato e a casca traz o painel Pesquisa para a frente
const aoVerFato = new Set<(id: string) => void>();
export const quandoVerFato = (f: (id: string) => void) => {
  aoVerFato.add(f);
  return () => {
    aoVerFato.delete(f);
  };
};
export const verFato = (id: string) => {
  loja.definir({fatoAberto: id});
  aoVerFato.forEach((f) => f(id));
};
export const carregarDiario = async () => {
  const diario = await window.estudio.diario();
  const ultimaAgente = [...diario].reverse().find((d) => d.autor === 'agente');
  const anterior = estado.ultimaMudancaAgente;
  loja.definir({diario, ultimaMudancaAgente: ultimaAgente?.seq});
  if (ultimaAgente && anterior !== undefined && ultimaAgente.seq !== anterior) avisar(`Claude: ${ultimaAgente.rotulo}`, 'agente');
};

// Conversas e terminais vivem fora do React (paineis/conversas.ts, paineis/terminais.ts) e carregam só quando alguém
// abre o painel do Claude; ao trocar ou fechar o projeto, quem estiver carregado se limpa por aqui.
const aoTrocarProjeto = new Set<() => void>();
export const quandoTrocarProjeto = (f: () => void) => {
  aoTrocarProjeto.add(f);
  return () => {
    aoTrocarProjeto.delete(f);
  };
};

const AREAS_VALIDAS = new Set<Area>(['video', 'imagem', '3d', 'efeitos']);

export const abrirProjeto = async (info: InfoProjeto) => {
  const mesmo = estado.info?.raiz === info.raiz;
  const existe = (id?: string) => Boolean(id && info.manifesto.documentos.some((d) => d.id === id));
  const ativo: Estado['ativo'] = {};
  if (mesmo) for (const [m, id] of Object.entries(estado.ativo)) if (existe(id)) ativo[m as Modulo] = id;
  for (const d of info.manifesto.documentos) ativo[d.modulo] ??= d.id;
  if (mesmo) {
    // o estudio.json mudou (documento novo, nome): a tela fica onde está
    const docs = Object.fromEntries(Object.entries(estado.docs).filter(([id]) => existe(id)));
    loja.definir((e) => ({info, ativo, alvoEfeitos: existe(e.alvoEfeitos) ? e.alvoEfeitos : ativo.video ?? ativo.imagem, docs,
      selecao: e.selecao && existe(e.selecao.documento) ? e.selecao : null}));
  } else {
    aoTrocarProjeto.forEach((f) => f());
    // reabre onde a pessoa parou (área, documento, seleção e tempo); sem isso, na área do primeiro documento
    const ult = info.estado;
    const docUlt = ult?.documento ? info.manifesto.documentos.find((d) => d.id === ult.documento) : undefined;
    if (docUlt) ativo[docUlt.modulo] = docUlt.id;
    const area: Area = ult?.area && AREAS_VALIDAS.has(ult.area) ? ult.area : info.manifesto.documentos[0]?.modulo ?? 'video';
    loja.definir({...INICIAL, info, area, ativo, alvoEfeitos: area === 'efeitos' && docUlt ? docUlt.id : ativo.video ?? ativo.imagem,
      selecao: docUlt && ult?.selecao ? {documento: docUlt.id, caminho: ult.selecao} : null, tempo_ms: ult?.tempo_ms ?? 0,
      zoomLinha: estado.zoomLinha, pedidoClaude: estado.pedidoClaude});
    if (info.aviso) avisar(info.aviso, 'info');
  }
  await Promise.all([...info.manifesto.documentos.map((d) => carregarDoc(d.id)), carregarComentarios(), carregarDiario(), ...(mesmo ? [] : [carregarPesquisa()])]);
  // a página do carrossel em que a pessoa parou só se resolve com o documento lido (o estado guarda o caminho, a loja o id)
  const ult = info.estado;
  if (!mesmo && ult?.documento && ult.pagina && estado.info?.raiz === info.raiz) {
    const doc = estado.docs[ult.documento]?.doc as DocImagem | undefined;
    const id = doc && Array.isArray(doc.paginas) ? paginasDe(doc)[indicePagina(ult.pagina)]?.id : undefined;
    if (id) loja.definir((e) => ({paginaAtiva: {...e.paginaAtiva, [ult.documento!]: id}}));
  }
};

/** Fecha o projeto e volta à tela inicial. */
export const fecharProjeto = async () => {
  await window.estudio.fecharProjeto();
  aoTrocarProjeto.forEach((f) => f());
  loja.definir({...INICIAL, zoomLinha: estado.zoomLinha});
};

/** Tira o prefixo que o Electron põe nas mensagens de erro do processo principal. */
export const mensagemDe = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/** Documento novo no projeto aberto, já ativo na área dele. */
export const criarDocumento = async (modulo: Modulo, formato?: {largura: number; altura: number; fps?: number}, titulo?: string) => {
  try {
    const entrada = await window.estudio.criarDocumento({modulo, formato: formato as never, titulo});
    const info = await window.estudio.projetoAtual();
    if (info) await abrirProjeto(info);
    loja.definir((e) => ({area: modulo, ativo: {...e.ativo, [modulo]: entrada.id}, selecao: null, tempo_ms: 0, ...(modulo === 'video' ? {alvoEfeitos: entrada.id} : {})}));
    avisar(`${entrada.titulo} criado`, 'ok');
    return entrada;
  } catch (e) {
    avisar(mensagemDe(e), 'erro');
    return null;
  }
};

/** Liga a tela ao disco: o arquivo que mudou é relido. */
export const observarProjeto = () =>
  window.estudio.aoMudar(({arquivo}) => {
    const info = estado.info;
    if (!info) return;
    if (arquivo === 'comentarios.json') return void carregarComentarios();
    if (arquivo.startsWith('.estudio/diario')) return void carregarDiario();
    // pesquisa.json ou o texto de uma fonte (pesquisa/fontes/<id>.txt): a lista relê; o texto aberto relê pelo sha256
    if (arquivo.startsWith('pesquisa/')) return void carregarPesquisa();
    if (arquivo === 'estudio.json') return void window.estudio.projetoAtual().then((i) => i && abrirProjeto(i));
    // envelope de áudio medido (midia/x.wav.envelope.json): as props dos vídeos ganham a forma de onda e o ducking
    if (arquivo.endsWith('.envelope.json')) return void info.manifesto.documentos.filter((d) => d.modulo === 'video').forEach((d) => void carregarDoc(d.id));
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
    const msg = mensagemDe(e);
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
  avisar('Comentário criado. O Claude já vê.', 'ok');
  return c;
};
