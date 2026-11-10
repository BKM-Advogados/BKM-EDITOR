// As conversas com o Claude vivem fora do React, como os terminais: trocar de área remonta o painel, mas o que já foi
// dito continua. Cada conversa é um `claude -p` no processo principal (src/main/conversa.ts); aqui os eventos que
// chegam viram itens para desenhar: a fala da pessoa, o texto do Claude, as ações como cartões e os pedidos de
// permissão.
import type {ContaClaude, EstadoProvedor, EventoConversa, PedidoPortaoTela} from '../../compartilhado/api';
import {avisar, quandoTrocarProjeto} from '../estado/loja';

export type Anexo = {chave: string; tipo: 'selecao' | 'comentario' | 'tempo' | 'projeto' | 'modulo'; rotulo: string; contexto: string};
export type Bloco =
  | {tipo: 'texto'; texto: string; aoVivo?: boolean}
  | {tipo: 'acao'; uso: string; nome: string; entrada: Record<string, unknown>; ok?: boolean; resultado?: string}
  | {tipo: 'permissao'; pedido: string; ferramenta: string; entrada: Record<string, unknown>; titulo?: string; pode_sempre: boolean;
      decisao?: 'permitida' | 'negada' | 'cancelada'};
export type Item =
  | {tipo: 'pessoa'; texto: string; anexos: Anexo[]}
  | {tipo: 'claude'; blocos: Bloco[]; fim?: {erro: boolean; duracao_ms?: number}}
  | {tipo: 'aviso'; texto: string; erro?: boolean};
export type EstadoConversa = 'nova' | 'trabalhando' | 'precisa' | 'pronta' | 'hibernada';
export type Conversa = {
  id: number;
  sessao: string;
  titulo: string;
  estado: EstadoConversa;
  detalhe?: string; // "pensando", "resumindo a conversa"…
  desde?: number; // quando começou a trabalhar
  modelo?: string;
  itens: Item[];
  rascunho: string;
  semLogin?: boolean;
  provedor: string; // id do catálogo (src/main/ia/provedores.ts): claude, deepseek, ollama, gemini-cli…
  uso?: {entrada: number; cache: number; saida: number; custo_usd?: number}; // somado na conversa
};

let conversas: Conversa[] = [];
let ativa: number | null = null;
let foco: 'conversa' | 'terminal' = 'conversa';
let conta: ContaClaude | null = null;
// frente IA: o catálogo de provedores e o diálogo Configurações › IA (aberto com o provedor em foco, ou fechado)
let provedores: EstadoProvedor[] = [];
let configIA: {foco?: string} | null = null;
// pedidos do portão de abas sem conversa no painel (terminal, app de fora): aparecem soltos, por cima da tela
let avulsos: PedidoPortaoTela[] = [];
let contagem = 0;
const ouvintes = new Set<() => void>();
// os objetos das conversas são mutáveis e de identidade estável (as funções abaixo guardam referência a eles); cada
// mudança troca só o array, o que basta para o painel redesenhar
const mudou = () => {
  conversas = [...conversas];
  ouvintes.forEach((f) => f());
};

export const estadoConversas = {
  lista: () => conversas,
  ativa: () => ativa,
  foco: () => foco,
  conta: () => conta,
  provedores: () => provedores,
  configIA: () => configIA,
  avulsos: () => avulsos,
  assinar(f: () => void) {
    ouvintes.add(f);
    return () => {
      ouvintes.delete(f);
    };
  },
};

const limpar = (m: string) => m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const ultimoClaude = (c: Conversa) => {
  const u = c.itens[c.itens.length - 1];
  if (u?.tipo === 'claude' && !u.fim) return u;
  const novo: Item = {tipo: 'claude', blocos: []};
  c.itens.push(novo);
  return novo as Extract<Item, {tipo: 'claude'}>;
};
const fecharTextoAoVivo = (i: Extract<Item, {tipo: 'claude'}>) => {
  for (const b of i.blocos) if (b.tipo === 'texto') b.aoVivo = false;
};

