// Claude Desktop (frente claude-desktop, docs/claude-desktop.md). Tudo o que não depende do Electron e que três lugares
// usam: o app (o botão "Conectar ao Claude Desktop" e o arquivo de descoberta), o MCP do Claude Desktop
// (mcp/desktop.ts) e o lançador da extensão .mcpb (mcpb/lancador.ts, que roda no Node do próprio Claude Desktop).
// Cada função recebe o sistema pedido (plataforma, variáveis, pasta pessoal) e monta os caminhos com path.win32 ou
// path.posix conforme ele, para os testes conferirem os três sistemas em qualquer um (o CI roda em Windows, Mac e Linux).
// As funções da configuração do Claude Desktop são puras (texto entra, texto sai); quem grava é o app.
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type Sistema = {plataforma: NodeJS.Platform | string; env: Record<string, string | undefined>; home: string};

export const sistemaAtual = (): Sistema => ({plataforma: process.platform, env: process.env, home: os.homedir()});

/** O módulo de caminhos do sistema pedido (não o de quem roda). */
export const caminhos = (plataforma: string) => (plataforma === 'win32' ? path.win32 : path.posix);

/** Nome do servidor no claude_desktop_config.json, o mesmo da extensão e do .mcp.json dos projetos. */
export const SERVIDOR_CLAUDE_DESKTOP = 'estudio';
/** Origem no diário e no Histórico de tudo o que vem do Claude Desktop. */
export const ORIGEM_CLAUDE_DESKTOP = 'Claude Desktop';
/** O MCP do Claude Desktop, gerado pelo mcp:build ao lado do nucleo.cjs. */
export const SCRIPT_DESKTOP = 'desktop.cjs';
/** O arquivo de descoberta, na pasta de dados do Estúdio. */
export const ARQUIVO_DESCOBERTA = 'claude-desktop.json';
/** Onde o Estúdio está instalado (executável e MCP), sem token, na pasta de dados: o app grava ao abrir e não apaga ao
 *  fechar. O lançador da extensão acha por ele a pasta escolhida à mão no instalador do Windows com o app fechado. */
export const ARQUIVO_INSTALACAO = 'instalacao.json';
export const ARQUIVO_CONFIG_CLAUDE = 'claude_desktop_config.json';

// ---------- pastas de cada sistema ----------

/** Pasta de configuração do Claude Desktop: %APPDATA%\Claude, ~/Library/Application Support/Claude ou ~/.config/Claude. */
export const pastaDoClaude = (s: Sistema) => {
  const p = caminhos(s.plataforma);
  if (s.plataforma === 'win32') return p.join(s.env.APPDATA || p.join(s.home, 'AppData', 'Roaming'), 'Claude');
  if (s.plataforma === 'darwin') return p.join(s.home, 'Library', 'Application Support', 'Claude');
  return p.join(s.env.XDG_CONFIG_HOME || p.join(s.home, '.config'), 'Claude');
};

export const arquivoConfigClaude = (s: Sistema) => caminhos(s.plataforma).join(pastaDoClaude(s), ARQUIVO_CONFIG_CLAUDE);

/** Pasta de dados do Estúdio (o userData do Electron, com o productName "Estudio"). */
export const pastaDadosEstudio = (s: Sistema) => {
  const p = caminhos(s.plataforma);
  if (s.plataforma === 'win32') return p.join(s.env.APPDATA || p.join(s.home, 'AppData', 'Roaming'), 'Estudio');
  if (s.plataforma === 'darwin') return p.join(s.home, 'Library', 'Application Support', 'Estudio');
  return p.join(s.env.XDG_CONFIG_HOME || p.join(s.home, '.config'), 'Estudio');
};

export const arquivoDescoberta = (s: Sistema) => caminhos(s.plataforma).join(pastaDadosEstudio(s), ARQUIVO_DESCOBERTA);
export const arquivoInstalacao = (s: Sistema) => caminhos(s.plataforma).join(pastaDadosEstudio(s), ARQUIVO_INSTALACAO);

/** Pasta padrão dos projetos (a mesma do main.ts: ~/Estudio). */
export const pastaPadraoProjetos = (s: Sistema) => caminhos(s.plataforma).join(s.home, 'Estudio');

export type Instalacao = {executavel: string; script: string};

/** O registro da instalação ({formato: 1, executavel, script, versao}); null se não existe, está fora do formato ou aponta
 *  para caminho relativo. Quem usa confere se os arquivos existem. */
