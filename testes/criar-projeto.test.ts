// Começar do zero: criar projeto e documento, o vídeo de cenas e os formatos (Onda A, 05/11/2026).
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {comIdsNovos, ehDocCenas, idLivre, novoDocCenas, resolverCenas, type DocCenas} from '../src/nucleo/cenas';
import {claudeMd, dentroDoOneDrive, documentoNovo, gravarPlano, nomeDePasta, nomePadrao, pastaLivre, planoDoExemplo, planoDoProjeto} from '../src/nucleo/criar-projeto';
import {EXEMPLO as EXEMPLO_DO_APP} from '../src/nucleo/exemplo';
import {MODELOS} from '../src/nucleo/modelos';
import {FORMATO_PADRAO, formatoDoVideo, proporcaoDe, rotuloFormato} from '../src/nucleo/formatos';
import {Projeto} from '../src/nucleo/projeto';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-criar-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));
// um projeto pronto no papel do exemplo empacotado (src/nucleo/exemplo.ts)
const EXEMPLO = path.join(__dirname, 'fixtures', 'projeto');

describe('formatos', () => {
  it('rotula pelo destino e cai no carrossel quando falta', () => {
    expect(proporcaoDe(1920, 1080)).toBe('16:9');
    expect(proporcaoDe(1000, 500)).toBe('2:1');
    expect(formatoDoVideo({})).toEqual(FORMATO_PADRAO);
    expect(formatoDoVideo({formato: {largura: 1920, altura: 1080, fps: 25}})).toEqual({largura: 1920, altura: 1080, fps: 25});
    expect(formatoDoVideo({formato: {largura: -3, altura: 'x'}})).toEqual(FORMATO_PADRAO);
    expect(rotuloFormato({largura: 1080, altura: 1920, fps: 30})).toBe('9:16 · 1080×1920 · 30 qps');
  });
});

describe('nomes e pastas', () => {
  it('nome padrão com data e pasta que o Windows aceita', () => {
    expect(nomePadrao(new Date(2026, 10, 5, 14, 7))).toBe('Sem título · 05/11 14:07');
    expect(nomeDePasta('Sem título · 05/11 14:07')).toBe('Sem título - 05-11 14h07');
    expect(nomeDePasta('a<b>c:d"e|f?g*.')).toBe('a-b-chd-e-f-g-');
    expect(nomeDePasta('CON')).toBe('Projeto CON');
  });
  it('não repete pasta que já existe', () => {
    const tem = new Set([path.join('R', 'X'), path.join('R', 'X (2)')]);
    expect(pastaLivre('R', 'X', (p) => tem.has(p))).toBe(path.join('R', 'X (3)'));
  });
  it('reconhece pasta do OneDrive', () => {
    expect(dentroDoOneDrive('C:\\Users\\a\\OneDrive - Empresa\\Projetos')).toBe(true);
    expect(dentroDoOneDrive('C:\\Users\\a\\OneDrive\\x')).toBe(true);
    expect(dentroDoOneDrive('C:\\Users\\a\\Estudio\\x')).toBe(false);
  });
});

