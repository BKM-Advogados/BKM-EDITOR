// Projetos prontos para IDE de agentes (frente IDE, docs/ide.md): .mcp.json, .claude/settings.local.json e t3.json
// escritos e mesclados sem apagar o que a pessoa tem, sem regravar o que não mudou, respeitando o desligar; o comando
// do MCP no app instalado e no de desenvolvimento; o --ide do nucleo.cjs; o "Abrir no T3 Code".
import {execFileSync, execSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {claudeMd, gravarPlano, planoDoProjeto} from '../src/nucleo/criar-projeto';
import {
  ARQUIVOS_IDE, gitignoreComIde, ICONE_T3, mcpJsonAtualizado, prepararParaIde, scriptDoMcp, servidorDoMcp, settingsLocalAtualizado, T3_SCHEMA, t3JsonAtualizado,
  type ServidorMcpStdio,
} from '../src/nucleo/ide';
import {acharNoPath, adicionarNoT3, criarIde} from '../src/main/ide';

const RAIZ = path.join(__dirname, '..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-ide-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));

const SERVIDOR: ServidorMcpStdio = servidorDoMcp({executavel: '/opt/Estudio/Estudio', script: '/opt/Estudio/resources/dist-mcp/nucleo.cjs', projeto: '/home/p/Estudio/Vídeo'});
const json = (t: string | null) => JSON.parse(t!) as Record<string, any>;

const projeto = (nome = 'Projeto') => {
  const pasta = path.join(mkdtempSync(path.join(tmp, 'p-')), nome);
  gravarPlano(pasta, planoDoProjeto({nome, modelo: 'video-branco'}));
  return pasta;
};
const ler = (raiz: string, rel: string) => readFileSync(path.join(raiz, rel), 'utf-8');

describe('o comando do MCP no .mcp.json', () => {
  it('app instalado: o executável do app em modo Node e o nucleo.cjs dos recursos', () => {
    const script = scriptDoMcp({empacotado: true, recursos: '/home/p/.local/opt/Estudio/resources', raizApp: '/home/p/.local/opt/Estudio/resources/app.asar'});
    expect(script).toBe('/home/p/.local/opt/Estudio/resources/dist-mcp/nucleo.cjs');
    const s = servidorDoMcp({executavel: '/home/p/.local/opt/Estudio/Estudio', script, projeto: '/home/p/Estudio/Meu vídeo'});
    expect(s).toEqual({type: 'stdio', command: '/home/p/.local/opt/Estudio/Estudio',
      args: [script, '--projeto', '/home/p/Estudio/Meu vídeo', '--autor', 'agente', '--origem', 'IDE', '--ide'], env: {ELECTRON_RUN_AS_NODE: '1'}});
  });

  it('desenvolvimento: o electron do node_modules e o dist-mcp do repositório', () => {
    const script = scriptDoMcp({empacotado: false, recursos: '/repo/node_modules/electron/dist/resources', raizApp: '/repo'});
    expect(script).toBe('/repo/dist-mcp/nucleo.cjs');
    const s = servidorDoMcp({executavel: '/repo/node_modules/electron/dist/electron', script, projeto: 'relativo/p'});
    expect(s.command).toBe('/repo/node_modules/electron/dist/electron');
    expect(s.args[2]).toBe(path.resolve('relativo/p')); // sempre absoluto
    expect(s.env).toEqual({ELECTRON_RUN_AS_NODE: '1'});
  });
});

describe('mesclar sem apagar', () => {
  it('.mcp.json: cria; com outros servidores e chaves, só põe o estudio; igual, não regrava', () => {
    expect(json(mcpJsonAtualizado(null, SERVIDOR).texto)).toEqual({mcpServers: {estudio: SERVIDOR}});
    const daPessoa = JSON.stringify({$comentario: 'meu', mcpServers: {github: {command: 'gh-mcp'}}});
    const novo = json(mcpJsonAtualizado(daPessoa, SERVIDOR).texto);
    expect(novo).toEqual({$comentario: 'meu', mcpServers: {github: {command: 'gh-mcp'}, estudio: SERVIDOR}});
    expect(mcpJsonAtualizado(JSON.stringify(novo), SERVIDOR)).toEqual({texto: null});
    expect(mcpJsonAtualizado(JSON.stringify(novo, null, 4), SERVIDOR).texto).toBeNull(); // formatação da pessoa não conta
  });

  it('.mcp.json: o estudio antigo do app (outro caminho) é refeito; o que a pessoa trocou à mão fica', () => {
    const antigo = servidorDoMcp({executavel: '/velho/electron', script: '/velho/dist-mcp/nucleo.cjs', projeto: '/pasta/original'});
    expect(json(mcpJsonAtualizado(JSON.stringify({mcpServers: {estudio: antigo}}), SERVIDOR).texto).mcpServers.estudio).toEqual(SERVIDOR);
    const http = {mcpServers: {estudio: {type: 'http', url: 'http://127.0.0.1:47815/mcp'}}};
    const r = mcpJsonAtualizado(JSON.stringify(http), SERVIDOR);
    expect(r.texto).toBeNull();
    expect(r.aviso).toContain('trocado à mão');
  });

  it('.mcp.json ilegível ou fora do formato: fica como está, com aviso', () => {
    expect(mcpJsonAtualizado('{ quebrado', SERVIDOR)).toMatchObject({texto: null, aviso: expect.stringContaining('não é JSON')});
    expect(mcpJsonAtualizado('[1]', SERVIDOR)).toMatchObject({texto: null, aviso: expect.stringContaining('não é um objeto')});
    expect(mcpJsonAtualizado('{"mcpServers": []}', SERVIDOR)).toMatchObject({texto: null, aviso: expect.stringContaining('mcpServers')});
    expect(json(mcpJsonAtualizado('\uFEFF{}', SERVIDOR).texto).mcpServers.estudio).toEqual(SERVIDOR); // BOM do Bloco de Notas
  });

  it('settings.local.json: acrescenta estudio, guarda o resto e respeita quem o desligou', () => {
    expect(json(settingsLocalAtualizado(null).texto)).toEqual({enabledMcpjsonServers: ['estudio']});
    const daPessoa = JSON.stringify({permissions: {allow: ['Bash(ls)']}, enabledMcpjsonServers: ['github']});
    expect(json(settingsLocalAtualizado(daPessoa).texto)).toEqual({permissions: {allow: ['Bash(ls)']}, enabledMcpjsonServers: ['github', 'estudio']});
    expect(settingsLocalAtualizado(JSON.stringify({enabledMcpjsonServers: ['estudio']})).texto).toBeNull();
    expect(settingsLocalAtualizado(JSON.stringify({disabledMcpjsonServers: ['estudio']})).texto).toBeNull();
    expect(settingsLocalAtualizado(JSON.stringify({enabledMcpjsonServers: 'estudio'})).aviso).toContain('não é uma lista');
  });

  it('t3.json: esquema, ícone e threads na pasta; a escolha da pessoa e os scripts ficam', () => {
    expect(json(t3JsonAtualizado(null).texto)).toEqual({$schema: T3_SCHEMA, iconPath: ICONE_T3, defaultThreadEnvMode: 'local'});
    const daPessoa = {defaultThreadEnvMode: 'worktree', scripts: [{name: 'Prévia', command: 'echo oi'}]};
    const novo = json(t3JsonAtualizado(JSON.stringify(daPessoa)).texto);
    expect(novo).toEqual({$schema: T3_SCHEMA, defaultThreadEnvMode: 'worktree', scripts: daPessoa.scripts, iconPath: ICONE_T3});
    expect(Object.keys(novo)[0]).toBe('$schema');
    expect(t3JsonAtualizado(JSON.stringify(novo)).texto).toBeNull();
  });

  it('.gitignore: as duas linhas da máquina, uma vez só', () => {
    const g = gitignoreComIde('saidas/\n')!;
    expect(g.split('\n')).toEqual(expect.arrayContaining(['saidas/', ARQUIVOS_IDE.mcp, ARQUIVOS_IDE.claude]));
    expect(gitignoreComIde(g)).toBeNull();
    expect(gitignoreComIde('saidas/')).toMatch(/^saidas\/\n# IDE/); // arquivo sem quebra no fim
    expect(gitignoreComIde('/.mcp.json\n/.claude/settings.local.json\n')).toBeNull();
  });
});

describe('no projeto', () => {
  it('cria os quatro arquivos; de novo, não grava nada; o que a pessoa tinha continua lá', () => {
    const raiz = projeto();
    mkdirSync(path.join(raiz, '.claude'), {recursive: true});
    writeFileSync(path.join(raiz, '.claude/settings.local.json'), JSON.stringify({permissions: {allow: ['Bash(ls)']}}));
    const r = prepararParaIde(raiz, SERVIDOR);
    expect(r.gravados.sort()).toEqual(['.claude/settings.local.json', '.gitignore', '.mcp.json', 't3.json']);
    expect(r.avisos).toEqual([]);
    expect(json(ler(raiz, '.claude/settings.local.json'))).toEqual({permissions: {allow: ['Bash(ls)']}, enabledMcpjsonServers: ['estudio']});
    expect(json(ler(raiz, '.mcp.json')).mcpServers.estudio).toEqual(SERVIDOR);
    expect(ler(raiz, '.gitignore')).toContain('saidas/'); // o que o app já tinha posto
    expect(prepararParaIde(raiz, SERVIDOR)).toEqual({gravados: [], avisos: []});
  });

  it('com git: o .mcp.json e o settings.local.json ficam fora; reabrir não deixa nada para commitar', () => {
    const raiz = projeto();
    const git = (...a: string[]) => execFileSync('git', a, {cwd: raiz, encoding: 'utf-8'});
    git('init', '-q');
    prepararParaIde(raiz, SERVIDOR);
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'primeiro');
    expect(git('ls-files').split('\n')).toEqual(expect.arrayContaining(['t3.json', '.gitignore', 'CLAUDE.md']));
    expect(git('ls-files')).not.toContain('.mcp.json');
    expect(git('ls-files')).not.toContain('settings.local.json');
    // o app de outro lugar (dev × instalado) reescreve o .mcp.json: nada muda para o git
    prepararParaIde(raiz, servidorDoMcp({executavel: '/outro/electron', script: '/outro/dist-mcp/nucleo.cjs', projeto: raiz}));
    prepararParaIde(raiz, SERVIDOR);
    expect(git('status', '--porcelain')).toBe('');
  });

  it('pasta que não é projeto: nada', () => {
    const vazia = mkdtempSync(path.join(tmp, 'vazia-'));
    expect(prepararParaIde(vazia, SERVIDOR)).toEqual({gravados: [], avisos: []});
    expect(existsSync(path.join(vazia, '.mcp.json'))).toBe(false);
  });

  it('desligado, não escreve; ligar escreve; desligar de novo não apaga', () => {
    const raiz = projeto();
    let ligado = false;
    const ide = criarIde({executavel: '/app/Estudio', script: '/app/resources/dist-mcp/nucleo.cjs', ligado: () => ligado});
    expect(ide.preparar(raiz)).toBeNull();
    expect(existsSync(path.join(raiz, '.mcp.json'))).toBe(false);
    expect(ide.estado(raiz)).toMatchObject({ligado: false, raiz});
    ligado = true;
    expect(ide.preparar(raiz)?.gravados).toContain('.mcp.json');
    expect(ide.estado(raiz)).toMatchObject({ligado: true, raiz, gravados: expect.arrayContaining(['t3.json'])});
    expect(json(ler(raiz, '.mcp.json')).mcpServers.estudio.args[2]).toBe(raiz);
    ligado = false;
    expect(ide.preparar(raiz)).toBeNull();
    for (const a of Object.values(ARQUIVOS_IDE)) expect(existsSync(path.join(raiz, a))).toBe(true);
  });

  it('Mac aberto de Downloads (App Translocation): não grava o caminho temporário e avisa para mover o app', () => {
    const raiz = projeto();
    const ide = criarIde({executavel: '/private/var/folders/xy/T/AppTranslocation/ABCD-1234/d/Estudio.app/Contents/MacOS/Estudio',
      script: '/private/var/folders/xy/T/AppTranslocation/ABCD-1234/d/Estudio.app/Contents/Resources/dist-mcp/nucleo.cjs', ligado: () => true});
    const r = ide.preparar(raiz);
    expect(r?.gravados).toEqual([]);
    expect(r?.avisos.join(' ')).toContain('Aplicativos');
    expect(existsSync(path.join(raiz, '.mcp.json'))).toBe(false);
    expect(ide.estado(raiz)).toMatchObject({ligado: true, raiz, avisos: [expect.stringContaining('cópia temporária')]});
  });

  it('o CLAUDE.md ensina a trabalhar pela IDE; as prévias só onde há vídeo ou animação', () => {
    const video = claudeMd(['video']);
    expect(video).toContain('## Trabalhando por uma IDE (T3 Code, Claude Code)');
    for (const f of ['ver_quadro', 'ver_cenas', 'ver_trecho']) expect(video).toContain(`\`${f}\``);
    expect(video).toContain('![o que é](caminho absoluto)');
    expect(video).toContain('Reverter');
    expect(claudeMd(['animacao'])).toContain('`ver_quadro`');
    const imagem = claudeMd(['imagem']);
    expect(imagem).toContain('## Trabalhando por uma IDE');
    expect(imagem).not.toContain('`ver_quadro`');
    const secao = video.split('## Trabalhando por uma IDE')[1];
    for (const l of secao.split('\n')) expect(l.length).toBeLessThanOrEqual(118);
  });
});

describe('o MCP por stdio com --ide', () => {
  it('a pasta de trabalho da IDE manda quando é um projeto (pasta copiada à mão leva o .mcp.json da original)', async () => {
    execSync('npm run mcp:build', {cwd: RAIZ, stdio: 'ignore'});
    const original = projeto('Original');
    const copia = projeto('Copia');
    const abrir = async (cwd: string, extra: string[]) => {
      const c = new Client({name: 'teste', version: '0'});
      await c.connect(new StdioClientTransport({command: process.execPath, args: [path.join(RAIZ, 'dist-mcp/nucleo.cjs'), '--projeto', original, ...extra], cwd, stderr: 'ignore'}));
      const r = (await c.callTool({name: 'projeto_info', arguments: {}})) as {content: {text: string}[]};
      await c.close();
      return JSON.parse(r.content[0].text).nome as string;
    };
    expect(await abrir(copia, ['--ide'])).toBe('Copia');
    expect(await abrir(copia, [])).toBe('Original'); // sem --ide, vale o --projeto, como antes
    expect(await abrir(tmp, ['--ide'])).toBe('Original'); // pasta de trabalho que não é projeto
  }, 60_000);
});

describe('Abrir no T3 Code', () => {
  it('acha o t3 no PATH (no Windows, pelo PATHEXT)', () => {
    expect(acharNoPath('t3', {PATH: '/a:/b'}, 'linux', (p) => p === '/b/t3')).toBe('/b/t3');
    expect(acharNoPath('t3', {PATH: '/a'}, 'linux', () => false)).toBeNull();
    expect(acharNoPath('t3', {Path: 'C:\\x;C:\\y', PATHEXT: '.EXE;.CMD'}, 'win32', (p) => p.endsWith(path.join('C:\\y', 't3.cmd')))).toBe(path.join('C:\\y', 't3.cmd'));
  });

  it('sem o t3, explica como adicionar à mão', async () => {
    const r = await adicionarNoT3(null, '/home/p/Estudio/Vídeo', 'Vídeo');
    expect(r.ok).toBe(false);
    expect(r.mensagem).toContain('/home/p/Estudio/Vídeo');
    expect(r.mensagem).toContain('não está no PATH');
  });

  it.skipIf(process.platform === 'win32')('roda t3 project add com a pasta e o nome; "já existe" conta como pronto', async () => {
    const pasta = mkdtempSync(path.join(tmp, 't3-'));
    const t3 = path.join(pasta, 't3');
    const log = path.join(pasta, 'args.txt');
    writeFileSync(t3, `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\n[ -n "$ELECTRON_RUN_AS_NODE" ] && exit 9\ncase "$3" in *Repetido*) echo "ProjectAlreadyExistsError: already exists" >&2; exit 1;; esac\necho ok\n`);
    chmodSync(t3, 0o755);
    const ok = await adicionarNoT3(t3, '/home/p/Estudio/Meu vídeo', 'Meu vídeo');
    expect(ok.ok).toBe(true);
    expect(readFileSync(log, 'utf-8').split('\n').slice(0, 5)).toEqual(['project', 'add', '/home/p/Estudio/Meu vídeo', '--title', 'Meu vídeo']);
    expect((await adicionarNoT3(t3, '/home/p/Repetido', 'R')).mensagem).toContain('já estava');
  });
});