export const lerInstalacao = (arquivo: string): Instalacao | null => {
  try {
    if (!existsSync(arquivo)) return null;
    const d = JSON.parse(readFileSync(arquivo, 'utf-8')) as {formato?: unknown; executavel?: unknown; script?: unknown};
    if (d.formato !== 1 || typeof d.executavel !== 'string' || typeof d.script !== 'string') return null;
    const absoluto = (x: string) => /^([A-Za-z]:[\\/]|\\\\|\/)/.test(x);
    return absoluto(d.executavel) && absoluto(d.script) ? {executavel: d.executavel, script: d.script} : null;
  } catch {
    return null;
  }
};

/** Onde o instalador de cada sistema põe o Estúdio, em ordem de preferência. */
export const instalacoesPadrao = (s: Sistema): Instalacao[] => {
  const p = caminhos(s.plataforma);
  if (s.plataforma === 'win32') {
    const local = s.env.LOCALAPPDATA || p.join(s.home, 'AppData', 'Local');
    const pasta = p.join(local, 'Programs', 'Estudio');
    return [{executavel: p.join(pasta, 'Estudio.exe'), script: p.join(pasta, 'resources', 'dist-mcp', SCRIPT_DESKTOP)}];
  }
  if (s.plataforma === 'darwin') {
    return ['/Applications', p.join(s.home, 'Applications')].map((dir) => {
      const app = p.join(dir, 'Estudio.app');
      return {executavel: p.join(app, 'Contents', 'MacOS', 'Estudio'), script: p.join(app, 'Contents', 'Resources', 'dist-mcp', SCRIPT_DESKTOP)};
    });
  }
  const pasta = p.join(s.home, '.local', 'opt', 'Estudio');
  return [{executavel: p.join(pasta, 'Estudio'), script: p.join(pasta, 'resources', 'dist-mcp', SCRIPT_DESKTOP)}];
};

// ---------- arquivo de descoberta ----------
// O app, aberto, grava na pasta de dados dele o endereço do MCP por HTTP (o mesmo servidor local das abas), um token só
// do Claude Desktop, o pid, a máquina, o executável e o projeto aberto. O MCP do Claude Desktop lê o arquivo a cada
// chamada: com o app vivo, a chamada vai para ele (um escritor só, portão, diário, Reverter), sem a pessoa colar token.
// Só o usuário lê o arquivo (0600; no Windows, a pasta do perfil já é só dele). Ao fechar, o app apaga.

export type Descoberta = {formato: 1; url: string; token: string; pid: number; host: string; executavel: string; script: string;
  versao: string; projeto: string | null; em: string};

/** O arquivo lido e conferido no formato; null se não existe ou está fora do formato. Não confere se o app está vivo. */
export const lerDescoberta = (arquivo: string): Descoberta | null => {
  try {
    if (!existsSync(arquivo)) return null;
    const d = JSON.parse(readFileSync(arquivo, 'utf-8')) as Partial<Descoberta>;
    if (d.formato !== 1 || typeof d.url !== 'string' || typeof d.token !== 'string' || typeof d.pid !== 'number' || typeof d.host !== 'string') return null;
    if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(d.url)) return null; // só o app desta máquina
    return {formato: 1, url: d.url, token: d.token, pid: d.pid, host: d.host, executavel: String(d.executavel ?? ''), script: String(d.script ?? ''),
      versao: String(d.versao ?? ''), projeto: typeof d.projeto === 'string' && d.projeto ? d.projeto : null, em: String(d.em ?? '')};
  } catch {
    return null;
  }
};

export const processoVivo = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** A descoberta de um app vivo, ou null (app fechado, ou morto sem apagar o arquivo). Não confere o nome da máquina: o
 *  arquivo mora na pasta de dados local, e no Mac o nome muda com a rede (o app aberto passaria por fechado). Um pid vivo
 *  que não é o app só leva a um token recusado, que o MCP trata. */
export const descobertaViva = (arquivo: string, o: {vivo?: (pid: number) => boolean} = {}): Descoberta | null => {
  const d = lerDescoberta(arquivo);
  if (!d) return null;
  if (!(o.vivo ?? processoVivo)(d.pid)) return null;
  return d;
};

// ---------- claude_desktop_config.json ----------

export type ServidorClaude = {command: string; args: string[]; env: Record<string, string>};
type Objeto = Record<string, unknown>;
export type Resultado = {texto: string | null; aviso?: string};

