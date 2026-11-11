// Kit de marca e fontes próprias (itens 11 e 12 da Ordem sugerida, 06/11/2026): a pasta de kits, aplicar ao documento,
// o kit de fábrica (só o neutro), o projeto novo com kit, as fontes de arquivo no carregador e no servidor de mídia.
import {copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {novoDocCenas, TEMA_NEUTRO, type DocCenas} from '../src/nucleo/cenas';
import {aplicarMarcaAoPlano, claudeMd, gravarPlano, novoDocImagem, planoDoProjeto} from '../src/nucleo/criar-projeto';
import type {DocImagem} from '../src/nucleo/documentos';
import {idDeMarca, inferirFonte, MARCA_BKM, MARCA_NEUTRO, MARCAS_INICIAIS, marcaDoDocumento, marcaDoKit, normalizarMarca, patchDaMarca, temaDaMarca} from '../src/nucleo/marca';
import {fontesDoProjeto, PastaMarcas} from '../src/nucleo/pasta-marcas';
import {Projeto} from '../src/nucleo/projeto';
import {fonte, listarFontes, registrarFontesDeArquivo} from '../src/composicoes/fontes';
import {ServidorMidia} from '../src/main/servidor-midia';
import {KIT_TESTE} from './fixtures/kit-teste';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-marca-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));
const LOGO = path.join(__dirname, 'fixtures', 'projeto', 'midia', 'logo.png');
const PASTA = path.join(tmp, 'marcas');
const marcas = new PastaMarcas({pasta: () => PASTA});
const quem = {autor: 'pessoa', origem: 'teste'};
/** GET com o caminho como está (o fetch normalizaria ".." antes de mandar). */
const bruto = (origem: string, caminho: string) => new Promise<number>((ok, erro) => {
  const u = new URL(origem);
  http.get({host: u.hostname, port: Number(u.port), path: caminho}, (res) => {
    res.resume();
    ok(res.statusCode ?? 0);
  }).on('error', erro);
});

