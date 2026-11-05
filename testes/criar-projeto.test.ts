// Começar do zero: criar projeto e documento, o vídeo de cenas e os formatos (Onda A, 05/11/2026).
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {comIdsNovos, ehDocCenas, idLivre, novoDocCenas, resolverCenas, type DocCenas} from '../src/nucleo/cenas';
import {claudeMd, dentroDoOneDrive, documentoNovo, gravarPlano, nomeDePasta, nomePadrao, pastaLivre, planoDoProjeto} from '../src/nucleo/criar-projeto';
import {FORMATO_PADRAO, formatoDoVideo, proporcaoDe, rotuloFormato} from '../src/nucleo/formatos';
import {Projeto} from '../src/nucleo/projeto';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-criar-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));
const EXEMPLO = path.join(__dirname, '..', 'exemplos', 'exemplo');

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

  it('modelo da Cliente copia o exemplo com o nome novo', () => {
    const destino = gravarPlano(path.join(tmp, 'cliente'), planoDoProjeto({nome: 'C3 · Teste', modelo: 'modelo-carrossel'}), EXEMPLO);
    const m = new Projeto(destino).manifesto();
    expect(m.nome).toBe('C3 · Teste');
    expect(m.documentos.map((d) => d.id)).toEqual(['carrossel', 'capa', 'cena3d']);
    expect(existsSync(path.join(destino, 'video', 'palavras.json'))).toBe(true);
    const capa = gravarPlano(path.join(tmp, 'capa'), planoDoProjeto({nome: 'Capa', modelo: 'modelo-capa'}), EXEMPLO);
    expect(new Projeto(capa).manifesto().documentos).toHaveLength(1);
    expect(existsSync(path.join(capa, 'midia', 'logo-exemplo.png'))).toBe(true);
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
});