const ehObjeto = (x: unknown): x is Objeto => typeof x === 'object' && x !== null && !Array.isArray(x);
const json = (o: unknown) => `${JSON.stringify(o, null, 2)}\n`;
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A entrada "estudio": o próprio executável do Estúdio em modo Node rodando o desktop.cjs (sem node no sistema). */
export const servidorClaudeDesktop = (i: Instalacao): ServidorClaude => ({command: i.executavel, args: [i.script], env: {ELECTRON_RUN_AS_NODE: '1'}});

/** O "estudio" foi escrito pelo Estúdio (e pode ser refeito ou tirado): roda o desktop.cjs, ou a ponte antiga dos apps de fora. */
export const ehDoEstudio = (s: unknown) => ehObjeto(s) && Array.isArray(s.args)
  && s.args.some((a) => typeof a === 'string' && [SCRIPT_DESKTOP, 'ponte.cjs'].includes(path.win32.basename(a)));

const lerConfig = (atual: string): {obj: Objeto} | {aviso: string} => {
  try {
    const o = JSON.parse(atual.replace(/^﻿/, '')) as unknown;
    if (!ehObjeto(o)) return {aviso: `${ARQUIVO_CONFIG_CLAUDE} não é um objeto JSON; ficou como estava`};
    if (o.mcpServers !== undefined && !ehObjeto(o.mcpServers)) return {aviso: `mcpServers do ${ARQUIVO_CONFIG_CLAUDE} não é um objeto; ficou como estava`};
    return {obj: o};
  } catch {
    return {aviso: `${ARQUIVO_CONFIG_CLAUDE} não é JSON válido; ficou como estava`};
  }
};

/** Configuração com o "estudio" deste Estúdio, sem mexer nos outros servidores nem nas outras chaves. texto null: nada a gravar. */
export const configConectada = (atual: string | null, servidor: ServidorClaude): Resultado => {
  if (atual === null || !atual.trim()) return {texto: json({mcpServers: {[SERVIDOR_CLAUDE_DESKTOP]: servidor}})};
  const lido = lerConfig(atual);
  if ('aviso' in lido) return {texto: null, aviso: lido.aviso};
  const servidores = (lido.obj.mcpServers ?? {}) as Objeto;
  const antes = servidores[SERVIDOR_CLAUDE_DESKTOP];
  if (igual(antes, servidor)) return {texto: null};
  if (antes !== undefined && !ehDoEstudio(antes)) {
    return {texto: null, aviso: `já existe um servidor "${SERVIDOR_CLAUDE_DESKTOP}" no ${ARQUIVO_CONFIG_CLAUDE} que não foi o Estúdio que pôs; ficou como estava`};
  }
  return {texto: json({...lido.obj, mcpServers: {...servidores, [SERVIDOR_CLAUDE_DESKTOP]: servidor}})};
};

/** Configuração sem o "estudio" do Estúdio; um "estudio" posto à mão fica. */
export const configDesconectada = (atual: string | null): Resultado => {
  if (atual === null) return {texto: null};
  const lido = lerConfig(atual);
  if ('aviso' in lido) return {texto: null, aviso: lido.aviso};
  const servidores = (lido.obj.mcpServers ?? {}) as Objeto;
  const antes = servidores[SERVIDOR_CLAUDE_DESKTOP];
  if (antes === undefined) return {texto: null};
  if (!ehDoEstudio(antes)) return {texto: null, aviso: `o servidor "${SERVIDOR_CLAUDE_DESKTOP}" do ${ARQUIVO_CONFIG_CLAUDE} não foi o Estúdio que pôs; ficou como estava`};
  const {[SERVIDOR_CLAUDE_DESKTOP]: _tirado, ...resto} = servidores;
  return {texto: json({...lido.obj, mcpServers: resto})};
};

/** conectado: a entrada aponta para este Estúdio; desatualizado: é do Estúdio, mas de outro caminho ou versão;
 *  manual: um "estudio" que não é do Estúdio; desconectado: sem entrada; ilegivel: o arquivo não é JSON de objeto. */
export type SituacaoConfig = 'conectado' | 'desatualizado' | 'manual' | 'desconectado' | 'ilegivel';

export const situacaoDaConfig = (atual: string | null, servidor: ServidorClaude): SituacaoConfig => {
  if (atual === null || !atual.trim()) return 'desconectado';
  const lido = lerConfig(atual);
  if ('aviso' in lido) return 'ilegivel';
  const antes = ((lido.obj.mcpServers ?? {}) as Objeto)[SERVIDOR_CLAUDE_DESKTOP];
  if (antes === undefined) return 'desconectado';
  if (igual(antes, servidor)) return 'conectado';
  return ehDoEstudio(antes) ? 'desatualizado' : 'manual';
};

