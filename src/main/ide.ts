// Projetos prontos para IDE de agentes (frente IDE, docs/ide.md; harnesses, docs/harnesses.md) no app: a opção de
// Configurações › IA, os arquivos do núcleo (src/nucleo/ide.ts) e os guias (AGENTS.md e GEMINI.md, criar-projeto.ts)
// escritos ao criar ou abrir um projeto, o "Abrir no T3 Code", que roda `t3 project add` quando o CLI do T3 está no PATH,
// e o `codex mcp add` para copiar. Sem Electron aqui: main.ts passa o executável do app e o caminho do nucleo.cjs.
import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import type {EstadoIde} from '../compartilhado/api';
import {comOrigem, HARNESSES, prepararParaIde, SERVIDOR_IDE, servidorDoMcp, type ResultadoIde, type ServidorMcpStdio} from '../nucleo/ide';

/** Um executável no PATH (no Windows, com as extensões do PATHEXT); null se não houver. */
export const acharNoPath = (nome: string, env: NodeJS.ProcessEnv = process.env, plataforma: string = process.platform, existe: (p: string) => boolean = existsSync) => {
  const win = plataforma === 'win32';
  const caminho = win ? path.win32 : path.posix; // o sistema pedido, não o de quem roda (testes e CI)
  const pastas = (env.PATH ?? env.Path ?? '').split(win ? ';' : ':').filter(Boolean);
  const exts = win ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean).map((e) => e.toLowerCase()) : [''];
  for (const p of pastas) {
    for (const e of exts) {
      const c = caminho.join(p, `${nome}${e}`);
      if (existe(c)) return c;
    }
  }
  return null;
};

/** Sem a variável que faz um Electron virar Node (o T3 é Electron, e o CLI dele também roda por Node). */
const ambienteLimpo = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));

/** `t3 project add <pasta> --title <nome>`; "já existe" conta como pronto. */
export const adicionarNoT3 = (t3: string | null, raiz: string, titulo: string): Promise<{ok: boolean; mensagem: string}> => {
  if (!t3) {
    return Promise.resolve({ok: false, mensagem: `O comando t3 não está no PATH deste computador. No T3 Code, adicione a pasta como projeto (${raiz}) `
      + `ou peça numa thread: "adicione o projeto ${raiz}". Depois abra uma thread nele: o MCP estudio já vem ligado.`});
  }
  const win = process.platform === 'win32';
  // no Windows o t3 é um .cmd, que só roda pelo shell (com as aspas à mão)
  const [cmd, args] = win ? [`"${t3}"`, ['project', 'add', `"${raiz}"`, '--title', `"${titulo.replace(/"/g, '')}"`]] : [t3, ['project', 'add', raiz, '--title', titulo]];
  return new Promise((ok) => {
    execFile(cmd, args, {timeout: 30_000, windowsHide: true, shell: win, env: ambienteLimpo()}, (e, stdout, stderr) => {
      const texto = `${stdout ?? ''}\n${stderr ?? ''}`.trim();
      if (!e) return ok({ok: true, mensagem: 'Projeto adicionado ao T3 Code: ele aparece na barra lateral do T3, e as threads Claude já vêm com o MCP estudio.'});
      if (/already exists|AlreadyExists/i.test(texto)) return ok({ok: true, mensagem: 'O projeto já estava no T3 Code.'});
      ok({ok: false, mensagem: `O t3 não adicionou o projeto (o T3 Code está aberto?): ${texto.split('\n').pop() || e.message}`});
    });
  });
};

/** Um argumento para colar no terminal: entre aspas simples no Linux e no Mac (sh); no Windows, entre aspas simples do
 *  PowerShell (o terminal padrão), com a aspa simples dobrada: nada dentro delas expande (`$(...)`, `$var`, crase), ao
 *  contrário das duplas. O `--` vai entre aspas no Windows: solto, o PowerShell o engole ao chamar o codex.ps1 do npm. */
