// Onda B: o acabamento do vídeo de cenas (src/nucleo/acabamento-video.ts): vinheta do logo, rodapé com a marca, cartão final e
// efeitos sonoros de midia/sfx/, tudo opcional. Resolução dos campos (ligado, desligado, sem kit, sem logo), a duração (a vinheta
// ocupa o começo da primeira cena, o cartão soma ao fim), o documento antigo que não muda, o rodapé fora das zonas da rede, o
// ducking dos efeitos, o kit de marca (aplicar_marca e o modelo Carrossel narrado) e a composição VideoCenas desenhando as peças.
// O Remotion vai de mentira na composição (quadro na mão, Sequence que só mostra o trecho do quadro, sem áudio), como no
// teste do carrossel narrado. Projetos e kits só em pasta temporária; o logo é o neutro de testes/fixtures/projeto.
import {copyFileSync, mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterAll, describe, expect, it, vi} from 'vitest';
import {acabamentoLigado, ALVO_SONS_LU, audioComSons, CARTAO_MS, linhaDoRodape, patchDoAcabamento, temAcabamento, TITULO_CARTAO_PADRAO, VINHETA_MS,
  VOLUME_SONS_PADRAO, type AcabamentoCenas} from '../src/nucleo/acabamento-video';
import {novaFaixaAudio} from '../src/nucleo/audio';
import {novoDocCenas, resolverCenas, type DocCenas, type PropsCenas} from '../src/nucleo/cenas';
import {aplicarMarcaAoPlano, claudeMd, gravarPlano, planoDoProjeto} from '../src/nucleo/criar-projeto';
import {caixaDaLegenda} from '../src/nucleo/exportacao';
import {MARCA_NEUTRO, patchDaMarca, temaDaMarca} from '../src/nucleo/marca';
import {ACABAMENTO_DO_MODELO, CENA_ABERTURA, modeloCarrosselNarrado} from '../src/nucleo/modelo-carrossel-narrado';
import {PastaMarcas} from '../src/nucleo/pasta-marcas';
import {Projeto} from '../src/nucleo/projeto';
import {conjuntoDe, livreDasZonas} from '../src/nucleo/zonas-seguras';
import {KIT_TESTE} from './fixtures/kit-teste';

const tela = vi.hoisted(() => ({quadro: 0, fps: 30, largura: 1080, altura: 1920, total: 1}));
vi.mock('remotion', async (original) => {
  const R = await original<typeof import('remotion')>();
  const React = await import('react');
  return {
    ...R,
    useCurrentFrame: () => tela.quadro,
    useVideoConfig: () => ({fps: tela.fps, width: tela.largura, height: tela.altura, durationInFrames: tela.total, id: 'x', defaultProps: {}, props: {}}),
    Sequence: ({from = 0, durationInFrames = Infinity, children}: {from?: number; durationInFrames?: number; children: React.ReactNode}) =>
      (tela.quadro >= from && tela.quadro < from + durationInFrames ? React.createElement(React.Fragment, null, children) : null),
    Html5Audio: ({src}: {src: string}) => React.createElement('audio', {src}),
    Img: ({src}: {src: string}) => React.createElement('img', {src}),
  };
});
const {VideoCenas, medidasDoAcabamento} = await import('../src/composicoes/cenas/VideoCenas');

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-acabamento-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));
const LOGO = path.join(__dirname, 'fixtures', 'projeto', 'midia', 'logo.png');

