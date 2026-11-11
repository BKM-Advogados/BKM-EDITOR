// Projetos prontos para agentes (T3 Code, Claude Code, Codex, Gemini CLI, Antigravity, Cursor, VS Code, opencode;
// docs/ide.md e docs/harnesses.md). Ao criar ou abrir um projeto, o app escreve, junto do guia (CLAUDE.md, AGENTS.md e
// GEMINI.md, criar-projeto.ts):
// - `.mcp.json`: o servidor "estudio" (o MCP por stdio deste app, mcp/nucleo.ts, apontado para esta pasta). O Claude Code
//   e as threads Claude do T3 (Claude Agent SDK) leem este arquivo.
// - `.claude/settings.local.json`: aprova o "estudio" do .mcp.json (`enabledMcpjsonServers`); no modo SDK do T3 não há
//   diálogo de aprovação.
// - `t3.json`: threads na própria pasta (`defaultThreadEnvMode: "local"`; worktree não serve, a mídia pesada fica fora do
//   git) e o ícone do projeto (a miniatura que o app tira ao fechar).
// - o mesmo servidor no arquivo de MCP de cada outro harness (HARNESSES), no formato dele e com a origem dele no diário
//   (`--origem "Gemini CLI"`, por exemplo): `.gemini/settings.json`, `.agents/mcp_config.json`, `.codex/config.toml`,
//   `.cursor/mcp.json`, `.vscode/mcp.json` e `opencode.json`.
// Tudo mesclado: o que a pessoa já tiver nesses arquivos fica, e nada é regravado se não mudou (o app commita o git do
// projeto sozinho). Os arquivos de MCP (caminhos absolutos desta máquina) e o settings.local.json vão para o .gitignore
// do projeto; o t3.json, sem nada da máquina, fica no git. As funções `...Atualizado` são puras; `prepararParaIde` grava.
import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {gravarAtomicoNoLugar} from './gravar-seguro';

export const SERVIDOR_IDE = 'estudio';
export const T3_SCHEMA = 'https://t3.codes/schema/t3.json';
export const ICONE_T3 = '.estudio/miniatura.jpg';
export const ARQUIVOS_IDE = {mcp: '.mcp.json', claude: '.claude/settings.local.json', t3: 't3.json'} as const;

/** O arquivo de instrução que cada harness lê na raiz do projeto (o mesmo guia, com a seção do harness no fim). */
export type ArquivoDeGuia = 'CLAUDE.md' | 'AGENTS.md' | 'GEMINI.md';
export const ARQUIVOS_DE_GUIA: readonly ArquivoDeGuia[] = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'];

/** Como cada harness escreve o servidor: `mcpServers` com `type: "stdio"` (Claude Code, Cursor), `mcpServers` sem `type`
 *  (Gemini CLI, Antigravity), `servers` (VS Code), `mcp.servers` com o comando numa lista (opencode) e TOML (Codex). */
export type FormatoMcp = 'mcpServers' | 'mcpServers-sem-tipo' | 'servers' | 'opencode' | 'toml';

export type Harness = {
  id: 'claude' | 'gemini' | 'antigravity' | 'codex' | 'cursor' | 'vscode' | 'opencode';
  nome: string;
  guia: ArquivoDeGuia;
  mcp: string;
  formato: FormatoMcp;
  /** O nome no diário e no Histórico (`--origem`); sem ele, "Claude na IDE", como antes. */
  origem?: string;
};

