// Harnesses (docs/harnesses.md): o mesmo guia no CLAUDE.md, no AGENTS.md e no GEMINI.md, com o que a pessoa escreveu
// fora das marcas preservado; o MCP estudio no arquivo de cada harness (Gemini CLI, Antigravity, Codex, Cursor, VS Code,
// opencode), mesclado sem apagar, sem regravar o que não mudou e com a origem de cada um; o desligar que não apaga; o
// `codex mcp add` para copiar; e, com o `codex` no PATH, a prova de que o Codex lista o estudio do projeto.
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {claudeMd, gravarPlano, guiaAtualizado, guiaDoProjeto, MARCA_CLAUDE_FIM, MARCA_CLAUDE_INICIO, planoDoProjeto, regerarGuias} from '../src/nucleo/criar-projeto';
import {
  blocoToml, codexTomlAtualizado, comOrigem, configJsonAtualizado, ehDoApp, entradaDoServidor, HARNESSES, LINHAS_GITIGNORE_IDE, mcpDoHarness, prepararParaIde,
  secaoDoHarness, servidorDoMcp, type Harness, type ServidorMcpStdio,
} from '../src/nucleo/ide';
import {acharNoPath, argumentoDoShell, comandoCodexMcpAdd, criarIde} from '../src/main/ide';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-harnesses-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));

// caminhos de quem roda (o CI roda em Windows, Mac e Linux): o servidor guarda o path.resolve do projeto
const PROJETO = path.resolve('/home/p/Estudio/Vídeo');
const SERVIDOR: ServidorMcpStdio = servidorDoMcp({executavel: '/opt/Estudio/Estudio', script: '/opt/Estudio/resources/dist-mcp/nucleo.cjs', projeto: PROJETO});
const h = (id: Harness['id']) => HARNESSES.find((x) => x.id === id)!;
const json = (t: string | null) => JSON.parse(t!) as Record<string, any>;

const projeto = (nome = 'Projeto', modelo: Parameters<typeof planoDoProjeto>[0]['modelo'] = 'video-branco') => {
  const pasta = path.join(mkdtempSync(path.join(tmp, 'p-')), nome);
  gravarPlano(pasta, planoDoProjeto({nome, modelo}));
  return pasta;
};
const ler = (raiz: string, rel: string) => readFileSync(path.join(raiz, rel), 'utf-8');