const VERTICAL = {largura: 1080, altura: 1920, fps: 30};
const TEMA_KIT = temaDaMarca(KIT_TESTE, {logo: 'midia/logo-teste.png', fontes_arquivos: []});
/** Vídeo de três cenas (4 s, 3 s e 5 s) com um número e uma lista, para os efeitos de entrada. */
const docBase = (formato = VERTICAL): DocCenas => {
  const d = novoDocCenas(formato);
  d.cenas = [
    {id: 'a', duracao_ms: 4000, blocos: [{id: 'a-t', tipo: 'titulo', em: 0, x: 0.1, y: 0.3, largura: 0.8, texto: 'Primeira'}]},
    {id: 'b', duracao_ms: 3000, blocos: [{id: 'b-n', tipo: 'numero', em: 500, x: 0.1, y: 0.3, largura: 0.8, de: 0, ate: 70}]},
    {id: 'c', duracao_ms: 5000, blocos: [{id: 'c-l', tipo: 'lista', em: 1000, x: 0.1, y: 0.3, largura: 0.8, itens: ['um', 'dois']}]},
  ];
  return d;
};
const comKit = (a?: AcabamentoCenas, formato = VERTICAL): DocCenas => ({...docBase(formato), tema: TEMA_KIT, ...(a ? {acabamento: a} : {})});
const TUDO: AcabamentoCenas = {vinheta: {ligada: true}, rodape: {ligado: true}, cartao_final: {ligado: true}};
const SFX = ['whoosh.wav', 'pop.wav', 'swell.wav', 'impacto_grave.wav'];

describe('documento antigo não muda', () => {
  it('sem acabamento, com {} ou com tudo desligado: as mesmas props de antes, sem `acabamento` e com a soma das cenas', () => {
    const antes = resolverCenas(comKit(), {sfx: SFX});
    expect(antes.props.duracao_ms).toBe(12000);
    expect('acabamento' in antes.props).toBe(false);
    for (const a of [{}, {nome: 'Escritório'}, {vinheta: {ligada: false}, rodape: {ligado: false}, cartao_final: {ligado: false}, sons: {ligados: false}}] as AcabamentoCenas[]) {
      expect(temAcabamento(a)).toBe(false);
      expect(resolverCenas(comKit(a), {sfx: SFX})).toEqual(antes);
    }
  });

  it('o modelo Carrossel narrado sem kit continua sem acabamento e sem a cena de abertura', () => {
    const doc = modeloCarrosselNarrado();
    expect(doc.acabamento).toBeUndefined();
    expect(doc.cenas[0].id).toBe('gancho');
    expect(resolverCenas(doc).props.acabamento).toBeUndefined();
  });
});