// Conferido nas docs oficiais em 11/11/2026 (links e o que cada uma diz em docs/harnesses.md).
export const HARNESSES: readonly Harness[] = [
  {id: 'claude', nome: 'Claude Code e T3 Code', guia: 'CLAUDE.md', mcp: ARQUIVOS_IDE.mcp, formato: 'mcpServers'},
  {id: 'codex', nome: 'Codex (CLI, app e extensão)', guia: 'AGENTS.md', mcp: '.codex/config.toml', formato: 'toml', origem: 'Codex'},
  {id: 'gemini', nome: 'Gemini CLI', guia: 'GEMINI.md', mcp: '.gemini/settings.json', formato: 'mcpServers-sem-tipo', origem: 'Gemini CLI'},
  {id: 'antigravity', nome: 'Antigravity', guia: 'AGENTS.md', mcp: '.agents/mcp_config.json', formato: 'mcpServers-sem-tipo', origem: 'Antigravity'},
  {id: 'cursor', nome: 'Cursor', guia: 'AGENTS.md', mcp: '.cursor/mcp.json', formato: 'mcpServers', origem: 'Cursor'},
  {id: 'vscode', nome: 'VS Code (Copilot)', guia: 'AGENTS.md', mcp: '.vscode/mcp.json', formato: 'servers', origem: 'VS Code'},
  {id: 'opencode', nome: 'opencode', guia: 'AGENTS.md', mcp: 'opencode.json', formato: 'opencode', origem: 'opencode'},
];

/** O que é desta máquina e não vai para o git do projeto: os arquivos de MCP de todos os harnesses e a aprovação do
 *  Claude Code. */
export const LINHAS_GITIGNORE_IDE = [ARQUIVOS_IDE.mcp, ARQUIVOS_IDE.claude, ...HARNESSES.filter((h) => h.id !== 'claude').map((h) => h.mcp)];
const COMENTARIO_GITIGNORE = '# IDE de agentes (Estúdio, docs/ide.md): caminhos desta máquina, refeitos ao abrir o projeto';

export type ServidorMcpStdio = {type: 'stdio'; command: string; args: string[]; env?: Record<string, string>};

/** Caminho do nucleo.cjs: nos recursos do app instalado; na raiz do repositório em desenvolvimento (o mcp:build grava lá). */
export const scriptDoMcp = (o: {empacotado: boolean; recursos: string; raizApp: string}) =>
  path.join(o.empacotado ? o.recursos : o.raizApp, 'dist-mcp', 'nucleo.cjs');

/** O servidor "estudio": o próprio executável do app em modo Node (ELECTRON_RUN_AS_NODE=1), que serve ao app instalado
 *  (sem node no sistema) e ao de desenvolvimento (o electron do node_modules). `--ide` deixa a pasta de trabalho da IDE
 *  mandar quando ela é um projeto do Estúdio (pasta copiada à mão leva o .mcp.json da original). `origem` é o nome do
 *  harness no diário. */
export const servidorDoMcp = (o: {executavel: string; script: string; projeto: string; origem?: string}): ServidorMcpStdio => ({
  type: 'stdio',
  command: o.executavel,
  args: [o.script, '--projeto', path.resolve(o.projeto), '--autor', 'agente', '--ide', ...(o.origem ? ['--origem', o.origem] : [])],
  env: {ELECTRON_RUN_AS_NODE: '1'},
});

/** O mesmo servidor com a origem de um harness (sem trocar uma origem que já esteja nele). */
export const comOrigem = (s: ServidorMcpStdio, origem?: string): ServidorMcpStdio =>
  !origem || s.args.includes('--origem') ? s : {...s, args: [...s.args, '--origem', origem]};

type Resultado = {texto: string | null; aviso?: string};
type Objeto = Record<string, unknown>;

const ehObjeto = (x: unknown): x is Objeto => typeof x === 'object' && x !== null && !Array.isArray(x);
const igual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const json = (o: unknown) => `${JSON.stringify(o, null, 2)}\n`;
const baseDoCaminho = (p: string) => p.split(/[\\/]/).pop() ?? p; // o nome do arquivo também num caminho do Windows

/** Lê o JSON da pessoa; ilegível ou sem ser objeto vira aviso e o arquivo fica como está. */
const lerObjeto = (atual: string, nome: string): {obj: Objeto} | {aviso: string} => {
  try {
    const o = JSON.parse(atual.replace(/^﻿/, '')) as unknown;
    return ehObjeto(o) ? {obj: o} : {aviso: `${nome} não é um objeto JSON; ficou como estava`};
  } catch {
    return {aviso: `${nome} não é JSON válido; ficou como estava`};
  }
};

