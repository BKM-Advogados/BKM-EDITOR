// Projetos prontos para uma IDE de agentes (T3 Code, Claude Code, Cursor; docs/ide.md). Ao criar ou abrir um projeto, o
// app escreve, junto do CLAUDE.md:
// - `.mcp.json`: o servidor "estudio" (o MCP por stdio deste app, mcp/nucleo.ts, apontado para esta pasta). O Claude Code,
//   as threads Claude do T3 (Claude Agent SDK) e o Cursor leem este arquivo.
// - `.claude/settings.local.json`: aprova o "estudio" do .mcp.json (`enabledMcpjsonServers`); no modo SDK do T3 não há
//   diálogo de aprovação.
// - `t3.json`: threads na própria pasta (`defaultThreadEnvMode: "local"`; worktree não serve, a mídia pesada fica fora do
//   git) e o ícone do projeto (a miniatura que o app tira ao fechar).
// Tudo mesclado: o que a pessoa já tiver nesses arquivos fica, e nada é regravado se não mudou (o app commita o git do
// projeto sozinho). O .mcp.json (caminhos absolutos desta máquina) e o settings.local.json vão para o .gitignore do
// projeto; o t3.json, sem nada da máquina, fica no git. As funções `...Atualizado` são puras; `prepararParaIde` grava.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';

export const SERVIDOR_IDE = 'estudio';
export const ORIGEM_IDE = 'IDE';
export const T3_SCHEMA = 'https://t3.codes/schema/t3.json';
export const ICONE_T3 = '.estudio/miniatura.jpg';
export const ARQUIVOS_IDE = {mcp: '.mcp.json', claude: '.claude/settings.local.json', t3: 't3.json'} as const;
/** O que é desta máquina e não vai para o git do projeto. */
export const LINHAS_GITIGNORE_IDE = [ARQUIVOS_IDE.mcp, ARQUIVOS_IDE.claude];
const COMENTARIO_GITIGNORE = '# IDE de agentes (Estúdio, docs/ide.md): caminhos desta máquina, refeitos ao abrir o projeto';

export type ServidorMcpStdio = {type: 'stdio'; command: string; args: string[]; env?: Record<string, string>};

/** Caminho do nucleo.cjs: nos recursos do app instalado; na raiz do repositório em desenvolvimento (o mcp:build grava lá). */
export const scriptDoMcp = (o: {empacotado: boolean; recursos: string; raizApp: string}) =>
  path.join(o.empacotado ? o.recursos : o.raizApp, 'dist-mcp', 'nucleo.cjs');

/** O servidor "estudio" do .mcp.json: o próprio executável do app em modo Node (ELECTRON_RUN_AS_NODE=1), que serve ao app
 *  instalado (sem node no sistema) e ao de desenvolvimento (o electron do node_modules). `--ide` deixa a pasta de trabalho
 *  da IDE mandar quando ela é um projeto do Estúdio (pasta copiada à mão leva o .mcp.json da original). */
export const servidorDoMcp = (o: {executavel: string; script: string; projeto: string}): ServidorMcpStdio => ({
  type: 'stdio',
  command: o.executavel,
  args: [o.script, '--projeto', path.resolve(o.projeto), '--autor', 'agente', '--origem', ORIGEM_IDE, '--ide'],
  env: {ELECTRON_RUN_AS_NODE: '1'},
});

type Resultado = {texto: string | null; aviso?: string};
type Objeto = Record<string, unknown>;

const ehObjeto = (x: unknown): x is Objeto => typeof x === 'object' && x !== null && !Array.isArray(x);
const igual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const json = (o: unknown) => `${JSON.stringify(o, null, 2)}\n`;

/** Lê o JSON da pessoa; ilegível ou sem ser objeto vira aviso e o arquivo fica como está. */
const lerObjeto = (atual: string, nome: string): {obj: Objeto} | {aviso: string} => {
  try {
    const o = JSON.parse(atual.replace(/^﻿/, '')) as unknown;
    return ehObjeto(o) ? {obj: o} : {aviso: `${nome} não é um objeto JSON; ficou como estava`};
  } catch {
    return {aviso: `${nome} não é JSON válido; ficou como estava`};
  }
};