describe('o guia: uma fonte, três arquivos', () => {
  it('CLAUDE.md, AGENTS.md e GEMINI.md têm o mesmo texto; só a seção do harness, no fim, muda', () => {
    const corpo = (t: string) => t.split('\n## Trabalhando ')[0];
    const [claude, agents, gemini] = (['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'] as const).map((a) => guiaDoProjeto(['video', 'imagem'], a));
    expect(claude).toBe(claudeMd(['video', 'imagem']));
    expect(corpo(agents)).toBe(corpo(claude));
    expect(corpo(gemini)).toBe(corpo(claude));
    for (const t of [claude, agents, gemini]) {
      expect(t.startsWith(MARCA_CLAUDE_INICIO)).toBe(true);
      expect(t.trimEnd().endsWith(MARCA_CLAUDE_FIM)).toBe(true);
      for (const f of ['ver_quadro', 'aplicar_patch', 'Reverter', 'listar_mudancas']) expect(t).toContain(f);
    }
    expect(agents).toContain('## Trabalhando por um agente (Codex, Cursor, VS Code, opencode, Antigravity)');
    for (const a of ['.codex/config.toml', '.cursor/mcp.json', '.vscode/mcp.json', 'opencode.json', '.agents/mcp_config.json', 'confiável']) expect(agents).toContain(a);
    expect(gemini).toContain('## Trabalhando pelo Gemini CLI');
    expect(gemini).toContain('.gemini/settings.json');
    expect(gemini).toContain('o terminal não a mostra'); // como mostrar imagem: o caminho, não o Markdown
    expect(claude).not.toContain('.codex/config.toml');
  });

  it('as seções dos harnesses cabem em 118 colunas e só falam das prévias onde há vídeo ou animação', () => {
    for (const a of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'] as const) {
      for (const l of secaoDoHarness(a, true)) expect(l.length).toBeLessThanOrEqual(118);
      expect(secaoDoHarness(a, true).join('\n')).toContain('`ver_cenas`');
      expect(secaoDoHarness(a, false).join('\n')).not.toContain('`ver_cenas`');
    }
  });

  it('AGENTS.md e GEMINI.md: o que a pessoa escreveu fora das marcas fica; o arquivo dela sem marcas ganha o guia no fim, uma vez', () => {
    const gerado = guiaDoProjeto(['video'], 'AGENTS.md');
    expect(guiaAtualizado(null, ['video'], 'AGENTS.md')).toBe(gerado);
    expect(guiaAtualizado(gerado, ['video'], 'AGENTS.md')).toBeNull();
    const comNotas = `# Minhas regras\n\nSempre em português.\n\n${gerado}\n## Depois\n\nnota final\n`;
    expect(guiaAtualizado(comNotas, ['video'], 'AGENTS.md')).toBeNull();
    // o app mudou o texto (outro módulo): só o de dentro das marcas muda
    const novo = guiaAtualizado(comNotas, ['video', 'musica'], 'AGENTS.md')!;
    expect(novo.startsWith('# Minhas regras\n\nSempre em português.\n\n')).toBe(true);
    expect(novo.endsWith('\n## Depois\n\nnota final\n')).toBe(true);
    expect(novo).toContain('## Música');
    // arquivo da pessoa, sem marcas
    const dela = '# Projeto da Ana\n\nUse sempre o kit Neutro.\n';
    const comGuia = guiaAtualizado(dela, ['video'], 'GEMINI.md')!;
    expect(comGuia.startsWith(dela.trimEnd())).toBe(true);
    expect(comGuia).toContain(MARCA_CLAUDE_INICIO);
    expect(guiaAtualizado(comGuia, ['video'], 'GEMINI.md')).toBeNull();
  });

  it('regerarGuias: grava os que faltam, não regrava o que não mudou e guarda o fim de linha CRLF', () => {
    const raiz = projeto();
    expect(regerarGuias(raiz).sort()).toEqual(['AGENTS.md', 'GEMINI.md']); // o CLAUDE.md já veio no plano
    expect(regerarGuias(raiz)).toEqual([]);
    const crlf = `# Minhas notas\r\n\r\n${ler(raiz, 'AGENTS.md').replace(/\n/g, '\r\n')}`;
    writeFileSync(path.join(raiz, 'AGENTS.md'), crlf);
    expect(regerarGuias(raiz, ['AGENTS.md'])).toEqual([]);
    const m = json(ler(raiz, 'estudio.json'));
    m.documentos.push({id: 'musica', modulo: 'musica', caminho: 'musica/musica.json', titulo: 'Música'});
    writeFileSync(path.join(raiz, 'estudio.json'), JSON.stringify(m));
    expect(regerarGuias(raiz).sort()).toEqual(['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']);
    const depois = ler(raiz, 'AGENTS.md');
    expect(depois.startsWith('# Minhas notas\r\n')).toBe(true);
    expect(depois).toContain('## Música');
    expect(depois.replace(/\r\n/g, '')).not.toContain('\n'); // tudo CRLF
  });
});

