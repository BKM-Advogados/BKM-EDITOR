// Frente 2 do MCP (src/nucleo/mcp-projeto.ts, importar-midia.ts, novo-projeto.ts): importar_midia com a regra do botão da
// tela, renomear_documento, marcar_ponto_de_restauracao (o Ctrl+S) e as ferramentas de trocar de projeto: no app (McpHttp,
// só para as conexões de fora e também sem projeto aberto), no servidor do Claude Desktop com o app fechado e aberto, e no
// MCP da IDE com o app fechado. Tudo em pasta temporária, sem build e sem o Electron.
import {execFileSync} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {ElicitRequestSchema, type JSONRPCMessage} from '@modelcontextprotocol/sdk/types.js';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {importarMidia, pastaDeImportacao, tipoDaExtensao} from '../src/nucleo/importar-midia';
import {definirMedidorDeEnvelope, definirPontoDeRestauracao, fixoNaPastaDaIde, mensagemDoPonto, registrarTrocaDeProjeto, trocadorSemApp,
  type TrocadorDeProjeto} from '../src/nucleo/mcp-projeto';
import {duplicarPastaDoProjeto, formatoDoPedido, resumoDoProjeto} from '../src/nucleo/novo-projeto';
import {criarServidorDesktop} from '../src/nucleo/mcp-desktop';
import {descobertaViva} from '../src/nucleo/claude-desktop';
import {encaminharAoApp} from '../src/nucleo/mcp-app';
import {classeDe} from '../src/nucleo/portao';
import {PastaModelos} from '../src/nucleo/pasta-modelos';
import {Projeto} from '../src/nucleo/projeto';
import {McpHttp, type Perguntador} from '../src/main/mcp-http';
import {criarClaudeDesktop} from '../src/main/claude-desktop';
import {SessaoProjeto} from '../src/main/sessao-projeto';

type Res = {isError?: boolean; content: {type: string; text: string}[]};
const textoDe = (r: unknown) => (r as Res).content.map((c) => c.text).join('\n');
const jsonDe = (r: unknown) => JSON.parse((r as Res).content[0].text);