/** O "estudio" foi escrito pelo app (e pode ser refeito): stdio com o nucleo.cjs. Outro "estudio" (HTTP, a ponte) é da pessoa. */
export const ehDoApp = (s: unknown) => ehObjeto(s) && Array.isArray(s.args) && s.args.some((a) => typeof a === 'string' && path.basename(a) === 'nucleo.cjs');

/** .mcp.json com o servidor "estudio" deste app, sem mexer nos outros servidores nem nas outras chaves. */
export const mcpJsonAtualizado = (atual: string | null, servidor: ServidorMcpStdio): Resultado => {
  if (atual === null) return {texto: json({mcpServers: {[SERVIDOR_IDE]: servidor}})};
  const lido = lerObjeto(atual, ARQUIVOS_IDE.mcp);
  if ('aviso' in lido) return {texto: null, aviso: lido.aviso};
  if (lido.obj.mcpServers !== undefined && !ehObjeto(lido.obj.mcpServers)) return {texto: null, aviso: `mcpServers do ${ARQUIVOS_IDE.mcp} não é um objeto; ficou como estava`};
  const servidores = (lido.obj.mcpServers ?? {}) as Objeto;
  const antes = servidores[SERVIDOR_IDE];
  if (igual(antes, servidor)) return {texto: null};
  if (antes !== undefined && !ehDoApp(antes)) {
    return {texto: null, aviso: `o servidor "${SERVIDOR_IDE}" do ${ARQUIVOS_IDE.mcp} foi trocado à mão; ficou como estava`};
  }
  return {texto: json({...lido.obj, mcpServers: {...servidores, [SERVIDOR_IDE]: servidor}})};
};

/** .claude/settings.local.json com "estudio" em `enabledMcpjsonServers`; quem o pôs em `disabledMcpjsonServers` decidiu. */
export const settingsLocalAtualizado = (atual: string | null): Resultado => {
  if (atual === null) return {texto: json({enabledMcpjsonServers: [SERVIDOR_IDE]})};
  const lido = lerObjeto(atual, ARQUIVOS_IDE.claude);
  if ('aviso' in lido) return {texto: null, aviso: lido.aviso};
  const {enabledMcpjsonServers: ligados, disabledMcpjsonServers: desligados} = lido.obj;
  if (Array.isArray(desligados) && desligados.includes(SERVIDOR_IDE)) return {texto: null};
  if (ligados !== undefined && !Array.isArray(ligados)) return {texto: null, aviso: `enabledMcpjsonServers do ${ARQUIVOS_IDE.claude} não é uma lista; ficou como estava`};
  if (ligados?.includes(SERVIDOR_IDE)) return {texto: null};
  return {texto: json({...lido.obj, enabledMcpjsonServers: [...(ligados ?? []), SERVIDOR_IDE]})};
};

/** t3.json com o esquema, o ícone e as threads na pasta; só acrescenta o que falta (a escolha da pessoa fica). */
export const t3JsonAtualizado = (atual: string | null): Resultado => {
  const padrao = {$schema: T3_SCHEMA, iconPath: ICONE_T3, defaultThreadEnvMode: 'local'};
  if (atual === null) return {texto: json(padrao)};
  const lido = lerObjeto(atual, ARQUIVOS_IDE.t3);
  if ('aviso' in lido) return {texto: null, aviso: lido.aviso};
  const faltam = Object.entries(padrao).filter(([k]) => lido.obj[k] === undefined);
  if (!faltam.length) return {texto: null};
  return {texto: json({...Object.fromEntries(faltam.filter(([k]) => k === '$schema')), ...lido.obj, ...Object.fromEntries(faltam.filter(([k]) => k !== '$schema'))})};
};

