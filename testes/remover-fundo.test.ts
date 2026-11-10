// Remover fundo sem a janela: o tamanho da entrada do modelo, o nome do arquivo sem fundo (o mesmo original no mesmo
// arquivo, dois originais de mesmo nome em arquivos diferentes), os patches da camada (e o voltar ao original), o
// download com SHA-256 conferido (rede falsa: o arquivo bom entra, o estragado não fica), a leitura que apaga modelo
// corrompido, a gravação em midia/ sem tocar no original nem no recorte de outra foto (marca de origem no PNG) e a
// ferramenta remover_fundo do MCP com um executor de teste no lugar da janela (página duplicada com os mesmos ids, e a
// pilha que muda enquanto o modelo roda).
import {createHash} from 'node:crypto';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
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
  caminhoSemFundo, codigoDoOriginal, definirRemovedorDeFundo, MODELO_FUNDO, MODNET, patchSemFundo, patchVoltarAoOriginal, tamanhoDaEntrada, type ModeloFundo,
} from '../src/nucleo/remover-fundo';
import {arquivoDoModelo, baixarModelo, estadoDoModelo, gravarSemFundo, lerModelo, marcarOrigem, origemMarcada} from '../src/main/remover-fundo';

const EXEMPLO = path.join(__dirname, 'fixtures', 'projeto');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-fundo-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));
afterEach(() => definirRemovedorDeFundo(null));

