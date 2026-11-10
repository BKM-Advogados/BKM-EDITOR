// O servidor MCP de verdade (o mesmo arquivo que o Claude chama), sobre uma cópia do projeto de exemplo.
import {execSync} from 'node:child_process';
import {cpSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {Projeto} from '../src/nucleo/projeto';

const RAIZ = path.join(__dirname, '..');
let pasta = '';
let cliente: Client;

const chamar = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await cliente.callTool({name, arguments: args})) as {isError?: boolean; content: {text: string}[]};
  const t = r.content[0].text;
  let dado: unknown = t;
  try {
    dado = JSON.parse(t);
  } catch {
    /* texto simples */
  }
  return {erro: Boolean(r.isError), dado: dado as any};
};

beforeAll(async () => {
  execSync('npm run mcp:build', {cwd: RAIZ, stdio: 'ignore'});
  pasta = mkdtempSync(path.join(tmpdir(), 'estudio-mcp-'));
  cpSync(path.join(RAIZ, 'exemplos', 'exemplo'), pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
  cliente = new Client({name: 'teste', version: '0'});
  // os kits de marca vão para uma pasta de teste, não para a da pessoa
  const env = Object.fromEntries(Object.entries({...process.env, ESTUDIO_MARCAS: path.join(pasta, '.marcas-teste')}).filter(([, v]) => v !== undefined)) as Record<string, string>;
  await cliente.connect(new StdioClientTransport({command: process.execPath, args: [path.join(RAIZ, 'dist-mcp', 'nucleo.cjs'), '--projeto', pasta], env}));
}, 60_000);

afterAll(async () => {
  await cliente?.close();
  rmSync(pasta, {recursive: true, force: true});
});

describe('MCP estudio', () => {
  it('lista as ferramentas', async () => {
    const {tools} = await cliente.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'adicionar_camada_animacao', 'adicionar_clipe_audio', 'agrupar_camadas', 'alinhar_camadas', 'animar', 'anotar_fonte', 'aplicar_cortes_fala', 'aplicar_marca', 'aplicar_patch', 'aplicar_progressao', 'arranjar', 'buscar_icone',
      'cancelar_transicao', 'checar_texto', 'concluir_transicao', 'copiar_clipe', 'cor_da_marca', 'creditos_das_musicas', 'criar_animacao', 'criar_comentario', 'criar_documento', 'criar_padrao', 'crossfade', 'desagrupar_camadas',
      'desfazer', 'destravar_camadas', 'distribuir_camadas', 'dividir_clipe', 'editar_legenda', 'editar_notas', 'efeito_pixel', 'encaixar_no_video', 'escolher_trilha', 'escrever_notas', 'estado_do_editor', 'exportar_legendas',
      'exportar_musica', 'fazer_lista', 'fonte_da_marca', 'gerar_notas', 'guia_do_projeto', 'importar_legendas', 'importar_midi', 'inserir_icone', 'inserir_linha', 'ler_comentario', 'ler_documento', 'ler_fonte',
      'ler_legendas', 'ler_musica', 'levar_para', 'licencas_do_projeto', 'listar_comentarios', 'listar_midia', 'listar_mudancas', 'listar_pesquisa', 'listar_trilhas', 'marca_dagua', 'marcar_midia', 'medir_contraste_marca',
      'medir_musica', 'pixelizar_imagem', 'por_no_video', 'preparar_teleprompter', 'projeto_info', 'propor_cortes_fala', 'reabrir_comentario', 'registrar_fato', 'remover_fundo', 'renomear_projeto', 'resolver_comentario', 'responder_comentario',
      'reverter', 'selecionar_camadas', 'texto_da_fonte', 'transcrever', 'travar_camadas', 'trocar_kit', 'ver_animacao', 'ver_cenas', 'ver_marca', 'ver_quadro',
      'ver_trecho',
    ]);
  });

  it('resolve um comentário da pessoa com patch, e a mudança vai para o diário', async () => {
    const p = new Projeto(pasta);
    const c = p.novoComentario({documento: 'carrossel', autor: 'pessoa', texto: 'o 25% entra cedo demais', alvo: {objeto: '/cenas/2/blocos/1', tempo_ms: 47000}});

    const lido = await chamar('ler_comentario', {id: c.id});
    expect(lido.dado.objeto_atual.tipo).toBe('numero');

    const doc = await chamar('ler_documento', {documento: 'carrossel', caminho: '/cenas/2/blocos/1/em'});
    expect(doc.dado.conteudo).toBe('adicional@43800');

    const ok = await chamar('aplicar_patch', {
      documento: 'carrossel', versao_base: doc.dado.versao, rotulo: 'número entra no fim da palavra',
      patch: [{op: 'test', path: '/cenas/2/blocos/1/em', value: 'adicional@43800'}, {op: 'replace', path: '/cenas/2/blocos/1/em', value: 'adicional$@43800'}],
    });
    expect(ok.erro).toBe(false);

    // versão velha: recusado, nada gravado
    const velho = await chamar('aplicar_patch', {documento: 'carrossel', versao_base: doc.dado.versao, patch: [{op: 'replace', path: '/cenas/2/blocos/1/y', value: 1}]});
    expect(velho.erro).toBe(true);
    expect(String(velho.dado)).toContain('conflito');

    await chamar('responder_comentario', {id: c.id, texto: 'agora entra no fim de "adicional"'});
    await chamar('resolver_comentario', {id: c.id, nota: 'em → adicional$@43800'});
    expect(p.comentarios()[0].estado).toBe('resolvido');

    const mud = await chamar('listar_mudancas');
    expect(mud.dado).toHaveLength(1);
    expect(mud.dado[0]).toMatchObject({autor: 'agente', origem: 'mcp', rotulo: 'número entra no fim da palavra'});
    expect(p.diario()[0].inverso).toEqual([{op: 'replace', path: '/cenas/2/blocos/1/em', value: 'adicional@43800'}]);
  });

  it('recusa patch cujo test falha, sem gravar', async () => {
    const doc = await chamar('ler_documento', {documento: 'capa'});
    const r = await chamar('aplicar_patch', {documento: 'capa', versao_base: doc.dado.versao,
      patch: [{op: 'test', path: '/camadas/2/texto', value: 'outro'}, {op: 'replace', path: '/camadas/2/tamanho', value: 10}]});
    expect(r.erro).toBe(true);
    const depois = await chamar('ler_documento', {documento: 'capa'});
    expect(depois.dado.versao).toBe(doc.dado.versao);
  });

  it('aplica um kit de marca a um vídeo de cenas novo', async () => {
    const criado = await chamar('criar_documento', {modulo: 'video', titulo: 'Com marca', formato: 'reels'});
    expect(criado.erro).toBe(false);
    const r = await chamar('aplicar_marca', {id: 'cliente', documento: criado.dado.id});
    expect(r.erro).toBe(false);
    expect(r.dado).toMatchObject({ok: true, documento: criado.dado.id, marca: 'cliente', nome: 'Cliente Advogados'});
    const doc = await chamar('ler_documento', {documento: criado.dado.id, caminho: '/tema'});
    expect(doc.dado.conteudo).toMatchObject({marca: 'cliente', fundo: '#171A19', destaque: '#C88155', fonte: 'Archivo'});
    const naoHa = await chamar('aplicar_marca', {id: 'inexistente', documento: criado.dado.id});
    expect(naoHa.erro).toBe(true);
    expect(String(naoHa.dado)).toContain('não achado');
  });

  it('busca ícones em português e insere um na imagem, na cor do kit (frente Marca)', async () => {
    const achou = await chamar('buscar_icone', {consulta: 'balança', limite: 3});
    expect(achou.erro).toBe(false);
    expect(achou.dado.icones[0].nome).toBe('scale');
    const r = await chamar('inserir_icone', {documento: 'capa', icone: 'scale', cor: '#FFFFFF', tamanho: 120});
    expect(r.erro).toBe(false);
    expect(r.dado).toMatchObject({ok: true, documento: 'capa', icone: 'scale', id: 'icone-1'});
    const depois = await chamar('ler_documento', {documento: 'capa', caminho: r.dado.camada});
    expect(depois.dado.conteudo).toMatchObject({tipo: 'forma', forma: 'icone', icone: 'scale', largura: 120, preenchimento: '#FFFFFF'});
    const nao = await chamar('inserir_icone', {documento: 'capa', icone: 'balanca'});
    expect(nao.erro).toBe(true);
    expect(String(nao.dado)).toContain('parecidos: scale');
    const semKit = await chamar('cor_da_marca', {documento: 'capa', camada: r.dado.camada, campo: 'preenchimento', nome: 'destaque'});
    expect(semKit.erro).toBe(false);
    expect(semKit.dado).toMatchObject({valor: '@destaque'});
  });

  it('lê uma fonte pela rede do Node (o fetch do MCP por stdio) e registra um fato', async () => {
    const html = readFileSync(path.join(__dirname, 'fixtures', 'pesquisa', 'planalto-art477.htm'));
    const local = http.createServer((_req, res) => res.writeHead(200, {'Content-Type': 'text/html; charset=windows-1252'}).end(html));
    await new Promise<void>((ok) => local.listen(0, '127.0.0.1', ok));
    try {
      const url = `http://127.0.0.1:${(local.address() as AddressInfo).port}/del5452compilado.htm`;
      const lida = await chamar('ler_fonte', {url});
      expect(lida.erro).toBe(false);
      expect(lida.dado).toMatchObject({id: 'f1', http: 200, nivel: 0});
      expect(lida.dado.texto).toContain('até dez dias contados a partir do término do contrato');
      const fato = await chamar('registrar_fato', {afirmacao: 'A rescisão é paga em até 10 dias.', fonte_id: 'f1', trecho: 'até dez dias contados a partir do término do contrato'});
      expect(fato.dado).toMatchObject({id: 'F1', achado: 'exato', estado: 'trecho_confere'});
      expect((await chamar('projeto_info')).dado).toMatchObject({fontes: 1, fatos: 1});
    } finally {
      local.close();
    }
  });
});
