// Exportação final pelo MCP (docs/exportacao.md, "Pelo MCP"): exportar_video, situacao_exportacao, exportar_imagem e
// exportar_carrossel. As ferramentas rodam contra um serviço falso (MCP em memória); o exportador do vídeo, o mesmo do
// diálogo (src/main/exportacao-video.ts), roda de verdade com o render do Remotion trocado por um falso (vi.mock). O
// render real, pelo nucleo.cjs como a IDE roda com o app fechado, fica na prova opcional do fim:
// ESTUDIO_PROVA_RENDER=1 npx vitest run testes/exportacao-mcp.test.ts
import {execSync} from 'node:child_process';
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {gravarPlano, planoDoProjeto} from '../src/nucleo/criar-projeto';
import type {Manifesto} from '../src/nucleo/documentos';
import type {OpcoesExportarVideo} from '../src/nucleo/exportacao';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {
  ABRA_NO_APP, definirEsperaDaChamada, definirServicoExportacao, destinosDoPedido, documentoPara, ESPERA_PADRAO_MS, esquecerExportacoes,
  type AndamentoFinal, type ResultadoVideoFinal, type ServicoExportacaoFinal,
} from '../src/nucleo/mcp-exportacao-final';
import {classeDe, type Portao} from '../src/nucleo/portao';
import {gravarPrefsExportacao} from '../src/nucleo/prefs-exportacao';
import {Projeto} from '../src/nucleo/projeto';
import type {RenderVideo} from '../src/main/exportar';
import {criarExportadorVideo} from '../src/main/exportacao-video';
import {servicoDeExportacao} from '../src/main/exportacao-servico';

// o render do Remotion trocado por um falso: grava o arquivo, avisa o andamento e, no modo "longo", espera o Cancelar
const render = vi.hoisted(() => ({modo: 'rapido' as 'rapido' | 'longo' | 'falha', pedidos: [] as unknown[]}));
vi.mock('../src/main/exportar', async (original) => ({
  ...(await original<typeof import('../src/main/exportar')>()),
  faltaEspaco: async () => null,
  encerrarRender: async () => undefined,
  renderizarVideo: async (_p: unknown, r: RenderVideo, aviso: (x: {tipo: 'status' | 'progresso'; progresso?: number; etapa?: string; mensagem?: string}) => void) => {
    render.pedidos.push(r);
    aviso({tipo: 'progresso', etapa: 'renderizando', progresso: 50});
    if (render.modo === 'falha') throw new Error('o Chrome do render caiu');
    writeFileSync(r.arquivo, 'meio');
    if (render.modo === 'longo') await new Promise((_ok, falhou) => r.cancelSignal?.(() => falhou(new Error('renderMedia() got cancelled'))));
    writeFileSync(r.arquivo, 'mp4');
    aviso({tipo: 'progresso', etapa: 'renderizando', progresso: 100});
    return r.arquivo;
  },
}));