describe('resolução dos campos', () => {
  it('com kit: vinheta no começo da primeira cena, rodapé durante as cenas, cartão somado ao fim', () => {
    const {props, avisos} = resolverCenas(comKit(TUDO));
    expect(avisos).toEqual([]);
    const a = props.acabamento!;
    expect(a.marca).toEqual({logo: 'midia/logo-teste.png', assinatura: '@escritorio.teste'});
    expect(a.vinheta).toEqual({t_in: 0, t_out: VINHETA_MS});
    expect(a.cartao).toEqual({t_in: 12000, t_out: 12000 + CARTAO_MS, titulo: TITULO_CARTAO_PADRAO, aviso: ''});
    expect(a.rodape).toMatchObject({t_in: VINHETA_MS, t_out: 12000, segura: true});
    // a duração total: as cenas e o cartão; as cenas não andam (a vinheta não soma)
    expect(props.duracao_ms).toBe(12000 + CARTAO_MS);
    expect(props.cenas.map((c) => [c.t_in, c.t_out])).toEqual([[0, 4000], [4000, 7000], [7000, 12000]]);
  });

  it('nome, título, aviso e durações do documento; durações fora da faixa viram aviso e ficam no limite', () => {
    const a: AcabamentoCenas = {nome: 'Escritório Exemplo', vinheta: {ligada: true, duracao_ms: 900}, cartao_final: {ligado: true, titulo: 'Siga', aviso: 'Informativo', duracao_ms: 2000}};
    const p = resolverCenas(comKit(a)).props;
    expect(p.acabamento!.marca.nome).toBe('Escritório Exemplo');
    expect(p.acabamento!.vinheta!.t_out).toBe(900);
    expect(p.acabamento!.cartao).toMatchObject({titulo: 'Siga', aviso: 'Informativo', t_out: 14000});
    expect(p.duracao_ms).toBe(14000);
    const fora = resolverCenas(comKit({vinheta: {ligada: true, duracao_ms: 60_000}, cartao_final: {ligado: true, duracao_ms: 10}}));
    expect(fora.props.acabamento!.vinheta!.t_out).toBe(4000); // o limite é 5 s, e a primeira cena tem 4
    expect(fora.props.duracao_ms).toBe(13000);
    expect(fora.avisos.join('\n')).toMatch(/vinheta vai de 0,6 a 5 s/);
    expect(fora.avisos.join('\n')).toMatch(/mais longa que a primeira cena/);
    expect(fora.avisos.join('\n')).toMatch(/cartão final vai de 1 a 10 s/);
  });

  it('peça presente sem interruptor vale ligada; `false` desliga só ela', () => {
    const p = resolverCenas(comKit({vinheta: {}, rodape: {ligado: false}})).props.acabamento!;
    expect(p.vinheta).toBeDefined();
    expect(p.rodape).toBeUndefined();
    expect(p.cartao).toBeUndefined();
  });

  it('sem kit (sem logo, assinatura nem nome): vinheta e rodapé não aparecem, com aviso; o cartão aparece só com o título', () => {
    const doc = {...docBase(), acabamento: TUDO};
    const {props, avisos} = resolverCenas(doc);
    expect(props.acabamento!.vinheta).toBeUndefined();
    expect(props.acabamento!.rodape).toBeUndefined();
    expect(props.acabamento!.cartao!.titulo).toBe(TITULO_CARTAO_PADRAO);
    expect(avisos.filter((x) => x.startsWith('Acabamento:'))).toHaveLength(2);
    // só o rodapé e a vinheta, sem kit: nada nas props
    expect(resolverCenas({...docBase(), acabamento: {vinheta: {ligada: true}, rodape: {ligado: true}}}).props.acabamento).toBeUndefined();
  });

  it('sem logo: a vinheta e o rodapé usam o nome ou a assinatura', () => {
    const {logo: _l, ...semLogo} = TEMA_KIT;
    const p = resolverCenas({...docBase(), tema: semLogo, acabamento: TUDO}).props.acabamento!;
    expect(p.marca).toEqual({assinatura: '@escritorio.teste'});
    expect(p.vinheta).toBeDefined();
    expect(p.rodape).toBeDefined();
    expect(linhaDoRodape({nome: 'Escritório', assinatura: '@x'})).toBe('ESCRITÓRIO  ·  @x');
  });

  it('acabamento que não é objeto vira aviso e não muda nada', () => {
    const {props, avisos} = resolverCenas({...comKit(), acabamento: 'sim' as unknown as AcabamentoCenas});
    expect(props.acabamento).toBeUndefined();
    expect(avisos.join('\n')).toMatch(/"acabamento" é um objeto/);
  });
});

describe('rodapé nas zonas seguras', () => {
  it('9:16: fora da faixa que a rede cobre embaixo e da coluna de ícones; com legendas, acima da legenda', () => {
    const r = resolverCenas(comKit({rodape: {ligado: true}})).props.acabamento!.rodape!;
    const ret = {x: r.x, y: r.y, largura: r.largura, altura: r.altura};
    expect(livreDasZonas(conjuntoDe('vertical')!.zonas, ret)).toBe(true);
    expect(r.y + r.altura).toBeGreaterThan(0.6); // é rodapé: fica embaixo
    const comLegenda = comKit({rodape: {ligado: true}});
    comLegenda.legendas = {segmentos: [{id: 's1', em: 500, sai: 2000, texto: 'olá mundo', palavras: [{w: 'olá', s: 500, e: 900}, {w: 'mundo', s: 950, e: 1500}]}]} as unknown as DocCenas['legendas'];
    const props = resolverCenas(comLegenda).props;
    const leg = caixaDaLegenda(props.legendas_cenas, {largura: 1080, altura: 1920})!;
    const r2 = props.acabamento!.rodape!;
    expect(r2.y + r2.altura).toBeLessThanOrEqual(leg.y + 1e-9);
  });

  it('16:9 e 1:1: dentro do quadro e fora das zonas do YouTube', () => {
    const r = resolverCenas(comKit({rodape: {ligado: true}}, {largura: 1920, altura: 1080, fps: 30})).props.acabamento!.rodape!;
    expect(livreDasZonas(conjuntoDe('youtube')!.zonas, {x: r.x, y: r.y, largura: r.largura, altura: r.altura})).toBe(true);
    const q = resolverCenas(comKit({rodape: {ligado: true}}, {largura: 1080, altura: 1080, fps: 30})).props.acabamento!.rodape!;
    expect(q.x).toBeGreaterThan(0);
    expect(q.y + q.altura).toBeLessThan(1);
  });
});