/** .gitignore com as linhas da máquina (LINHAS_GITIGNORE_IDE) que faltam, debaixo de um comentário; null se já tem. */
export const gitignoreComIde = (atual: string): string | null => {
  const tem = new Set(atual.split(/\r?\n/).map((l) => l.trim().replace(/^\//, '')));
  const faltam = LINHAS_GITIGNORE_IDE.filter((l) => !tem.has(l));
  if (!faltam.length) return null;
  return `${atual}${atual && !atual.endsWith('\n') ? '\n' : ''}${COMENTARIO_GITIGNORE}\n${faltam.join('\n')}\n`;
};

export type ResultadoIde = {gravados: string[]; avisos: string[]};

/** Escreve ou atualiza os arquivos de IDE de um projeto. Nunca lança: um arquivo que não dá para mesclar vira aviso e o
 *  resto segue (abrir o projeto não depende disto). */
export const prepararParaIde = (raiz: string, servidor: ServidorMcpStdio): ResultadoIde => {
  const r: ResultadoIde = {gravados: [], avisos: []};
  if (!existsSync(path.join(raiz, 'estudio.json'))) return r;
  const ler = (rel: string) => (existsSync(path.join(raiz, rel)) ? readFileSync(path.join(raiz, rel), 'utf-8') : null);
  const gravar = (rel: string, texto: string) => {
    mkdirSync(path.dirname(path.join(raiz, rel)), {recursive: true});
    writeFileSync(path.join(raiz, rel), texto, 'utf-8');
    r.gravados.push(rel);
  };
  // o .gitignore antes: o commit do app nunca vê o .mcp.json fora dele
  const passos: [string, () => Resultado][] = [
    ['.gitignore', () => ({texto: gitignoreComIde(ler('.gitignore') ?? '')})],
    [ARQUIVOS_IDE.mcp, () => mcpJsonAtualizado(ler(ARQUIVOS_IDE.mcp), servidor)],
    [ARQUIVOS_IDE.claude, () => settingsLocalAtualizado(ler(ARQUIVOS_IDE.claude))],
    [ARQUIVOS_IDE.t3, () => t3JsonAtualizado(ler(ARQUIVOS_IDE.t3))],
  ];
  for (const [rel, f] of passos) {
    try {
      const {texto, aviso} = f();
      if (aviso) r.avisos.push(aviso);
      if (texto !== null) gravar(rel, texto);
    } catch (e) {
      r.avisos.push(`${rel}: ${(e as Error).message}`);
    }
  }
  return r;
};

// ---------- guia do projeto (CLAUDE.md) ----------
/** A seção do CLAUDE.md para quem trabalha pela IDE: ver o vídeo pelas prévias (projeto com vídeo ou animação), a tela
 *  que recarrega e o diário. */
export const secaoIde = (comVideo: boolean): string[] => [
  '',
  '## Trabalhando por uma IDE (T3 Code, Claude Code)',
  '',
  '- O `.mcp.json` desta pasta liga o MCP `estudio` (o app o escreve e atualiza ao abrir o projeto). Abra a pasta como',
  '  projeto na IDE, com as threads na própria pasta, sem worktree: a mídia pesada fica fora do git.',
  ...(comVideo ? [
    '- Para ver o vídeo sem o app: `ver_quadro` (um quadro, por `tempo_ms` ou por `cena` e `fracao`), `ver_cenas` (folha',
    '  de contato, um quadro de cada cena) e `ver_trecho` (MP4 com som, de `de_ms` a `ate_ms`). Elas gravam em',
    '  `saidas/previas/` e devolvem o caminho absoluto; mostre o arquivo na resposta com `![o que é](caminho absoluto)`.',
  ] : []),
  '- Com o app aberto, a tela recarrega sozinha quando um arquivo muda.',
  '- Mudança feita pelo MCP entra no diário (`.estudio/diario.jsonl`) com a origem "IDE", e o Histórico do app tem',
  '  Reverter para cada uma.',
];