/** O "estudio" foi escrito pelo app (e pode ser refeito): o nucleo.cjs nos args (ou no comando em lista, do opencode).
 *  Outro "estudio" (HTTP, a ponte) é da pessoa. */
export const ehDoApp = (s: unknown) => ehObjeto(s)
  && [s.args, s.command].some((l) => Array.isArray(l) && l.some((a) => typeof a === 'string' && baseDoCaminho(a) === 'nucleo.cjs'));

/** A entrada do servidor no formato do harness. */
export const entradaDoServidor = (s: ServidorMcpStdio, formato: Exclude<FormatoMcp, 'toml'>): Objeto => {
  if (formato === 'mcpServers-sem-tipo') return {command: s.command, args: s.args, env: s.env ?? {}};
  if (formato === 'opencode') return {type: 'local', command: [s.command, ...s.args], environment: s.env ?? {}};
  return s;
};

const CHAVES: Record<Exclude<FormatoMcp, 'toml'>, string[]> = {
  mcpServers: ['mcpServers'], 'mcpServers-sem-tipo': ['mcpServers'], servers: ['servers'], opencode: ['mcp', 'servers'],
};

/** A entrada do app por cima da que está no arquivo: só os campos do app mudam. O que a pessoa pôs no "estudio" fica
 *  (`enabled: false` do opencode, `trust` e `timeout` do Gemini, uma `GEMINI_API_KEY` no `env` para a narração), e os
 *  objetos do app (`env`, `environment`) mesclam com os dela, chave a chave. */
export const mesclarEntrada = (antes: unknown, entrada: Objeto): Objeto => {
  if (!ehObjeto(antes)) return entrada;
  const nova: Objeto = {...antes};
  for (const [k, v] of Object.entries(entrada)) nova[k] = ehObjeto(v) && ehObjeto(antes[k]) ? {...antes[k], ...v} : v;
  return nova;
};

/** Um arquivo JSON de MCP com a entrada "estudio" deste app em `chaves` (por exemplo `mcp.servers`), sem mexer nos outros
 *  servidores, nas outras chaves nem no que a pessoa acrescentou ao "estudio" (mesclarEntrada). Igual: null. "estudio"
 *  trocado à mão: fica, com aviso. */
export const configJsonAtualizado = (atual: string | null, arquivo: string, chaves: string[], entrada: Objeto): Resultado => {
  const montar = (base: Objeto, i: number, e: Objeto): Objeto => {
    const k = chaves[i];
    const dentro = (base[k] ?? {}) as Objeto;
    return {...base, [k]: i === chaves.length - 1 ? {...dentro, [SERVIDOR_IDE]: e} : montar(dentro, i + 1, e)};
  };
  if (atual === null) return {texto: json(montar({}, 0, entrada))};
  const lido = lerObjeto(atual, arquivo);
  if ('aviso' in lido) return {texto: null, aviso: lido.aviso};
  let nivel: Objeto = lido.obj;
  for (const [i, k] of chaves.entries()) {
    const prox = nivel[k];
    if (prox === undefined) {
      nivel = {};
      break;
    }
    if (!ehObjeto(prox)) return {texto: null, aviso: `${chaves.slice(0, i + 1).join('.')} do ${arquivo} não é um objeto; ficou como estava`};
    nivel = prox;
  }
  const antes = nivel[SERVIDOR_IDE];
  if (antes !== undefined && !ehDoApp(antes)) return {texto: null, aviso: `o servidor "${SERVIDOR_IDE}" do ${arquivo} foi trocado à mão; ficou como estava`};
  const nova = mesclarEntrada(antes, entrada);
  if (igual(antes, nova)) return {texto: null};
  return {texto: json(montar(lido.obj, 0, nova))};
};

/** .mcp.json com o servidor "estudio" deste app, sem mexer nos outros servidores nem nas outras chaves. */
export const mcpJsonAtualizado = (atual: string | null, servidor: ServidorMcpStdio): Resultado =>
  configJsonAtualizado(atual, ARQUIVOS_IDE.mcp, ['mcpServers'], servidor);