describe('efeitos sonoros', () => {
  it('sem a lista de midia/sfx/ (quem chamou não olhou o disco), nenhum efeito e nenhum aviso', () => {
    const {props, avisos} = resolverCenas(comKit({...TUDO, sons: {ligados: true}}));
    expect(props.acabamento!.sons).toBeUndefined();
    expect(avisos).toEqual([]);
  });

  it('midia/sfx/ sem os arquivos: aviso e nenhum efeito', () => {
    const {props, avisos} = resolverCenas(comKit({sons: {ligados: true}}), {sfx: ['outro.wav']});
    expect(props.acabamento).toBeUndefined();
    expect(avisos.join('\n')).toMatch(/midia\/sfx\/ não tem/);
  });

  it('nas trocas de cena, nas entradas e na vinheta e no cartão, baixos por padrão; só os arquivos que existem', () => {
    const sons = resolverCenas(comKit({...TUDO, sons: {ligados: true}}), {sfx: SFX}).props.acabamento!.sons!;
    const lista = sons.clipes.map((c) => [c.nome, c.em]);
    expect(lista).toEqual([
      ['whoosh.wav', 120], ['impacto_grave.wav', 380], // a vinheta
      ['whoosh.wav', 3800], ['pop.wav', 4500], // troca para a cena 2 e o número
      ['whoosh.wav', 6800], ['pop.wav', 8000], ['pop.wav', 8450], // troca para a cena 3 e os dois itens da lista
      ['swell.wav', 11800], // o cartão final
    ]);
    expect(sons.clipes.every((c) => c.arquivo.startsWith('midia/sfx/') && c.volume <= 0.55 * VOLUME_SONS_PADRAO + 1e-9)).toBe(true);
    const so = resolverCenas(comKit({sons: {ligados: true, volume: 1}}), {sfx: ['pop.wav']}).props.acabamento!.sons!;
    expect(so.clipes.map((c) => [c.nome, c.volume])).toEqual([['pop.wav', 0.3], ['pop.wav', 0.3], ['pop.wav', 0.3]]);
    // a faixa entra na conta do pool de <audio> da prévia
    expect(audioComSons(undefined, {marca: {}, sons: so})!.faixas).toHaveLength(1);
  });

  it('o efeito que cai sobre a narração cai com o ducking da música; volume fora de 0 a 1 vira aviso', () => {
    const doc = comKit({sons: {ligados: true, volume: 3}});
    const voz = novaFaixaAudio('voz', 'narracao');
    voz.clipes = [{id: 'v1', arquivo: 'midia/voz.wav', em: 3000, duracao_ms: 6000}];
    doc.audio = {faixas: [voz]};
    const {props, avisos} = resolverCenas(doc, {sfx: SFX});
    expect(avisos.join('\n')).toMatch(/volume dos efeitos vai de 0 a 1; vai com 1/);
    const pop = props.acabamento!.sons!.clipes.find((c) => c.em === 4500)!;
    expect(pop.ducking?.reducao_db).toBeGreaterThan(0);
    expect(ALVO_SONS_LU).toBe(20); // a medida da casa para efeito (docs/audio.md, som-D4)
    expect(pop.ducking!.musica_db).toBeCloseTo(-6 + 20 * Math.log10(0.3 * 1), 1); // sem envelope, o efeito conta como −6 dB
  });
});

