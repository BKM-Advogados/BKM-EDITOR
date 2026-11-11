// Lançador da extensão do Claude Desktop (Estudio-<versão>.mcpb, docs/claude-desktop.md). O Claude Desktop roda este
// arquivo com o Node dele (no Linux, com o próprio Estúdio em modo Node: manifest.json, platform_overrides). Ele não
// traz as ferramentas: acha o Estúdio instalado e roda o MCP do próprio app (resources/dist-mcp/desktop.cjs) com o
// executável dele em modo Node, ligado aos mesmos stdin e stdout. Assim a extensão nunca fica atrás do app: atualizar o
// Estúdio atualiza as ferramentas, e o MCP lê os recursos do app (ffmpeg, Remotion, whisper) de dentro do pacote dele,
// o que o Node do Claude Desktop não conseguiria (parte deles mora no app.asar).
// Sem o Estúdio, um servidor mínimo responde com uma ferramenta só, que diz para instalar o Estúdio.
// Ordem da busca: ESTUDIO_EXECUTAVEL (e ESTUDIO_SCRIPT), o Estúdio aberto agora (arquivo de descoberta, que cobre a pasta
// de instalação escolhida à mão no Windows) e o lugar padrão de cada sistema.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import readline from 'node:readline';
import {arquivoDescoberta, caminhos, instalacoesPadrao, lerDescoberta, SCRIPT_DESKTOP, sistemaAtual, type Instalacao, type Sistema} from '../src/nucleo/claude-desktop';

declare const __VERSAO__: string;
const VERSAO = typeof __VERSAO__ === 'string' ? __VERSAO__ : '0.0.0';

/** O script do MCP ao lado de um executável informado à mão (pasta do app no Windows e no Linux, Estudio.app no Mac). */
export const scriptAoLado = (executavel: string, plataforma: string) => {
  const p = caminhos(plataforma);
  if (plataforma === 'darwin') return p.join(p.dirname(p.dirname(executavel)), 'Resources', 'dist-mcp', SCRIPT_DESKTOP);
  return p.join(p.dirname(executavel), 'resources', 'dist-mcp', SCRIPT_DESKTOP);
};

/** Os lugares onde procurar, em ordem. */
export const candidatos = (s: Sistema, descoberta: Instalacao | null): Instalacao[] => {
  const r: Instalacao[] = [];
  const exe = s.env.ESTUDIO_EXECUTAVEL;
  if (exe) r.push({executavel: exe, script: s.env.ESTUDIO_SCRIPT || scriptAoLado(exe, s.plataforma)});
  if (descoberta?.executavel && descoberta.script) r.push(descoberta);
  return [...r, ...instalacoesPadrao(s)];
};

export type Busca = {achado: Instalacao} | {antigo: Instalacao} | {nada: Instalacao[]};

/** O primeiro com executável e MCP; um executável sem o desktop.cjs é um Estúdio anterior à 2.0.1. */
export const procurar = (lista: Instalacao[], existe: (p: string) => boolean = existsSync): Busca => {
  const achado = lista.find((c) => existe(c.executavel) && existe(c.script));
  if (achado) return {achado};
  const antigo = lista.find((c) => existe(c.executavel));
  return antigo ? {antigo} : {nada: lista};
};

export const mensagemDaBusca = (b: Exclude<Busca, {achado: Instalacao}>) => ('antigo' in b
  ? `O Estúdio instalado (${b.antigo.executavel}) é anterior à versão 2.0.1 e não traz o MCP do Claude Desktop. `
    + 'Atualize o Estúdio e reinicie o Claude Desktop.'
  : 'Instale o Estúdio para usar esta extensão: não achei o app neste computador (procurei em '
    + `${b.nada.map((c) => c.executavel).join(', ')}). No Windows, rode o Estudio-Setup; no Mac, arraste o Estudio.app do DMG `
    + 'para Aplicativos; no Linux, use o instalar-linux.sh. Depois reinicie o Claude Desktop.');

/** Servidor MCP mínimo, sem dependências, para quando não há Estúdio: diz o que fazer em vez de falhar calado. */
export const servirAviso = (mensagem: string, entrada: NodeJS.ReadableStream = process.stdin, saida: NodeJS.WritableStream = process.stdout) => {
  const enviar = (o: unknown) => saida.write(`${JSON.stringify(o)}\n`);
  const ferramenta = {name: 'estudio_instalar', description: mensagem, inputSchema: {type: 'object', properties: {}}, annotations: {readOnlyHint: true}};
  return readline.createInterface({input: entrada}).on('line', (l) => {
    let m: {id?: string | number | null; method?: string; params?: {protocolVersion?: string}};
    try {
      m = JSON.parse(l);
    } catch {
      return;
    }
    if (m.id === undefined || m.id === null) return; // notificação
    const responder = (result: unknown) => enviar({jsonrpc: '2.0', id: m.id, result});
    if (m.method === 'initialize') {
      return responder({protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: {tools: {}},
        serverInfo: {name: 'estudio', version: VERSAO}, instructions: mensagem});
    }
    if (m.method === 'ping') return responder({});
    if (m.method === 'tools/list') return responder({tools: [ferramenta]});
    if (m.method === 'tools/call') return responder({isError: true, content: [{type: 'text', text: mensagem}]});
    enviar({jsonrpc: '2.0', id: m.id, error: {code: -32601, message: `método não atendido sem o Estúdio: ${m.method}`}});
  });
};

/** O que o server/index.js da extensão roda (mcpb/index.ts). */
export const principal = () => {
  const s = sistemaAtual();
  const d = lerDescoberta(arquivoDescoberta(s));
  const busca = procurar(candidatos(s, d ? {executavel: d.executavel, script: d.script} : null));
  if (!('achado' in busca)) {
    const msg = mensagemDaBusca(busca);
    process.stderr.write(`estudio (extensão ${VERSAO}): ${msg}\n`);
    servirAviso(msg);
    return;
  }
  const {executavel, script} = busca.achado;
  process.stderr.write(`estudio (extensão ${VERSAO}): usando ${executavel}\n`);
  const filho = spawn(executavel, [script], {stdio: 'inherit', windowsHide: true, env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}});
  filho.on('error', (e) => {
    const msg = `O Estúdio em ${executavel} não abriu (${e.message}). Reinstale o Estúdio e reinicie o Claude Desktop.`;
    process.stderr.write(`estudio: ${msg}\n`);
    servirAviso(msg);
  });
  filho.on('exit', (codigo, sinal) => process.exit(codigo ?? (sinal ? 1 : 0)));
  for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sinal, () => filho.kill(sinal));
};