describe('vídeo de cenas', () => {
  const doc = novoDocCenas({largura: 1920, altura: 1080, fps: 30});

  it('nasce com uma cena e o título', () => {
    expect(ehDocCenas(doc)).toBe(true);
    expect(doc.cenas).toHaveLength(1);
    expect(doc.cenas[0].blocos[0]).toMatchObject({tipo: 'titulo', texto: 'Seu título'});
  });

  it('resolve tempos de saída, formato e origem de cada bloco', () => {
    const d: DocCenas = {...doc, cenas: [
      {id: 'a', duracao_ms: 2000, blocos: [{id: 'a1', tipo: 'titulo', x: 0.1, y: 0.4, largura: 0.8, em: 300, texto: 'Oi'}]},
      {id: 'b', duracao_ms: 3000, blocos: [{id: 'b1', tipo: 'texto', x: 0.1, y: 0.5, largura: 0.8, em: 500, sai: 2500}]},
    ]};
    const {props, avisos} = resolverCenas(d);
    expect(avisos).toEqual([]);
    expect(props).toMatchObject({composicao: 'VideoCenas', duracao_ms: 5000, largura: 1920, altura: 1080, fps: 30});
    expect(props.cenas.map((c) => [c.t_in, c.t_out])).toEqual([[0, 2000], [2000, 5000]]);
    expect(props.cenas[0].blocos[0]).toMatchObject({em: 300, sai: 2000, origem: '/cenas/0/blocos/0'});
    expect(props.cenas[1].blocos[0]).toMatchObject({em: 2500, sai: 4500, origem: '/cenas/1/blocos/0'});
  });

  it('corrige duração fora do lugar com aviso, sem quebrar', () => {
    const {props, avisos} = resolverCenas({...doc, cenas: [{id: 'a', duracao_ms: 10, blocos: []}]});
    expect(props.cenas[0].t_out).toBe(300);
    expect(avisos[0]).toMatch(/duração/);
    expect(resolverCenas({...doc, cenas: []}).props.duracao_ms).toBe(1000);
  });

  it('repassa os refs da pesquisa no bloco e na cena, e não inventa quando faltam', () => {
    const d: DocCenas = {...doc, cenas: [
      {id: 'a', duracao_ms: 2000, refs: ['F1'], blocos: [{id: 'a1', tipo: 'texto', x: 0.1, y: 0.4, largura: 0.8, texto: 'Dez dias', refs: ['F3', 'F7']}]},
      {id: 'b', duracao_ms: 2000, blocos: [{id: 'b1', tipo: 'titulo', x: 0.1, y: 0.4, largura: 0.8}]},
    ]};
    const {props} = resolverCenas(d);
    expect(props.cenas[0].refs).toEqual(['F1']);
    expect(props.cenas[0].blocos[0].refs).toEqual(['F3', 'F7']);
    expect(props.cenas[1]).not.toHaveProperty('refs');
    expect(props.cenas[1].blocos[0]).not.toHaveProperty('refs');
    expect(comIdsNovos(d.cenas[0], d, 'cena').blocos[0].refs).toEqual(['F3', 'F7']);
  });

  it('dá ids livres e duplica com ids novos', () => {
    expect(idLivre(doc, 'cena')).toBe('cena-2');
    const copia = comIdsNovos(doc.cenas[0], doc, 'cena');
    expect(copia.id).toBe('cena-2');
    expect(copia.blocos[0].id).not.toBe(doc.cenas[0].blocos[0].id);
  });
});

