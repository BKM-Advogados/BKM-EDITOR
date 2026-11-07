// Remover fundo sem a janela: o tamanho da entrada do modelo, o nome do arquivo sem fundo, os patches da camada (e o
// voltar ao original), o download com SHA-256 conferido (rede falsa: o arquivo bom entra, o estragado não fica), a
// leitura que apaga modelo corrompido, a gravação em midia/ sem tocar no original e a ferramenta remover_fundo do MCP
// com um executor de teste no lugar da janela.
import {createHash} from 'node:crypto';
import {cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jsonpatch, {type Operation} from 'fast-json-patch';
import {afterAll, afterEach, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {CamadaImagem, DocImagem, OperacaoPatch} from '../src/nucleo/documentos';
import {Projeto} from '../src/nucleo/projeto';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {
  caminhoSemFundo, definirRemovedorDeFundo, MODELO_FUNDO, MODNET, patchSemFundo, patchVoltarAoOriginal, tamanhoDaEntrada, type ModeloFundo,
} from '../src/nucleo/remover-fundo';
import {arquivoDoModelo, baixarModelo, estadoDoModelo, gravarSemFundo, lerModelo} from '../src/main/remover-fundo';

const EXEMPLO = path.join(__dirname, '..', 'exemplos', 'exemplo');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-fundo-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));
afterEach(() => definirRemovedorDeFundo(null));

const aplicar = <T,>(doc: T, patch: OperacaoPatch[]): T => jsonpatch.applyPatch(structuredClone(doc), patch as Operation[], true, false).newDocument;
const foto = (extra: Partial<CamadaImagem> = {}): CamadaImagem => ({id: 'foto', nome: 'Foto', tipo: 'imagem', x: 0, y: 0, largura: 1080, altura: 1350, src: 'midia/ana.jpg', ...extra});