const aoEvento = (id: number, e: EventoConversa) => {
  const c = conversas.find((x) => x.id === id);
  if (!c) return;
  switch (e.tipo) {
    case 'pronto':
      c.sessao = e.sessao;
      c.modelo = e.modelo;
      break;
    case 'estado':
      c.detalhe = e.estado === 'requesting' ? 'pensando' : e.estado === 'compacting' ? 'resumindo a conversa' : e.estado;
      break;
    case 'texto': {
      const i = ultimoClaude(c);
      const u = i.blocos[i.blocos.length - 1];
      if (u?.tipo === 'texto' && u.aoVivo) u.texto += e.delta;
      else i.blocos.push({tipo: 'texto', texto: e.delta, aoVivo: true});
      c.detalhe = 'escrevendo';
      break;
    }
    case 'mensagem': {
      const i = ultimoClaude(c);
      const vivo = [...i.blocos].reverse().find((b) => b.tipo === 'texto' && b.aoVivo) as Extract<Bloco, {tipo: 'texto'}> | undefined;
      if (vivo) Object.assign(vivo, {texto: e.texto, aoVivo: false});
      else i.blocos.push({tipo: 'texto', texto: e.texto});
      break;
    }
    case 'ferramenta': {
      const i = ultimoClaude(c);
      fecharTextoAoVivo(i);
      i.blocos.push({tipo: 'acao', uso: e.uso, nome: e.nome, entrada: e.entrada});
      c.detalhe = undefined;
      break;
    }
    case 'resultado': {
      for (const it of c.itens) {
        if (it.tipo !== 'claude') continue;
        const b = it.blocos.find((x) => x.tipo === 'acao' && x.uso === e.uso) as Extract<Bloco, {tipo: 'acao'}> | undefined;
        if (b) Object.assign(b, {ok: e.ok, resultado: e.texto});
      }
      break;
    }
    case 'permissao':
      ultimoClaude(c).blocos.push({tipo: 'permissao', pedido: e.pedido, ferramenta: e.ferramenta, entrada: e.entrada, titulo: e.titulo, pode_sempre: e.pode_sempre});
      c.estado = 'precisa';
      break;
    case 'permissao-cancelada':
      for (const it of c.itens) if (it.tipo === 'claude') for (const b of it.blocos) if (b.tipo === 'permissao' && b.pedido === e.pedido) b.decisao = 'cancelada';
      if (c.estado === 'precisa') c.estado = 'trabalhando';
      break;
    case 'fim': {
      const i = ultimoClaude(c);
      fecharTextoAoVivo(i);
      i.fim = {erro: e.erro, duracao_ms: e.duracao_ms};
      if (e.erro && c.provedor === 'claude' && /authenticat|log ?in|oauth/i.test(e.texto ?? '')) {
        c.semLogin = true;
        i.blocos = i.blocos.filter((b) => b.tipo !== 'texto');
        c.itens.push({tipo: 'aviso', erro: true, texto: 'O Claude Code deste PC não está logado. Abra um terminal (botão abaixo) e digite /login: o login é feito pela Anthropic, no navegador.'});
      } else if (e.erro && e.texto && !i.blocos.some((b) => b.tipo === 'texto')) c.itens.push({tipo: 'aviso', erro: true, texto: e.texto});
      c.estado = 'pronta';
      c.detalhe = undefined;
      c.desde = undefined;
      guardarDepois(c);
      break;
    }
    case 'uso': {
      const u = (c.uso ??= {entrada: 0, cache: 0, saida: 0});
      u.entrada += e.entrada;
      u.cache += e.entrada_cache;
      u.saida += e.saida;
      if (e.custo_usd !== undefined) u.custo_usd = (u.custo_usd ?? 0) + e.custo_usd;
      break;
    }
    case 'hibernou':
      c.estado = 'hibernada';
      guardarDepois(c);
      break;
    case 'saiu':
      if (c.estado === 'trabalhando' || c.estado === 'precisa') {
        c.itens.push({tipo: 'aviso', erro: true, texto: `O processo de ${c.titulo.split(' · ')[0]} parou${e.detalhe ? `: ${e.detalhe}` : ''}. A próxima mensagem continua a mesma conversa.`});
      }
      c.estado = 'hibernada';
      c.detalhe = undefined;
      c.desde = undefined;
      break;
    case 'erro':
      c.itens.push({tipo: 'aviso', erro: true, texto: e.mensagem});
      break;
  }
  mudou();
};