describe('o MCP de cada harness: formato, mesclagem e origem', () => {
  it('cada harness tem a sua origem no diário; o .mcp.json do Claude fica como antes, sem --origem', () => {
    expect(h('claude').origem).toBeUndefined();
    expect(json(mcpDoHarness(h('claude'), null, SERVIDOR).texto).mcpServers.estudio.args).not.toContain('--origem');
    for (const x of HARNESSES.filter((y) => y.origem)) expect(comOrigem(SERVIDOR, x.origem).args.slice(-2)).toEqual(['--origem', x.origem]);
    expect(comOrigem(comOrigem(SERVIDOR, 'Codex'), 'Cursor').args.filter((a) => a === '--origem')).toHaveLength(1);
  });

  it('Gemini CLI e Antigravity: mcpServers sem type; as outras configurações da pessoa ficam', () => {
    for (const id of ['gemini', 'antigravity'] as const) {
      const novo = json(mcpDoHarness(h(id), null, SERVIDOR).texto).mcpServers.estudio;
      expect(novo).toEqual({command: SERVIDOR.command, args: [...SERVIDOR.args, '--origem', h(id).origem], env: {ELECTRON_RUN_AS_NODE: '1'}});
    }
    const daPessoa = JSON.stringify({theme: 'GitHub', context: {fileName: ['AGENTS.md', 'GEMINI.md']}, mcpServers: {github: {command: 'gh-mcp'}}});
    const r = json(mcpDoHarness(h('gemini'), daPessoa, SERVIDOR).texto);
    expect(r.theme).toBe('GitHub');
    expect(r.context).toEqual({fileName: ['AGENTS.md', 'GEMINI.md']});
    expect(Object.keys(r.mcpServers)).toEqual(['github', 'estudio']);
    expect(mcpDoHarness(h('gemini'), JSON.stringify(r), SERVIDOR).texto).toBeNull();
  });

  it('Cursor: mcpServers com type stdio; VS Code: servers', () => {
    expect(json(mcpDoHarness(h('cursor'), null, SERVIDOR).texto).mcpServers.estudio).toMatchObject({type: 'stdio', command: SERVIDOR.command});
    const vs = json(mcpDoHarness(h('vscode'), JSON.stringify({inputs: [{id: 'tok'}], servers: {outro: {type: 'http', url: 'https://x'}}}), SERVIDOR).texto);
    expect(vs.inputs).toEqual([{id: 'tok'}]);
    expect(vs.servers.outro).toEqual({type: 'http', url: 'https://x'});
    expect(vs.servers.estudio).toMatchObject({type: 'stdio', args: expect.arrayContaining(['--origem', 'VS Code'])});
    expect(vs.mcpServers).toBeUndefined();
  });

  it('opencode: mcp.servers, o comando numa lista e environment (o formato que o `opencode mcp add` 2.x grava)', () => {
    const novo = json(mcpDoHarness(h('opencode'), null, SERVIDOR).texto);
    expect(novo).toEqual({mcp: {servers: {estudio: {type: 'local', command: [SERVIDOR.command, ...SERVIDOR.args, '--origem', 'opencode'], environment: {ELECTRON_RUN_AS_NODE: '1'}}}}});
    const daPessoa = JSON.stringify({$schema: 'https://opencode.ai/config.json', model: 'x/y', mcp: {timeout: {startup: 5000}, servers: {gh: {type: 'local', command: ['gh-mcp']}}}});
    const r = json(mcpDoHarness(h('opencode'), daPessoa, SERVIDOR).texto);
    expect(r.model).toBe('x/y');
    expect(r.mcp.timeout).toEqual({startup: 5000});
    expect(Object.keys(r.mcp.servers)).toEqual(['gh', 'estudio']);
    expect(mcpDoHarness(h('opencode'), JSON.stringify(r), SERVIDOR).texto).toBeNull();
    expect(mcpDoHarness(h('opencode'), JSON.stringify({mcp: {servers: []}}), SERVIDOR)).toMatchObject({texto: null, aviso: expect.stringContaining('mcp.servers')});
    expect(ehDoApp(r.mcp.servers.estudio)).toBe(true);
  });

  it('o estudio antigo do app é atualizado só nos campos do app; o trocado à mão fica, com aviso; o caminho do Windows também é reconhecido', () => {
    const antigo = entradaDoServidor(servidorDoMcp({executavel: '/velho/electron', script: '/velho/dist-mcp/nucleo.cjs', projeto: '/x'}), 'servers');
    const novo = entradaDoServidor(servidorDoMcp({executavel: '/novo/electron', script: '/novo/dist-mcp/nucleo.cjs', projeto: '/x'}), 'servers');
    const r = json(configJsonAtualizado(JSON.stringify({servers: {estudio: antigo}}), '.vscode/mcp.json', ['servers'], novo).texto);
    expect(r.servers.estudio).toEqual(novo);
    const http = JSON.stringify({mcpServers: {estudio: {httpUrl: 'http://127.0.0.1:47815/mcp'}}});
    expect(mcpDoHarness(h('gemini'), http, SERVIDOR)).toMatchObject({texto: null, aviso: expect.stringContaining('trocado à mão')});
    expect(ehDoApp({command: 'C:\\Program Files\\Estudio\\Estudio.exe', args: ['C:\\Program Files\\Estudio\\resources\\dist-mcp\\nucleo.cjs']})).toBe(true);
    expect(ehDoApp({command: 'npx', args: ['outro-mcp']})).toBe(false);
  });
});