// ---------- projetos para escolher com o app fechado ----------

export type ProjetoListado = {nome: string; pasta: string; de: 'recente' | 'pasta'; aberto_em?: string};

const nomeDoManifesto = (pasta: string) => {
  try {
    const m = JSON.parse(readFileSync(path.join(pasta, 'estudio.json'), 'utf-8')) as {nome?: unknown};
    return typeof m.nome === 'string' && m.nome.trim() ? m.nome : path.basename(pasta);
  } catch {
    return path.basename(pasta);
  }
};

const mesmaPasta = (a: string, b: string, plataforma = process.platform) => {
  const n = (x: string) => path.resolve(x).replace(/[\\/]+$/, '');
  return plataforma === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
};

/** A pasta dos projetos escolhida nas preferências do app (pasta_projetos), se houver. */
const pastaDasPreferencias = (dados: string) => {
  try {
    const p = JSON.parse(readFileSync(path.join(dados, 'preferencias.json'), 'utf-8')) as {pasta_projetos?: unknown};
    return typeof p.pasta_projetos === 'string' && p.pasta_projetos ? p.pasta_projetos : null;
  } catch {
    return null;
  }
};

/** Os recentes do app (recentes.json, o mais novo primeiro) e as subpastas com estudio.json da pasta dos projetos (a das
 *  preferências e ~/Estudio), sem repetir e só os que ainda existem. Roda neste sistema: lê o disco de verdade. */
export const listarProjetos = (o: {dados: string; pastas: string[]}): ProjetoListado[] => {
  const r: ProjetoListado[] = [];
  const ja = (p: string) => r.some((x) => mesmaPasta(x.pasta, p));
  const ehProjeto = (p: string) => existsSync(path.join(p, 'estudio.json'));
  try {
    const l = JSON.parse(readFileSync(path.join(o.dados, 'recentes.json'), 'utf-8')) as {raiz?: unknown; aberto_em?: unknown}[];
    for (const x of Array.isArray(l) ? l : []) {
      if (typeof x?.raiz !== 'string' || ja(x.raiz) || !ehProjeto(x.raiz)) continue;
      r.push({nome: nomeDoManifesto(x.raiz), pasta: path.resolve(x.raiz), de: 'recente', ...(typeof x.aberto_em === 'string' ? {aberto_em: x.aberto_em} : {})});
    }
  } catch {
    /* sem recentes */
  }
  const pastas = [pastaDasPreferencias(o.dados), ...o.pastas].filter((p): p is string => Boolean(p));
  for (const base of pastas) {
    let nomes: string[] = [];
    try {
      nomes = readdirSync(base, {withFileTypes: true}).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    } catch {
      continue;
    }
    for (const n of nomes) {
      const p = path.join(base, n);
      if (!ja(p) && ehProjeto(p)) r.push({nome: nomeDoManifesto(p), pasta: path.resolve(p), de: 'pasta'});
    }
  }
  return r;
};

/** O projeto pedido pelo Claude: caminho de uma pasta com estudio.json, ou o nome (ou o fim do caminho) de um listado. */
export const resolverProjeto = (pedido: string, listados: ProjetoListado[]): {pasta: string; nome: string} | {erro: string} => {
  const limpo = String(pedido ?? '').trim();
  if (!limpo) return {erro: 'diga qual projeto (o nome ou a pasta que listar_projetos mostrou)'};
  if (path.isAbsolute(limpo)) {
    if (existsSync(path.join(limpo, 'estudio.json'))) return {pasta: path.resolve(limpo), nome: nomeDoManifesto(limpo)};
    return {erro: `${limpo} não é um projeto do Estúdio (não tem estudio.json)`};
  }
  const baixo = limpo.toLocaleLowerCase('pt-BR');
  const achados = listados.filter((x) => x.nome.toLocaleLowerCase('pt-BR') === baixo || path.basename(x.pasta).toLocaleLowerCase('pt-BR') === baixo);
  if (achados.length === 1) return {pasta: achados[0].pasta, nome: achados[0].nome};
  if (achados.length > 1) return {erro: `há ${achados.length} projetos chamados "${limpo}"; escolha pela pasta: ${achados.map((x) => x.pasta).join(' ou ')}`};
  return {erro: `nenhum projeto chamado "${limpo}"; use listar_projetos para ver os nomes`};
};
