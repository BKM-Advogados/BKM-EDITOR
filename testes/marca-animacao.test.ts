// Kit de marca e ferramentas da imagem diante da animação (auditoria MCP: N1, M4, M12). A animação tem `camadas` e
// `largura` como a imagem, mas lê o kit só do `tema`: aplicar_marca grava o `tema` (e não `/marca`), as ferramentas que
// gravam campos da imagem recusam, travar e destravar continuam valendo, e documento que não recebe kit não ganha
// arquivo nenhum no projeto.
import {copyFileSync, cpSync, existsSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {novaAnimacao, type DocAnimacao} from '../src/nucleo/animacao';
import {novoDocImagem} from '../src/nucleo/criar-projeto';
import {ehDocImagem} from '../src/nucleo/documentos';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {MARCA_NEUTRO, patchDaMarca, temaDaMarca} from '../src/nucleo/marca';
import {descreverMarca} from '../src/nucleo/mcp-marca';
import {PastaMarcas} from '../src/nucleo/pasta-marcas';
import {Projeto} from '../src/nucleo/projeto';
import {KIT_TESTE} from './fixtures/kit-teste';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-marca-anim-'));
const pasta = path.join(tmp, 'proj');
const marcas = path.join(tmp, 'marcas');
const anterior = process.env.ESTUDIO_MARCAS;
let cliente: Client;
let projeto: Projeto;

type Res = {isError?: boolean; content: {text: string}[]};
const chamar = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await cliente.callTool({name, arguments: args})) as Res;
  const t = r.content[0]?.text ?? '';
  let dado: any = t;
  try {
    dado = JSON.parse(t);
  } catch {
    /* texto */
  }
  return {erro: Boolean(r.isError), dado, texto: t};
};