let tmp = '';
let fora = ''; // "o computador da pessoa": arquivos fora de qualquer projeto
const novoProjeto = (pai: string, nome: string) => {
  const p = path.join(pai, nome);
  cpSync(path.join(__dirname, 'fixtures', 'projeto'), p, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
  const m = JSON.parse(readFileSync(path.join(p, 'estudio.json'), 'utf-8'));
  writeFileSync(path.join(p, 'estudio.json'), JSON.stringify({...m, nome}, null, 2));
  return p;
};

/** Um servidor com as ferramentas de sempre num projeto, e o cliente ligado nele. */
const conectar = async (raiz: string, perguntar?: () => Promise<boolean>) => {
  const s = new McpServer({name: 'estudio', version: '0'});
  registrarFerramentas(s, new Projeto(raiz), 'agente', 'teste', undefined, undefined, perguntar ? {perguntar} : undefined);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await s.connect(a);
  const c = new Client({name: 'teste', version: '0'});
  await c.connect(b);
  return c;
};

beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-projeto-mcp-'));
  fora = path.join(tmp, 'fora');
  mkdirSync(fora, {recursive: true});
  writeFileSync(path.join(fora, 'Foto da Ana.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(path.join(fora, 'voz.wav'), Buffer.from('RIFF'));
  writeFileSync(path.join(fora, 'senhas.txt'), 'nada');
});

afterAll(() => rmSync(tmp, {recursive: true, force: true, maxRetries: 10, retryDelay: 100}));
afterEach(() => {
  definirMedidorDeEnvelope(null);
  definirPontoDeRestauracao(null);
});

describe('importar mídia (a mesma regra do botão da tela)', () => {
  it('copia de fora para midia/ com nome livre, numa subpasta e com outro nome; o que está no projeto fica no lugar', () => {
    const p = new Projeto(novoProjeto(tmp, 'imp-nucleo'));
    expect(importarMidia(p, path.join(fora, 'Foto da Ana.png'))).toEqual({caminho: 'midia/Foto da Ana.png', tipo: 'imagem', copiado: true});
    expect(importarMidia(p, path.join(fora, 'Foto da Ana.png')).caminho).toBe('midia/Foto da Ana (2).png');
    expect(importarMidia(p, path.join(fora, 'voz.wav'), {pasta: 'midia/tomadas', nome: 'take 1.wav'}).caminho).toBe('midia/tomadas/take 1.wav');
    expect(existsSync(path.join(p.raiz, 'midia', 'tomadas', 'take 1.wav'))).toBe(true);
    expect(importarMidia(p, path.join(p.raiz, 'midia', 'logo.png'))).toEqual({caminho: 'midia/logo.png', tipo: 'imagem', copiado: false});
    expect(importarMidia(p, 'midia/foto.jpg').copiado).toBe(false);
  });

  it('recusa extensão fora do filtro, tipo errado, arquivo que não existe e pasta fora de midia/', () => {
    const p = new Projeto(novoProjeto(tmp, 'imp-recusa'));
    expect(() => importarMidia(p, path.join(fora, 'senhas.txt'))).toThrow(/\.txt não entra/);
    expect(() => importarMidia(p, path.join(fora, 'voz.wav'), {tipo: 'imagem'})).toThrow(/como imagem/);
    expect(() => importarMidia(p, path.join(fora, 'sumiu.png'))).toThrow(/não achado/);
    expect(() => pastaDeImportacao('../fora')).toThrow(/pasta inválida/);
    expect(pastaDeImportacao(' tomadas/ ')).toBe('midia/tomadas');
    expect(tipoDaExtensao('a.MOV')).toBe('video');
    expect(readdirSync(path.join(p.raiz, 'midia')).sort()).toEqual(['foto.jpg', 'logo.png']);
  });

  it('midia/ ligada para fora por link: só leitura, não copia para lá', () => {
    const raiz = novoProjeto(tmp, 'imp-link');
    const outroDisco = path.join(tmp, 'outro-disco');
    mkdirSync(outroDisco);
    rmSync(path.join(raiz, 'midia'), {recursive: true});
    symlinkSync(outroDisco, path.join(raiz, 'midia'), 'junction'); // junção no Windows (sem Modo de Desenvolvedor); link no resto
    expect(() => importarMidia(new Projeto(raiz), path.join(fora, 'Foto da Ana.png'))).toThrow(/link simbólico/);
    expect(readdirSync(outroDisco)).toEqual([]);
  });

  it('pelo MCP: copia, mede o áudio quando há medidor, avisa quando não há e é cartão (negado, nada copia)', async () => {
    const raiz = novoProjeto(tmp, 'imp-mcp');
    const c = await conectar(raiz);
    const img = jsonDe(await c.callTool({name: 'importar_midia', arguments: {caminho: path.join(fora, 'Foto da Ana.png'), nome: 'ana'}}));
    expect(img).toMatchObject({ok: true, caminho: 'midia/ana.png', tipo: 'imagem', copiado: true});
    expect(img.proximo).toMatch(/src/);
    const semMedidor = jsonDe(await c.callTool({name: 'importar_midia', arguments: {caminho: path.join(fora, 'voz.wav')}}));
    expect(semMedidor.aviso).toMatch(/medidas quando o áudio entrar/);
    const medidos: string[] = [];
    definirMedidorDeEnvelope(async (_p, arquivo) => (medidos.push(arquivo), {duracao_ms: 1234}));
    const medido = jsonDe(await c.callTool({name: 'importar_midia', arguments: {caminho: path.join(fora, 'voz.wav'), pasta: 'narracao'}}));
    expect(medido).toMatchObject({caminho: 'midia/narracao/voz.wav', duracao_ms: 1234, envelope: 'midia/narracao/voz.wav.envelope.json'});
    expect(medidos).toEqual(['midia/narracao/voz.wav']);
    definirMedidorDeEnvelope(async () => {
      throw new Error('sem ffmpeg');
    });
    expect(jsonDe(await c.callTool({name: 'importar_midia', arguments: {caminho: path.join(fora, 'voz.wav')}})).aviso).toMatch(/sem ffmpeg/);
    const recusado = await c.callTool({name: 'importar_midia', arguments: {caminho: path.join(fora, 'senhas.txt')}});
    expect(recusado.isError).toBe(true);
    await c.close();

    expect(classeDe('importar_midia')).toBe('cartao');
    const negado = await conectar(novoProjeto(tmp, 'imp-negado'), async () => false);
    const r = await negado.callTool({name: 'importar_midia', arguments: {caminho: path.join(fora, 'Foto da Ana.png')}});
    expect(textoDe(r)).toMatch(/negou/);
    expect(existsSync(path.join(tmp, 'imp-negado', 'midia', 'Foto da Ana.png'))).toBe(false);
    await negado.close();
  });
});

describe('renomear documento e ponto de restauração', () => {
  it('renomear_documento muda o título no manifesto (pelo id ou pelo caminho); id e arquivo ficam', async () => {
    const raiz = novoProjeto(tmp, 'renomear');
    const c = await conectar(raiz);
    expect(jsonDe(await c.callTool({name: 'renomear_documento', arguments: {documento: 'capa', titulo: '  Capa do post  '}}))).toEqual({ok: true, id: 'capa', titulo: 'Capa do post'});
    expect(jsonDe(await c.callTool({name: 'renomear_documento', arguments: {documento: '3d/cena.json', titulo: 'Anel'}}))).toMatchObject({id: 'cena3d', titulo: 'Anel'});
    const m = new Projeto(raiz).manifesto();
    expect(m.documentos.find((d) => d.id === 'capa')).toMatchObject({titulo: 'Capa do post', caminho: 'imagem/capa.json'});
    expect((await c.callTool({name: 'renomear_documento', arguments: {documento: 'nao-existe', titulo: 'x'}})).isError).toBe(true);
    expect((await c.callTool({name: 'renomear_documento', arguments: {documento: 'capa', titulo: '   '}})).isError).toBe(true);
    expect(classeDe('renomear_documento')).toBe('livre');
    await c.close();
  });

  it('marcar_ponto_de_restauracao usa o serviço de quem roda o MCP; sem ele, diz que não há como', async () => {
    const raiz = novoProjeto(tmp, 'ponto-falso');
    const c = await conectar(raiz);
    expect(textoDe(await c.callTool({name: 'marcar_ponto_de_restauracao', arguments: {}}))).toMatch(/não tem como criar pontos/);
    const pedidos: [string, string | undefined][] = [];
    definirPontoDeRestauracao(async (r, m) => (pedidos.push([r, m]), {ok: true, mensagem: 'Ponto de restauração criado'}));
    expect(jsonDe(await c.callTool({name: 'marcar_ponto_de_restauracao', arguments: {mensagem: 'antes do roteiro novo'}}))).toEqual({ok: true, mensagem: 'Ponto de restauração criado'});
    expect(pedidos).toEqual([[raiz, 'antes do roteiro novo']]);
    expect(classeDe('marcar_ponto_de_restauracao')).toBe('livre');
    expect(mensagemDoPonto()).toBe('estúdio: ponto de restauração');
    expect(mensagemDoPonto('  antes\n do  roteiro ')).toBe('estúdio: ponto de restauração — antes do roteiro');
    await c.close();
  });

  it('com o app fechado, o ponto é um commit de verdade no git do projeto, com a mensagem', async () => {
    const raiz = novoProjeto(tmp, 'ponto-git');
    const primeiro = await SessaoProjeto.pontoSemApp(raiz, mensagemDoPonto('primeiro'));
    if (!primeiro.temGit) return; // máquina sem git: o app também não teria pontos de restauração
    expect(primeiro.ok).toBe(true);
    writeFileSync(path.join(raiz, 'imagem', 'nota.txt'), 'mudou');
    expect((await SessaoProjeto.pontoSemApp(raiz, mensagemDoPonto('depois da nota'))).ok).toBe(true);
    const log = execFileSync('git', ['log', '--format=%s'], {cwd: raiz, encoding: 'utf-8'});
    expect(log).toContain('estúdio: ponto de restauração — depois da nota');
  });
});

describe('criar e duplicar a pasta do projeto (novo-projeto.ts)', () => {
  it('formato pelo id da tela, pelo tamanho, o fixo da animação; 3D sem formato; id desconhecido é recusado', () => {
    expect(formatoDoPedido('video-branco', 'reels')).toEqual({largura: 1080, altura: 1920, fps: 30});
    expect(formatoDoPedido('imagem-branco', 'feed')).toEqual({largura: 1080, altura: 1350, fps: 30});
    expect(formatoDoPedido('video-branco', {largura: 1280, altura: 720})).toEqual({largura: 1280, altura: 720, fps: 30});
    expect(formatoDoPedido('animacao-9x16', 'quadrado')).toMatchObject({largura: 1080, altura: 1920});
    expect(formatoDoPedido('3d-branco', 'reels')).toBeUndefined();
    expect(formatoDoPedido('video-branco')).toBeUndefined();
    expect(() => formatoDoPedido('video-branco', 'cinema')).toThrow(/formato desconhecido/);
  });

  it('a cópia leva documentos e mídia, sem .git, .estudio e saidas, com o nome novo', () => {
    const raiz = novoProjeto(tmp, 'Original');
    mkdirSync(path.join(raiz, '.estudio'), {recursive: true});
    writeFileSync(path.join(raiz, '.estudio', 'diario.jsonl'), '{}\n');
    mkdirSync(path.join(raiz, 'saidas'), {recursive: true});
    writeFileSync(path.join(raiz, 'saidas', 'video.mp4'), 'x');
    const r = duplicarPastaDoProjeto(raiz);
    expect(r).toEqual({raiz: path.join(tmp, 'Original (cópia)'), nome: 'Original (cópia)'});
    expect(existsSync(path.join(r.raiz, 'midia', 'logo.png'))).toBe(true);
    expect(existsSync(path.join(r.raiz, '.estudio'))).toBe(false);
    expect(existsSync(path.join(r.raiz, 'saidas'))).toBe(false);
    expect(resumoDoProjeto(r.raiz)).toMatchObject({nome: 'Original (cópia)', documentos: [{id: 'carrossel'}, {id: 'capa'}, {id: 'cena3d'}]});
    expect(duplicarPastaDoProjeto(raiz, 'Versão B').raiz).toBe(path.join(tmp, 'Versão B'));
  });
});

// ---------- trocar de projeto ----------

const chamarApp = async (url: string, token: string, msg: Record<string, unknown>) =>
  encaminharAoApp({url, token}, {jsonrpc: '2.0', id: 7, ...msg} as JSONRPCMessage, undefined, 30_000);

describe('trocar de projeto pelo app (McpHttp)', () => {
  let servidor: http.Server;
  let url = '';
  let projetoDoApp: Projeto | null = null;
  const pedidos: Parameters<Perguntador>[0][] = [];
  const chamadas: string[] = [];
  let mcp: McpHttp;

  beforeAll(async () => {
    const pasta = path.join(tmp, 'app-troca');
    mkdirSync(pasta);
    const alfa = novoProjeto(pasta, 'Alfa');
    const beta = novoProjeto(pasta, 'Beta');
    projetoDoApp = new Projeto(alfa);
    mcp = new McpHttp(path.join(tmp, 'cfg-troca'), () => projetoDoApp, undefined, async (p) => (pedidos.push(p), {permitir: true}));
    // o "main.ts": troca o projeto do app e devolve o resumo
    mcp.definirTrocador((quem): TrocadorDeProjeto => ({
      criar: async (o) => (chamadas.push(`criar ${o.nome} ${quem.ide ? 'ide' : 'fora'}`), {ok: true}),
      abrir: async (pedido) => {
        chamadas.push(`abrir ${pedido}`);
        projetoDoApp = new Projeto(pedido === 'Beta' ? beta : alfa);
        return {ok: true, ...resumoDoProjeto(projetoDoApp.raiz)};
      },
      duplicar: async () => (chamadas.push('duplicar'), {ok: true}),
      fechar: async () => {
        chamadas.push('fechar');
        projetoDoApp = null;
        return {ok: true};
      },
    }));
    servidor = http.createServer((req, res) => void mcp.atender(req, res).then((ok) => ok || res.writeHead(404).end()));
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    url = `http://127.0.0.1:${(servidor.address() as {port: number}).port}/mcp`;
  });

  afterAll(async () => {
    servidor.closeAllConnections();
    await new Promise((ok) => servidor.close(ok));
  });

  const nomes = async (token: string) => {
    const r = (await chamarApp(url, token, {method: 'tools/list', params: {}})) as unknown as {result: {tools: {name: string}[]}};
    return r.result.tools.map((t) => t.name);
  };

  it('a conversa de dentro do app não recebe as ferramentas de troca; as de fora (fixo e IDE) recebem', async () => {
    const aba = /^Bearer (\S+)$/.exec(mcp.novaConexao('http://x', 'claude-1').headers.Authorization)![1];
    const ide = /^Bearer (\S+)$/.exec(mcp.novaConexao('http://x', 'mcp', {ide: true}).headers.Authorization)![1];
    mcp.registrarFixo('token-fixo', 'Claude Desktop');
    expect(await nomes(aba)).toContain('importar_midia');
    expect(await nomes(aba)).not.toContain('abrir_projeto');
    expect(await nomes(ide)).toEqual(expect.arrayContaining(['criar_projeto', 'abrir_projeto', 'duplicar_projeto', 'fechar_projeto']));
    expect(await nomes('token-fixo')).toContain('abrir_projeto');
    const r = (await chamarApp(url, ide, {method: 'tools/call', params: {name: 'criar_projeto', arguments: {nome: 'Novo'}}})) as unknown as {result: Res};
    expect(r.result.isError).toBeFalsy();
    expect(chamadas).toContain('criar Novo ide');
  });

  it('abrir e fechar pelo token fixo passam pelo portão; sem projeto, só as de troca respondem (o resto, 409)', async () => {
    pedidos.length = 0;
    const r = (await chamarApp(url, 'token-fixo', {method: 'tools/call', params: {name: 'abrir_projeto', arguments: {projeto: 'Beta'}}})) as unknown as {result: Res};
    expect(jsonDe(r.result)).toMatchObject({ok: true, nome: 'Beta'});
    expect(pedidos[0]).toMatchObject({ferramenta: 'abrir_projeto', origem: 'Claude Desktop'});
    await chamarApp(url, 'token-fixo', {method: 'tools/call', params: {name: 'fechar_projeto', arguments: {}}});
    expect(projetoDoApp).toBeNull();
    // sem projeto: ler_documento volta 409 (o Claude Desktop roda no escolhido), abrir_projeto funciona
    expect(await chamarApp(url, 'token-fixo', {method: 'tools/call', params: {name: 'projeto_info', arguments: {}}})).toBeNull();
    const aberto = (await chamarApp(url, 'token-fixo', {method: 'tools/call', params: {name: 'abrir_projeto', arguments: {projeto: 'Alfa'}}})) as unknown as {result: Res};
    expect(jsonDe(aberto.result)).toMatchObject({nome: 'Alfa'});
    expect(chamadas.slice(-3)).toEqual(['abrir Beta', 'fechar', 'abrir Alfa']);
    for (const n of ['criar_projeto', 'abrir_projeto', 'duplicar_projeto', 'fechar_projeto']) expect(classeDe(n)).toBe('cartao');
  });
});

describe('trocar de projeto pelo Claude Desktop', () => {
  let casa = '';
  let projetos = '';
  let dados = '';
  beforeAll(() => {
    casa = path.join(tmp, 'desktop');
    projetos = path.join(casa, 'Estudio');
    dados = path.join(casa, 'dados');
    mkdirSync(dados, {recursive: true});
    novoProjeto(projetos, 'Alfa');
  });

  const conectarDesktop = async (descoberta: () => ReturnType<typeof descobertaViva>, aceitar = true, modelos?: PastaModelos) => {
    const d = criarServidorDesktop({dados, pastas: [projetos], descoberta, modelos,
      registrar: (s, projeto, origem, portao) => registrarFerramentas(s, projeto, 'agente', origem, undefined, undefined, portao)});
    const [a, b] = InMemoryTransport.createLinkedPair();
    await d.servidor.connect(a);
    const c = new Client({name: 'claude-desktop-falso', version: '0'}, {capabilities: {elicitation: {}}});
    c.setRequestHandler(ElicitRequestSchema, async () => (aceitar ? {action: 'accept', content: {permitir: true}} : {action: 'decline'}));
    await c.connect(b);
    return {c, d};
  };

  it('com o app fechado: criar escolhe o projeto novo; abrir escolhe; duplicar copia o escolhido; fechar esquece', async () => {
    const {c, d} = await conectarDesktop(() => null);
    const lista = (await c.listTools()).tools.map((t) => t.name);
    expect(lista).toEqual(expect.arrayContaining(['listar_projetos', 'criar_projeto', 'abrir_projeto', 'duplicar_projeto', 'fechar_projeto', 'importar_midia']));
    const criado = jsonDe(await c.callTool({name: 'criar_projeto', arguments: {nome: 'Reels da semana', formato: 'reels'}}));
    expect(criado).toMatchObject({ok: true, nome: 'Reels da semana', pasta: path.join(projetos, 'Reels da semana'), aberto_no_app: false});
    expect(d.escolhido()).toBe(path.join(projetos, 'Reels da semana'));
    expect(jsonDe(await c.callTool({name: 'projeto_info', arguments: {}})).nome).toBe('Reels da semana');
    expect(jsonDe(await c.callTool({name: 'abrir_projeto', arguments: {projeto: 'Alfa'}}))).toMatchObject({nome: 'Alfa'});
    expect(jsonDe(await c.callTool({name: 'projeto_info', arguments: {}})).nome).toBe('Alfa');
    const copia = jsonDe(await c.callTool({name: 'duplicar_projeto', arguments: {nome: 'Alfa B'}}));
    expect(copia).toMatchObject({nome: 'Alfa B', pasta: path.join(projetos, 'Alfa B')});
    expect(jsonDe(await c.callTool({name: 'projeto_info', arguments: {}})).nome).toBe('Alfa B');
    expect(jsonDe(await c.callTool({name: 'fechar_projeto', arguments: {}}))).toMatchObject({ok: true, fechado: path.join(projetos, 'Alfa B')});
    expect(textoDe(await c.callTool({name: 'projeto_info', arguments: {}}))).toMatch(/Nenhum projeto escolhido/);
    expect((await c.callTool({name: 'abrir_projeto', arguments: {projeto: 'Nao Existe'}})).isError).toBe(true);
    await d.fechar();
  });

  it('com o app fechado, listar_modelos responde sem projeto escolhido e criar_projeto cria de um modelo seu', async () => {
    const pastaModelos = path.join(dados, 'meus-modelos');
    const modelos = new PastaModelos({pasta: () => pastaModelos});
    const {c, d} = await conectarDesktop(() => null, true, modelos);
    // sem modelo salvo: lista vazia com aviso, ainda sem projeto escolhido
    const vazio = jsonDe(await c.callTool({name: 'listar_modelos', arguments: {}}));
    expect(vazio.modelos).toEqual([]);
    expect(d.escolhido()).toBeNull();
    const m = modelos.salvar(new Projeto(path.join(projetos, 'Alfa')), {nome: 'Meu modelo'});
    const lista = jsonDe(await c.callTool({name: 'listar_modelos', arguments: {}}));
    expect(lista.modelos.map((x: {id: string}) => x.id)).toEqual([m.id]);
    expect(d.escolhido()).toBeNull();
    const criado = jsonDe(await c.callTool({name: 'criar_projeto', arguments: {modelo_proprio: m.id, nome: 'Do modelo'}}));
    expect(criado).toMatchObject({ok: true, nome: 'Do modelo', pasta: path.join(projetos, 'Do modelo')});
    expect(d.escolhido()).toBe(path.join(projetos, 'Do modelo'));
    const nada = await c.callTool({name: 'criar_projeto', arguments: {modelo_proprio: 'nao-existe'}});
    expect(nada.isError).toBe(true);
    expect(textoDe(nada)).toMatch(/modelo não achado/);
    await d.fechar();
  });

  it('com o app fechado, a pasta de modelos vem da preferência pasta_modelos do app (pasta de dados)', async () => {
    const outra = path.join(dados, 'modelos-da-preferencia');
    const m = new PastaModelos({pasta: () => outra}).salvar(new Projeto(path.join(projetos, 'Alfa')), {nome: 'Da preferência'});
    writeFileSync(path.join(dados, 'preferencias.json'), JSON.stringify({pasta_modelos: outra}), 'utf-8');
    const {c, d} = await conectarDesktop(() => null); // sem a opção modelos: lê as preferências
    const lista = jsonDe(await c.callTool({name: 'listar_modelos', arguments: {}}));
    expect(lista.modelos.map((x: {id: string}) => x.id)).toEqual([m.id]);
    const criado = jsonDe(await c.callTool({name: 'criar_projeto', arguments: {modelo_proprio: m.id, nome: 'Pela preferência'}}));
    expect(criado).toMatchObject({ok: true, nome: 'Pela preferência'});
    await d.fechar();
    rmSync(path.join(dados, 'preferencias.json'), {force: true});
  });

  it('com o app fechado, criar negado pela pessoa no Claude Desktop não grava nada', async () => {
    const {c, d} = await conectarDesktop(() => null, false);
    const r = await c.callTool({name: 'criar_projeto', arguments: {nome: 'Negado'}});
    expect(textoDe(r)).toMatch(/negou/);
    expect(existsSync(path.join(projetos, 'Negado'))).toBe(false);
    await d.fechar();
  });

  it('com o app aberto: vai ao app, que troca; a chamada seguinte segue no projeto novo sem "projeto mudou"', async () => {
    let projetoDoApp: Projeto | null = new Projeto(path.join(projetos, 'Alfa'));
    const beta = novoProjeto(projetos, 'Beta');
    const mcp = new McpHttp(path.join(casa, 'cfg-app'), () => projetoDoApp, undefined, async () => ({permitir: true}));
    const pastaDados = mkdtempSync(path.join(casa, 'dados-app-'));
    let cd: ReturnType<typeof criarClaudeDesktop>;
    mcp.definirTrocador(() => ({
      criar: async () => ({ok: true}),
      abrir: async () => {
        projetoDoApp = new Projeto(beta);
        cd.publicar(beta);
        return {ok: true, aberto_no_app: true, ...resumoDoProjeto(beta)};
      },
      duplicar: async () => ({ok: true}),
      fechar: async () => ({ok: true}),
    }));
    const servidor = http.createServer((req, res) => void mcp.atender(req, res).then((ok) => ok || res.writeHead(404).end()));
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    const url = `http://127.0.0.1:${(servidor.address() as {port: number}).port}`;
    cd = criarClaudeDesktop({dados: pastaDados, executavel: process.execPath, script: 'x', versao: '2.0.1', mcp: () => mcp, url: () => url});
    cd.publicar(path.join(projetos, 'Alfa'));
    const {c, d} = await conectarDesktop(() => descobertaViva(cd.arquivoDescoberta));
    expect(jsonDe(await c.callTool({name: 'projeto_info', arguments: {}})).nome).toBe('Alfa');
    expect(jsonDe(await c.callTool({name: 'abrir_projeto', arguments: {projeto: 'Beta'}}))).toMatchObject({nome: 'Beta', aberto_no_app: true});
    const info = await c.callTool({name: 'projeto_info', arguments: {}});
    expect(info.isError).toBeFalsy();
    expect(jsonDe(info).nome).toBe('Beta');
    cd.retirar();
    await d.fechar();
    servidor.closeAllConnections();
    await new Promise((ok) => servidor.close(ok));
  });
});

describe('trocar de projeto pelo MCP da IDE com o app fechado', () => {
  it('criar e duplicar gravam a pasta e avisam que a IDE fica onde está; abrir e fechar explicam', async () => {
    const pai = path.join(tmp, 'ide');
    const raiz = novoProjeto(pai, 'Da IDE');
    const s = new McpServer({name: 'estudio', version: '0'});
    registrarTrocaDeProjeto(s, trocadorSemApp({pastaProjetos: pai, atual: () => raiz}));
    const [a, b] = InMemoryTransport.createLinkedPair();
    await s.connect(a);
    const c = new Client({name: 'ide', version: '0'});
    await c.connect(b);
    const criado = jsonDe(await c.callTool({name: 'criar_projeto', arguments: {nome: 'Outro', modelo: 'imagem-branco', formato: 'quadrado'}}));
    expect(criado).toMatchObject({pasta: path.join(pai, 'Outro'), aberto_no_app: false});
    expect(criado.aviso).toMatch(/continua em .*Da IDE/s);
    expect(existsSync(path.join(pai, 'Outro', 'estudio.json'))).toBe(true);
    expect(jsonDe(await c.callTool({name: 'duplicar_projeto', arguments: {}})).nome).toBe('Da IDE (cópia)');
    const abrir = await c.callTool({name: 'abrir_projeto', arguments: {projeto: 'Outro'}});
    expect(abrir.isError).toBe(true);
    expect(textoDe(abrir)).toBe(fixoNaPastaDaIde(raiz));
    expect((await c.callTool({name: 'fechar_projeto', arguments: {}})).isError).toBe(true);
    expect((await c.callTool({name: 'criar_projeto', arguments: {formato: 'cinema'}})).isError).toBe(true);
    await c.close();
  });
});