describe('regras do remover fundo', () => {
  it('o modelo é o MODNet, Apache-2.0, com endereço de revisão travada e SHA-256', () => {
    expect(MODELO_FUNDO).toBe(MODNET);
    expect(MODNET.licenca).toBe('Apache-2.0');
    expect(MODNET.url).toMatch(/^https:\/\/huggingface\.co\/Xenova\/modnet\/resolve\/[0-9a-f]{40}\/onnx\/model\.onnx$/);
    expect(MODNET.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a entrada tem o lado menor em 512 e os dois lados múltiplos de 32, sem passar de 1024', () => {
    expect(tamanhoDaEntrada(1080, 1350)).toEqual({w: 512, h: 640});
    expect(tamanhoDaEntrada(1080, 1080)).toEqual({w: 512, h: 512});
    expect(tamanhoDaEntrada(1920, 1080)).toEqual({w: 896, h: 512});
    expect(tamanhoDaEntrada(4000, 1000)).toEqual({w: 1024, h: 256});
    expect(tamanhoDaEntrada(10, 10)).toEqual({w: 512, h: 512});
  });

  it('o sem fundo vai para midia/, ao lado do original, e não acumula sufixo', () => {
    expect(caminhoSemFundo('midia/ana.jpg')).toBe('midia/ana.sem-fundo.png');
    expect(caminhoSemFundo('midia/fotos/ana.perfil.jpeg')).toBe('midia/fotos/ana.perfil.sem-fundo.png');
    expect(caminhoSemFundo('midia/ana.sem-fundo.png')).toBe('midia/ana.sem-fundo.png');
    expect(caminhoSemFundo('fotos\\ana.png')).toBe('midia/ana.sem-fundo.png');
  });

  it('a camada troca para o sem fundo guardando o original, e volta', () => {
    const doc = {camadas: [foto()]};
    const sem = aplicar(doc, patchSemFundo(doc.camadas[0], '/camadas/0', 'midia/ana.sem-fundo.png'));
    expect(sem.camadas[0]).toMatchObject({src: 'midia/ana.sem-fundo.png', src_original: 'midia/ana.jpg'});
    // de novo (o modelo rodou outra vez): o original continua o primeiro
    const outra = aplicar(sem, patchSemFundo(sem.camadas[0], '/camadas/0', 'midia/ana.sem-fundo.png'));
    expect(outra.camadas[0].src_original).toBe('midia/ana.jpg');
    const volta = aplicar(sem, patchVoltarAoOriginal(sem.camadas[0], '/camadas/0'));
    expect(volta.camadas[0]).toEqual(foto());
    expect(patchVoltarAoOriginal(foto(), '/camadas/0')).toEqual([]);
    // a pessoa trocou o arquivo por baixo: o patch não passa
    const trocada = {camadas: [foto({src: 'midia/outra.jpg'})]};
    expect(() => aplicar(trocada, patchSemFundo(foto(), '/camadas/0', 'midia/ana.sem-fundo.png'))).toThrow();
  });
});

describe('modelo no disco', () => {
  const bytes = new Uint8Array(4096).map((_, i) => (i * 7) % 251);
  const falso: ModeloFundo = {...MODNET, id: 'falso', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
  const rede = (corpo: Uint8Array, status = 200) => async () => new Response(corpo as unknown as BodyInit, {status});

  it('baixa em pedaços, confere o SHA-256 e avisa o andamento', async () => {
    const pasta = path.join(tmp, 'modelos-ok');
    expect(estadoDoModelo(pasta, falso).pronto).toBe(false);
    const andamento: number[] = [];
    const e = await baixarModelo({pasta, buscar: rede(bytes), modelo: falso, aoProgresso: (r) => andamento.push(r)});
    expect(e).toMatchObject({pronto: true, id: 'falso', licenca: 'Apache-2.0'});
    expect(andamento.at(-1)).toBe(bytes.length);
    expect(existsSync(`${arquivoDoModelo(pasta, falso)}.parcial`)).toBe(false);
    expect(lerModelo(pasta, falso)).toEqual(bytes);
  });

  it('arquivo que não confere não fica na pasta', async () => {
    const pasta = path.join(tmp, 'modelos-ruim');
    const estragado = bytes.slice();
    estragado[10] ^= 0xff;
    await expect(baixarModelo({pasta, buscar: rede(estragado), modelo: falso})).rejects.toThrow(/não confere/);
    expect(existsSync(arquivoDoModelo(pasta, falso))).toBe(false);
    expect(existsSync(`${arquivoDoModelo(pasta, falso)}.parcial`)).toBe(false);
    await expect(baixarModelo({pasta, buscar: rede(bytes, 404), modelo: falso})).rejects.toThrow(/404/);
    await expect(baixarModelo({pasta, buscar: rede(new Uint8Array(bytes.length + 10)), modelo: falso})).rejects.toThrow(/maior/);
  });

  it('modelo corrompido na pasta é apagado ao ler', async () => {
    const pasta = path.join(tmp, 'modelos-corrompido');
    await baixarModelo({pasta, buscar: rede(bytes), modelo: falso});
    const mexido = bytes.slice();
    mexido[0] ^= 1;
    writeFileSync(arquivoDoModelo(pasta, falso), mexido);
    expect(() => lerModelo(pasta, falso)).toThrow(/apagado/);
    expect(existsSync(arquivoDoModelo(pasta, falso))).toBe(false);
  });

  it('o PNG sem fundo vai para midia/ e nunca no lugar do original', () => {
    const raiz = path.join(tmp, 'projeto-gravar');
    const projeto = new Projeto(raiz);
    const png = `data:image/png;base64,${Buffer.from('png de teste').toString('base64')}`;
    expect(gravarSemFundo(projeto, 'midia/ana.jpg', png)).toBe('midia/ana.sem-fundo.png');
    expect(readFileSync(path.join(raiz, 'midia', 'ana.sem-fundo.png'), 'utf-8')).toBe('png de teste');
    expect(() => gravarSemFundo(projeto, 'midia/ana.sem-fundo.png', png)).toThrow(/original/);
    expect(() => gravarSemFundo(projeto, '../fora.jpg', png)).not.toThrow(); // o sem fundo cai em midia/fora.sem-fundo.png
    expect(existsSync(path.join(raiz, 'midia', 'fora.sem-fundo.png'))).toBe(true);
  });
});

describe('ferramenta remover_fundo', () => {
  const conectar = async () => {
    const pasta = mkdtempSync(path.join(tmp, 'mcp-'));
    cpSync(EXEMPLO, pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
    const projeto = new Projeto(pasta);
    const servidor = new McpServer({name: 'estudio', version: '0'});
    registrarFerramentas(servidor, projeto, 'agente', 'teste');
    const [a, b] = InMemoryTransport.createLinkedPair();
    const cliente = new Client({name: 'teste', version: '0'});
    await Promise.all([servidor.connect(a), cliente.connect(b)]);
    const chamar = async (args: Record<string, unknown>) => {
      const r = (await cliente.callTool({name: 'remover_fundo', arguments: args})) as {isError?: boolean; content: {text: string}[]};
      const t = r.content[0].text;
      return {erro: Boolean(r.isError), texto: t, dado: r.isError ? undefined : JSON.parse(t)};
    };
    const capa = () => projeto.lerJson<DocImagem>('imagem/capa.json').doc;
    return {projeto, pasta, chamar, capa, fechar: () => cliente.close()};
  };

  it('fora do app (sem janela) avisa e não mexe em nada', async () => {
    const m = await conectar();
    const antes = m.capa();
    const r = await m.chamar({documento: 'capa', camada: 'foto'});
    expect(r.erro).toBe(true);
    expect(r.texto).toMatch(/app do Estúdio aberto/);
    expect(m.capa()).toEqual(antes);
    await m.fechar();
  });

  it('com a janela: grava o sem fundo, troca o src guardando o original, e volta', async () => {
    const m = await conectar();
    const pedidos: string[] = [];
    definirRemovedorDeFundo(async (src) => {
      pedidos.push(src);
      const caminho = gravarSemFundo(m.projeto, src, `data:image/png;base64,${Buffer.from('sem fundo').toString('base64')}`);
      return {caminho, ms: 321};
    });
    const r = await m.chamar({documento: 'capa', camada: 'foto'});
    expect(r.erro).toBe(false);
    expect(r.dado).toMatchObject({ok: true, camada: '/camadas/0', src: 'midia/Cidade Exemplo.sem-fundo.png', src_original: 'midia/Cidade Exemplo.jpg', modelo: 'modnet', tempo_modelo_ms: 321});
    expect(pedidos).toEqual(['midia/Cidade Exemplo.jpg']);
    expect(m.capa().camadas[0]).toMatchObject({src: 'midia/Cidade Exemplo.sem-fundo.png', src_original: 'midia/Cidade Exemplo.jpg'});
    // o original ficou intacto
    expect(readFileSync(path.join(m.pasta, 'midia', 'Cidade Exemplo.jpg'))).toEqual(readFileSync(path.join(EXEMPLO, 'midia', 'Cidade Exemplo.jpg')));
    expect(m.projeto.diario().at(-1)).toMatchObject({autor: 'agente', rotulo: 'fundo removido de foto'});
    // de novo, pelo caminho: o modelo recebe o original, não o sem fundo
    await m.chamar({documento: 'capa', camada: '/camadas/0'});
    expect(pedidos.at(-1)).toBe('midia/Cidade Exemplo.jpg');
    const volta = await m.chamar({documento: 'capa', camada: 'foto', voltar: true});
    expect(volta.dado).toMatchObject({ok: true, src: 'midia/Cidade Exemplo.jpg'});
    expect(m.capa().camadas[0]).not.toHaveProperty('src_original');
    expect((await m.chamar({documento: 'capa', camada: 'foto', voltar: true})).texto).toMatch(/não guardou o original/);
    expect((await m.chamar({documento: 'capa', camada: 'titulo'})).texto).toMatch(/não é uma camada de imagem/);
    expect((await m.chamar({documento: 'capa', camada: 'nada'})).texto).toMatch(/não achada/);
    await m.fechar();
  }, 30_000);
});