describe('Codex: .codex/config.toml', () => {
  const codex = comOrigem(SERVIDOR, 'Codex');

  it('cria as tabelas [mcp_servers.estudio] e [mcp_servers.estudio.env]', () => {
    const t = codexTomlAtualizado(null, codex).texto!;
    expect(t).toBe(`${blocoToml(codex)}\n`);
    expect(t.split('\n')).toEqual(expect.arrayContaining(['[mcp_servers.estudio]', `command = ${JSON.stringify(codex.command)}`, '[mcp_servers.estudio.env]', 'ELECTRON_RUN_AS_NODE = "1"']));
    expect(t).toContain('"--origem", "Codex"');
  });

  it('caminho do Windows e aspas: escapados como texto TOML', () => {
    const win = servidorDoMcp({executavel: 'C:\\Users\\p\\AppData\\Local\\Programs\\Estudio\\Estudio.exe', script: 'C:\\x\\dist-mcp\\nucleo.cjs', projeto: PROJETO});
    const t = blocoToml(win);
    expect(t).toContain('command = "C:\\\\Users\\\\p\\\\AppData\\\\Local\\\\Programs\\\\Estudio\\\\Estudio.exe"');
    expect(blocoToml({...win, command: 'a"b\u007f'})).toContain('command = "a\\"b\\u007f"');
  });

  it('mescla: o resto do arquivo fica, igual não regrava, caminho novo troca no lugar', () => {
    const daPessoa = 'model = "gpt-5"\n\n[mcp_servers.github]\ncommand = "gh-mcp"\n';
    const um = codexTomlAtualizado(daPessoa, codex).texto!;
    expect(um.startsWith(daPessoa)).toBe(true);
    expect(codexTomlAtualizado(um, codex).texto).toBeNull();
    // a tabela do estudio no meio, com outra depois; o app mudou de lugar
    const meio = `model = "gpt-5"\n\n${blocoToml(codex)}\n\n[mcp_servers.github]\ncommand = "gh-mcp"\n`;
    const outro = comOrigem(servidorDoMcp({executavel: '/novo/Estudio', script: '/novo/resources/dist-mcp/nucleo.cjs', projeto: PROJETO}), 'Codex');
    const trocado = codexTomlAtualizado(meio, outro).texto!;
    expect(trocado).toBe(`model = "gpt-5"\n\n${blocoToml(outro)}\n\n[mcp_servers.github]\ncommand = "gh-mcp"\n`);
    expect(codexTomlAtualizado(trocado, outro).texto).toBeNull();
    expect(codexTomlAtualizado(trocado.replace(/\n/g, '\r\n'), outro).texto).toBeNull(); // CRLF do Windows: o mesmo
  });

  it('o estudio da pessoa (sem o nucleo.cjs) ou escrito de outro jeito fica como está, com aviso', () => {
    expect(codexTomlAtualizado('[mcp_servers.estudio]\nurl = "http://127.0.0.1:1/mcp"\n', codex)).toMatchObject({texto: null, aviso: expect.stringContaining('trocado à mão')});
    expect(codexTomlAtualizado('mcp_servers.estudio.command = "x"\n', codex)).toMatchObject({texto: null, aviso: expect.stringContaining('outro jeito')});
    expect(codexTomlAtualizado('[mcp_servers]\nestudio = { command = "x" }\n', codex)).toMatchObject({texto: null, aviso: expect.stringContaining('outro jeito')});
    // "estudio" como valor ou noutra tabela não conta
    expect(codexTomlAtualizado('[profiles.estudio]\nmodel = "o3"\n', codex).texto).toContain('[profiles.estudio]');
  });

  it('o comando para copiar (codex mcp add), com aspas do Linux e do Mac ou do Windows', () => {
    const s = servidorDoMcp({executavel: '/opt/Estudio/Estudio', script: '/opt/Estudio/resources/dist-mcp/nucleo.cjs', projeto: '/home/p/Meu vídeo'});
    const posix = comandoCodexMcpAdd(s, 'linux');
    expect(posix.startsWith('codex mcp add estudio --env ELECTRON_RUN_AS_NODE=1 -- /opt/Estudio/Estudio /opt/Estudio/resources/dist-mcp/nucleo.cjs --projeto ')).toBe(true);
    expect(posix).toContain(`'${path.resolve('/home/p/Meu vídeo')}'`);
    expect(posix.endsWith('--origem Codex')).toBe(true);
    const win = comandoCodexMcpAdd(servidorDoMcp({executavel: 'C:\\Program Files\\Estudio\\Estudio.exe', script: 'C:\\Program Files\\Estudio\\resources\\dist-mcp\\nucleo.cjs', projeto: PROJETO}), 'win32');
    // PowerShell: aspas simples (nada expande) e o -- entre aspas (solto, o PowerShell o engole ao chamar o codex.ps1)
    expect(win).toContain("'--' 'C:\\Program Files\\Estudio\\Estudio.exe' 'C:\\Program Files\\Estudio\\resources\\dist-mcp\\nucleo.cjs'");
  });
});