// ---------- Codex (.codex/config.toml) ----------
/** Texto TOML entre aspas: o escape do JSON serve ao TOML (\" \\ \n \t \uXXXX), menos o DEL, que o TOML pede escapado. */
const tomlTexto = (s: string) => JSON.stringify(s).replace(/\u007f/g, '\\u007f');
const TABELA_CODEX = `mcp_servers.${SERVIDOR_IDE}`;

/** As tabelas `[mcp_servers.estudio]` e `[mcp_servers.estudio.env]` do Codex. */
export const blocoToml = (s: ServidorMcpStdio): string => [
  `[${TABELA_CODEX}]`,
  `command = ${tomlTexto(s.command)}`,
  `args = [${s.args.map(tomlTexto).join(', ')}]`,
  ...(s.env && Object.keys(s.env).length ? ['', `[${TABELA_CODEX}.env]`, ...Object.entries(s.env).map(([k, v]) => `${k} = ${tomlTexto(v)}`)] : []),
].join('\n');

/** O nome de uma tabela TOML (`[a."b".c]` → `a.b.c`); null se a linha não abre tabela. */
const tabelaDaLinha = (linha: string): string | null => {
  const m = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(linha);
  return m ? m[1].split('.').map((p) => p.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')).join('.') : null;
};

/** A chave de uma linha `chave = valor` do TOML (sem aspas), ou null. */
const chaveDaLinha = (linha: string): string | null => {
  const m = /^\s*("([^"]*)"|'([^']*)'|[A-Za-z0-9_-]+)\s*=/.exec(linha);
  return m ? (m[2] ?? m[3] ?? m[1]) : null;
};

/** Quantas linhas, a partir de `i`, o valor da chave ocupa: uma lista aberta (`args = [`) vai até fechar. Os colchetes
 *  dentro de texto entre aspas não contam. */
const linhasDoValor = (linhas: string[], i: number): number => {
  let nivel = 0;
  for (let j = i; j < linhas.length; j++) {
    const semTexto = linhas[j].replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '').replace(/#.*$/, '');
    for (const c of semTexto) nivel += c === '[' ? 1 : c === ']' ? -1 : 0;
    if (nivel <= 0) return j - i + 1;
  }
  return linhas.length - i;
};

/** As linhas de uma tabela (sem o cabeçalho) com as chaves do app trocadas no lugar, as que faltam no começo e as da
 *  pessoa (outras chaves, comentários) como estão. */
const mesclarTabelaToml = (corpo: string[], doApp: [string, string][]): string[] => {
  const pendentes = new Map(doApp);
  const saida: string[] = [];
  for (let i = 0; i < corpo.length; ) {
    const k = chaveDaLinha(corpo[i]);
    const n = k === null ? 1 : linhasDoValor(corpo, i);
    if (k !== null && pendentes.has(k)) {
      saida.push(pendentes.get(k)!);
      pendentes.delete(k);
    } else saida.push(...corpo.slice(i, i + n));
    i += n;
  }
  return [...pendentes.values(), ...saida];
};

/** .codex/config.toml com o "estudio" do app atualizado no lugar: só `command`, `args` e as chaves do `env` que o app usa
 *  mudam; o que a pessoa pôs nas tabelas do "estudio" (outra variável no `env`, `enabled`, `tool_timeout_sec`), os
 *  comentários, o fim de linha (CRLF) e o resto do arquivo ficam. O "estudio" escrito de outro jeito (tabela em linha,
 *  chave pontilhada) ou trocado à mão fica, com aviso. */
