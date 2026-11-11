// Claude Desktop (docs/claude-desktop.md): os caminhos de cada sistema (pelo sistema pedido, não pelo de quem roda), a
// mesclagem do claude_desktop_config.json com arquivos de verdade, o arquivo de descoberta, a lista de projetos, o
// lançador da extensão e o manifesto .mcpb contra o esquema oficial (testes/fixtures/mcpb-manifest-v0.3.schema.json,
// cópia de github.com/modelcontextprotocol/mcpb/schemas, licença MIT/Apache-2.0).
import {mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import os, {tmpdir} from 'node:os';
import path from 'node:path';
import Ajv from 'ajv';
import {afterAll, beforeEach, describe, expect, it} from 'vitest';
import {
  arquivoConfigClaude, arquivoDescoberta, configConectada, configDesconectada, descobertaViva, ehDoEstudio, instalacoesPadrao, lerDescoberta,
  listarProjetos, pastaDadosEstudio, pastaDoClaude, resolverProjeto, servidorClaudeDesktop, situacaoDaConfig, type Sistema,
} from '../src/nucleo/claude-desktop';
import {criarClaudeDesktop, temExtensao} from '../src/main/claude-desktop';
import {candidatos, mensagemDaBusca, procurar, scriptAoLado} from '../mcpb/lancador';
import {deszipar, zipar} from '../mcpb/zip';

const RAIZ = path.join(__dirname, '..');
const tmp: string[] = [];
const pastaTemp = (nome: string) => {
  const p = mkdtempSync(path.join(tmpdir(), `estudio-cd-${nome}-`));
  tmp.push(p);
  return p;
};
afterAll(() => {
  for (const p of tmp) rmSync(p, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
});

const WIN: Sistema = {plataforma: 'win32', home: 'C:\\Users\\ana', env: {APPDATA: 'C:\\Users\\ana\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local'}};
const MAC: Sistema = {plataforma: 'darwin', home: '/Users/ana', env: {}};
const LIN: Sistema = {plataforma: 'linux', home: '/home/ana', env: {}};

describe('caminhos de cada sistema', () => {
  it('pasta do Claude Desktop e do arquivo de configuração', () => {
    expect(pastaDoClaude(WIN)).toBe('C:\\Users\\ana\\AppData\\Roaming\\Claude');
    expect(arquivoConfigClaude(WIN)).toBe('C:\\Users\\ana\\AppData\\Roaming\\Claude\\claude_desktop_config.json');
    expect(arquivoConfigClaude(MAC)).toBe('/Users/ana/Library/Application Support/Claude/claude_desktop_config.json');
    expect(arquivoConfigClaude(LIN)).toBe('/home/ana/.config/Claude/claude_desktop_config.json');
    expect(pastaDoClaude({...LIN, env: {XDG_CONFIG_HOME: '/x/cfg'}})).toBe('/x/cfg/Claude');
    // sem APPDATA no ambiente, o lugar padrão dentro do perfil
    expect(pastaDoClaude({...WIN, env: {}})).toBe('C:\\Users\\ana\\AppData\\Roaming\\Claude');
  });

  it('pasta de dados do Estúdio (userData) e o arquivo de descoberta', () => {
    expect(pastaDadosEstudio(WIN)).toBe('C:\\Users\\ana\\AppData\\Roaming\\Estudio');
    expect(arquivoDescoberta(MAC)).toBe('/Users/ana/Library/Application Support/Estudio/claude-desktop.json');
    expect(arquivoDescoberta(LIN)).toBe('/home/ana/.config/Estudio/claude-desktop.json');
  });

  it('onde cada instalador põe o Estúdio, com o executável e o desktop.cjs dos recursos', () => {
    expect(instalacoesPadrao(WIN)).toEqual([{executavel: 'C:\\Users\\ana\\AppData\\Local\\Programs\\Estudio\\Estudio.exe',
      script: 'C:\\Users\\ana\\AppData\\Local\\Programs\\Estudio\\resources\\dist-mcp\\desktop.cjs'}]);
    expect(instalacoesPadrao(MAC)).toEqual([
      {executavel: '/Applications/Estudio.app/Contents/MacOS/Estudio', script: '/Applications/Estudio.app/Contents/Resources/dist-mcp/desktop.cjs'},
      {executavel: '/Users/ana/Applications/Estudio.app/Contents/MacOS/Estudio', script: '/Users/ana/Applications/Estudio.app/Contents/Resources/dist-mcp/desktop.cjs'},
    ]);
    expect(instalacoesPadrao(LIN)).toEqual([{executavel: '/home/ana/.local/opt/Estudio/Estudio', script: '/home/ana/.local/opt/Estudio/resources/dist-mcp/desktop.cjs'}]);
  });
});

describe('lançador da extensão: achar o Estúdio', () => {
  const existe = (lista: string[]) => (p: string) => lista.includes(p);

  it('acha a instalação padrão de cada sistema', () => {
    for (const s of [WIN, MAC, LIN]) {
      const [padrao] = instalacoesPadrao(s);
      expect(procurar(candidatos(s, null), existe([padrao.executavel, padrao.script]))).toEqual({achado: padrao});
    }
  });

  it('no Mac, também em ~/Applications', () => {
    const [, doUsuario] = instalacoesPadrao(MAC);
    expect(procurar(candidatos(MAC, null), existe([doUsuario.executavel, doUsuario.script]))).toEqual({achado: doUsuario});
  });

  it('a pasta escolhida à mão no instalador do Windows vem pela descoberta do app aberto, antes do lugar padrão', () => {
    const outra = {executavel: 'D:\\Apps\\Estudio\\Estudio.exe', script: 'D:\\Apps\\Estudio\\resources\\dist-mcp\\desktop.cjs'};
    const [padrao] = instalacoesPadrao(WIN);
    expect(procurar(candidatos(WIN, outra), existe([outra.executavel, outra.script, padrao.executavel, padrao.script]))).toEqual({achado: outra});
  });

  it('ESTUDIO_EXECUTAVEL manda, com o script ao lado pelo sistema pedido', () => {
    expect(scriptAoLado('D:\\E\\Estudio.exe', 'win32')).toBe('D:\\E\\resources\\dist-mcp\\desktop.cjs');
    expect(scriptAoLado('/Apps/Estudio.app/Contents/MacOS/Estudio', 'darwin')).toBe('/Apps/Estudio.app/Contents/Resources/dist-mcp/desktop.cjs');
    expect(scriptAoLado('/opt/E/Estudio', 'linux')).toBe('/opt/E/resources/dist-mcp/desktop.cjs');
    const s = {...LIN, env: {ESTUDIO_EXECUTAVEL: '/opt/E/Estudio'}};
    expect(candidatos(s, null)[0]).toEqual({executavel: '/opt/E/Estudio', script: '/opt/E/resources/dist-mcp/desktop.cjs'});
  });

  it('sem o Estúdio, a mensagem manda instalar; com um Estúdio antigo (sem desktop.cjs), manda atualizar', () => {
    const nada = procurar(candidatos(WIN, null), () => false);
    expect('nada' in nada).toBe(true);
    expect(mensagemDaBusca(nada as {nada: never[]})).toMatch(/^Instale o Estúdio/);
    const [padrao] = instalacoesPadrao(LIN);
    const antigo = procurar(candidatos(LIN, null), existe([padrao.executavel]));
    expect(antigo).toEqual({antigo: padrao});
    expect(mensagemDaBusca(antigo as {antigo: typeof padrao})).toMatch(/anterior à versão 2\.0\.1.*Atualize o Estúdio/);
  });
});

describe('claude_desktop_config.json (funções puras)', () => {
  const srv = servidorClaudeDesktop({executavel: '/opt/E/Estudio', script: '/opt/E/resources/dist-mcp/desktop.cjs'});

  it('a entrada roda o executável do Estúdio em modo Node', () => {
    expect(srv).toEqual({command: '/opt/E/Estudio', args: ['/opt/E/resources/dist-mcp/desktop.cjs'], env: {ELECTRON_RUN_AS_NODE: '1'}});
    expect(ehDoEstudio(srv)).toBe(true);
    expect(ehDoEstudio({command: 'C:\\E\\Estudio.exe', args: ['C:\\E\\resources\\dist-mcp\\ponte.cjs']})).toBe(true); // a ponte antiga
    expect(ehDoEstudio({command: 'npx', args: ['outro-servidor']})).toBe(false);
  });

  it('arquivo novo, igual, ilegível, de outro programa e desconectar', () => {
    const novo = configConectada(null, srv).texto!;
    expect(JSON.parse(novo)).toEqual({mcpServers: {estudio: srv}});
    expect(configConectada(novo, srv)).toEqual({texto: null});
    expect(situacaoDaConfig(novo, srv)).toBe('conectado');
    expect(configConectada('{ quebrado', srv)).toMatchObject({texto: null, aviso: expect.stringMatching(/não é JSON válido/)});
    expect(configConectada('{"mcpServers": []}', srv).aviso).toMatch(/não é um objeto/);
    const manual = JSON.stringify({mcpServers: {estudio: {command: 'npx', args: ['outro']}}});
    expect(configConectada(manual, srv).aviso).toMatch(/não foi o Estúdio que pôs/);
    expect(situacaoDaConfig(manual, srv)).toBe('manual');
    expect(configDesconectada(manual).texto).toBeNull();
    expect(JSON.parse(configDesconectada(novo).texto!)).toEqual({mcpServers: {}});
    expect(configDesconectada(null)).toEqual({texto: null});
    const outro = servidorClaudeDesktop({executavel: '/velho/Estudio', script: '/velho/resources/dist-mcp/desktop.cjs'});
    expect(situacaoDaConfig(JSON.stringify({mcpServers: {estudio: outro}}), srv)).toBe('desatualizado');
    // BOM do Bloco de Notas
    expect(configConectada(`\uFEFF${novo}`, srv)).toEqual({texto: null});
  });
});

describe('claude_desktop_config.json com arquivos de verdade (o botão do app)', () => {
  let home = '';
  let sistema: Sistema;
  let arquivo = '';
  const exe = path.join('/opt', 'Estudio', 'Estudio');
  const script = path.join('/opt', 'Estudio', 'resources', 'dist-mcp', 'desktop.cjs');
  const cd = () => criarClaudeDesktop({dados: path.join(home, 'dados'), executavel: exe, script, versao: '2.0.1', mcp: () => null, url: () => null, sistema});

  beforeEach(() => {
    home = pastaTemp('home');
    sistema = {plataforma: process.platform, home, env: {APPDATA: path.join(home, 'Roaming'), XDG_CONFIG_HOME: path.join(home, '.config')}};
    arquivo = arquivoConfigClaude(sistema);
  });

  it('sem arquivo: cria a pasta e o arquivo; o estado diz conectado', () => {
    const e = cd().conectar();
    expect(e).toMatchObject({situacao: 'conectado', arquivo, claude_encontrado: true, extensao: false, translocado: false});
    expect(JSON.parse(readFileSync(arquivo, 'utf-8')).mcpServers.estudio).toEqual(servidorClaudeDesktop({executavel: exe, script}));
  });

  it('mescla sem apagar o que existe, não regrava quando nada mudou e desconecta deixando o resto', async () => {
    mkdirSync(path.dirname(arquivo), {recursive: true});
    const original = {globalShortcut: 'Ctrl+Space', preferences: {menuBarEnabled: false},
      mcpServers: {filesystem: {command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/ana']}}};
    writeFileSync(arquivo, JSON.stringify(original, null, 2));
    expect(cd().estado().situacao).toBe('desconectado');
    expect(cd().conectar().situacao).toBe('conectado');
    const depois = JSON.parse(readFileSync(arquivo, 'utf-8'));
    expect(depois.globalShortcut).toBe('Ctrl+Space');
    expect(depois.preferences).toEqual({menuBarEnabled: false});
    expect(depois.mcpServers.filesystem).toEqual(original.mcpServers.filesystem);
    expect(Object.keys(depois.mcpServers)).toEqual(['filesystem', 'estudio']);
    // conectar de novo: o arquivo nem é tocado
    const antes = statSync(arquivo).mtimeMs;
    const texto = readFileSync(arquivo, 'utf-8');
    await new Promise((ok) => setTimeout(ok, 30));
    expect(cd().conectar().situacao).toBe('conectado');
    expect(statSync(arquivo).mtimeMs).toBe(antes);
    expect(readFileSync(arquivo, 'utf-8')).toBe(texto);
    // desconectar tira só o estudio
    expect(cd().desconectar().situacao).toBe('desconectado');
    expect(JSON.parse(readFileSync(arquivo, 'utf-8'))).toEqual(original);
    // desconectar de novo: nada a fazer, arquivo intacto
    const t2 = statSync(arquivo).mtimeMs;
    await new Promise((ok) => setTimeout(ok, 30));
    cd().desconectar();
    expect(statSync(arquivo).mtimeMs).toBe(t2);
  });

  it('arquivo quebrado ou "estudio" posto à mão: não mexe e avisa', () => {
    mkdirSync(path.dirname(arquivo), {recursive: true});
    writeFileSync(arquivo, '{"mcpServers": {');
    expect(cd().conectar()).toMatchObject({situacao: 'ilegivel', aviso: expect.stringMatching(/não é JSON válido/)});
    expect(readFileSync(arquivo, 'utf-8')).toBe('{"mcpServers": {');
    const manual = JSON.stringify({mcpServers: {estudio: {type: 'http', url: 'http://127.0.0.1:47815/mcp'}}});
    writeFileSync(arquivo, manual);
    expect(cd().conectar()).toMatchObject({situacao: 'manual', aviso: expect.stringMatching(/não foi o Estúdio/)});
    expect(cd().desconectar().aviso).toMatch(/não foi o Estúdio/);
    expect(readFileSync(arquivo, 'utf-8')).toBe(manual);
  });

  it('a entrada de outra cópia do Estúdio (app movido) é trocada pela deste', () => {
    mkdirSync(path.dirname(arquivo), {recursive: true});
    const velho = servidorClaudeDesktop({executavel: '/velho/Estudio', script: '/velho/resources/dist-mcp/desktop.cjs'});
    writeFileSync(arquivo, JSON.stringify({mcpServers: {estudio: velho}}));
    expect(cd().estado().situacao).toBe('desatualizado');
    expect(cd().conectar().situacao).toBe('conectado');
  });

  it('Mac rodando de Downloads (App Translocation): não grava um caminho que vai sumir', () => {
    const tr = criarClaudeDesktop({dados: home, executavel: '/private/var/folders/x/T/AppTranslocation/AB/d/Estudio.app/Contents/MacOS/Estudio',
      script: '/private/var/folders/x/T/AppTranslocation/AB/d/Estudio.app/Contents/Resources/dist-mcp/desktop.cjs', versao: '2.0.1', mcp: () => null,
      url: () => null, sistema});
    expect(tr.conectar()).toMatchObject({translocado: true, situacao: 'desconectado', aviso: expect.stringMatching(/Aplicativos/)});
  });

  it('acha a extensão .mcpb instalada pelo nome da pasta, também a de uma versão antiga com outro autor no manifesto', () => {
    const pasta = pastaDoClaude(sistema);
    expect(temExtensao(pasta)).toBe(false);
    const antiga = path.join(pasta, 'Claude Extensions', 'local.mcpb.autor-antigo.estudio');
    mkdirSync(antiga, {recursive: true});
    expect(temExtensao(pasta)).toBe(true);
    rmSync(antiga, {recursive: true});
    expect(temExtensao(pasta)).toBe(false);
    mkdirSync(path.join(pasta, 'Claude Extensions', 'local.mcpb.estudio.estudio'), {recursive: true});
    expect(temExtensao(pasta)).toBe(true);
    expect(cd().estado().extensao).toBe(true);
  });
});

describe('arquivo de descoberta', () => {
  it('o app publica a porta, o token só do Claude Desktop e o projeto; só o usuário lê; ao fechar, apaga', () => {
    const dados = pastaTemp('dados');
    const fixos = new Map<string, string>();
    const mcp = {registrarFixo: (t: string, o: string) => fixos.set(t, o), esquecerFixo: (t: string) => fixos.delete(t)};
    const cd = criarClaudeDesktop({dados, executavel: '/opt/E/Estudio', script: '/opt/E/resources/dist-mcp/desktop.cjs', versao: '2.0.1',
      mcp: () => mcp, url: () => 'http://127.0.0.1:4321'});
    expect(cd.publicar()).toBe(true);
    const d = lerDescoberta(cd.arquivoDescoberta)!;
    expect(d).toMatchObject({formato: 1, url: 'http://127.0.0.1:4321/mcp', pid: process.pid, host: os.hostname(), executavel: '/opt/E/Estudio', projeto: null});
    expect(fixos.get(d.token)).toBe('Claude Desktop');
    if (process.platform !== 'win32') expect(statSync(cd.arquivoDescoberta).mode & 0o777).toBe(0o600);
    // abrir um projeto: o mesmo token, com o projeto
    cd.publicar(path.join(dados, 'Projeto'));
    const d2 = lerDescoberta(cd.arquivoDescoberta)!;
    expect(d2.token).toBe(d.token);
    expect(d2.projeto).toBe(path.resolve(dados, 'Projeto'));
    cd.publicar(null);
    expect(lerDescoberta(cd.arquivoDescoberta)!.projeto).toBeNull();
    // viva só com o processo vivo e nesta máquina
    expect(descobertaViva(cd.arquivoDescoberta)).not.toBeNull();
    expect(descobertaViva(cd.arquivoDescoberta, {vivo: () => false})).toBeNull();
    expect(descobertaViva(cd.arquivoDescoberta, {host: 'outra-maquina'})).toBeNull();
    cd.retirar();
    expect(lerDescoberta(cd.arquivoDescoberta)).toBeNull();
    expect(fixos.size).toBe(0);
  });

  it('outro Estúdio que publicou depois não perde o arquivo; endereço que não é desta máquina é recusado', () => {
    const dados = pastaTemp('dados2');
    const mcp = {registrarFixo: () => undefined, esquecerFixo: () => undefined};
    const a = criarClaudeDesktop({dados, executavel: 'a', script: 'a', versao: '1', mcp: () => mcp, url: () => 'http://127.0.0.1:1'});
    const b = criarClaudeDesktop({dados, executavel: 'b', script: 'b', versao: '1', mcp: () => mcp, url: () => 'http://127.0.0.1:2'});
    a.publicar();
    b.publicar();
    a.retirar();
    expect(lerDescoberta(b.arquivoDescoberta)?.executavel).toBe('b');
    const arq = path.join(dados, 'claude-desktop.json');
    writeFileSync(arq, JSON.stringify({...lerDescoberta(arq), url: 'http://10.0.0.5:47815/mcp'}));
    expect(lerDescoberta(arq)).toBeNull();
    writeFileSync(arq, 'quebrado');
    expect(lerDescoberta(arq)).toBeNull();
  });

  it('sem o servidor do app ainda (antes do ready), não publica', () => {
    const cd = criarClaudeDesktop({dados: pastaTemp('dados3'), executavel: 'a', script: 'a', versao: '1', mcp: () => null, url: () => null});
    expect(cd.publicar()).toBe(false);
  });
});

describe('projetos para escolher com o app fechado', () => {
  it('recentes primeiro, depois as pastas (a das preferências e ~/Estudio), sem repetir e só os que existem', () => {
    const casa = pastaTemp('casa');
    const dados = path.join(casa, 'dados');
    const estudio = path.join(casa, 'Estudio');
    const outra = path.join(casa, 'Outra');
    const criar = (p: string, nome: string) => {
      mkdirSync(p, {recursive: true});
      writeFileSync(path.join(p, 'estudio.json'), JSON.stringify({formato: 1, nome, documentos: []}));
    };
    criar(path.join(estudio, 'Reels'), 'Reels de março');
    criar(path.join(estudio, 'Carrossel'), 'Carrossel LGPD');
    criar(path.join(outra, 'Vinheta'), 'Vinheta');
    mkdirSync(path.join(estudio, 'trilhas'), {recursive: true}); // pasta comum, sem estudio.json
    mkdirSync(dados, {recursive: true});
    writeFileSync(path.join(dados, 'recentes.json'), JSON.stringify([
      {raiz: path.join(estudio, 'Reels'), nome: 'antigo', aberto_em: '2026-11-10T10:00:00.000Z'},
      {raiz: path.join(casa, 'Apagado'), nome: 'Apagado', aberto_em: '2026-11-09T10:00:00.000Z'},
    ]));
    writeFileSync(path.join(dados, 'preferencias.json'), JSON.stringify({pasta_projetos: outra}));
    const l = listarProjetos({dados, pastas: [estudio]});
    expect(l.map((x) => [x.nome, x.de])).toEqual([['Reels de março', 'recente'], ['Vinheta', 'pasta'], ['Carrossel LGPD', 'pasta']]);
    expect(resolverProjeto('carrossel lgpd', l)).toEqual({pasta: path.resolve(estudio, 'Carrossel'), nome: 'Carrossel LGPD'});
    expect(resolverProjeto('Vinheta', l)).toMatchObject({pasta: path.resolve(outra, 'Vinheta')});
    expect(resolverProjeto(path.join(estudio, 'Reels'), l)).toMatchObject({nome: 'Reels de março'});
    expect(resolverProjeto(path.join(estudio, 'trilhas'), l)).toMatchObject({erro: expect.stringMatching(/não é um projeto/)});
    expect(resolverProjeto('Nenhum', l)).toMatchObject({erro: expect.stringMatching(/listar_projetos/)});
    expect(resolverProjeto('', l)).toMatchObject({erro: expect.any(String)});
    // sem recentes nem pastas: lista vazia, sem erro
    expect(listarProjetos({dados: path.join(casa, 'nada'), pastas: [path.join(casa, 'nada')]})).toEqual([]);
  });
});

describe('a extensão .mcpb', () => {
  const manifesto = JSON.parse(readFileSync(path.join(RAIZ, 'mcpb', 'manifest.json'), 'utf-8'));

  it('o manifesto passa no esquema oficial (MCPB 0.3) e acompanha a versão do app', () => {
    const esquema = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'mcpb-manifest-v0.3.schema.json'), 'utf-8'));
    const validar = new Ajv({allErrors: true, strict: false, logger: false}).compile(esquema);
    expect(validar(manifesto), JSON.stringify(validar.errors)).toBe(true);
    expect(validar({...manifesto, server: {...manifesto.server, type: 'deno'}})).toBe(false); // o esquema pega erro de verdade
    expect(manifesto.manifest_version).toBe('0.3');
    expect(manifesto.version).toBe(JSON.parse(readFileSync(path.join(RAIZ, 'package.json'), 'utf-8')).version);
    expect(manifesto.server).toMatchObject({type: 'node', entry_point: 'server/index.js',
      mcp_config: {command: 'node', args: ['${__dirname}/server/index.js']}});
    // no Linux o Claude Desktop pode não ter Node próprio: o lançador roda com o Estúdio em modo Node
    expect(manifesto.server.mcp_config.platform_overrides.linux).toEqual({command: '${HOME}/.local/opt/Estudio/Estudio',
      args: ['${__dirname}/server/index.js'], env: {ELECTRON_RUN_AS_NODE: '1'}});
    expect(manifesto.compatibility.platforms.sort()).toEqual(['darwin', 'linux', 'win32']);
  });

  it('o zip do .mcpb volta igual (nomes com acento, deflate e CRC)', () => {
    const entradas = [{nome: 'manifest.json', dados: Buffer.from('{"nome":"Estúdio"}')}, {nome: 'server/índice.js', dados: Buffer.alloc(5000, 'a')}];
    expect(deszipar(zipar(entradas))).toEqual(entradas);
    const z = zipar(entradas);
    z[z.indexOf(Buffer.from('manifest.json')) + 20] ^= 0xff; // estraga um byte dos dados comprimidos
    expect(() => deszipar(z)).toThrow();
  });
});