describe('kit de marca', () => {
  it('o de fábrica é só o neutro', () => {
    expect(MARCAS_INICIAIS.map((m) => m.id)).toEqual(['neutro']);
  });

  it('o neutro dá exatamente o tema neutro, com o id do kit', () => {
    expect(temaDaMarca(MARCA_NEUTRO)).toEqual({...TEMA_NEUTRO, marca: 'neutro'});
    expect(marcaDoDocumento({tema: temaDaMarca(MARCA_NEUTRO)})).toBe('neutro');
    expect(marcaDoDocumento(novoDocCenas({largura: 1080, altura: 1920, fps: 30}))).toBeUndefined();
  });

  it('cria os de fábrica na primeira vez; um kit que já estava na pasta (de fábrica numa versão antiga) fica como está', () => {
    // um kit gravado por uma versão anterior, com logo: não é mais de fábrica, mas continua listado e lido
    marcas.gravar(KIT_TESTE);
    copyFileSync(LOGO, path.join(marcas.pastaDe('teste'), 'logo.png'));
    marcas.garantir();
    expect(marcas.listar().map((m) => m.id)).toEqual(['neutro', 'teste']);
    const teste = marcas.ler('teste');
    expect(teste.logo).toBe('logo.png');
    expect(existsSync(path.join(teste.pasta, 'logo.png'))).toBe(true);
    expect(existsSync(path.join(PASTA, 'neutro', 'marca.json'))).toBe(true);
    expect(existsSync(path.join(PASTA, 'bkm'))).toBe(false); // o kit da BKM não vem mais de fábrica
    marcas.garantir(); // de novo não muda nada
    expect(marcas.listar()).toHaveLength(2);
    expect(readdirSync(PASTA).sort()).toEqual(['neutro', 'teste']);
  });

  it('cria, grava, relê e duplica (a cópia leva o logo)', () => {
    const k = marcas.criar('Escritório Teste');
    expect(k).toMatchObject({id: 'escritorio-teste', nome: 'Escritório Teste', cores: MARCA_NEUTRO.cores});
    marcas.gravar({...k, cores: {...k.cores, destaque: '#ff0000', ouro: '#c9a961'}, assinatura: '@teste'});
    expect(marcas.ler('escritorio-teste')).toMatchObject({cores: {destaque: '#FF0000', ouro: '#C9A961'}, assinatura: '@teste'});
    const copia = marcas.duplicar('teste', 'Teste cópia');
    expect(copia.id).toBe('teste-copia');
    expect(copia.cores.terracota).toBe('#C88155');
    expect(existsSync(path.join(copia.pasta, 'logo.png'))).toBe(true);
    expect(marcas.listar().map((m) => m.id)).toEqual(['neutro', 'escritorio-teste', 'teste', 'teste-copia']);
    expect(() => marcas.ler('nao-existe')).toThrow(/não achado/);
  });

  it('lê marca.json torto com calma e faz id de pasta', () => {
    const m = normalizarMarca({nome: ' X ', cores: {fundo: '#abcdef', texto: 7}, fontes: 'nada', logo: ''}, 'q');
    expect(m).toMatchObject({id: 'q', nome: 'X', cores: {fundo: '#ABCDEF', texto: TEMA_NEUTRO.texto}, fontes: {titulo: 'Inter', texto: 'Inter', arquivos: []}});
    expect(m.logo).toBeUndefined();
    expect(idDeMarca('Escritório Exemplo · 2026')).toBe('escritorio-exemplo-2026');
    expect(idDeMarca('???')).toBe('marca');
  });

  it('infere família, peso e estilo pelo nome do arquivo', () => {
    expect(inferirFonte('Montserrat-SemiBoldItalic.ttf')).toEqual({familia: 'Montserrat', peso: 600, estilo: 'italic'});
    expect(inferirFonte('C:\\fontes\\OpenSans-Regular.woff2')).toEqual({familia: 'Open Sans', peso: 400});
    expect(inferirFonte('Minha Fonte.otf')).toEqual({familia: 'Minha Fonte', peso: 400});
    expect(inferirFonte('Archivo_700.ttf')).toEqual({familia: 'Archivo', peso: 700});
    // nome que não vale sem aspas num font-family perde o que sobra
    expect(inferirFonte('Minha (fonte) #2.ttf').familia).toBe('Minha fonte 2');
    expect(normalizarMarca({fontes: {titulo: 'Minha (fonte)', arquivos: [{familia: 'A "b"', arquivo: 'fontes/a.ttf'}]}}).fontes).toEqual({titulo: 'Minha fonte', texto: 'Minha fonte',
      arquivos: [{familia: 'A b', arquivo: 'fontes/a.ttf'}]});
  });

  it('importa fonte e aplica ao vídeo de cenas: tema, logo em midia/ e fonte em fontes/; trocar o kit limpa o tema', () => {
    const ttf = path.join(tmp, 'Teste-Bold.ttf');
    writeFileSync(ttf, 'fonte de mentira');
    expect(() => marcas.importarFonte('teste', path.join(tmp, 'x.txt'))).toThrow(/fonte em/);
    const kit = marcas.importarFonte('teste', ttf);
    expect(kit.fontes.arquivos).toEqual([{familia: 'Teste', arquivo: 'fontes/Teste-Bold.ttf', peso: 700}]);
    expect(existsSync(path.join(kit.pasta, 'fontes', 'Teste-Bold.ttf'))).toBe(true);

    const destino = gravarPlano(path.join(tmp, 'proj'), planoDoProjeto({nome: 'P', modelo: 'video-branco'}));
    const p = new Projeto(destino);
    const r = marcas.aplicar(p, 'teste', 'video', quem);
    expect(r.copiados.sort()).toEqual(['fontes/Teste-Bold.ttf', 'midia/logo-teste.png']);
    expect(p.lerJson<DocCenas>('video/video.json').doc.tema).toEqual({
      fundo: '#171A19', texto: '#F4F0EA', destaque: '#C88155', suave: '#A09F9B', fonte: 'Archivo', marca: 'teste', logo: 'midia/logo-teste.png', assinatura: '@escritorio.teste',
      fontes_arquivos: [{familia: 'Teste', arquivo: 'fontes/Teste-Bold.ttf', peso: 700}],
    });
    expect(p.diario()[0]).toMatchObject({autor: 'pessoa', origem: 'teste', rotulo: 'kit de marca: Kit de Teste'});
    expect(fontesDoProjeto(destino)).toEqual([{familia: 'Teste', peso: 700, arquivo: 'fontes/Teste-Bold.ttf'}]);

    // aplicar de novo não copia de novo; o neutro tira logo, assinatura e fontes do tema (os arquivos ficam no projeto)
    expect(marcas.aplicar(p, 'teste', 'video', quem).copiados).toEqual([]);
    marcas.aplicar(p, 'neutro', 'video', quem);
    expect(p.lerJson<DocCenas>('video/video.json').doc.tema).toEqual({...TEMA_NEUTRO, marca: 'neutro'});
    expect(existsSync(path.join(destino, 'midia', 'logo-teste.png'))).toBe(true);
    expect(() => marcas.aplicar(p, 'teste', 'nao-existe', quem)).toThrow(/não achado/);
  });

  it('não aplica em cena 3D e, na imagem, troca o fundo, a fonte (por peso, sem fonte) e a cor dos textos e guarda o kit', () => {
    expect(patchDaMarca({formato: 1, fundo: '#000', camera: {}, luzes: [], objetos: []}, KIT_TESTE)).toEqual([]);
    const img: DocImagem = {...novoDocImagem(1080, 1350), camadas: [
      {id: 'f', nome: 'Faixa', tipo: 'forma', x: 0, y: 0, largura: 10, altura: 10, preenchimento: '#123456'},
      {id: 't', nome: 'Título', tipo: 'texto', x: 0, y: 0, largura: 10, altura: 10, texto: 'Oi', peso: 800, cor: '#FFFFFF'},
      {id: 's', nome: 'Sub', tipo: 'texto', x: 0, y: 0, largura: 10, altura: 10, texto: 'oi'},
    ]};
    expect(patchDaMarca(img, KIT_TESTE)).toEqual([
      {op: 'replace', path: '/fundo', value: '#171A19'},
      {op: 'add', path: '/camadas/1/fonte', value: 'Archivo'}, {op: 'replace', path: '/camadas/1/cor', value: '#F4F0EA'},
      {op: 'add', path: '/camadas/2/fonte', value: 'IBM Plex Sans'}, {op: 'add', path: '/camadas/2/cor', value: '@texto'},
      {op: 'add', path: '/marca', value: marcaDoKit(KIT_TESTE)},
    ]);
  });

  it('projeto novo com kit já nasce no tema do kit, com logo e fontes copiados', () => {
    marcas.gravar(MARCA_BKM); // kit de escritório que a pessoa já tinha na pasta: continua funcionando
    const bkm = aplicarMarcaAoPlano(planoDoProjeto({nome: 'N', modelo: 'video-branco'}), marcas.ler('bkm'));
    expect(JSON.parse(bkm.arquivos['video/video.json']).tema).toEqual({fundo: '#101826', texto: '#F2EEE6', destaque: '#C9A961', suave: '#A5ADBA', fonte: 'Inter', marca: 'bkm',
      assinatura: 'bkmadvogados.com.br'});
    expect(bkm.copiar).toBeUndefined();

    const destino = gravarPlano(path.join(tmp, 'novo-teste'), aplicarMarcaAoPlano(planoDoProjeto({nome: 'K', modelo: 'imagem-branco'}), marcas.ler('teste')));
    expect(existsSync(path.join(destino, 'midia', 'logo-teste.png'))).toBe(true);
    expect(existsSync(path.join(destino, 'fontes', 'Teste-Bold.ttf'))).toBe(true);
    const img = new Projeto(destino).lerJson<DocImagem>('imagem/imagem.json').doc;
    expect(img.fundo).toBe('#171A19');
    expect(img.camadas[0]).toMatchObject({fonte: 'Archivo', cor: '#F4F0EA'});

    // o que o kit cita mas não está na pasta fica fora do tema
    const semLogo = aplicarMarcaAoPlano(planoDoProjeto({nome: 'S', modelo: 'video-branco'}), marcas.ler('teste'), () => false);
    const tema = JSON.parse(semLogo.arquivos['video/video.json']).tema;
    expect(tema.logo).toBeUndefined();
    expect(tema.fontes_arquivos).toBeUndefined();
    expect(semLogo.copiar).toBeUndefined();
  });

  it('o CLAUDE.md ensina o kit e a ferramenta', () => {
    expect(claudeMd(['video'])).toContain('aplicar_marca');
    expect(claudeMd(['video'])).toContain('fontes_arquivos');
    expect(claudeMd(['3d'])).not.toContain('aplicar_marca');
  });
});

