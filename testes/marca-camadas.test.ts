// Rodada 3, Marca (marco 1): o kit nas camadas e na troca de marca. A imagem guarda o kit que recebeu (imagem-N2), a
// cor "@destaque" lê dele (cor por referência), camada nova nasce na marca da peça (imagem-D8), trocar de kit leva cada
// cor e fonte para o mesmo papel (imagem-D1, imagem-D9), reaplicar atualiza o logo e as fontes do projeto (imagem-D13),
// a fonte variável não fica presa no peso 400 (imagem-D14) e o "Da marca" lê o kit certo (imagem-D16).
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jsonpatch, {type Operation} from 'fast-json-patch';
import {afterAll, describe, expect, it} from 'vitest';
import {contornoDaMarca, degradeDaMarca, kitDaImagem} from '../src/nucleo/acabamento';
import {formaNova, textoNovo} from '../src/nucleo/camadas-novas';
import {docCarrossel} from '../src/nucleo/carrossel';
import {amostrasDaMarca, avisoDeContraste, contraste, ehReferenciaCor, ehReferenciaFonte, nomeDaCor, resolverCor, resolverFonte, resolverMarcaNoDoc} from '../src/nucleo/cor-marca';
import {gravarPlano, novoDocImagem, planoDoProjeto} from '../src/nucleo/criar-projeto';
import type {CamadaImagem, DocImagem, OperacaoPatch} from '../src/nucleo/documentos';
import {lerEixoDePeso} from '../src/nucleo/fonte-variavel';
import {inferirFonte, MARCA_NEUTRO, marcaDoDocumento, marcaDoKit, patchDaMarca, type Marca} from '../src/nucleo/marca';
import {KIT_ESCRITORIO} from './fixtures/kit-escritorio';
import {KIT_TESTE} from './fixtures/kit-teste';
import {PastaMarcas} from '../src/nucleo/pasta-marcas';
import {Projeto} from '../src/nucleo/projeto';
import {deFonteArquivo} from '../src/composicoes/fontes';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-marca-camadas-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));
const aplicar = (doc: DocImagem, patch: OperacaoPatch[]): DocImagem => jsonpatch.applyPatch(structuredClone(doc), patch as Operation[], true, false).newDocument;
const textos = (doc: DocImagem) => doc.paginas!.flatMap((p) => p.camadas).filter((c) => c.tipo === 'texto');
const porId = (doc: DocImagem, pagina: number, id: string) => doc.paginas![pagina].camadas.find((c) => c.id === id)!;