describe('no projeto: todos os harnesses de uma vez', () => {
  it('escreve o guia e o MCP de cada harness; de novo, nada; o que a pessoa tinha fica', () => {
    const raiz = projeto();
    mkdirSync(path.join(raiz, '.gemini'));
    writeFileSync(path.join(raiz, '.gemini/settings.json'), JSON.stringify({theme: 'GitHub'}));
    const guias = (r: string) => regerarGuias(r, ['AGENTS.md', 'GEMINI.md']);
    const r = prepararParaIde(raiz, SERVIDOR, guias);
    expect(r.avisos).toEqual([]);
    expect(r.gravados.sort()).toEqual(['.claude/settings.local.json', 'AGENTS.md', 'GEMINI.md', 't3.json', ...HARNESSES.map((x) => x.mcp)].sort());
    expect(json(ler(raiz, '.gemini/settings.json')).theme).toBe('GitHub');
    expect(ler(raiz, '.codex/config.toml')).toContain('[mcp_servers.estudio]');
    expect(prepararParaIde(raiz, SERVIDOR, guias)).toEqual({gravados: [], avisos: []});
  });

  it('com git: os arquivos de MCP ficam fora, os guias entram; reabrir de outro app não deixa nada para commitar', () => {
    const raiz = projeto();
    const git = (...a: string[]) => execFileSync('git', a, {cwd: raiz, encoding: 'utf-8'});
    git('init', '-q');
    const guias = (r: string) => regerarGuias(r, ['AGENTS.md', 'GEMINI.md']);
    prepararParaIde(raiz, SERVIDOR, guias);
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'primeiro');
    const versionados = git('ls-files').split('\n');
    expect(versionados).toEqual(expect.arrayContaining(['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 't3.json']));
    for (const l of LINHAS_GITIGNORE_IDE) expect(versionados).not.toContain(l);
    prepararParaIde(raiz, servidorDoMcp({executavel: '/outro/electron', script: '/outro/dist-mcp/nucleo.cjs', projeto: raiz}), guias);
    prepararParaIde(raiz, SERVIDOR, guias);
    expect(git('status', '--porcelain')).toBe('');
  });

  it('projeto antigo: o .gitignore ganha as linhas dos harnesses antes dos arquivos', () => {
    const raiz = projeto();
    writeFileSync(path.join(raiz, '.gitignore'), 'saidas/\n.mcp.json\n.claude/settings.local.json\n');
    prepararParaIde(raiz, SERVIDOR);
    const g = ler(raiz, '.gitignore').split('\n');
    for (const l of LINHAS_GITIGNORE_IDE) expect(g).toContain(l);
    expect(g.filter((l) => l === '.mcp.json')).toHaveLength(1);
  });

  it('desligado não escreve nada; ligar escreve tudo; desligar de novo não apaga', () => {
    const raiz = projeto();
    let ligado = false;
    const ide = criarIde({executavel: '/app/Estudio', script: '/app/resources/dist-mcp/nucleo.cjs', ligado: () => ligado,
      guias: (r) => regerarGuias(r, ['AGENTS.md', 'GEMINI.md'])});
    expect(ide.preparar(raiz)).toBeNull();
    for (const x of HARNESSES) expect(existsSync(path.join(raiz, x.mcp))).toBe(false);
    expect(existsSync(path.join(raiz, 'AGENTS.md'))).toBe(false);
    ligado = true;
    expect(ide.preparar(raiz)?.gravados).toEqual(expect.arrayContaining(['AGENTS.md', 'GEMINI.md', '.codex/config.toml', 'opencode.json']));
    const e = ide.estado(raiz);
    expect(e.harnesses.map((x) => x.mcp)).toEqual(HARNESSES.map((x) => x.mcp));
    expect(e.comandoCodex).toContain('codex mcp add estudio');
    ligado = false;
    expect(ide.preparar(raiz)).toBeNull();
    for (const a of ['AGENTS.md', 'GEMINI.md', ...HARNESSES.map((x) => x.mcp)]) expect(existsSync(path.join(raiz, a))).toBe(true);
  });
});

// Prova real, sem gastar cota de modelo: o Codex do PATH desta máquina lista o estudio do .codex/config.toml de um
// projeto confiável. O CODEX_HOME vai para uma pasta temporária: a configuração da pessoa não é tocada.
const codex = acharNoPath('codex');
describe.skipIf(!codex)('prova com o Codex instalado', () => {
  it('codex mcp list mostra o estudio do projeto (pasta confiável), com --origem Codex', () => {
    const raiz = projeto('Prova Codex');
    prepararParaIde(raiz, SERVIDOR);
    const casa = mkdtempSync(path.join(tmp, 'codex-home-'));
    const listar = () => JSON.parse(execFileSync(codex!, ['mcp', 'list', '--json'], {cwd: raiz, encoding: 'utf-8', env: {...process.env, CODEX_HOME: casa}, stdio: ['ignore', 'pipe', 'ignore']})) as {name: string; transport?: {args?: string[]}}[];
    expect(listar().map((s) => s.name)).not.toContain('estudio'); // sem confiar na pasta, o Codex não lê o arquivo dela
    writeFileSync(path.join(casa, 'config.toml'), `[projects.${JSON.stringify(raiz)}]\ntrust_level = "trusted"\n`);
    const estudio = listar().find((s) => s.name === 'estudio');
    expect(estudio).toBeTruthy();
    expect(JSON.stringify(estudio)).toContain('--origem');
  }, 60_000);
});

// revisão da 2.0.1: reabrir o projeto não pode apagar o que a pessoa pôs na entrada "estudio" de cada harness
describe('o que a pessoa pôs no "estudio" fica ao reabrir', () => {
  const OUTRO = servidorDoMcp({executavel: '/outro/Estudio', script: '/outro/resources/dist-mcp/nucleo.cjs', projeto: PROJETO});

  it('JSON (Gemini CLI e opencode): a chave no env, o trust, o timeout e o enabled ficam; de novo, não regrava', () => {
    const gemini = json(mcpDoHarness(h('gemini'), null, SERVIDOR).texto);
    gemini.mcpServers.estudio.env = {...gemini.mcpServers.estudio.env, GEMINI_API_KEY: 'chave-de-teste'};
    gemini.mcpServers.estudio.trust = true;
    gemini.mcpServers.estudio.timeout = 60000;
    const r = json(mcpDoHarness(h('gemini'), JSON.stringify(gemini), OUTRO).texto);
    expect(r.mcpServers.estudio).toMatchObject({command: '/outro/Estudio', trust: true, timeout: 60000,
      env: {GEMINI_API_KEY: 'chave-de-teste', ELECTRON_RUN_AS_NODE: '1'}});
    expect(r.mcpServers.estudio.args[0]).toBe('/outro/resources/dist-mcp/nucleo.cjs');
    expect(mcpDoHarness(h('gemini'), JSON.stringify(r), OUTRO).texto).toBeNull();

    const opencode = json(mcpDoHarness(h('opencode'), null, SERVIDOR).texto);
    opencode.mcp.servers.estudio.enabled = false;
    const o = json(mcpDoHarness(h('opencode'), JSON.stringify(opencode), OUTRO).texto);
    expect(o.mcp.servers.estudio.enabled).toBe(false);
    expect(o.mcp.servers.estudio.command[0]).toBe('/outro/Estudio');
  });

  it('TOML do Codex: a chave no env, o enabled e o tool_timeout_sec ficam; o comentário da tabela seguinte e o CRLF também', () => {
    const base = blocoToml(comOrigem(SERVIDOR, 'Codex')).split('\n');
    expect(base[3]).toBe('');
    const daPessoa = ['model = "o3"', '', base[0], base[1], base[2], 'enabled = false', 'tool_timeout_sec = 120', '', base[4], base[5],
      'GEMINI_API_KEY = "chave-de-teste"', '', '# servidor do GitHub', '[mcp_servers.github]', 'command = "gh-mcp"', ''].join('\r\n');
    const r = codexTomlAtualizado(daPessoa, comOrigem(OUTRO, 'Codex')).texto!;
    expect(r.replace(/\r\n/g, '')).not.toContain('\n'); // continua CRLF
    for (const linha of ['model = "o3"', 'enabled = false', 'tool_timeout_sec = 120', 'GEMINI_API_KEY = "chave-de-teste"', 'ELECTRON_RUN_AS_NODE = "1"',
      'command = "/outro/Estudio"', 'command = "gh-mcp"']) expect(r).toContain(linha);
    expect(r).toContain('\r\n\r\n# servidor do GitHub\r\n[mcp_servers.github]');
    expect(r).not.toContain('/opt/Estudio/Estudio');
    expect(r.match(/^\[mcp_servers\.estudio\.env\]/gm)).toHaveLength(1);
    expect(codexTomlAtualizado(r, comOrigem(OUTRO, 'Codex')).texto).toBeNull();
  });

  it('TOML do Codex sem a tabela do env: ela entra logo depois da principal, antes da tabela seguinte', () => {
    const base = blocoToml(comOrigem(SERVIDOR, 'Codex')).split('\n');
    const semEnv = [base[0], base[1], base[2], '', '[outra]', 'x = 1', ''].join('\n');
    const r = codexTomlAtualizado(semEnv, comOrigem(OUTRO, 'Codex')).texto!;
    expect(r.indexOf('[mcp_servers.estudio.env]')).toBeLessThan(r.indexOf('[outra]'));
    expect(r).toContain('[mcp_servers.estudio.env]\nELECTRON_RUN_AS_NODE = "1"');
  });

  it('comando do Codex para colar no Windows: aspas simples do PowerShell, nada expande', () => {
    expect(argumentoDoShell("C:\\P\\Promo $(Start-Process calc) R$50 `x` it's 100%", 'win32')).toBe("'C:\\P\\Promo $(Start-Process calc) R$50 `x` it''s 100%'");
    expect(argumentoDoShell('--', 'win32')).toBe("'--'");
    expect(argumentoDoShell('C:\\Estudio\\Estudio.exe', 'win32')).toBe('C:\\Estudio\\Estudio.exe');
    expect(argumentoDoShell('a,b', 'win32')).toBe("'a,b'"); // vírgula vira lista no PowerShell
    expect(argumentoDoShell("it's", 'linux')).toBe("'it'\\''s'");
  });
});