const RAIZ = path.join(__dirname, '..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-exportacao-mcp-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));
beforeEach(() => {
  render.modo = 'rapido';
  render.pedidos = [];
});
afterEach(() => {
  definirServicoExportacao(null);
  definirEsperaDaChamada(ESPERA_PADRAO_MS);
  esquecerExportacoes();
});

/** Projeto pequeno de verdade: um vídeo de cenas 9:16 de 3 s, uma imagem simples e um carrossel de duas páginas. */
const projetoDeTeste = () => {
  const pasta = path.join(mkdtempSync(path.join(tmp, 'p-')), 'Teste');
  gravarPlano(pasta, planoDoProjeto({nome: 'Teste', modelo: 'video-branco', formato: {largura: 1080, altura: 1920}}));
  const p = new Projeto(pasta);
  const {doc} = p.lerJson<Record<string, unknown>>('video/video.json');
  p.gravarTexto('video/video.json', JSON.stringify({...doc, cenas: [
    {id: 'abre', duracao_ms: 2000, blocos: [{id: 't1', tipo: 'titulo', texto: 'Olá', em: 0, sai: 2000, x: 0.08, y: 0.4, largura: 0.84, tam: 0.085}]},
    {id: 'fim', duracao_ms: 1000, fundo: '#203040', blocos: []},
  ]}, null, 2));
  const camada = {id: 't', nome: 'Título', tipo: 'texto', texto: 'Capa', x: 10, y: 10, largura: 500, altura: 100};
  p.gravarTexto('imagem/simples.json', JSON.stringify({formato: 1, largura: 1080, altura: 1350, fundo: '#ffffff', camadas: [camada]}, null, 2));
  p.gravarTexto('imagem/carrossel.json', JSON.stringify({formato: 1, largura: 1080, altura: 1350, fundo: '#ffffff', camadas: [],
    paginas: [{id: 'p1', nome: 'Um', camadas: [camada]}, {id: 'p2', nome: 'Dois', camadas: []}]}, null, 2));
  const m = p.manifesto();
  p.gravarTexto('estudio.json', JSON.stringify({...m, documentos: [...m.documentos,
    {id: 'simples', modulo: 'imagem', caminho: 'imagem/simples.json', titulo: 'Simples'},
    {id: 'carrossel', modulo: 'imagem', caminho: 'imagem/carrossel.json', titulo: 'Carrossel'}]} satisfies Manifesto, null, 2));
  return p;
};

type Chamada = {erro: boolean; texto: string; dado: any};
const conectar = async (p: Projeto, portao?: Portao) => {
  const servidor = new McpServer({name: 'estudio', version: '0'});
  registrarFerramentas(servidor, p, 'agente', 'IDE', undefined, undefined, portao);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const cliente = new Client({name: 'teste', version: '0'});
  await Promise.all([servidor.connect(a), cliente.connect(b)]);
  const chamar = async (name: string, args: Record<string, unknown> = {}): Promise<Chamada> => {
    const r = (await cliente.callTool({name, arguments: args})) as {isError?: boolean; content: {type: 'text'; text: string}[]};
    const t = r.content[0].text;
    let dado: unknown;
    try {
      dado = JSON.parse(t);
    } catch {
      dado = undefined;
    }
    return {erro: Boolean(r.isError), texto: t, dado};
  };
  return {chamar, fechar: () => cliente.close()};
};

/** Serviço falso: anota os pedidos; o vídeo termina quando `terminar` é chamado (ou na hora, com `imediato`). */
const servicoFalso = (o: {imediato?: boolean; janela?: boolean} = {}) => {
  const pedidos: {tipo: string; documento: string; opcoes?: Partial<OpcoesExportarVideo>; pedido?: unknown}[] = [];
  let terminar: (r: ResultadoVideoFinal) => void = () => undefined;
  let avisar: (a: AndamentoFinal) => void = () => undefined;
  let cancelado = 0;
  const s: ServicoExportacaoFinal = {
    video: (projeto, documento, opcoes, aviso) => {
      pedidos.push({tipo: 'video', documento, opcoes});
      avisar = aviso ?? (() => undefined);
      const arquivo = path.join(projeto.pastaDeSaidas(), 'Vídeo.mp4');
      if (o.imediato) return Promise.resolve({ok: true, arquivos: [arquivo], pasta: projeto.pastaDeSaidas()});
      return new Promise((ok) => (terminar = ok));
    },
    cancelarVideo: () => {
      cancelado++;
      terminar({ok: false, cancelado: true, mensagem: 'Exportação cancelada', arquivos: []});
    },
    ...(o.janela ? {
      imagem: async (projeto, pedido) => {
        pedidos.push({tipo: 'imagem', documento: pedido.documento, pedido});
        return {ok: true, arquivo: path.join(projeto.pastaDeSaidas(), `${pedido.nome ?? 'Simples'}.${pedido.formato}`), pasta: projeto.pastaDeSaidas(), faltaram: []};
      },
      carrossel: async (projeto, pedido) => {
        pedidos.push({tipo: 'carrossel', documento: pedido.documento, pedido});
        const pasta = path.join(projeto.pastaDeSaidas(), pedido.nome ?? 'Carrossel');
        return {ok: true, pasta, ...(pedido.pdf ? {pdf: `${pasta}.pdf`} : {}), arquivos: [path.join(pasta, '01.png'), path.join(pasta, '02.png')], faltaram: ['Foto (Dois)']};
      },
    } : {}),
  };
  return {s, pedidos, terminar: (r: ResultadoVideoFinal) => terminar(r), avisar: (a: AndamentoFinal) => avisar(a), cancelado: () => cancelado};
};

describe('contas da exportação final', () => {
  it('destinos: ids da tela, proporção, medida (vira o preset quando bate) e um personalizado por vez', () => {
    expect(destinosDoPedido(['reels', '16:9', '1080x1350'])).toEqual([
      {id: 'reels', largura: 1080, altura: 1920}, {id: 'youtube', largura: 1920, altura: 1080}, {id: 'feed', largura: 1080, altura: 1350}]);
    expect(destinosDoPedido(['1000x500', 'reels', 'reels'])).toEqual([{id: 'personalizado', largura: 1000, altura: 500}, {id: 'reels', largura: 1080, altura: 1920}]);
    expect(() => destinosDoPedido(['1000x500', '800x800'])).toThrow(/um tamanho personalizado/);
    expect(() => destinosDoPedido(['tiktok'])).toThrow(/destino desconhecido/);
    expect(() => destinosDoPedido(['8000x100'])).toThrow(/16 a 7680/);
  });

  it('documento: o pedido (do módulo certo), o da tela ou o primeiro do módulo', () => {
    const m = {formato: 1, nome: 'x', documentos: [
      {id: 'img', modulo: 'imagem', caminho: 'a', titulo: 'A'}, {id: 'v1', modulo: 'video', caminho: 'b', titulo: 'B'}, {id: 'an', modulo: 'animacao', caminho: 'c', titulo: 'C'}]} as Manifesto;
    expect(documentoPara(m, ['video', 'animacao'], undefined, undefined, '')).toBe('v1');
    expect(documentoPara(m, ['video', 'animacao'], undefined, 'an', '')).toBe('an');
    expect(documentoPara(m, ['video', 'animacao'], undefined, 'img', '')).toBe('v1'); // a tela está numa imagem: o primeiro vídeo
    expect(() => documentoPara(m, ['video', 'animacao'], 'img', undefined, 'use exportar_imagem')).toThrow(/módulo imagem; use exportar_imagem/);
    expect(() => documentoPara(m, ['imagem'], 'nada', undefined, '')).toThrow(/não achado/);
  });

  it('portão: as três que gravam pedem o cartão; a situação é livre', () => {
    const anot = {readOnlyHint: false, destructiveHint: false, openWorldHint: false} as never;
    for (const f of ['exportar_video', 'exportar_imagem', 'exportar_carrossel']) expect(classeDe(f, anot)).toBe('cartao');
    expect(classeDe('situacao_exportacao', anot)).toBe('livre');
  });
});

describe('exportar_video pelo MCP (serviço falso)', () => {
  it('pronto dentro da espera: opções da tela, marca d\'água guardada, arquivos e markdown; nada no diário', async () => {
    const f = servicoFalso({imediato: true});
    definirServicoExportacao(f.s);
    const p = projetoDeTeste();
    gravarPrefsExportacao(p, {marca_dagua: {reels: {ligada: true, conteudo: 'logo', canto: 'sup-dir', tamanho: 0.06, opacidade: 0.85}}});
    const {chamar, fechar} = await conectar(p);
    const r = await chamar('exportar_video', {destinos: ['reels', 'youtube'], codec: 'webm', qualidade: 'leve', escala: 0.5, trecho: {de_ms: 0, ate_ms: 1500}, nome: 'Entrega', legendas: 'ambos'});
    expect(r.erro).toBe(false);
    expect(r.dado).toMatchObject({situacao: 'pronta', ok: true, documento: 'video', em_saidas: ['saidas/Vídeo.mp4']});
    expect(r.dado.markdown).toContain('Vídeo.mp4');
    const o = f.pedidos[0].opcoes!;
    expect(o).toMatchObject({codec: 'webm', qualidade: 'leve', escala: 0.5, trecho: {de_ms: 0, ate_ms: 1500}, nome: 'Entrega'});
    expect(o.destinos?.map((d) => d.id)).toEqual(['reels', 'youtube']);
    expect(o.marca_dagua?.reels?.ligada).toBe(true);
    expect(o.legendas?.reels).toBe('ambos');
    expect(o.legendas?.youtube).toBe('ambos');
    // marca_dagua: false tira a marca guardada; sem destinos, o formato do documento (o exportador decide)
    await chamar('exportar_video', {marca_dagua: false});
    expect(f.pedidos[1].opcoes).toMatchObject({marca_dagua: {}});
    expect(f.pedidos[1].opcoes?.destinos).toBeUndefined();
    expect(p.diario()).toEqual([]);
    await fechar();
  });

  it('recusa o que não dá: escala fora da lista, destino desconhecido, imagem, documento que não há', async () => {
    const f = servicoFalso({imediato: true});
    definirServicoExportacao(f.s);
    const {chamar, fechar} = await conectar(projetoDeTeste());
    expect((await chamar('exportar_video', {escala: 0.3})).texto).toMatch(/escala 0.3: use 1, 0.75, 0.5/);
    expect((await chamar('exportar_video', {destinos: ['tiktok']})).texto).toMatch(/destino desconhecido/);
    expect((await chamar('exportar_video', {documento: 'simples'})).texto).toMatch(/módulo imagem.*exportar_imagem/);
    expect((await chamar('exportar_video', {documento: 'nada'})).texto).toMatch(/não achado/);
    expect(f.pedidos).toEqual([]);
    await fechar();
  });

  it('render longo: devolve o id cedo, situacao_exportacao acompanha, recusa outro e mostra os arquivos no fim', async () => {
    const f = servicoFalso();
    definirServicoExportacao(f.s);
    definirEsperaDaChamada(30);
    const p = projetoDeTeste();
    const {chamar, fechar} = await conectar(p);
    const r = await chamar('exportar_video', {});
    expect(r.erro).toBe(false);
    expect(r.dado).toMatchObject({situacao: 'renderizando', documento: 'video'});
    const id = r.dado.exportacao as string;
    expect(r.dado.proximo_passo).toContain(id);
    f.avisar({tipo: 'progresso', etapa: 'renderizando', progresso: 42.4, arquivo: 'Vídeo.mp4', indice: 1, total: 1, geral: 0.424});
    const s1 = await chamar('situacao_exportacao', {exportacao: id});
    expect(s1.dado).toMatchObject({situacao: 'renderizando', andamento: {arquivo: 'Vídeo.mp4', etapa: 'renderizando', porcento: 42, geral_porcento: 42}});
    const outra = await chamar('exportar_video', {});
    expect(outra.erro).toBe(true);
    expect(outra.texto).toContain(id);
    f.terminar({ok: true, arquivos: [path.join(p.pastaDeSaidas(), 'Vídeo.mp4')], pasta: p.pastaDeSaidas(), avisos: ['som fora do alvo']});
    await new Promise((ok) => setTimeout(ok, 10));
    const s2 = await chamar('situacao_exportacao', {}); // sem id: a mais recente
    expect(s2.dado).toMatchObject({exportacao: id, situacao: 'pronta', em_saidas: ['saidas/Vídeo.mp4'], avisos: ['som fora do alvo']});
    expect((await chamar('situacao_exportacao', {exportacao: 'outro'})).texto).toMatch(/exportação não achada/);
    await fechar();
  });

  it('cancelar pela situacao_exportacao para o render e a situação vira cancelada', async () => {
    const f = servicoFalso();
    definirServicoExportacao(f.s);
    definirEsperaDaChamada(0);
    const {chamar, fechar} = await conectar(projetoDeTeste());
    const id = (await chamar('exportar_video', {})).dado.exportacao;
    expect((await chamar('situacao_exportacao', {exportacao: id, cancelar: true})).dado.situacao).toBe('cancelando');
    expect(f.cancelado()).toBe(1);
    await new Promise((ok) => setTimeout(ok, 10));
    const s = await chamar('situacao_exportacao', {exportacao: id});
    expect(s.dado).toMatchObject({situacao: 'cancelada', mensagem: 'Exportação cancelada'});
    await fechar();
  });

  it('negado no cartão, nada roda', async () => {
    const f = servicoFalso({imediato: true});
    definirServicoExportacao(f.s);
    const perguntas: string[] = [];
    const {chamar, fechar} = await conectar(projetoDeTeste(), {perguntar: async (x) => (perguntas.push(`${x.ferramenta}: ${x.motivo}`), false)});
    const r = await chamar('exportar_video', {});
    expect(r.erro).toBe(true);
    expect(r.texto).toMatch(/negou/);
    expect(perguntas[0]).toMatch(/^exportar_video: exportar o vídeo para saidas/);
    expect(f.pedidos).toEqual([]);
    await fechar();
  });

  it('sem o render do Estúdio, diz que não há', async () => {
    const {chamar, fechar} = await conectar(projetoDeTeste());
    expect((await chamar('exportar_video', {})).texto).toMatch(/precisa do render do Estúdio/);
    await fechar();
  });
});

describe('exportar_imagem e exportar_carrossel pelo MCP', () => {
  it('com o app fechado (sem janela), pedem para abrir o projeto no Estúdio', async () => {
    definirServicoExportacao(servicoFalso().s);
    const {chamar, fechar} = await conectar(projetoDeTeste());
    expect((await chamar('exportar_imagem', {documento: 'simples'})).texto).toBe(ABRA_NO_APP);
    expect((await chamar('exportar_carrossel', {})).texto).toBe(ABRA_NO_APP);
    await fechar();
  });

  it('com a janela: opções da imagem, carrossel sem PDF e com nome, e os avisos do que não carregou', async () => {
    const f = servicoFalso({janela: true});
    definirServicoExportacao(f.s);
    const p = projetoDeTeste();
    const {chamar, fechar} = await conectar(p);
    const i = await chamar('exportar_imagem', {documento: 'simples', formato: 'jpg', qualidade: 70, escala: 2, nome: 'Post'});
    expect(i.erro).toBe(false);
    expect(f.pedidos[0].pedido).toEqual({documento: 'simples', formato: 'jpg', qualidade: 70, escala: 2, nome: 'Post'});
    expect(i.dado).toMatchObject({ok: true, em_saidas: 'saidas/Post.jpg'});
    expect(i.dado.markdown).toContain('Post.jpg');
    // sem documento: a primeira imagem; o padrão é PNG a 90, escala 1
    await chamar('exportar_imagem', {});
    expect(f.pedidos[1].pedido).toEqual({documento: 'simples', formato: 'png', qualidade: 90, escala: 1});
    // imagem com páginas é carrossel, e o carrossel sem documento acha o carrossel (não a primeira imagem)
    expect((await chamar('exportar_imagem', {documento: 'carrossel'})).texto).toMatch(/carrossel.*exportar_carrossel/);
    expect((await chamar('exportar_carrossel', {documento: 'simples'})).texto).toMatch(/não tem páginas: use exportar_imagem/);
    const c = await chamar('exportar_carrossel', {pdf: false, nome: 'LinkedIn'});
    expect(f.pedidos[2].pedido).toEqual({documento: 'carrossel', pdf: false, nome: 'LinkedIn'});
    expect(c.dado).toMatchObject({ok: true, em_saidas: ['saidas/LinkedIn/01.png', 'saidas/LinkedIn/02.png'], avisos: [expect.stringContaining('Foto (Dois)')]});
    expect(c.dado.pdf).toBeUndefined();
    expect((await chamar('exportar_carrossel', {})).dado.pdf).toBe(path.join(p.pastaDeSaidas(), 'Carrossel.pdf'));
    await fechar();
  });

  it('o serviço do app traduz a resposta da janela: sem janela vira "abra o projeto", prazo estourado avisa que pode terminar', async () => {
    const exportador = criarExportadorVideo({preparar: async () => ({serveUrl: '', browserExecutable: null, binariesDirectory: null}), comMidia: (_r, f) => f('')});
    const p = projetoDeTeste();
    const pedido = {documento: 'simples', formato: 'png' as const, qualidade: 90, escala: 1};
    const sem = servicoDeExportacao(exportador, async () => ({ok: false, mensagem: 'sem janela do Estúdio aberta'}));
    await expect(sem.imagem!(p, pedido)).rejects.toThrow(ABRA_NO_APP);
    const prazo = servicoDeExportacao(exportador, async () => ({ok: false, mensagem: 'a janela não respondeu "exportar:imagem" em 240 s'}));
    await expect(prazo.imagem!(p, pedido)).rejects.toThrow(/pode ainda terminar sozinha em saidas/);
    const ok = servicoDeExportacao(exportador, async (acao, dados) => ({ok: true, dados: {ok: true, arquivo: `${acao}:${(dados as {documento: string}).documento}`}}));
    expect(await ok.carrossel!(p, {documento: 'carrossel', pdf: true})).toEqual({ok: true, arquivo: 'exportar:carrossel:carrossel'});
    expect(servicoDeExportacao(exportador).imagem).toBeUndefined(); // fora do app não há janela
  });
});

describe('o exportador do vídeo (o mesmo do diálogo), com o render falso', () => {
  const criar = () => {
    const andamento: {geral?: number; mensagem?: string; arquivo?: string}[] = [];
    let terminou = 0;
    const exportador = criarExportadorVideo({
      preparar: async () => ({serveUrl: '', browserExecutable: null, binariesDirectory: null}),
      comMidia: (_raiz, f) => f('http://127.0.0.1:1'),
      aoAndamento: (x) => andamento.push(x),
      aoTerminar: () => terminou++,
    });
    return {exportador, andamento, terminou: () => terminou};
  };

  it('um arquivo por destino em saidas/, sem gravar por cima, com o andamento geral e o aviso de fim', async () => {
    const {exportador, andamento, terminou} = criar();
    const p = projetoDeTeste();
    const r = await exportador.exportar(p, 'video', {destinos: [{id: 'reels', largura: 1080, altura: 1920}, {id: 'youtube', largura: 1920, altura: 1080}], escala: 0.5, nome: 'Entrega'});
    expect(r.ok).toBe(true);
    expect(r.arquivos?.map((a) => path.basename(a))).toEqual(['Entrega-9x16.mp4', 'Entrega-16x9.mp4']);
    expect(render.pedidos.map((x) => {
      const props = (x as RenderVideo).props;
      return [props.largura, props.altura];
    })).toEqual([[540, 960], [960, 540]]);
    expect(andamento.some((x) => x.geral === 0.75)).toBe(true); // metade do segundo de dois arquivos
    expect(andamento.at(-1)?.mensagem).toMatch(/^Exportado: saidas[/\\]Entrega-9x16.mp4/);
    expect(terminou()).toBe(1);
    const de_novo = await exportador.exportar(p, 'video', {});
    expect(path.basename(de_novo.arquivo!)).toBe('Vídeo.mp4');
    expect(path.basename((await exportador.exportar(p, 'video', {})).arquivo!)).toBe('Vídeo (2).mp4');
  });

  it('uma exportação por vez; cancelar tira o arquivo pela metade', async () => {
    const {exportador, terminou} = criar();
    const p = projetoDeTeste();
    render.modo = 'longo';
    const primeira = exportador.exportar(p, 'video');
    await vi.waitFor(() => expect(render.pedidos).toHaveLength(1));
    expect(exportador.ocupado()).toBe(true);
    expect(await exportador.exportar(p, 'video')).toEqual({ok: false, mensagem: 'já há uma exportação em andamento'});
    exportador.cancelar();
    const r = await primeira;
    expect(r).toMatchObject({ok: false, cancelado: true, mensagem: 'Exportação cancelada', arquivos: []});
    expect(readdirSync(p.pastaDeSaidas()).filter((n) => n.endsWith('.mp4'))).toEqual([]);
    expect(exportador.ocupado()).toBe(false);
    expect(terminou()).toBe(1);
  });

  it('trecho fora do vídeo é recusado; documento que não é vídeo não começa; falha do render volta com a mensagem', async () => {
    const {exportador, terminou} = criar();
    const p = projetoDeTeste();
    expect((await exportador.exportar(p, 'video', {trecho: {de_ms: 2000, ate_ms: 9000}})).mensagem).toMatch(/trecho inválido.*3000 ms/);
    expect((await exportador.exportar(p, 'simples')).ok).toBe(false);
    expect(terminou()).toBe(1); // só o trecho inválido chegou a começar (o documento que não é vídeo para antes)
    render.modo = 'falha';
    const r = await exportador.exportar(p, 'video');
    expect(r).toMatchObject({ok: false, mensagem: 'o Chrome do render caiu'});
    expect(existsSync(path.join(p.pastaDeSaidas(), 'Vídeo.mp4'))).toBe(false);
  });
});

// ---------- prova: o vídeo de verdade pelo nucleo.cjs (Electron em modo Node), como a IDE com o app fechado ----------
const PROVA = process.env.ESTUDIO_PROVA_RENDER === '1';
describe.skipIf(!PROVA)('prova: exportar_video de verdade pelo nucleo.cjs', () => {
  it('um MP4 curto em 9:16 e 16:9, meio tamanho, em saidas/', async () => {
    execSync('npm run mcp:build', {cwd: RAIZ, stdio: 'ignore'});
    const p = projetoDeTeste();
    const electron = require('electron') as unknown as string;
    const env = Object.fromEntries(Object.entries({...process.env, ELECTRON_RUN_AS_NODE: '1'}).filter(([, v]) => v !== undefined)) as Record<string, string>;
    const cliente = new Client({name: 'prova', version: '0'});
    await cliente.connect(new StdioClientTransport({command: electron, args: [path.join(RAIZ, 'dist-mcp/nucleo.cjs'), '--projeto', p.raiz, '--origem', 'IDE', '--ide'], env, cwd: p.raiz}));
    try {
      const r = (await cliente.callTool({name: 'exportar_video', arguments: {destinos: ['reels', 'youtube'], escala: 0.5, qualidade: 'leve'}}, undefined, {timeout: 600_000})) as {isError?: boolean; content: {text: string}[]};
      expect(r.isError, r.content[0]?.text).toBeFalsy();
      const dado = JSON.parse(r.content[0].text);
      expect(dado.situacao).toBe('pronta');
      expect(dado.em_saidas).toEqual(['saidas/Vídeo-9x16.mp4', 'saidas/Vídeo-16x9.mp4']);
      for (const a of dado.arquivos as string[]) expect(readFileSync(a).subarray(4, 8).toString()).toBe('ftyp');
      const sem = (await cliente.callTool({name: 'exportar_imagem', arguments: {}})) as {isError?: boolean; content: {text: string}[]};
      expect(sem.content[0].text).toBe(ABRA_NO_APP);
    } finally {
      await cliente.close();
    }
  }, 900_000);
});