describe('criar projeto', () => {
  it('plano do vídeo em branco: manifesto, documento, .gitignore e CLAUDE.md', () => {
    const plano = planoDoProjeto({nome: 'Teste', modelo: 'video-branco', formato: {largura: 1080, altura: 1080, fps: 30}});
    expect(plano.manifesto.documentos).toEqual([{id: 'video', modulo: 'video', caminho: 'video/video.json', titulo: 'Vídeo'}]);
    const conteudo = JSON.parse(plano.arquivos['video/video.json']) as DocCenas;
    expect(conteudo.formato).toEqual({largura: 1080, altura: 1080, fps: 30});
    expect(plano.arquivos['.gitignore']).toContain('saidas/');
    expect(plano.arquivos['CLAUDE.md']).toContain('"tipo": "cenas"');
  });

  it('grava e abre como projeto do Estúdio', () => {
    const destino = gravarPlano(path.join(tmp, 'branco'), planoDoProjeto({nome: 'Branco', modelo: 'video-branco'}));
    const p = new Projeto(destino);
    expect(p.manifesto().nome).toBe('Branco');
    expect(existsSync(path.join(destino, 'midia'))).toBe(true);
    expect(existsSync(path.join(destino, 'saidas'))).toBe(true);
    expect(() => gravarPlano(destino, planoDoProjeto({nome: 'De novo', modelo: 'video-branco'}))).toThrow(/já existe/);
  });

  it('o exemplo é copiado inteiro com o nome novo', () => {
    const destino = gravarPlano(path.join(tmp, 'exemplo'), planoDoExemplo('Exemplo · Teste'), EXEMPLO);
    const m = new Projeto(destino).manifesto();
    expect(m.nome).toBe('Exemplo · Teste');
    expect(m.documentos.map((d) => d.id)).toEqual(['carrossel', 'capa', 'cena3d']);
    expect(existsSync(path.join(destino, 'video', 'palavras.json'))).toBe(true);
    // o CLAUDE.md do projeto tem a seção "Pesquisa" (o caso de uso principal: o carrossel narrado), uma vez só
    const md = readFileSync(path.join(destino, 'CLAUDE.md'), 'utf-8');
    expect(md).toContain('## Como trabalhar');
    expect(md.match(/## Pesquisa/g)).toHaveLength(1);
    expect(md).toContain('`registrar_fato`');
    expect(readFileSync(path.join(destino, '.gitignore'), 'utf-8')).toContain('pesquisa/fontes/');
    // o próprio exemplo já traz a seção igual à que o app gera e a linha do .gitignore: mudou a seção, muda o exemplo
    const doExemplo = readFileSync(path.join(EXEMPLO, 'CLAUDE.md'), 'utf-8').replace(/\r\n/g, '\n');
    expect(doExemplo).toContain(planoDoExemplo('x').acrescentarAoClaudeMd);
    expect(readFileSync(path.join(EXEMPLO, '.gitignore'), 'utf-8')).toContain('pesquisa/fontes/');
    // sem a pasta do exemplo, gravar avisa em vez de criar um projeto vazio
    expect(() => gravarPlano(path.join(tmp, 'sem-exemplo'), planoDoExemplo('Sem'))).toThrow(/exemplo/);
  });

  it('o exemplo não é modelo, e o nome da pasta dele fica numa constante', () => {
    expect(MODELOS.map((m) => m.id)).toEqual(['video-branco', 'imagem-branco', '3d-branco', 'animacao-branco', 'animacao-9x16', 'animacao-logo-pixel']);
    expect(EXEMPLO_DO_APP.pasta).toMatch(/^[a-z0-9-]+$/);
  });

  it('documento novo não colide e entra no manifesto', () => {
    const destino = gravarPlano(path.join(tmp, 'docs'), planoDoProjeto({nome: 'Docs', modelo: 'video-branco'}));
    const p = new Projeto(destino);
    const {entrada, conteudo} = documentoNovo(p.manifesto(), 'video', {formato: {largura: 1920, altura: 1080, fps: 30}});
    expect(entrada).toMatchObject({id: 'video-2', caminho: 'video/video-2.json', titulo: 'Vídeo 2'});
    p.adicionarDocumento(entrada, conteudo);
    const img = documentoNovo(p.manifesto(), 'imagem');
    p.adicionarDocumento(img.entrada, img.conteudo);
    expect(p.manifesto().documentos.map((d) => d.id)).toEqual(['video', 'video-2', 'imagem']);
    expect(p.lerJson<DocCenas>('video/video-2.json').doc.formato.largura).toBe(1920);
    expect(() => p.adicionarDocumento(entrada, conteudo)).toThrow(/já existe/);
    p.renomear('Docs 2');
    expect(JSON.parse(readFileSync(path.join(destino, 'estudio.json'), 'utf-8')).nome).toBe('Docs 2');
  });

  it('manifesto quebrado vira mensagem útil', () => {
    const destino = gravarPlano(path.join(tmp, 'quebrado'), planoDoProjeto({nome: 'Q', modelo: '3d-branco'}));
    const p = new Projeto(destino);
    p.gravarTexto('estudio.json', '{"nome": ');
    expect(() => p.manifesto()).toThrow(/não é um JSON válido/);
  });

  it('CLAUDE.md fala só do que o projeto tem', () => {
    expect(claudeMd(['imagem'])).not.toContain('"tipo": "cenas"');
    expect(claudeMd(['video', '3d'])).toContain('Cena 3D');
  });

  it('CLAUDE.md ensina a pesquisa como visualizador, com as ferramentas do MCP', () => {
    const md = claudeMd(['video']);
    expect(md).toContain('## Pesquisa');
    for (const f of ['ler_fonte', 'anotar_fonte', 'registrar_fato', 'listar_pesquisa', 'texto_da_fonte', 'checar_texto']) expect(md).toContain(`\`${f}\``);
    expect(md).toContain('"refs": ["F3", "F7"]');
    expect(md).toContain('observação de quem baixou');
    expect(md).toContain('pesquisa/dossie.md');
    expect(md).not.toMatch(/aprovad|marque .* como aprovado|a pessoa aprova/i);
    expect(claudeMd(['imagem'])).toContain('## Pesquisa');
    expect(claudeMd(['3d'])).not.toContain('## Pesquisa');
    expect(md.indexOf('## Pesquisa')).toBeGreaterThan(md.indexOf('## Como trabalhar'));
  });

  it('o texto baixado das fontes fica fora do git', () => {
    const plano = planoDoProjeto({nome: 'P', modelo: 'video-branco'});
    const linhas = plano.arquivos['.gitignore'].split('\n');
    expect(linhas).toContain('pesquisa/fontes/');
    expect(linhas).not.toContain('pesquisa/');
  });
});
