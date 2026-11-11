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
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';

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

/** Um arquivo JSON de MCP com a entrada "estudio" deste app em `chaves` (por exemplo `mcp.servers`), sem mexer nos outros
 *  servidores nem nas outras chaves. Igual: null. "estudio" trocado à mão: fica, com aviso. */
export const configJsonAtualizado = (atual: string | null, arquivo: string, chaves: string[], entrada: Objeto): Resultado => {
  const montar = (base: Objeto, i: number): Objeto => {
    const k = chaves[i];
    const dentro = (base[k] ?? {}) as Objeto;
    return {...base, [k]: i === chaves.length - 1 ? {...dentro, [SERVIDOR_IDE]: entrada} : montar(dentro, i + 1)};
  };
  if (atual === null) return {texto: json(montar({}, 0))};
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
  if (igual(antes, entrada)) return {texto: null};
  if (antes !== undefined && !ehDoApp(antes)) return {texto: null, aviso: `o servidor "${SERVIDOR_IDE}" do ${arquivo} foi trocado à mão; ficou como estava`};
  return {texto: json(montar(lido.obj, 0))};
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

/** .codex/config.toml com as tabelas do "estudio" refeitas no lugar delas (ou no fim), e o resto do arquivo como está.
 *  O "estudio" escrito de outro jeito (tabela em linha, chave pontilhada) ou trocado à mão fica, com aviso. */
export const codexTomlAtualizado = (atual: string | null, servidor: ServidorMcpStdio, arquivo = '.codex/config.toml'): Resultado => {
  const bloco = blocoToml(servidor);
  if (atual === null) return {texto: `${bloco}\n`};
  const linhas = atual.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
  const nossa = (t: string | null) => t !== null && (t === TABELA_CODEX || t.startsWith(`${TABELA_CODEX}.`));
  let tabela: string | null = null;
  const dentro: number[] = [];
  // o "estudio" em chave pontilhada na raiz (`mcp_servers.estudio.command = ...`) ou dentro de `[mcp_servers]`
  // (`estudio = {...}`) não é do app
  const naRaiz = new RegExp(`^\\s*mcp_servers\\s*\\.\\s*["']?${SERVIDOR_IDE}["']?\\s*[.=]`);
  const emMcpServers = new RegExp(`^\\s*["']?${SERVIDOR_IDE}["']?\\s*[.=]`);
  for (const [i, l] of linhas.entries()) {
    const t = tabelaDaLinha(l);
    if (t !== null) tabela = t;
    else if ((tabela === null && naRaiz.test(l)) || (tabela === 'mcp_servers' && emMcpServers.test(l))) {
      return {texto: null, aviso: `o servidor "${SERVIDOR_IDE}" do ${arquivo} está escrito de outro jeito; ficou como estava`};
    }
    if (nossa(tabela)) dentro.push(i);
  }
  if (!dentro.length) {
    const corpo = linhas.join('\n').replace(/\n*$/, '');
    return {texto: `${corpo}${corpo ? '\n\n' : ''}${bloco}\n`};
  }
  const antes = dentro.map((i) => linhas[i]).join('\n');
  if (!antes.includes('nucleo.cjs')) return {texto: null, aviso: `o servidor "${SERVIDOR_IDE}" do ${arquivo} foi trocado à mão; ficou como estava`};
  if (antes.trim() === bloco.trim()) return {texto: null};
  // tira as nossas linhas (com as em branco do fim de cada tabela) e põe o bloco novo onde estava a primeira; antes
  // dela nada saiu, então a posição no resto é a mesma
  const resto = linhas.filter((_, i) => !dentro.includes(i));
  const pos = Math.min(dentro[0], resto.length);
  const novo = [...resto.slice(0, pos), ...bloco.split('\n'), ...(pos < resto.length ? [''] : []), ...resto.slice(pos)].join('\n');
  return {texto: `${novo.replace(/\n*$/, '')}\n`};
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
    writeFileSync(path.join(raiz, rel), texto, 'utf-8');
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