beforeAll(async () => {
  cpSync(path.join(__dirname, 'fixtures', 'projeto'), pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
  process.env.ESTUDIO_MARCAS = marcas;
  const pm = new PastaMarcas({pasta: () => marcas});
  pm.gravar(KIT_TESTE);
  copyFileSync(path.join(__dirname, 'fixtures', 'projeto', 'midia', 'logo.png'), path.join(pm.pastaDe('teste'), 'logo.png'));
  projeto = new Projeto(pasta);
  const servidor = new McpServer({name: 'estudio', version: '0'});
  registrarFerramentas(servidor, projeto, 'agente', 'teste');
  const [a, b] = InMemoryTransport.createLinkedPair();
  await servidor.connect(a);
  cliente = new Client({name: 'teste', version: '0'});
  await cliente.connect(b);
});

afterAll(async () => {
  await cliente?.close();
  if (anterior === undefined) delete process.env.ESTUDIO_MARCAS;
  else process.env.ESTUDIO_MARCAS = anterior;
  rmSync(tmp, {recursive: true, force: true});
});

describe('kit de marca na animação (N1)', () => {
  it('patchDaMarca grava o tema da animação, não o /marca da imagem', () => {
    const patch = patchDaMarca(novaAnimacao(1920, 1080), MARCA_NEUTRO);
    expect(patch.map((o) => o.path)).toEqual(['/tema']);
    expect(patch[0]).toMatchObject({op: 'add', value: temaDaMarca(MARCA_NEUTRO)});
  });

  it('a animação não é imagem; a imagem continua sendo', () => {
    expect(ehDocImagem(novaAnimacao(1080, 1080))).toBe(false);
    expect(ehDocImagem(novoDocImagem(1080, 1350))).toBe(true);
    expect(descreverMarca(novaAnimacao(1080, 1080))).toMatchObject({kit: null, tema: null});
  });

  it('aplicar_marca pelo MCP põe as cores do kit no tema, e pixelizar com usar_paleta_marca as usa', async () => {
    const criada = await chamar('criar_animacao', {titulo: 'Kit'});
    expect(criada.erro).toBe(false);
    const id = criada.dado.documento as string;
    const r = await chamar('aplicar_marca', {id: 'teste', documento: id});
    expect(r.erro, r.texto).toBe(false);
    const doc = projeto.lerJson<DocAnimacao & {marca?: unknown}>(projeto.arquivoDoDocumento(id)).doc;
    expect(doc.tema).toMatchObject({fundo: KIT_TESTE.cores.fundo, destaque: KIT_TESTE.cores.destaque, marca: 'teste'});
    expect(doc.marca).toBeUndefined();
    expect((await chamar('ver_marca', {documento: id})).dado).toMatchObject({kit: 'teste'});

    const camada = await chamar('adicionar_camada_animacao', {documento: id, tipo: 'pixel'});
    expect(camada.erro, camada.texto).toBe(false);
    const px = await chamar('pixelizar_imagem', {documento: id, camada_id: camada.dado.camada_id ?? camada.dado.id, imagem_src: 'midia/logo.png', colunas: 8, usar_paleta_marca: true});
    expect(px.erro, px.texto).toBe(false);
    const kit = [KIT_TESTE.cores.fundo, KIT_TESTE.cores.texto, KIT_TESTE.cores.destaque, KIT_TESTE.cores.suave].map((c) => c.toUpperCase());
    for (const cor of px.dado.grade.paleta as string[]) expect(kit).toContain(cor.toUpperCase());
  });
});

describe('ferramentas da imagem na animação (M4)', () => {
  let id = '';
  beforeAll(async () => {
    id = (await chamar('criar_animacao', {titulo: 'Camadas'})).dado.documento;
    await chamar('adicionar_camada_animacao', {documento: id, tipo: 'forma'});
    await chamar('adicionar_camada_animacao', {documento: id, tipo: 'forma'});
  });
  const camadas = () => projeto.lerJson<DocAnimacao>(projeto.arquivoDoDocumento(id)).doc.camadas;

  it('inserir_icone, alinhar, distribuir, agrupar e cor_da_marca recusam e não mexem no arquivo', async () => {
    const antes = JSON.stringify(camadas());
    const ids = camadas().map((c) => c.id);
    const pedidos: [string, Record<string, unknown>][] = [
      ['inserir_icone', {documento: id, icone: 'scale'}],
      ['inserir_linha', {documento: id, x1: 0, y1: 0, x2: 100, y2: 100}],
      ['fazer_lista', {documento: id, camada: ids[0], tipo: 'marcadores'}],
      ['cor_da_marca', {documento: id, camada: ids[0], campo: 'preenchimento', nome: 'destaque'}],
      ['fonte_da_marca', {documento: id, camada: ids[0], papel: 'titulo'}],
      ['alinhar_camadas', {documento: id, camadas: ids, como: 'esquerda'}],
      ['distribuir_camadas', {documento: id, camadas: ids, eixo: 'horizontal'}],
      ['agrupar_camadas', {documento: id, camadas: ids}],
      ['desagrupar_camadas', {documento: id, camadas: ids}],
    ];
    for (const [nome, args] of pedidos) {
      const r = await chamar(nome, args);
      expect(r.erro, `${nome}: ${r.texto}`).toBe(true);
      expect(r.texto, nome).toMatch(/não é uma imagem/);
    }
    expect(JSON.stringify(camadas())).toBe(antes);
  });

  it('selecionar, travar e destravar continuam valendo na animação', async () => {
    const alvo = camadas()[0].id;
    expect((await chamar('selecionar_camadas', {documento: id, camadas: [alvo]})).erro).toBe(false);
    expect((await chamar('travar_camadas', {documento: id, camadas: [alvo]})).erro).toBe(false);
    expect((camadas()[0] as {travada?: boolean}).travada).toBe(true);
    expect((await chamar('destravar_camadas', {documento: id, camadas: [alvo]})).erro).toBe(false);
    expect((camadas()[0] as {travada?: boolean}).travada).toBeFalsy();
  });
});

describe('aplicar_marca em documento que não recebe kit (M12)', () => {
  it('3D e música recusam antes de copiar logo ou fonte para o projeto', async () => {
    const musica = (await chamar('criar_documento', {modulo: 'musica', titulo: 'Trilha'})).dado.id as string;
    const listar = (p: string) => (existsSync(path.join(pasta, p)) ? readdirSync(path.join(pasta, p)).sort() : []);
    const antes = {midia: listar('midia'), fontes: listar('fontes')};
    for (const documento of ['cena3d', musica]) {
      const r = await chamar('aplicar_marca', {id: 'teste', documento});
      expect(r.erro).toBe(true);
      expect(r.texto).toMatch(/não recebe kit de marca \(só vídeo de cenas, imagem e animação\)/);
    }
    expect({midia: listar('midia'), fontes: listar('fontes')}).toEqual(antes);
  });
});