let ligado = false;
const ligar = () => {
  if (ligado) return;
  ligado = true;
  window.estudio.conversa.aoEvento(aoEvento);
};

export const lerConta = async (forcar = false) => {
  if (conta && !forcar) return conta;
  conta = await window.estudio.conversa.conta();
  if (conta.logado) for (const c of conversas) c.semLogin = false;
  mudou();
  return conta;
};

export const novaConversa = async (sessao?: string, provedor = 'claude') => {
  ligar();
  try {
    const r = await window.estudio.conversa.abrir({sessao, provedor});
    contagem += 1;
    const c: Conversa = {id: r.id, sessao: r.sessao, titulo: r.rotulo ?? `Claude ${contagem}`, estado: sessao ? 'hibernada' : 'nova', itens: [], rascunho: '',
      provedor: r.provedor ?? provedor};
    conversas.push(c);
    ativa = c.id;
    foco = 'conversa';
    mudou();
    return c;
  } catch (e) {
    avisar(limpar((e as Error).message), 'erro');
    return null;
  }
};

/** Monta o texto que vai ao Claude: o contexto da tela (anexos) antes do pedido da pessoa. */
const comContexto = (texto: string, anexos: Anexo[]) =>
  anexos.length ? `Contexto do Estúdio (o que a pessoa está vendo agora):\n${anexos.map((a) => `- ${a.contexto}`).join('\n')}\n\n${texto}` : texto;

export const enviar = async (id: number, texto: string, anexos: Anexo[]) => {
  const c = conversas.find((x) => x.id === id);
  if (!c || !texto.trim()) return false;
  c.itens.push({tipo: 'pessoa', texto: texto.trim(), anexos});
  if (!c.itens.some((i, n) => i.tipo === 'pessoa' && n < c.itens.length - 1)) c.titulo = `${c.titulo} · ${texto.trim().replace(/\s+/g, ' ').slice(0, 26)}`;
  c.estado = 'trabalhando';
  c.desde = Date.now();
  c.detalhe = 'abrindo';
  c.rascunho = '';
  mudou();
  try {
    await window.estudio.conversa.enviar(id, comContexto(texto.trim(), anexos));
    return true;
  } catch (e) {
    c.itens.push({tipo: 'aviso', erro: true, texto: limpar((e as Error).message)});
    c.estado = 'pronta';
    c.desde = undefined;
    mudou();
    return false;
  }
};

export const responderPermissao = (id: number, pedido: string, decisao: 'permitir' | 'negar', sempre = false) => {
  const c = conversas.find((x) => x.id === id);
  if (!c) return;
  // pedido do portão do MCP (src/nucleo/portao.ts): a resposta vai ao servidor, não ao agente
  if (pedido.startsWith('portao:')) window.estudio.ia.responderPortao(pedido.slice(7), decisao === 'permitir', sempre);
  else window.estudio.conversa.permitir(id, pedido, decisao, sempre);
  for (const it of c.itens) if (it.tipo === 'claude') for (const b of it.blocos) if (b.tipo === 'permissao' && b.pedido === pedido) b.decisao = decisao === 'permitir' ? 'permitida' : 'negada';
  if (c.estado === 'precisa') c.estado = 'trabalhando';
  mudou();
};

export const parar = (id: number) => window.estudio.conversa.parar(id);

/** Encerra o processo (libera a memória); a próxima mensagem volta à mesma conversa com --resume. */
export const hibernarConversa = async (id: number) => {
  const c = conversas.find((x) => x.id === id);
  if (!c) return null;
  const sessao = await window.estudio.conversa.hibernar(id);
  c.estado = 'hibernada';
  c.desde = undefined;
  mudou();
  return sessao;
};