describe('ligar pelo kit de marca e pelo modelo', () => {
  it('acabamentoLigado guarda o que havia; patchDoAcabamento troca o bloco inteiro', () => {
    const atual: AcabamentoCenas = {nome: 'X', vinheta: {ligada: false, duracao_ms: 900}, sons: {ligados: true}};
    expect(acabamentoLigado(atual)).toEqual({nome: 'X', vinheta: {ligada: true, duracao_ms: 900}, rodape: {ligado: true}, cartao_final: {ligado: true}, sons: {ligados: true}});
    expect(patchDoAcabamento({}, TUDO)).toEqual([{op: 'add', path: '/acabamento', value: TUDO}]);
    expect(patchDoAcabamento({acabamento: atual}, undefined)).toEqual([{op: 'test', path: '/acabamento', value: atual}, {op: 'remove', path: '/acabamento'}]);
  });

  it('patchDaMarca com acabamento liga vinheta, rodapé e cartão no vídeo de cenas; sem a opção, só o tema', () => {
    const doc = docBase();
    expect(patchDaMarca(doc, KIT_TESTE)).toHaveLength(2);
    const ops = patchDaMarca(doc, KIT_TESTE, temaDaMarca(KIT_TESTE), {acabamento: true});
    expect(ops.at(-1)).toEqual({op: 'add', path: '/acabamento', value: TUDO});
  });

  it('aplicar_marca {acabamento: true} grava tema e acabamento num patch só, com o logo copiado', () => {
    const marcas = new PastaMarcas({pasta: () => path.join(tmp, 'marcas')});
    marcas.gravar(KIT_TESTE);
    copyFileSync(LOGO, path.join(marcas.pastaDe('teste'), 'logo.png'));
    const raiz = gravarPlano(path.join(tmp, 'aplicar'), planoDoProjeto({nome: 'A', modelo: 'video-branco', formato: VERTICAL}));
    const p = new Projeto(raiz);
    const id = p.manifesto().documentos[0].id;
    const r = marcas.aplicar(p, 'teste', id, {autor: 'agente', origem: 'teste', acabamento: true});
    const doc = p.lerJson<DocCenas>(p.arquivoDoDocumento(id)).doc;
    expect(doc.acabamento).toEqual(TUDO);
    expect(r.copiados).toContain('midia/logo-teste.png');
    expect(resolverCenas(doc).props.acabamento!.marca.logo).toBe('midia/logo-teste.png');
  });

  it('o modelo Carrossel narrado com kit (logo ou assinatura) vem com a cena de abertura e vinheta, rodapé e cartão ligados', () => {
    const marca = {...KIT_TESTE, pasta: path.join(tmp, 'kit-modelo')};
    const plano = aplicarMarcaAoPlano(planoDoProjeto({nome: 'C', modelo: 'video-carrossel-narrado'}), marca, () => true);
    const doc = JSON.parse(plano.arquivos['video/video.json']) as DocCenas;
    expect(doc.cenas[0]).toEqual(CENA_ABERTURA);
    expect(doc.cenas.slice(1).map((c) => c.id)).toEqual(modeloCarrosselNarrado().cenas.map((c) => c.id));
    expect(doc.acabamento).toEqual(ACABAMENTO_DO_MODELO);
    const {props, avisos} = resolverCenas(doc);
    expect(avisos).toEqual([]);
    // a vinheta ocupa a cena de abertura inteira e o gancho começa logo depois dela
    expect(props.acabamento!.vinheta).toEqual({t_in: 0, t_out: props.cenas[1].t_in});
    expect(props.duracao_ms).toBe(props.cenas.at(-1)!.t_out + CARTAO_MS);
  });

  it('o modelo com um kit sem logo nem assinatura (o neutro) fica como o de sempre, só com o tema', () => {
    const plano = aplicarMarcaAoPlano(planoDoProjeto({nome: 'N', modelo: 'video-carrossel-narrado'}), {...MARCA_NEUTRO, pasta: tmp}, () => true);
    const doc = JSON.parse(plano.arquivos['video/video.json']) as DocCenas;
    expect(doc).toEqual({...modeloCarrosselNarrado(), tema: temaDaMarca(MARCA_NEUTRO, {fontes_arquivos: []})});
  });

  it('o guia do projeto de vídeo explica o bloco e a opção do aplicar_marca', () => {
    const md = claudeMd(['video']);
    for (const c of ['`acabamento`', '`vinheta`', '`rodape`', '`cartao_final`', '`sons`', '`midia/sfx/`', '`aplicar_marca {acabamento: true}`']) expect(md).toContain(c);
    expect(claudeMd(['imagem'])).not.toContain('`cartao_final`');
  });
});

