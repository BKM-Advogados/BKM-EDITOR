// As conversas com o Claude vivem fora do React, como os terminais: trocar de área remonta o painel, mas o que já foi
// dito continua. Cada conversa é um `claude -p` no processo principal (src/main/conversa.ts); aqui os eventos que
// chegam viram itens para desenhar: a fala da pessoa, o texto do Claude, as ações como cartões e os pedidos de
// permissão.
import type {ContaClaude, EventoConversa} from '../../compartilhado/api';
import {avisar, quandoTrocarProjeto} from '../estado/loja';

export type Anexo = {chave: string; tipo: 'selecao' | 'comentario' | 'tempo' | 'projeto'; rotulo: string; contexto: string};
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
  window.estudio.conversa.permitir(id, pedido, decisao, sempre);
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