describe('cor por referência ao kit', () => {
  const escritorio = marcaDoKit(KIT_ESCRITORIO);
  it('"@destaque" é a cor do kit da imagem; variações clareiam, escurecem e misturam', () => {
    expect(ehReferenciaCor('@destaque')).toBe(true);
    expect(ehReferenciaCor('#C88155')).toBe(false);
    expect(ehReferenciaCor('@')).toBe(false);
    expect(resolverCor('@destaque', escritorio)).toBe('#C9A961');
    expect(resolverCor('#123456', escritorio)).toBe('#123456');
    expect(resolverCor('@destaque+100', escritorio)).toBe('#FFFFFF');
    expect(resolverCor('@texto-100', escritorio)).toBe('#000000');
    expect(resolverCor('@fundo:destaque:25', escritorio)).toBe('#3E3C35'); // 25% do caminho do fundo ao destaque
    expect(resolverCor('@terracotaEscura', marcaDoKit(KIT_TESTE))).toBe('#795033');
    expect(resolverCor('@terracotaescura', marcaDoKit(KIT_TESTE))).toBe('#795033');
    expect(resolverCor('@naoExiste', escritorio)).toBe('#808080');
    expect(resolverCor('@destaque', undefined)).toBe(MARCA_NEUTRO.cores.destaque); // sem kit, o neutro
  });

  it('a fonte do texto também lê o kit: "@titulo", "@texto" e "@mono" (sem mono, a de texto)', () => {
    const kit = marcaDoKit(KIT_TESTE);
    expect(ehReferenciaFonte('@titulo')).toBe(true);
    expect(ehReferenciaFonte('Archivo')).toBe(false);
    expect(resolverFonte('@titulo', kit)).toBe('Archivo');
    expect(resolverFonte('@texto', kit)).toBe('IBM Plex Sans');
    expect(resolverFonte('@mono', kit)).toBe('IBM Plex Mono');
    expect(resolverFonte('@mono', escritorio)).toBe('Inter');
    expect(resolverFonte('Impact', kit)).toBe('Impact');
    expect(resolverFonte('@titulo', undefined)).toBe(MARCA_NEUTRO.fontes.titulo);
  });

  it('o documento resolvido troca fundo, degradês e camadas (da raiz e das páginas) e devolve o mesmo objeto se não há referência', () => {
    const limpo = novoDocImagem(1080, 1080);
    expect(resolverMarcaNoDoc(limpo)).toBe(limpo);
    const doc = docCarrossel({largura: 1080, altura: 1350, paginas: 3, marca: escritorio});
    doc.fundo_degrade = degradeDaMarca(KIT_ESCRITORIO, 'fundo', true);
    const r = resolverMarcaNoDoc(doc);
    expect(r.fundo).toBe('#101826');
    expect(r.fundo_degrade!.paradas.map((p) => p.cor)).toEqual(['#101826', resolverCor('@fundo:destaque:25', escritorio)]);
    const faixa = porId(r, 0, 'faixa');
    expect(faixa.preenchimento).toBe('#C9A961');
    expect(porId(r, 0, 'titulo').cor).toBe('#F2EEE6');
    expect(porId(r, 1, 'pagina').cor).toBe('#A5ADBA');
    expect(doc.paginas![0].camadas[0].preenchimento).toBe('@destaque'); // o original não muda
    // a camada sem referência é a mesma, para a prévia não refazer o que não mudou
    const fixa: CamadaImagem = {id: 'x', nome: 'x', tipo: 'forma', x: 0, y: 0, largura: 1, altura: 1, preenchimento: '#112233'};
    expect(resolverMarcaNoDoc({...limpo, camadas: [fixa]}).camadas[0]).toBe(fixa);
    // sombra, contorno e degradê da camada também
    const enfeitada: CamadaImagem = {...fixa, sombra: {cor: '@texto'}, contorno: {cor: '@destaque', espessura: 4}, degrade: degradeDaMarca(KIT_ESCRITORIO, 'camada', true)};
    const e = resolverMarcaNoDoc({...limpo, marca: escritorio, camadas: [enfeitada]}).camadas[0];
    expect(e.sombra!.cor).toBe('#F2EEE6');
    expect(e.contorno!.cor).toBe('#C9A961');
    expect(e.degrade!.paradas[0].cor).toBe('#C9A961');
    expect(e.degrade!.paradas[1].cor).toBe(resolverCor('@destaque+35', escritorio));
  });

  it('contraste de WCAG: preto no branco é 21; abaixo de 4,5 vira aviso', () => {
    expect(contraste('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contraste('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contraste('azul', '#FFFFFF')).toBeNull();
    expect(contraste('rgba(0,0,0,0)', '#FFFFFF')).toBeCloseTo(1, 5); // transparente não esconde nada
    expect(avisoDeContraste('#777777', '#FFFFFF')).toMatch(/4,5:1/); // 4,48:1, por pouco
    expect(avisoDeContraste('#767676', '#FFFFFF')).toBeNull(); // 4,54:1
    expect(avisoDeContraste('@suave', '@fundo', escritorio)).toBeNull();
    expect(avisoDeContraste('@fundo', '@fundo', escritorio)).toMatch(/1,0:1/);
    expect(avisoDeContraste('esquisito', '#000000')).toBeNull();
  });

  it('as amostras são as cores do kit com nome, as quatro de sempre primeiro, e o nome volta pela cor ou pela referência', () => {
    const kit = marcaDoKit(KIT_TESTE);
    const a = amostrasDaMarca(kit);
    expect(a.slice(0, 4).map((x) => x.nome)).toEqual(['fundo', 'texto', 'destaque', 'suave']);
    expect(a.find((x) => x.nome === 'terracotaEscura')).toEqual({nome: 'terracotaEscura', rotulo: 'Terracota escura', valor: '#795033', referencia: '@terracotaEscura'});
    expect(a).toHaveLength(Object.keys(KIT_TESTE.cores).length);
    expect(nomeDaCor('#c88155', kit)).toBe('Destaque');
    expect(nomeDaCor('@suave', kit)).toBe('Suave');
    expect(nomeDaCor('@destaque+35', kit)).toBe('Destaque (variação)');
    expect(nomeDaCor('#010203', kit)).toBeNull();
  });
});

describe('imagem-D8: camada nova nasce na marca da peça', () => {
  it('texto e forma novos usam a fonte do kit e as referências; sem kit, o neutro (nunca as cores nem o Archivo de outro kit)', () => {
    const doc = {...novoDocImagem(1080, 1350), marca: marcaDoKit(KIT_ESCRITORIO)};
    expect(textoNovo(doc)).toMatchObject({fonte: '@titulo', cor: '@texto', peso: 700, x: 108});
    expect(textoNovo(doc, {x: 500, y: 600})).toMatchObject({x: 500, y: 600});
    // perto da borda direita a caixa recua e encolhe, em vez de sair da página
    const perto = textoNovo(doc, {x: 1000, y: 600});
    expect(perto.x + perto.largura).toBeLessThanOrEqual(doc.largura);
    expect(perto.largura).toBeGreaterThanOrEqual(Math.round(doc.largura * 0.2));
    expect(formaNova(doc)).toMatchObject({preenchimento: '@destaque', largura: 324, altura: 324});
    // a fonte e a cor se leem do kit da imagem na hora de pintar: o do escritório em Inter, o de teste em Archivo, sem kit o neutro
    const lida = (marca?: Marca) => resolverMarcaNoDoc({...novoDocImagem(1080, 1350), ...(marca ? {marca: marcaDoKit(marca)} : {}), camadas: [{id: 't', ...textoNovo(doc)} as CamadaImagem]}).camadas[0];
    expect(lida(KIT_ESCRITORIO)).toMatchObject({fonte: 'Inter', cor: '#F2EEE6'});
    expect(lida(KIT_TESTE)).toMatchObject({fonte: 'Archivo', cor: '#F4F0EA'});
    expect(lida()).toMatchObject({fonte: MARCA_NEUTRO.fontes.titulo, cor: MARCA_NEUTRO.cores.texto});
  });

  it('o modelo de carrossel nasce com as fontes e as cores do kit pedido', () => {
    const escritorio = docCarrossel({largura: 1080, altura: 1350, paginas: 3, marca: marcaDoKit(KIT_ESCRITORIO)});
    expect(escritorio.marca!.id).toBe('escritorio');
    expect(new Set(textos(escritorio).map((c) => c.fonte))).toEqual(new Set(['@titulo', '@texto', '@mono']));
    const lido = resolverMarcaNoDoc(escritorio);
    expect(textos(lido).every((c) => c.fonte === 'Inter')).toBe(true); // o kit do escritório é todo em Inter
    expect(porId(escritorio, 0, 'faixa').preenchimento).toBe('@destaque');
    expect(porId(escritorio, 0, 'subtitulo').cor).toBe('@suave');
    expect(escritorio.fundo).toBe('@fundo');
    const kit = resolverMarcaNoDoc(docCarrossel({largura: 1080, altura: 1350, paginas: 3, marca: marcaDoKit(KIT_TESTE)}));
    expect(porId(kit, 0, 'titulo').fonte).toBe('Archivo');
    expect(porId(kit, 1, 'pagina').fonte).toBe('IBM Plex Mono');
    expect(porId(kit, 1, 'texto').fonte).toBe('IBM Plex Sans');
    const neutro = docCarrossel({largura: 1080, altura: 1350, paginas: 2});
    expect(neutro.marca!.id).toBe('neutro');
    expect(textos(resolverMarcaNoDoc(neutro)).every((c) => c.fonte === 'Inter')).toBe(true);
  });
});

describe('imagem-N2, imagem-D1 e imagem-D9: trocar de kit', () => {
  const kit = docCarrossel({largura: 1080, altura: 1350, paginas: 3, marca: marcaDoKit(KIT_TESTE)});

  it('a imagem guarda o kit que recebeu, e o painel e o MCP sabem qual é', () => {
    const doc = aplicar(novoDocImagem(1080, 1080), patchDaMarca(novoDocImagem(1080, 1080), KIT_ESCRITORIO));
    expect(doc.marca).toEqual(marcaDoKit(KIT_ESCRITORIO));
    expect(marcaDoDocumento(doc)).toBe('escritorio');
    const outro = aplicar(doc, patchDaMarca(doc, KIT_TESTE));
    expect(marcaDoDocumento(outro)).toBe('teste');
    expect(outro.marca!.cores.terracota).toBe('#C88155');
  });

  it('com referências, o kit novo muda a peça toda sem tocar nas camadas', () => {
    const escritorio = aplicar(kit, patchDaMarca(kit, KIT_ESCRITORIO));
    expect(escritorio.marca!.id).toBe('escritorio');
    expect(porId(escritorio, 0, 'faixa').preenchimento).toBe('@destaque'); // a referência fica
    expect(resolverMarcaNoDoc(escritorio).paginas![0].camadas[0].preenchimento).toBe('#C9A961');
    // a fonte também é referência: título, texto e numeral mono seguem o kit (o kit do escritório não tem mono: cai no texto)
    expect(porId(escritorio, 0, 'titulo').fonte).toBe('@titulo');
    expect(resolverMarcaNoDoc(escritorio).paginas![1].camadas.find((c) => c.id === 'pagina')!.fonte).toBe('Inter');
  });

  it('com hexadecimais copiados do kit anterior, cada cor vai para o mesmo papel; as escolhidas à mão ficam', () => {
    const legado: DocImagem = {formato: 1, largura: 1080, altura: 1350, fundo: '#171A19', efeitos: [], camadas: [
      {id: 'faixa', nome: 'Faixa', tipo: 'forma', x: 0, y: 0, largura: 100, altura: 8, preenchimento: '#C88155', degrade: {tipo: 'linear', paradas: [{cor: '#C88155', posicao: 0}, {cor: '#E4B492', posicao: 1}]}},
      {id: 'titulo', nome: 'Título', tipo: 'texto', x: 0, y: 0, largura: 100, altura: 50, texto: 'Oi', fonte: 'Archivo', peso: 800, cor: '#F4F0EA', contorno: {cor: '#C88155', espessura: 3}},
      {id: 'sub', nome: 'Sub', tipo: 'texto', x: 0, y: 0, largura: 100, altura: 50, texto: 'oi', fonte: 'IBM Plex Sans', peso: 400, cor: '#A09F9B'},
      {id: 'num', nome: 'Número', tipo: 'texto', x: 0, y: 0, largura: 100, altura: 50, texto: '1/3', fonte: 'IBM Plex Mono', peso: 500, cor: '#C88155'},
      {id: 'livre', nome: 'Livre', tipo: 'texto', x: 0, y: 0, largura: 100, altura: 50, texto: 'x', fonte: 'Impact', peso: 400, cor: '#123456'},
      {id: 'foto', nome: 'Foto', tipo: 'imagem', x: 0, y: 0, largura: 100, altura: 50, src: 'midia/foto.png', sombra: {cor: '#171A19', opacidade: 0.5}},
    ]};
    const r = aplicar(legado, patchDaMarca(legado, KIT_ESCRITORIO));
    const c = (id: string) => r.camadas.find((x) => x.id === id)!;
    expect(r.fundo).toBe('#101826');
    expect(c('faixa').preenchimento).toBe('#C9A961');
    expect(c('faixa').degrade!.paradas[0].cor).toBe('#C9A961'); // o degradê que o "Da marca" do kit de teste deixou
    expect(c('faixa').degrade!.paradas[1].cor).toBe('#E4B492'); // terracota clara: o kit do escritório não tem par, fica
    expect(c('titulo')).toMatchObject({fonte: 'Inter', cor: '#F2EEE6', contorno: {cor: '#C9A961'}});
    expect(c('sub')).toMatchObject({fonte: 'Inter', cor: '#A5ADBA'}); // cada texto na sua cor: o subtítulo não vira cor de título
    expect(c('num')).toMatchObject({fonte: 'Inter', cor: '#C9A961'}); // o numeral mono segue o destaque
    expect(c('livre')).toMatchObject({fonte: 'Impact', cor: '#123456'});
    expect(c('foto').sombra!.cor).toBe('#101826');
    expect(r.marca!.id).toBe('escritorio');
  });

  it('imagem de antes do campo `marca`, na paleta escura do kit de fábrica que saiu, troca de kit pelo papel de cada cor e fonte', () => {
    const antiga: DocImagem = {...novoDocImagem(1080, 1350), fundo: '#171A19', camadas: [
      {id: 'f', nome: 'Faixa', tipo: 'forma', x: 0, y: 0, largura: 10, altura: 10, preenchimento: '#C88155'},
      {id: 't', nome: 'Título', tipo: 'texto', x: 0, y: 0, largura: 10, altura: 10, texto: 'Oi', fonte: 'Archivo', peso: 800, cor: '#F4F0EA'},
      {id: 'n', nome: 'Numeral', tipo: 'texto', x: 0, y: 0, largura: 10, altura: 10, texto: '1/3', fonte: 'IBM Plex Mono', cor: '#A09F9B'},
    ]};
    const escritorio = aplicar(antiga, patchDaMarca(antiga, KIT_ESCRITORIO));
    expect(escritorio.fundo).toBe('#101826');
    expect(escritorio.camadas.map((c) => (c.tipo === 'forma' ? c.preenchimento : [c.fonte, c.cor]))).toEqual(['#C9A961', ['Inter', '#F2EEE6'], ['Inter', '#A5ADBA']]);
  });

  it('legado: imagem de antes do campo `marca`, na paleta marinho do outro kit de fábrica que saiu, troca de kit pelo papel de cada cor e fonte', () => {
    const antiga: DocImagem = {...novoDocImagem(1080, 1350), fundo: '#101826', camadas: [
      {id: 'f', nome: 'Faixa', tipo: 'forma', x: 0, y: 0, largura: 10, altura: 10, preenchimento: '#C9A961'},
      {id: 't', nome: 'Título', tipo: 'texto', x: 0, y: 0, largura: 10, altura: 10, texto: 'Oi', fonte: 'Inter', peso: 800, cor: '#F2EEE6'},
      {id: 's', nome: 'Sub', tipo: 'texto', x: 0, y: 0, largura: 10, altura: 10, texto: 'oi', fonte: 'Inter', peso: 400, cor: '#A5ADBA'},
    ]};
    const r = aplicar(antiga, patchDaMarca(antiga, KIT_TESTE));
    expect(r.fundo).toBe('#171A19');
    expect(r.camadas.map((c) => (c.tipo === 'forma' ? c.preenchimento : [c.fonte, c.cor]))).toEqual(['#C88155', ['Archivo', '#F4F0EA'], ['IBM Plex Sans', '#A09F9B']]);
    expect(r.marca!.id).toBe('teste');
  });

  it('legado: imagem que guarda o kit de fábrica que saiu (id antigo, fora da pasta) lê as cores que guardou e troca de kit por elas', () => {
    // o id que ficou gravado nas imagens de quem já usava, tratado como qualquer outro (montado em pedaços: o nome do
    // escritório não fica no repositório)
    const ID_LEGADO = ['b', 'k', 'm'].join('');
    const guardado = {...marcaDoKit(KIT_ESCRITORIO), id: ID_LEGADO, nome: ID_LEGADO};
    const doc: DocImagem = {...novoDocImagem(1080, 1350), fundo: '#101826', marca: guardado, camadas: [
      {id: 'f', nome: 'Faixa', tipo: 'forma', x: 0, y: 0, largura: 10, altura: 10, preenchimento: '@destaque'},
      {id: 'g', nome: 'Faixa copiada', tipo: 'forma', x: 0, y: 0, largura: 10, altura: 10, preenchimento: '#C9A961'},
    ]};
    expect(marcaDoDocumento(doc)).toBe(ID_LEGADO);
    expect(resolverMarcaNoDoc(doc).camadas[0].preenchimento).toBe('#C9A961'); // a referência lê a cópia que a imagem guarda
    expect(kitDaImagem(doc, [KIT_TESTE, MARCA_NEUTRO])?.id).toBe('teste'); // o kit não está na pasta: o primeiro
    const r = aplicar(doc, patchDaMarca(doc, KIT_TESTE));
    expect(r.fundo).toBe('#171A19');
    expect(r.camadas.map((c) => c.tipo === 'forma' && c.preenchimento)).toEqual(['@destaque', '#C88155']);
    expect(marcaDoDocumento(r)).toBe('teste');
  });

  it('o numeral mono continua mono quando o kit novo tem mono, e o subtítulo continua suave na ida e na volta', () => {
    const kitMono: Marca = {...MARCA_NEUTRO, id: 'mono', nome: 'Mono', fontes: {titulo: 'Archivo', texto: 'IBM Plex Sans', mono: 'IBM Plex Mono', arquivos: []}};
    const doc = docCarrossel({largura: 1080, altura: 1350, paginas: 3});
    const lida = (d: DocImagem, p: number, id: string) => porId(resolverMarcaNoDoc(d), p, id);
    const idaKit = aplicar(doc, patchDaMarca(doc, KIT_TESTE));
    expect(lida(idaKit, 1, 'pagina')).toMatchObject({fonte: 'IBM Plex Mono', cor: '#A09F9B'}); // o neutro não tinha mono: o papel ficou na referência
    const volta = aplicar(idaKit, patchDaMarca(idaKit, kitMono));
    expect(lida(volta, 1, 'pagina')).toMatchObject({fonte: 'IBM Plex Mono'});
    expect(lida(volta, 1, 'titulo').fonte).toBe('Archivo');
    expect(lida(volta, 1, 'texto').fonte).toBe('IBM Plex Sans');
    expect(porId(volta, 0, 'subtitulo').cor).toBe('@suave');
    const semMono = aplicar(volta, patchDaMarca(volta, KIT_ESCRITORIO));
    expect(lida(semMono, 1, 'pagina').fonte).toBe('Inter'); // kit sem mono: o numeral usa a fonte de texto
  });

  it('texto sem cor ou no branco padrão recebe a cor de texto do kit', () => {
    const doc: DocImagem = {...novoDocImagem(1080, 1080), camadas: [
      {id: 'a', nome: 'A', tipo: 'texto', x: 0, y: 0, largura: 10, altura: 10, texto: 'a'},
      {id: 'b', nome: 'B', tipo: 'texto', x: 0, y: 0, largura: 10, altura: 10, texto: 'b', cor: '#FFFFFF'},
    ]};
    const r = aplicar(doc, patchDaMarca(doc, KIT_ESCRITORIO));
    expect(r.camadas[0].cor).toBe('@texto');
    expect(r.camadas[1].cor).toBe('#F2EEE6');
  });

  it('reaplicar o mesmo kit não mexe nas camadas e atualiza só o que o kit mudou', () => {
    const uma = aplicar(kit, patchDaMarca(kit, KIT_TESTE));
    expect(uma.paginas).toEqual(kit.paginas);
    const kitEditado: Marca = {...KIT_TESTE, cores: {...KIT_TESTE.cores, destaque: '#AA5500'}};
    const hex: DocImagem = {...uma, camadas: [{id: 'f', nome: 'F', tipo: 'forma', x: 0, y: 0, largura: 1, altura: 1, preenchimento: '#C88155'}]};
    const depois = aplicar(hex, patchDaMarca(hex, kitEditado));
    expect(depois.camadas[0].preenchimento).toBe('#AA5500');
    expect(depois.marca!.cores.destaque).toBe('#AA5500');
  });
});

describe('imagem-D16: o "Da marca" lê o kit certo', () => {
  const kits = [KIT_TESTE, KIT_ESCRITORIO, MARCA_NEUTRO];
  it('a imagem aponta o kit pelo id; antes do campo, vale o do fundo; o kit saído da pasta cai no do fundo', () => {
    expect(kitDaImagem({fundo: '#FFFFFF', marca: marcaDoKit(KIT_ESCRITORIO)}, kits)?.id).toBe('escritorio');
    expect(kitDaImagem({fundo: '#171A19'}, kits)?.id).toBe('teste');
    expect(kitDaImagem({fundo: '#101826'}, kits)?.id).toBe('escritorio');
    expect(kitDaImagem({fundo: '#000000', marca: {...marcaDoKit(KIT_ESCRITORIO), id: 'sumiu'}}, kits)?.id).toBe('teste'); // sem par: o primeiro
  });

  it('com a imagem guardando o kit, "Da marca" grava referência e acompanha o kit; sem ele, o hexadecimal', () => {
    expect(contornoDaMarca(KIT_TESTE, {tipo: 'forma'}, true)).toEqual({cor: '@destaque', espessura: 6, posicao: 'fora'});
    expect(contornoDaMarca(KIT_TESTE, {tipo: 'forma'})).toEqual({cor: '#C88155', espessura: 6, posicao: 'fora'});
    expect(degradeDaMarca(KIT_TESTE, 'camada', true).paradas.map((p) => p.cor)).toEqual(['@destaque', '@destaque+35']);
    expect(degradeDaMarca(KIT_TESTE, 'fundo', true).paradas.map((p) => p.cor)).toEqual(['@fundo', '@fundo:destaque:25']);
    // a referência dá o mesmo pixel que o hexadecimal de antes
    const sol = marcaDoKit(KIT_TESTE);
    expect(degradeDaMarca(KIT_TESTE, 'camada', true).paradas.map((p) => resolverCor(p.cor, sol))).toEqual(degradeDaMarca(KIT_TESTE).paradas.map((p) => p.cor));
    expect(degradeDaMarca(KIT_TESTE, 'fundo', true).paradas.map((p) => resolverCor(p.cor, sol))).toEqual(degradeDaMarca(KIT_TESTE, 'fundo').paradas.map((p) => p.cor));
  });
});

// ---------- fonte variável ----------
/** Um TTF mínimo só com a tabela fvar: um eixo `wght` de `min` a `max`. */
const ttfVariavel = (min: number, max: number, eixo = 'wght') => {
  const b = new Uint8Array(28 + 16 + 20);
  const d = new DataView(b.buffer);
  d.setUint32(0, 0x00010000);
  d.setUint16(4, 1); // uma tabela
  b.set([...'fvar'].map((c) => c.charCodeAt(0)), 12);
  d.setUint32(20, 28); // offset
  d.setUint32(24, 36); // tamanho
  d.setUint16(28 + 4, 16); // axesArrayOffset
  d.setUint16(28 + 8, 1); // axisCount
  d.setUint16(28 + 10, 20); // axisSize
  b.set([...eixo].map((c) => c.charCodeAt(0)), 28 + 16);
  d.setInt32(28 + 20, min * 65536);
  d.setInt32(28 + 24, Math.round((min + max) / 2) * 65536);
  d.setInt32(28 + 28, max * 65536);
  return b;
};
const ttfEstatico = () => {
  const b = new Uint8Array(28);
  new DataView(b.buffer).setUint32(0, 0x00010000);
  new DataView(b.buffer).setUint16(4, 1);
  b.set([...'head'].map((c) => c.charCodeAt(0)), 12);
  return b;
};

describe('imagem-D14: fonte variável', () => {
  it('lê a faixa do eixo de peso da própria fonte', () => {
    expect(lerEixoDePeso(ttfVariavel(200, 800))).toEqual({variavel: true, min: 200, max: 800});
    expect(lerEixoDePeso(ttfEstatico())).toEqual({variavel: false});
    expect(lerEixoDePeso(ttfVariavel(75, 100, 'wdth'))).toEqual({variavel: true}); // variável só na largura: o peso não varia
    expect(lerEixoDePeso(new Uint8Array([1, 2, 3]))).toEqual({variavel: false});
  });

  it('o nome do arquivo também conta (WOFF2 não deixa ler a tabela)', () => {
    expect(inferirFonte('Roboto-VariableFont_wght.ttf')).toEqual({familia: 'Roboto', peso: 100, peso_max: 900});
    expect(inferirFonte('Inter[opsz,wght].ttf')).toEqual({familia: 'Inter', peso: 100, peso_max: 900});
    expect(inferirFonte('Inter-Italic[opsz,wght].ttf')).toMatchObject({familia: 'Inter', estilo: 'italic', peso_max: 900});
    expect(inferirFonte('Roboto-Bold.ttf')).toEqual({familia: 'Roboto', peso: 700}); // fonte comum segue como antes
  });

  it('importada no kit, vai com a faixa de peso (e o carregador pede "200 800", não "200")', () => {
    const marcas = new PastaMarcas({pasta: () => path.join(tmp, 'marcas-var')});
    marcas.garantir();
    marcas.gravar(KIT_ESCRITORIO); // kit de escritório na pasta da pessoa
    const arquivo = path.join(tmp, 'Variavel-VariableFont_wght.ttf');
    writeFileSync(arquivo, ttfVariavel(200, 800));
    const k = marcas.importarFonte('escritorio', arquivo);
    expect(k.fontes.arquivos).toEqual([{familia: 'Variavel', arquivo: 'fontes/Variavel-VariableFont_wght.ttf', peso: 200, peso_max: 800}]);
    expect(marcas.ler('escritorio').fontes.arquivos[0].peso_max).toBe(800);
    expect(deFonteArquivo(k.fontes.arquivos[0], 'http://x/f.ttf')).toEqual({familia: 'Variavel', url: 'http://x/f.ttf', peso: 200, pesoMax: 800, estilo: undefined});
    // peso dito à mão vale um peso só
    const fixo = marcas.importarFonte('escritorio', arquivo, {peso: 700, familia: 'Outra'});
    expect(fixo.fontes.arquivos.find((f) => f.familia === 'Outra')).toEqual({familia: 'Outra', arquivo: 'fontes/Variavel-VariableFont_wght.ttf', peso: 700});
  });
});

describe('imagem-D13: reaplicar o kit atualiza o logo e as fontes do projeto', () => {
  it('logo novo com o mesmo nome troca o do projeto e vem listado em "atualizados"; igual não conta', () => {
    const marcas = new PastaMarcas({pasta: () => path.join(tmp, 'marcas-d13')});
    marcas.garantir();
    marcas.gravar(KIT_ESCRITORIO); // kit de escritório na pasta da pessoa
    const logo1 = path.join(tmp, 'logo1.png');
    const logo2 = path.join(tmp, 'logo2.png');
    writeFileSync(logo1, 'logo provisório');
    writeFileSync(logo2, 'logo definitivo');
    marcas.importarLogo('escritorio', logo1);
    const projeto = new Projeto(gravarPlano(path.join(tmp, 'projeto-d13'), planoDoProjeto({nome: 'D13', modelo: 'video-branco'})));
    const doc = 'video';
    const quem = {autor: 'pessoa', origem: 'teste'};

    const primeira = marcas.aplicar(projeto, 'escritorio', doc, quem);
    expect(primeira.copiados).toEqual(['midia/logo-escritorio.png']);
    expect(primeira.atualizados).toEqual([]);

    const igual = marcas.aplicar(projeto, 'escritorio', doc, quem);
    expect(igual.copiados).toEqual([]);
    expect(igual.atualizados).toEqual([]);

    marcas.importarLogo('escritorio', logo2);
    const depois = marcas.aplicar(projeto, 'escritorio', doc, quem);
    expect(depois.copiados).toEqual([]);
    expect(depois.atualizados).toEqual(['midia/logo-escritorio.png']);
    expect(String(readFileSync(projeto.caminho('midia/logo-escritorio.png')))).toBe('logo definitivo');
  });
});
