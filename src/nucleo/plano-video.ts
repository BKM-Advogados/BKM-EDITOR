// O Plano do vídeo (Onda B, frente 2): antes de montar uma peça nova, a IA faz poucas perguntas, escreve o plano
// (objetivo, público, formato e duração, roteiro cena a cena, mídia, narração e música) e espera a pessoa aprovar ou
// pedir ajuste. O plano mora em `plano.json`, na raiz do projeto: entra no git, no diário (com Reverter) e aparece na
// conversa do app como um cartão com "Aprovar plano" e "Pedir ajuste". As mesmas regras valem com o app fechado: o MCP
// por stdio lê e grava o mesmo arquivo, e a pessoa aprova na conversa (aprovar_plano).
// Puro e sem Node: a tela importa daqui o tipo e o texto do plano.

export const ARQUIVO_PLANO = 'plano.json';

/** `aguardando`: escrito, esperando a pessoa. `aprovado`: a IA pode montar. `ajustar`: a pessoa pediu mudança. */
export type EstadoPlano = 'aguardando' | 'aprovado' | 'ajustar';

export type CenaPlano = {
  /** Nome curto da cena ("Abertura", "O prazo"). */
  cena: string;
  /** O que aparece na tela. */
  mostra: string;
  /** O que se fala (narração ou texto lido), se houver. */
  fala?: string;
  duracao_s?: number;
};

/** O que a IA escreve; o resto (estado, revisão, quem e quando) é do app. */
export type ConteudoPlano = {
  objetivo: string;
  publico: string;
  formato_e_duracao: string;
  roteiro: CenaPlano[];
  midia: {usar: string[]; falta: string[]};
  narracao: string;
  musica: string;
  notas?: string;
};

export type Assinatura = {por: string; em: string};

export type PlanoVideo = ConteudoPlano & {
  formato: 1;
  estado: EstadoPlano;
  /** Conta cada escrita: aprovar pede a revisão vista, para ninguém aprovar um plano que mudou por baixo. */
  revisao: number;
  escrito: Assinatura;
  /** A última decisão da pessoa sobre esta revisão (some quando o plano é reescrito). */
  decisao?: Assinatura & {ajuste?: string};
};

export type Decisao = {decisao: 'aprovar'} | {decisao: 'ajustar'; ajuste: string};

const ESTADOS: readonly EstadoPlano[] = ['aguardando', 'aprovado', 'ajustar'];
const texto = (v: unknown) => (typeof v === 'string' ? v : '');
const textos = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);

/** Lê o plano gravado sem confiar no formato. Sem plano (arquivo vazio, revertido até o começo, ou outra coisa): null. */
export const lerPlano = (json: unknown): PlanoVideo | null => {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  if (typeof o.revisao !== 'number' || !Number.isFinite(o.revisao) || o.revisao < 1) return null;
  const roteiro = (Array.isArray(o.roteiro) ? o.roteiro : []).filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object').map((c) => ({
    cena: texto(c.cena),
    mostra: texto(c.mostra),
    ...(typeof c.fala === 'string' && c.fala.trim() ? {fala: c.fala} : {}),
    ...(typeof c.duracao_s === 'number' && Number.isFinite(c.duracao_s) && c.duracao_s > 0 ? {duracao_s: c.duracao_s} : {}),
  }));
  const midia = (o.midia && typeof o.midia === 'object' ? o.midia : {}) as {usar?: unknown; falta?: unknown};
  const assinatura = (v: unknown): Assinatura => {
    const a = (v && typeof v === 'object' ? v : {}) as {por?: unknown; em?: unknown};
    return {por: texto(a.por) || '?', em: texto(a.em)};
  };
  const d = o.decisao && typeof o.decisao === 'object' ? (o.decisao as {ajuste?: unknown}) : undefined;
  return {
    formato: 1,
    estado: ESTADOS.includes(o.estado as EstadoPlano) ? (o.estado as EstadoPlano) : 'aguardando',
    revisao: Math.floor(o.revisao),
    objetivo: texto(o.objetivo),
    publico: texto(o.publico),
    formato_e_duracao: texto(o.formato_e_duracao),
    roteiro,
    midia: {usar: textos(midia.usar), falta: textos(midia.falta)},
    narracao: texto(o.narracao),
    musica: texto(o.musica),
    ...(typeof o.notas === 'string' && o.notas.trim() ? {notas: o.notas} : {}),
    escrito: assinatura(o.escrito),
    ...(d ? {decisao: {...assinatura(d), ...(typeof d.ajuste === 'string' && d.ajuste.trim() ? {ajuste: d.ajuste} : {})}} : {}),
  };
};