describe('fontes de arquivo', () => {
  it('registra, lista e devolve a família pelo nome; o resto segue como antes', () => {
    expect(fonte('Fonte Que Não Existe')).toBe('Fonte Que Não Existe');
    registrarFontesDeArquivo([{familia: 'Teste', url: 'http://127.0.0.1:1/t/fontes/Teste-Bold.ttf', peso: 700}, {familia: 'Teste', url: 'http://127.0.0.1:1/t/fontes/Teste-Bold.ttf', peso: 700}]);
    expect(fonte('Teste')).toBe('Teste');
    expect(listarFontes()).toContainEqual({nome: 'Teste', origem: 'arquivo'});
    expect(listarFontes().filter((f) => f.origem === 'google').map((f) => f.nome)).toEqual(['Archivo', 'IBM Plex Mono', 'IBM Plex Sans', 'Inter']);
  });
});

describe('servidor de mídia', () => {
  it('serve as fontes do projeto e o logo e as fontes dos kits, e nada mais da pasta dos kits', async () => {
    const s = new ServidorMidia();
    await s.iniciar();
    s.servir(path.join(tmp, 'proj'));
    s.servirMarcas(() => PASTA);
    try {
      const fonteProjeto = await fetch(`${s.base}/fontes/Teste-Bold.ttf`);
      expect(fonteProjeto.status).toBe(200);
      expect(fonteProjeto.headers.get('content-type')).toBe('font/ttf');
      expect(await fonteProjeto.text()).toBe('fonte de mentira');
      expect((await fetch(`${s.urlMarca('teste')}/fontes/Teste-Bold.ttf`)).status).toBe(200);
      const logo = await fetch(`${s.urlMarca('teste')}/logo.png`);
      expect(logo.status).toBe(200);
      expect(logo.headers.get('content-type')).toBe('image/png');
      expect((await fetch(`${s.urlMarca('teste')}/marca.json`)).status).toBe(404);
      // sair da pasta não pode: ".." (que a URL já dobra) ou "\.." codificado, que só o Windows entenderia como pasta acima
      const token = s.base.split('/').pop()!;
      for (const caminho of [`/${token}/~marcas/../proj/midia/logo-teste.png`, `/${token}/~marcas/teste/..%5c..%5cproj/midia/logo-teste.png`, `/${token}/..%5cmarcas/teste/logo.png`]) {
        expect([403, 404]).toContain(await bruto(s.origem, caminho));
      }
      expect((await fetch(`${s.origem}/outro-token/fontes/Teste-Bold.ttf`)).status).toBe(404);
    } finally {
      s.parar();
    }
  });
});