export const codexTomlAtualizado = (atual: string | null, servidor: ServidorMcpStdio, arquivo = '.codex/config.toml'): Resultado => {
  const bloco = blocoToml(servidor);
  if (atual === null) return {texto: `${bloco}\n`};
  const bom = atual.startsWith('﻿') ? '﻿' : '';
  const eol = atual.includes('\r\n') ? '\r\n' : '\n';
  const linhas = atual.slice(bom.length).replace(/\r\n/g, '\n').split('\n');
  const montar = (ls: string[]) => `${bom}${ls.join('\n').replace(/\n*$/, '')}\n`.replace(/\n/g, eol);
  const ENV = `${TABELA_CODEX}.env`;
  // o "estudio" em chave pontilhada na raiz (`mcp_servers.estudio.command = ...`) ou dentro de `[mcp_servers]`
  // (`estudio = {...}`) não é do app
  const naRaiz = new RegExp(`^\\s*mcp_servers\\s*\\.\\s*["']?${SERVIDOR_IDE}["']?\\s*[.=]`);
  const emMcpServers = new RegExp(`^\\s*["']?${SERVIDOR_IDE}["']?\\s*[.=]`);
  // as tabelas do arquivo: [cabeçalho, fim) de cada uma; a do começo (sem cabeçalho) é a raiz
  const tabelas: {nome: string | null; ini: number; fim: number}[] = [{nome: null, ini: -1, fim: linhas.length}];
  for (const [i, l] of linhas.entries()) {
    const t = tabelaDaLinha(l);
    const atualT = tabelas[tabelas.length - 1];
    if (t !== null) {
      atualT.fim = i;
      tabelas.push({nome: t, ini: i, fim: linhas.length});
    } else if ((atualT.nome === null && naRaiz.test(l)) || (atualT.nome === 'mcp_servers' && emMcpServers.test(l))) {
      return {texto: null, aviso: `o servidor "${SERVIDOR_IDE}" do ${arquivo} está escrito de outro jeito; ficou como estava`};
    }
  }
  const nossa = (t: string | null) => t !== null && (t === TABELA_CODEX || t.startsWith(`${TABELA_CODEX}.`));
  const nossas = tabelas.filter((t) => nossa(t.nome));
  if (!nossas.length) {
    const corpo = linhas.join('\n').replace(/\n*$/, '');
    return {texto: montar([...(corpo ? [corpo, ''] : []), bloco])};
  }
  // o corpo de cada tabela vai até a última linha `chave = valor`: as linhas em branco e os comentários depois dela são
  // da tabela seguinte (o comentário que a apresenta)
  const corpoDe = (t: {ini: number; fim: number}) => {
    let fim = t.fim;
    while (fim > t.ini + 1 && /^\s*(#.*)?$/.test(linhas[fim - 1])) fim--;
    return {ini: t.ini + 1, fim};
  };
  const textoDoEstudio = nossas.map((t) => linhas.slice(t.ini, corpoDe(t).fim).join('\n')).join('\n');
  if (!textoDoEstudio.includes('nucleo.cjs')) return {texto: null, aviso: `o servidor "${SERVIDOR_IDE}" do ${arquivo} foi trocado à mão; ficou como estava`};
  const principal: [string, string][] = [['command', `command = ${tomlTexto(servidor.command)}`], ['args', `args = [${servidor.args.map(tomlTexto).join(', ')}]`]];
  const doEnv: [string, string][] = Object.entries(servidor.env ?? {}).map(([k, v]) => [k, `${k} = ${tomlTexto(v)}`]);
  const novas = [...linhas];
  // de trás para frente, para os índices de cima continuarem valendo
  const tabelaEnv = nossas.find((t) => t.nome === ENV);
  const tabelaPrincipal = nossas.find((t) => t.nome === TABELA_CODEX);
  const trocar = (t: {ini: number; fim: number}, doApp: [string, string][]) => {
    const c = corpoDe(t);
    novas.splice(c.ini, c.fim - c.ini, ...mesclarTabelaToml(linhas.slice(c.ini, c.fim), doApp));
  };
  const ordem = [tabelaEnv, tabelaPrincipal].filter((t): t is NonNullable<typeof t> => Boolean(t)).sort((a, b) => b.ini - a.ini);
  for (const t of ordem) trocar(t, t === tabelaEnv ? doEnv : principal);
  if (!tabelaEnv && doEnv.length && tabelaPrincipal) {
    // a tabela do env que faltava entra logo depois do corpo da principal (antes dela, nada mudou de tamanho se ela vem
    // depois; por isso a posição é recalculada no texto novo)
    const novasTabelas = novas.map((l) => tabelaDaLinha(l));
    const iniP = novasTabelas.indexOf(TABELA_CODEX);
    let fimP = novasTabelas.findIndex((t, i) => i > iniP && t !== null);
    if (fimP < 0) fimP = novas.length;
    while (fimP > iniP + 1 && /^\s*(#.*)?$/.test(novas[fimP - 1])) fimP--;
    novas.splice(fimP, 0, '', `[${ENV}]`, ...doEnv.map(([, l]) => l));
  }
  if (!tabelaPrincipal) return {texto: null, aviso: `o servidor "${SERVIDOR_IDE}" do ${arquivo} está escrito de outro jeito; ficou como estava`};
  const texto = montar(novas);
  return texto === atual ? {texto: null} : {texto};
};

/** O arquivo de MCP de um harness atualizado (puro). */
export const mcpDoHarness = (h: Harness, atual: string | null, servidor: ServidorMcpStdio): Resultado => {
  const s = comOrigem(servidor, h.origem);
  if (h.formato === 'toml') return codexTomlAtualizado(atual, s, h.mcp);
  return configJsonAtualizado(atual, h.mcp, CHAVES[h.formato], entradaDoServidor(s, h.formato));
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

/** Escreve ou atualiza os arquivos de IDE de um projeto, de todos os harnesses. Nunca lança: um arquivo que não dá para
 *  mesclar vira aviso e o resto segue (abrir o projeto não depende disto). `guias`, se vier, refaz o AGENTS.md e o
 *  GEMINI.md (criar-projeto.ts) e devolve os que gravou. */
export const prepararParaIde = (raiz: string, servidor: ServidorMcpStdio, guias?: (raiz: string) => string[]): ResultadoIde => {
  const r: ResultadoIde = {gravados: [], avisos: []};
  if (!existsSync(path.join(raiz, 'estudio.json'))) return r;
  const ler = (rel: string) => (existsSync(path.join(raiz, rel)) ? readFileSync(path.join(raiz, rel), 'utf-8') : null);
  const gravar = (rel: string, texto: string) => {
    mkdirSync(path.dirname(path.join(raiz, rel)), {recursive: true});
    // atômico e no lugar: um arquivo da pessoa (opencode.json, .vscode/mcp.json) nunca fica meio gravado, e o symlink e o
    // modo dele ficam
    gravarAtomicoNoLugar(path.join(raiz, rel), texto);
    r.gravados.push(rel);
  };
  // o .gitignore antes: o commit do app nunca vê os arquivos de MCP fora dele
  const passos: [string, () => Resultado][] = [
    ['.gitignore', () => ({texto: gitignoreComIde(ler('.gitignore') ?? '')})],
    ...HARNESSES.map((h): [string, () => Resultado] => [h.mcp, () => mcpDoHarness(h, ler(h.mcp), servidor)]),
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
  if (guias) {
    try {
      r.gravados.push(...guias(raiz));
    } catch (e) {
      r.avisos.push(`guias: ${(e as Error).message}`);
    }
  }
  return r;
};

// ---------- a seção de cada harness no guia (CLAUDE.md, AGENTS.md, GEMINI.md) ----------
const linhasDasPrevias = (mostrar: string[]) => [
  '- Para ver o vídeo sem o app: `ver_quadro` (um quadro, por `tempo_ms` ou por `cena` e `fracao`), `ver_cenas` (folha',
  '  de contato, um quadro de cada cena) e `ver_trecho` (MP4 com som, de `de_ms` a `ate_ms`). Elas gravam em',
  ...mostrar,
];

const linhasDoDiario = (quem: string) => [
  '- Com o app aberto, a tela recarrega sozinha quando um arquivo muda.',
  `- Mudança feita pelo MCP entra no diário (\`.estudio/diario.jsonl\`) com a origem ${quem}, e o Histórico do app tem`,
  '  Reverter para cada uma.',
];

/** A seção do guia para quem trabalha por um harness: onde o MCP está ligado, como ver o vídeo pelas prévias (projeto com
 *  vídeo ou animação) e mostrar a imagem à pessoa, a tela que recarrega e o diário. */
export const secaoDoHarness = (arquivo: ArquivoDeGuia, comVideo: boolean): string[] => {
  if (arquivo === 'CLAUDE.md') {
    return [
      '',
      '## Trabalhando por uma IDE (T3 Code, Claude Code)',
      '',
      '- O `.mcp.json` desta pasta liga o MCP `estudio` (o app o escreve e atualiza ao abrir o projeto). Abra a pasta como',
      '  projeto na IDE, com as threads na própria pasta, sem worktree: a mídia pesada fica fora do git.',
      ...(comVideo ? linhasDasPrevias([
        '  `saidas/previas/` e devolvem o caminho absoluto; mostre o arquivo na resposta com `![o que é](caminho absoluto)`.',
      ]) : []),
      ...linhasDoDiario('"IDE"'),
    ];
  }
  if (arquivo === 'GEMINI.md') {
    return [
      '',
      '## Trabalhando pelo Gemini CLI',
      '',
      '- O `.gemini/settings.json` desta pasta liga o MCP `estudio` (o app o escreve e atualiza ao abrir o projeto). O',
      '  Gemini CLI só conecta servidor stdio em pasta confiável: se `/mcp` não mostrar o `estudio`, peça à pessoa para',
      '  confiar na pasta. Trabalhe na própria pasta, sem cópia nem worktree: a mídia pesada fica fora do git.',
      '- O Antigravity lê este arquivo e também o AGENTS.md, que tem o mesmo guia; o MCP dele fica em',
      '  `.agents/mcp_config.json`.',
      ...(comVideo ? linhasDasPrevias([
        '  `saidas/previas/` e devolvem o caminho absoluto. A imagem do quadro chega a você na resposta da ferramenta;',
        '  o terminal não a mostra, então dê à pessoa o caminho absoluto do arquivo para ela abrir.',
      ]) : []),
      ...linhasDoDiario('"Gemini CLI"'),
    ];
  }
  return [
    '',
    '## Trabalhando por um agente (Codex, Cursor, VS Code, opencode, Antigravity)',
    '',
    '- O MCP `estudio` já vem ligado nesta pasta, no arquivo de cada programa (o app os escreve e atualiza ao abrir o',
    '  projeto): Codex em `.codex/config.toml`, Cursor em `.cursor/mcp.json`, VS Code em `.vscode/mcp.json`, opencode em',
    '  `opencode.json` e Antigravity em `.agents/mcp_config.json`. O Codex só lê o arquivo do projeto com a pasta',
    '  confiável. Se as ferramentas do `estudio` não aparecerem, peça à pessoa para confiar na pasta ou ligar o',
    '  servidor na tela de MCP do programa. Trabalhe na própria pasta, sem cópia nem worktree: a mídia pesada fica fora',
    '  do git.',
    ...(comVideo ? linhasDasPrevias([
      '  `saidas/previas/` e devolvem o caminho absoluto. A imagem do quadro chega a você na resposta da ferramenta; para',
      '  a pessoa, dê o caminho absoluto do arquivo e, se a sua tela mostra Markdown com imagem, use',
      '  `![o que é](caminho absoluto)`.',
    ]) : []),
    '- Com o app aberto, a tela recarrega sozinha quando um arquivo muda.',
    '- Mudança feita pelo MCP entra no diário (`.estudio/diario.jsonl`) com o nome do programa ("Codex", "Cursor",',
    '  "VS Code", "opencode", "Antigravity"), e o Histórico do app tem Reverter para cada uma.',
  ];
};

/** A seção do CLAUDE.md (mantida com o nome antigo para quem já a importava). */
export const secaoIde = (comVideo: boolean): string[] => secaoDoHarness('CLAUDE.md', comVideo);