/** O plano novo (ou reescrito): a revisão sobe, o estado volta a `aguardando` e a decisão anterior sai. */
export const escreverPlano = (anterior: PlanoVideo | null, c: ConteudoPlano, por: string, em: string): PlanoVideo => {
  const limpo = (s: string) => s.trim();
  const roteiro = c.roteiro.map((x) => ({
    cena: limpo(x.cena),
    mostra: limpo(x.mostra),
    ...(x.fala?.trim() ? {fala: limpo(x.fala)} : {}),
    ...(x.duracao_s !== undefined && x.duracao_s > 0 ? {duracao_s: x.duracao_s} : {}),
  }));
  if (!roteiro.length) throw new Error('o roteiro precisa de pelo menos uma cena');
  if (!limpo(c.objetivo)) throw new Error('diga o objetivo do vídeo');
  return {
    formato: 1,
    estado: 'aguardando',
    revisao: (anterior?.revisao ?? 0) + 1,
    objetivo: limpo(c.objetivo),
    publico: limpo(c.publico),
    formato_e_duracao: limpo(c.formato_e_duracao),
    roteiro,
    midia: {usar: c.midia.usar.map(limpo).filter(Boolean), falta: c.midia.falta.map(limpo).filter(Boolean)},
    narracao: limpo(c.narracao),
    musica: limpo(c.musica),
    ...(c.notas?.trim() ? {notas: limpo(c.notas)} : {}),
    escrito: {por, em},
  };
};

/** Erro de decisão: sem plano, revisão que não é a atual ou ajuste vazio. `conflito` quando o plano mudou por baixo. */
export class ErroPlano extends Error {
  constructor(mensagem: string, readonly tipo: 'nao_achado' | 'conflito' | 'patch') {
    super(mensagem);
  }
}

/** A pessoa aprova ou pede ajuste da revisão que viu. */
export const decidirPlano = (plano: PlanoVideo | null, revisao: number, d: Decisao, por: string, em: string): PlanoVideo => {
  if (!plano) throw new ErroPlano('não há plano neste projeto: a IA escreve um com escrever_plano', 'nao_achado');
  if (plano.revisao !== revisao) {
    throw new ErroPlano(`o plano mudou (revisão ${plano.revisao}; a vista era a ${revisao}): leia o plano de novo antes de decidir`, 'conflito');
  }
  if (d.decisao === 'ajustar') {
    const ajuste = d.ajuste.trim();
    if (!ajuste) throw new ErroPlano('diga o que ajustar no plano', 'patch');
    return {...plano, estado: 'ajustar', decisao: {por, em, ajuste}};
  }
  return {...plano, estado: 'aprovado', decisao: {por, em}};
};

const somaDuracao = (p: PlanoVideo) => p.roteiro.reduce((s, c) => s + (c.duracao_s ?? 0), 0);

/** O plano em markdown, para a IA mostrar à pessoa e para quem lê o projeto fora do app. */
export const planoEmTexto = (p: PlanoVideo): string => {
  const soma = somaDuracao(p);
  const linhas = [
    `# Plano do vídeo (revisão ${p.revisao}, ${ROTULO_ESTADO[p.estado]})`,
    '',
    `- **Objetivo:** ${p.objetivo || '—'}`,
    `- **Público:** ${p.publico || '—'}`,
    `- **Formato e duração:** ${p.formato_e_duracao || '—'}${soma ? ` (roteiro soma ${soma} s)` : ''}`,
    '',
    '## Roteiro',
    '',
    ...p.roteiro.map((c, i) => `${i + 1}. **${c.cena || `Cena ${i + 1}`}**${c.duracao_s ? ` (${c.duracao_s} s)` : ''}: ${c.mostra || '—'}${c.fala ? `\n   Fala: "${c.fala}"` : ''}`),
    '',
    '## Mídia',
    '',
    `- Vai usar: ${p.midia.usar.length ? p.midia.usar.join('; ') : 'nada de fora (só texto e formas)'}`,
    `- Falta: ${p.midia.falta.length ? p.midia.falta.join('; ') : 'nada'}`,
    '',
    `- **Narração:** ${p.narracao || '—'}`,
    `- **Música:** ${p.musica || '—'}`,
  ];
  if (p.notas) linhas.push(`- **Notas:** ${p.notas}`);
  if (p.decisao?.ajuste) linhas.push('', `**Ajuste pedido:** ${p.decisao.ajuste}`);
  return linhas.join('\n');
};

export const ROTULO_ESTADO: Record<EstadoPlano, string> = {aguardando: 'esperando a aprovação', aprovado: 'aprovado', ajustar: 'ajuste pedido'};

/** O que a IA faz agora, pelo estado do plano (vai na resposta de ler_plano e escrever_plano). */
export const proximoPasso = (p: PlanoVideo | null): string => {
  if (!p) return 'Não há plano. Num pedido novo, pergunte só o que falta (até 3 perguntas, com sugestão de resposta) e escreva o plano com escrever_plano; pedido pequeno vai direto, sem plano.';
  if (p.estado === 'aprovado') return `Plano aprovado (revisão ${p.revisao}): monte seguindo o roteiro e, no fim, diga o que mudou em relação a ele.`;
  if (p.estado === 'ajustar') return `A pessoa pediu ajuste: "${p.decisao?.ajuste ?? ''}". Reescreva o plano com escrever_plano e espere de novo; não monte ainda.`;
  return `Esperando a pessoa (revisão ${p.revisao}). Não monte ainda. No app, ela aprova pelo cartão do plano na conversa; fora dele, ela aprova na conversa e você registra com aprovar_plano {revisao: ${p.revisao}}.`;
};