describe('composição VideoCenas', () => {
  const desenhar = (props: PropsCenas, ms: number) => {
    tela.largura = props.largura;
    tela.altura = props.altura;
    tela.total = Math.ceil((props.duracao_ms / 1000) * tela.fps);
    tela.quadro = Math.round((ms / 1000) * tela.fps);
    return renderToStaticMarkup(React.createElement(VideoCenas as unknown as React.FC<PropsCenas>, props));
  };

  it('vinheta com o logo, rodapé com a assinatura, cartão final com o título e os efeitos tocando', () => {
    const props = resolverCenas(comKit({...TUDO, nome: 'Escritório Exemplo', cartao_final: {ligado: true, aviso: 'Conteúdo informativo'}, sons: {ligados: true}}), {sfx: SFX}).props;
    const vinheta = desenhar(props, 400);
    expect(vinheta).toContain('midia/logo-teste.png');
    expect(vinheta).toContain('midia/sfx/whoosh.wav');
    const meio = desenhar(props, 5000);
    expect(meio).toContain('ESCRITÓRIO EXEMPLO');
    expect(meio).toContain('@escritorio.teste');
    expect(meio).not.toContain('midia/logo-teste.png');
    const cartao = desenhar(props, 13000);
    expect(cartao).toContain(TITULO_CARTAO_PADRAO);
    expect(cartao).toContain('Conteúdo informativo');
    expect(cartao).toContain('midia/logo-teste.png');
    expect(cartao).not.toContain('Primeira'); // a última cena acabou onde o cartão começa
  });

  it('sem logo, a vinheta escreve o nome; documento sem acabamento não desenha nenhuma peça', () => {
    const {logo: _l, ...semLogo} = TEMA_KIT;
    const props = resolverCenas({...docBase(), tema: semLogo, acabamento: {nome: 'Escritório Exemplo', vinheta: {ligada: true}}}).props;
    expect(desenhar(props, 400)).toContain('ESCRITÓRIO EXEMPLO');
    const antigo = resolverCenas(comKit()).props;
    for (const ms of [400, 5000, 11900]) {
      const html = desenhar(antigo, ms);
      expect(html).not.toContain('midia/logo-teste.png');
      expect(html).not.toContain('@escritorio.teste');
    }
  });

  it('as medidas do acabamento seguem o quadro: em 1080×1920 são as do carrossel narrado; deitado, a marca é menor', () => {
    const em = medidasDoAcabamento(1080, 1920);
    expect(em).toMatchObject({u: 1, tamVinheta: 1, tamMarca: 0.62});
    expect(em.topoMarca).toBeGreaterThan(250); // abaixo da faixa que a rede cobre em cima
    const deitado = medidasDoAcabamento(1920, 1080);
    expect(deitado).toMatchObject({u: 1, tamVinheta: 0.6, tamMarca: 0.4});
    expect(deitado.topoLinha).toBeLessThan(1080 * 0.9);
    expect(deitado.altoMarca).toBeGreaterThan(0);
  });
});
