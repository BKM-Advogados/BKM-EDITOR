// Conversas guardadas por projeto (frente IA, F6, transversal-D9): cada conversa do painel vira um arquivo em
// .estudio/conversas/<sessao>.json do projeto, com o que a tela desenha (itens), o provedor, o modelo e o que cada via
// precisa para continuar: o Claude volta com --resume pela sessão; o laço próprio, com o histórico de mensagens; o
// agente ACP, com o id da sessão dele (session/load). Fica fora do git do projeto (linha no .gitignore na primeira vez).
import {existsSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import type {Projeto} from '../../nucleo/projeto';

export type ConversaGuardada = {
  formato: 1;
  sessao: string;
  provedor: string;
  titulo: string;
  modelo?: string;
  criada_em: string;
  atualizada_em: string;
  itens: unknown[];
  uso?: unknown;
  historico?: unknown[]; // laço próprio: mensagens no formato da OpenAI
  agente?: string; // ACP: o sessionId do agente
};

const PASTA = '.estudio/conversas';
const MAX_ITENS = 300;
const MAX_GUARDADAS = 30;
const LINHA_GITIGNORE = '.estudio/conversas/';

const nomeSeguro = (sessao: string) => String(sessao).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);

// na trava de escrita do projeto: o MCP da IDE (outro processo) também acrescenta linhas ao .gitignore
const garantirGitignore = (p: Projeto) => p.comTrava(() => {
  const atual = p.existe('.gitignore') ? p.lerTexto('.gitignore') : '';
  if (atual.split(/\r?\n/).some((l) => l.trim() === LINHA_GITIGNORE)) return;
  p.gravarTexto('.gitignore', `${atual}${atual && !atual.endsWith('\n') ? '\n' : ''}# conversas com a IA (Estúdio): ficam só neste PC\n${LINHA_GITIGNORE}\n`);
});

export const guardarConversa = (p: Projeto, c: Omit<ConversaGuardada, 'formato' | 'criada_em' | 'atualizada_em'>) => {
  garantirGitignore(p);
  const rel = `${PASTA}/${nomeSeguro(c.sessao)}.json`;
  let criada = new Date().toISOString();
  try {
    if (p.existe(rel)) criada = (JSON.parse(p.lerTexto(rel)) as ConversaGuardada).criada_em ?? criada;
  } catch {
    /* arquivo antigo estragado: regrava */
  }
  const dado: ConversaGuardada = {formato: 1, ...c, itens: c.itens.slice(-MAX_ITENS), criada_em: criada, atualizada_em: new Date().toISOString()};
  p.gravarTexto(rel, JSON.stringify(dado));
  return rel;
};

/** As conversas do projeto, da mais recente para a mais antiga (até 30). Arquivo estragado fica de fora. */
export const listarGuardadas = (p: Projeto): ConversaGuardada[] => {
  const dir = p.caminho(PASTA);
  if (!existsSync(dir)) return [];
  const r: ConversaGuardada[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    try {
      const c = JSON.parse(readFileSync(path.join(dir, f), 'utf-8')) as ConversaGuardada;
      if (c?.formato === 1 && c.sessao && c.provedor) r.push(c);
    } catch {
      /* fica de fora */
    }
  }
  return r.sort((a, b) => b.atualizada_em.localeCompare(a.atualizada_em)).slice(0, MAX_GUARDADAS);
};

export const lerGuardada = (p: Projeto, sessao: string): ConversaGuardada | undefined => {
  const rel = `${PASTA}/${nomeSeguro(sessao)}.json`;
  try {
    return p.existe(rel) ? (JSON.parse(p.lerTexto(rel)) as ConversaGuardada) : undefined;
  } catch {
    return undefined;
  }
};

export const apagarGuardada = (p: Projeto, sessao: string) => rmSync(p.caminhoParaGravar(`${PASTA}/${nomeSeguro(sessao)}.json`), {force: true});