export const argumentoDoShell = (a: string, plataforma: string) => {
  if (plataforma === 'win32') return a !== '--' && /^[\w./:=+\\-]+$/.test(a) ? a : `'${a.replace(/'/g, "''")}'`;
  if (/^[\w./:=@%+,-]+$/.test(a)) return a;
  return `'${a.replace(/'/g, `'\\''`)}'`;
};

/** O `codex mcp add` do servidor deste projeto, para colar no terminal (no Windows, no PowerShell): liga o MCP na configuração da pessoa
 *  (~/.codex/config.toml, que o CLI, o app e a extensão do Codex dividem), para quem não quer marcar a pasta como
 *  confiável. Com o `--ide`, a pasta em que o Codex abrir vale no lugar do `--projeto`, se for um projeto do Estúdio. */
export const comandoCodexMcpAdd = (s: ServidorMcpStdio, plataforma: string = process.platform) => {
  const codex = comOrigem(s, HARNESSES.find((h) => h.id === 'codex')?.origem);
  const env = Object.entries(codex.env ?? {}).flatMap(([k, v]) => ['--env', `${k}=${v}`]);
  return ['codex', 'mcp', 'add', SERVIDOR_IDE, ...env, '--', codex.command, ...codex.args].map((a) => argumentoDoShell(a, plataforma)).join(' ');
};

/** O app roda de uma cópia temporária do macOS (App Translocation), e o caminho do executável não vale depois de fechar. */
export const emTranslocacao = (executavel: string) => executavel.includes('/AppTranslocation/');

/** `guias` refaz o AGENTS.md e o GEMINI.md do projeto (regerarGuias, criar-projeto.ts) e devolve os que gravou. */
export const criarIde = (o: {executavel: string; script: string; ligado: () => boolean; guias?: (raiz: string) => string[]}) => {
  let ultimo: (ResultadoIde & {raiz: string}) | undefined;
  return {
    /** Ao criar ou abrir um projeto (e ao ligar a opção): escreve ou atualiza os arquivos. Desligado, não toca em nada.
     *  Com o projeto, grava dentro da trava de escrita: o .gitignore também é mudado pelo commit e pelo MCP da IDE. */
    preparar(raiz: string, projeto?: {comTrava: <T>(f: () => T) => T}) {
      if (!o.ligado()) return null;
      // Mac aberto de Downloads sem mover (App Translocation): o executável mora numa cópia temporária que some ao fechar;
      // um .mcp.json com esse caminho quebraria na próxima abertura (docs/portes.md, seção 8)
      if (emTranslocacao(o.executavel)) {
        ultimo = {raiz, gravados: [], avisos: ['o Estúdio está rodando de uma cópia temporária do macOS (aberto de Downloads): mova o Estudio.app para Aplicativos e abra de novo para os projetos ficarem prontos para a IDE']};
        return ultimo;
      }
      const gravar = () => prepararParaIde(raiz, servidorDoMcp({executavel: o.executavel, script: o.script, projeto: raiz}), o.guias);
      let r: ResultadoIde;
      try {
        r = projeto ? projeto.comTrava(gravar) : gravar();
      } catch (e) {
        r = {gravados: [], avisos: [(e as Error).message]}; // trava ocupada por outro programa: fica para a próxima abertura
      }
      ultimo = {raiz, ...r};
      return ultimo;
    },
    estado(raiz?: string): EstadoIde {
      const doProjeto = raiz && ultimo && path.resolve(ultimo.raiz) === path.resolve(raiz) ? ultimo : undefined;
      const harnesses = HARNESSES.map((h) => ({nome: h.nome, guia: h.guia, mcp: h.mcp}));
      const comandoCodex = raiz && !emTranslocacao(o.executavel) ? comandoCodexMcpAdd(servidorDoMcp({executavel: o.executavel, script: o.script, projeto: raiz})) : undefined;
      return {ligado: o.ligado(), t3: acharNoPath('t3'), harnesses, ...(comandoCodex ? {comandoCodex} : {}),
        ...(doProjeto ? {raiz: doProjeto.raiz, gravados: doProjeto.gravados, avisos: doProjeto.avisos} : raiz ? {raiz} : {})};
    },
    abrirNoT3: (raiz: string, titulo: string) => adicionarNoT3(acharNoPath('t3'), raiz, titulo),
  };
};