export const fecharConversa = (id: number) => {
  // fechar a aba é a pessoa dizendo que acabou: a conversa guardada sai junto (F6)
  const fechada = conversas.find((c) => c.id === id);
  if (fechada) void window.estudio.ia?.apagarGuardada(fechada.sessao).catch(() => undefined);
  window.estudio.conversa.fechar(id);
  conversas = conversas.filter((c) => c.id !== id);
  if (ativa === id) ativa = conversas[conversas.length - 1]?.id ?? null;
  mudou();
};

export const ativarConversa = (id: number) => {
  ativa = id;
  foco = 'conversa';
  mudou();
};

export const focarTerminal = () => {
  foco = 'terminal';
  mudou();
};

export const guardarRascunho = (id: number, texto: string) => {
  const c = conversas.find((x) => x.id === id);
  if (c) c.rascunho = texto;
};

export const avisarNaConversa = (id: number, texto: string) => {
  const c = conversas.find((x) => x.id === id);
  if (!c) return;
  c.itens.push({tipo: 'aviso', texto});
  mudou();
};

/** Conversa nova que já começa com um pedido (o campo "Descreva o vídeo para o Claude" da tela inicial): a fala mostra
 *  o pedido da pessoa; o que o Claude precisa saber do projeto novo vai como anexo. */
export const conversarCom = async (texto: string, anexos: Anexo[] = [], provedor = 'claude') => {
  if (provedor === 'claude') await lerConta().catch(() => null);
  const c = await novaConversa(undefined, provedor);
  if (c) await enviar(c.id, texto, anexos);
  return c;
};

// as conversas são da pasta do projeto: ao trocar ou fechar, o processo principal encerra os claude e a tela esquece
quandoTrocarProjeto(() => {
  conversas = [];
  ativa = null;
  foco = 'conversa';
  contagem = 0;
  mudou();
});

/** "Pedir ao Claude" de outros painéis: põe o pedido na caixa da conversa ativa (a pessoa confere e manda). */
export const preencher = (texto: string) => {
  const c = conversas.find((x) => x.id === ativa);
  if (!c || foco !== 'conversa') return false;
  c.rascunho = texto;
  mudou();
  requestAnimationFrame(() => (document.querySelector('.conversa .caixa-pedido textarea') as HTMLTextAreaElement | null)?.focus());
  return true;
};

// ---------- frente IA: provedores, Configurações › IA e seletor de modelo ----------
export const lerProvedores = async () => {
  try {
    provedores = (await window.estudio.ia?.provedores()) ?? [];
  } catch {
    provedores = [];
  }
  mudou();
  return provedores;
};

export const abrirConfigIA = (foco?: string) => {
  configIA = {foco};
  mudou();
  void lerProvedores();
};

export const fecharConfigIA = () => {
  configIA = null;
  mudou();
};

/** O seletor de modelo da conversa: grava no processo principal e vale na próxima mensagem. */
export const trocarModelo = async (id: number, modelo: string) => {
  const c = conversas.find((x) => x.id === id);
  if (!c) return;
  try {
    await window.estudio.ia.modeloDaConversa(id, modelo || undefined);
    c.modelo = modelo || undefined;
    c.itens.push({tipo: 'aviso', texto: `Modelo trocado para ${modelo || 'o padrão da conta'}: vale a partir da próxima mensagem.`});
    mudou();
  } catch (e) {
    avisar(limpar((e as Error).message), 'erro');
  }
};

// ---------- frente IA: portão de permissão do MCP ----------
// O pedido traz a origem (o rótulo da aba: "DeepSeek 1"). Se uma conversa do painel tem esse rótulo, o cartão aparece
// nela, igual ao de qualquer provedor; senão (aba de terminal, app de fora), aparece solto por cima da tela.
const doPortao = (p: PedidoPortaoTela) => {
  const c = conversas.find((x) => x.titulo.split(' · ')[0] === p.origem);
  if (!c) {
    avulsos = [...avulsos, p];
    mudou();
    return;
  }
  ultimoClaude(c).blocos.push({tipo: 'permissao', pedido: `portao:${p.id}`, ferramenta: p.ferramenta, entrada: p.entrada, titulo: p.motivo, pode_sempre: true});
  c.estado = 'precisa';
  mudou();
};