const aplicar = <T,>(doc: T, patch: OperacaoPatch[]): T => jsonpatch.applyPatch(structuredClone(doc), patch as Operation[], true, false).newDocument;
const foto = (extra: Partial<CamadaImagem> = {}): CamadaImagem => ({id: 'foto', nome: 'Foto', tipo: 'imagem', x: 0, y: 0, largura: 1080, altura: 1350, src: 'midia/ana.jpg', ...extra});
// PNG de 1×1 de verdade (a janela devolve PNG; a marca de origem entra nele)
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const dataPng = `data:image/png;base64,${PNG}`;

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

  it('o sem fundo vai para midia/, ao lado do original, com o código do caminho do original', () => {
    expect(caminhoSemFundo('midia/ana.jpg')).toBe(`midia/ana.${codigoDoOriginal('midia/ana.jpg')}.sem-fundo.png`);
    expect(caminhoSemFundo('midia/fotos/ana.perfil.jpeg')).toMatch(/^midia\/fotos\/ana\.perfil\.[0-9a-f]{8}\.sem-fundo\.png$/);
    expect(caminhoSemFundo('fotos\\ana.png')).toMatch(/^midia\/ana\.[0-9a-f]{8}\.sem-fundo\.png$/);
    // o mesmo original cai sempre no mesmo arquivo (no Windows, maiúscula e barra invertida não fazem outro arquivo)
    expect(caminhoSemFundo('midia/ana.jpg')).toBe(caminhoSemFundo('midia/ana.jpg'));
    expect(codigoDoOriginal('midia\\Ana.jpg')).toBe(codigoDoOriginal('midia/ana.jpg'));
  });

  it('dois originais de mesmo nome (outra pasta, outra extensão) não caem no mesmo arquivo', () => {
    const nomes = ['midia/ana.jpg', 'fotos/ana.png', 'midia/ana.png', 'outra/ana.png', 'midia/sub/ana.jpg'].map(caminhoSemFundo);
    expect(new Set(nomes).size).toBe(nomes.length);
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

  it('a marca de origem vai dentro do PNG e volta na leitura (caminho com acento também)', () => {
    const marcado = marcarOrigem(Buffer.from(PNG, 'base64'), 'midia\\Foto da Ação.jpg');
    expect(origemMarcada(marcado)).toBe('midia/foto da ação.jpg');
    expect(origemMarcada(Buffer.from(PNG, 'base64'))).toBeNull();
    expect(origemMarcada(Buffer.from('não é png'))).toBeNull();
    expect(() => marcarOrigem(Buffer.from('não é png'), 'midia/a.jpg')).toThrow(/PNG/);
  });

  it('o PNG sem fundo vai para midia/, com a marca, e nunca no lugar do original', () => {
    const raiz = path.join(tmp, 'projeto-gravar');
    const projeto = new Projeto(raiz);
    const rel = gravarSemFundo(projeto, 'midia/ana.jpg', dataPng);
    expect(rel).toBe(caminhoSemFundo('midia/ana.jpg'));
    expect(origemMarcada(readFileSync(path.join(raiz, rel)))).toBe('midia/ana.jpg');
    // o mesmo original grava por cima do recorte dele
    expect(gravarSemFundo(projeto, 'midia/ana.jpg', dataPng)).toBe(rel);
    expect(gravarSemFundo(projeto, '../fora.jpg', dataPng)).toMatch(/^midia\/fora\.[0-9a-f]{8}\.sem-fundo\.png$/);
  });

  it('duas fotos de mesmo nome dão dois recortes; a segunda não troca a pessoa da primeira', () => {
    const raiz = path.join(tmp, 'projeto-dois');
    const projeto = new Projeto(raiz);
    const a = gravarSemFundo(projeto, 'midia/ana.jpg', dataPng);
    const antes = readFileSync(path.join(raiz, a));
    const b = gravarSemFundo(projeto, 'fotos/ana.png', dataPng);
    expect(b).not.toBe(a);
    expect(readFileSync(path.join(raiz, a))).toEqual(antes);
    expect(origemMarcada(readFileSync(path.join(raiz, a)))).toBe('midia/ana.jpg');
    expect(origemMarcada(readFileSync(path.join(raiz, b)))).toBe('fotos/ana.png');
  });

  it('arquivo no lugar do recorte que não é dele (da pessoa, ou de outra foto) fica intacto: o recorte vai para "-2"', () => {
    const raiz = path.join(tmp, 'projeto-ocupado');
    const projeto = new Projeto(raiz);
    const alvo = caminhoSemFundo('midia/ana.jpg');
    mkdirSync(path.join(raiz, 'midia'), {recursive: true});
    writeFileSync(path.join(raiz, alvo), 'arquivo da pessoa');
    const r = gravarSemFundo(projeto, 'midia/ana.jpg', dataPng);
    expect(r).toBe(alvo.replace(/\.sem-fundo\.png$/, '-2.sem-fundo.png'));
    expect(readFileSync(path.join(raiz, alvo), 'utf-8')).toBe('arquivo da pessoa');
    // recorte marcado com outro original no lugar: também não é sobrescrito
    writeFileSync(path.join(raiz, r), marcarOrigem(Buffer.from(PNG, 'base64'), 'fotos/outra.jpg'));
    const r3 = gravarSemFundo(projeto, 'midia/ana.jpg', dataPng);
    expect(r3).toBe(alvo.replace(/\.sem-fundo\.png$/, '-3.sem-fundo.png'));
    expect(origemMarcada(readFileSync(path.join(raiz, r)))).toBe('fotos/outra.jpg');
    // a próxima vez do mesmo original reusa o recorte dele
    expect(gravarSemFundo(projeto, 'midia/ana.jpg', dataPng)).toBe(r3);
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
      const caminho = gravarSemFundo(m.projeto, src, dataPng);
      return {caminho, ms: 321};
    });
    const r = await m.chamar({documento: 'capa', camada: 'foto'});
    expect(r.erro).toBe(false);
    expect(r.dado).toMatchObject({ok: true, camada: '/camadas/0', src: caminhoSemFundo('midia/foto.jpg'), src_original: 'midia/foto.jpg', modelo: 'modnet', tempo_modelo_ms: 321});
    expect(pedidos).toEqual(['midia/foto.jpg']);
    expect(m.capa().camadas[0]).toMatchObject({src: caminhoSemFundo('midia/foto.jpg'), src_original: 'midia/foto.jpg'});
    // o original ficou intacto
    expect(readFileSync(path.join(m.pasta, 'midia', 'foto.jpg'))).toEqual(readFileSync(path.join(EXEMPLO, 'midia', 'foto.jpg')));
    expect(m.projeto.diario().at(-1)).toMatchObject({autor: 'agente', rotulo: 'fundo removido de foto'});
    // de novo, pelo caminho: o modelo recebe o original, não o sem fundo
    await m.chamar({documento: 'capa', camada: '/camadas/0'});
    expect(pedidos.at(-1)).toBe('midia/foto.jpg');
    const volta = await m.chamar({documento: 'capa', camada: 'foto', voltar: true});
    expect(volta.dado).toMatchObject({ok: true, src: 'midia/foto.jpg'});
    expect(m.capa().camadas[0]).not.toHaveProperty('src_original');
    expect((await m.chamar({documento: 'capa', camada: 'foto', voltar: true})).texto).toMatch(/não guardou o original/);
    expect((await m.chamar({documento: 'capa', camada: 'titulo'})).texto).toMatch(/não é uma camada de imagem/);
    expect((await m.chamar({documento: 'capa', camada: 'nada'})).texto).toMatch(/não achada/);
    await m.fechar();
  }, 30_000);

  // carrossel com a página da foto duplicada: as duas páginas têm a camada "foto", com o mesmo id e o mesmo arquivo
  const duplicarPaginaDaFoto = (m: Awaited<ReturnType<typeof conectar>>) => {
    const {doc, versao} = m.projeto.lerJson<DocImagem>('imagem/capa.json');
    const pagina = (id: string, nome: string) => ({id, nome, camadas: structuredClone(doc.camadas)});
    m.projeto.aplicarPatch({documento: 'capa', versao_base: versao, autor: 'pessoa', origem: 'teste', rotulo: 'duas páginas iguais',
      patch: [{op: 'replace', path: '/camadas', value: []}, {op: 'add', path: '/paginas', value: [pagina('pagina-1', 'Capa'), pagina('pagina-2', 'Cópia')]}]});
  };

  it('página duplicada: o recorte pedido pelo caminho cai nessa página, não na primeira com o mesmo id', async () => {
    const m = await conectar();
    duplicarPaginaDaFoto(m);
    definirRemovedorDeFundo(async (src) => ({caminho: gravarSemFundo(m.projeto, src, dataPng), ms: 1}));
    const r = await m.chamar({documento: 'capa', camada: '/paginas/1/camadas/0'});
    expect(r.erro).toBe(false);
    expect(r.dado.camada).toBe('/paginas/1/camadas/0');
    const doc = m.capa();
    expect(doc.paginas![1].camadas[0]).toMatchObject({src: caminhoSemFundo('midia/foto.jpg'), src_original: 'midia/foto.jpg'});
    expect(doc.paginas![0].camadas[0].src).toBe('midia/foto.jpg');
    expect(doc.paginas![0].camadas[0]).not.toHaveProperty('src_original');
    // pelo id, que agora está nas duas páginas: recusa e diz os caminhos
    const ambiguo = await m.chamar({documento: 'capa', camada: 'foto'});
    expect(ambiguo.erro).toBe(true);
    expect(ambiguo.texto).toMatch(/está em 2 camadas \(\/paginas\/0\/camadas\/0, \/paginas\/1\/camadas\/0\)/);
    await m.fechar();
  }, 30_000);

  it('a pilha muda enquanto o modelo roda: nada é gravado no documento e a resposta diz onde ficou o recorte', async () => {
    const m = await conectar();
    duplicarPaginaDaFoto(m);
    definirRemovedorDeFundo(async (src) => {
      // a pessoa põe uma camada nova embaixo da foto da página 2 enquanto o modelo trabalha
      const {versao} = m.projeto.lerJson<DocImagem>('imagem/capa.json');
      m.projeto.aplicarPatch({documento: 'capa', versao_base: versao, autor: 'pessoa', origem: 'teste', rotulo: 'forma nova',
        patch: [{op: 'add', path: '/paginas/1/camadas/0', value: {id: 'nova', nome: 'Nova', tipo: 'forma', x: 0, y: 0, largura: 10, altura: 10}}]});
      return {caminho: gravarSemFundo(m.projeto, src, dataPng), ms: 1};
    });
    const antes = await m.chamar({documento: 'capa', camada: '/paginas/1/camadas/0'});
    expect(antes.erro).toBe(true);
    expect(antes.texto).toMatch(/saiu de \/paginas\/1\/camadas\/0.*agora ali está nova.*o documento não mudou/);
    expect(antes.texto).toContain(caminhoSemFundo('midia/foto.jpg'));
    const doc = m.capa();
    expect(doc.paginas!.flatMap((p) => p.camadas).every((c) => c.src_original === undefined)).toBe(true);
    expect(existsSync(path.join(m.pasta, caminhoSemFundo('midia/foto.jpg')))).toBe(true);
    await m.fechar();
  }, 30_000);
});