const portaoCancelado = (id: string) => {
  avulsos = avulsos.filter((p) => p.id !== id);
  for (const c of conversas) {
    for (const it of c.itens) if (it.tipo === 'claude') for (const b of it.blocos) if (b.tipo === 'permissao' && b.pedido === `portao:${id}` && !b.decisao) b.decisao = 'cancelada';
    if (c.estado === 'precisa' && !c.itens.some((it) => it.tipo === 'claude' && it.blocos.some((b) => b.tipo === 'permissao' && !b.decisao))) c.estado = 'trabalhando';
  }
  mudou();
};

export const responderAvulso = (id: string, permitir: boolean, sempre = false) => {
  window.estudio.ia.responderPortao(id, permitir, sempre);
  avulsos = avulsos.filter((p) => p.id !== id);
  mudou();
};

if (typeof window !== 'undefined' && window.estudio?.ia?.aoPedidoPortao) {
  window.estudio.ia.aoPedidoPortao(doPortao);
  window.estudio.ia.aoPortaoCancelado(portaoCancelado);
}

// ---------- frente IA, F6: conversas guardadas por projeto (transversal-D9) ----------
// Cada conversa vai para .estudio/conversas/ do projeto a cada fim de resposta; ao abrir o projeto, as mais recentes
// voltam ao painel como hibernadas, com o que já foi dito, e a próxima mensagem continua a mesma conversa.
const esperas = new Map<number, number>();
export const guardarDepois = (c: Conversa) => {
  if (!window.estudio.ia?.guardar || !c.itens.length) return;
  window.clearTimeout(esperas.get(c.id));
  esperas.set(c.id, window.setTimeout(() => {
    esperas.delete(c.id);
    void window.estudio.ia.guardar(c.id, {titulo: c.titulo, itens: c.itens, uso: c.uso}).catch(() => undefined);
  }, 800));
};

/** Itens guardados podem ter parado no meio (texto ao vivo, permissão sem resposta): voltam fechados. */
const fecharItens = (itens: Item[]): Item[] => itens.map((it) => {
  if (it.tipo !== 'claude') return it;
  return {...it, fim: it.fim ?? {erro: false}, blocos: it.blocos.map((b) => (b.tipo === 'texto' ? {...b, aoVivo: false}
    : b.tipo === 'permissao' && !b.decisao ? {...b, decisao: 'cancelada' as const} : b))};
});

const RESTAURAR = 5;

/** Ao abrir o projeto: as conversas guardadas mais recentes voltam ao painel. Devolve quantas voltaram. */
export const restaurarGuardadas = async () => {
  ligar();
  let guardadas: Awaited<ReturnType<typeof window.estudio.ia.guardadas>> = [];
  try {
    guardadas = (await window.estudio.ia?.guardadas()) ?? [];
  } catch {
    return 0;
  }
  let n = 0;
  for (const g of guardadas.slice(0, RESTAURAR).reverse()) {
    try {
      const r = await window.estudio.conversa.abrir({sessao: g.sessao, provedor: g.provedor, modelo: g.modelo});
      const resto = g.titulo.split(' · ').slice(1).join(' · ');
      // o rótulo é o desta abertura (é ele que vai ao diário e casa o cartão do portão); o resto do título volta igual
      const c: Conversa = {id: r.id, sessao: r.sessao, titulo: resto ? `${r.rotulo} · ${resto}` : r.rotulo, estado: 'hibernada',
        itens: fecharItens(g.itens as Item[]), rascunho: '', provedor: r.provedor, modelo: g.modelo, uso: g.uso as Conversa['uso']};
      conversas.push(c);
      ativa = c.id;
      n += 1;
    } catch {
      /* provedor que não existe mais neste PC: a conversa fica guardada e não volta agora */
    }
  }
  if (n) {
    foco = 'conversa';
    mudou();
  }
  return n;
};
