// Marca d'água por rede na exportação (rodada 2, frente C, 07/11/2026): a posição fica fora das zonas seguras de cada
// destino, a escolha é por destino e lembrada no projeto, e só entra nas props quando ligada.
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {ARQUIVO_PREFS_EXPORTACAO, gravarPrefsExportacao, lerPrefsExportacao} from '../src/main/ipc-exportacao';
import {novoDocCenas, resolverCenas} from '../src/nucleo/cenas';
import {
  CANTOS_MARCA, configPadraoMarca, fontesDaMarcaDagua, marcaDaguaDoDestino, normalizarConfigMarca, normalizarPrefsExportacao, TAMANHO_MARCA,
  type ConfigMarcaDagua,
} from '../src/nucleo/exportacao';
import {FORMATOS_VIDEO} from '../src/nucleo/formatos';
import {temaDaMarca} from '../src/nucleo/marca';
import {KIT_TESTE} from './fixtures/kit-teste';
import {Projeto} from '../src/nucleo/projeto';
import {conjuntoDe, livreDasZonas, posicaoSegura, zonasDaMarca, type CantoMarca} from '../src/nucleo/zonas-seguras';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-marca-dagua-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));

const FONTES = {logo: 'midia/logo-teste.png', assinatura: '@escritorio.teste', fonte: 'Archivo'};
const ligada = (canto: CantoMarca, extra: Partial<ConfigMarcaDagua> = {}): ConfigMarcaDagua => ({ligada: true, conteudo: 'logo', canto, tamanho: 0.06, opacidade: 0.85, ...extra});

describe("marca d'água", () => {
  it('em todo formato, todo canto e todo tamanho da faixa, a marca fica dentro do quadro e fora das zonas da rede', () => {
    for (const f of FORMATOS_VIDEO) {
      const zonas = conjuntoDe(zonasDaMarca(f.largura, f.altura))?.zonas ?? [];
      for (const {id: canto} of CANTOS_MARCA) {
        for (const tamanho of [TAMANHO_MARCA.min, 0.06, 0.1, TAMANHO_MARCA.max]) {
          for (const conteudo of ['logo', 'assinatura'] as const) {
            const m = marcaDaguaDoDestino(ligada(canto, {tamanho, conteudo}), f, FONTES, 3)!;
            const ret = {x: m.x, y: m.y, largura: m.largura, altura: m.altura};
            expect(m.segura, `${f.id} ${canto} ${tamanho} ${conteudo}`).toBe(true);
            expect(livreDasZonas(zonas, ret), `${f.id} ${canto} ${tamanho} ${conteudo}`).toBe(true);
            // encostada do lado do canto pedido
            expect(m.alinhar).toBe(canto.endsWith('dir') ? 'direita' : 'esquerda');
            expect(canto.endsWith('dir') ? m.x + m.largura > 0.5 : m.x < 0.5).toBe(true);
            expect(canto.startsWith('inf') ? m.y + m.altura > 0.5 : m.y < 0.5).toBe(true);
          }
        }
      }
    }
  });

  it('no 9:16, o padrão é em cima à direita, logo abaixo do nome do perfil e longe da coluna de ícones', () => {
    const reels = FORMATOS_VIDEO.find((f) => f.id === 'reels')!;
    const c = configPadraoMarca(reels, FONTES);
    expect(c).toMatchObject({ligada: false, conteudo: 'logo', canto: 'sup-dir'});
    const m = marcaDaguaDoDestino({...c, ligada: true}, reels, FONTES, 3)!;
    const topo = conjuntoDe('vertical')!.zonas.find((z) => z.tipo === 'coberta' && z.y === 0)!;
    expect(m.y).toBeGreaterThanOrEqual(topo.altura);
    expect(m.y).toBeLessThan(0.2);
    expect(m.y + m.altura).toBeLessThan(0.42); // a coluna de ícones começa em 42%
    // no feed embaixo à direita, no YouTube em cima à direita
    expect(configPadraoMarca(FORMATOS_VIDEO.find((f) => f.id === 'feed')!).canto).toBe('inf-dir');
    expect(configPadraoMarca(FORMATOS_VIDEO.find((f) => f.id === 'youtube')!).canto).toBe('sup-dir');
  });

  it('sem pedido, sem kit ou caixa grande demais: sem marca, ou o aviso de que não coube', () => {
    const reels = {largura: 1080, altura: 1920};
    expect(marcaDaguaDoDestino(undefined, reels, FONTES)).toBeNull();
    expect(marcaDaguaDoDestino({...ligada('sup-dir'), ligada: false}, reels, FONTES)).toBeNull();
    expect(marcaDaguaDoDestino(ligada('sup-dir'), reels, {})).toBeNull();
    // pediu logo e o kit só tem assinatura: vai a assinatura, na fonte do tema
    expect(marcaDaguaDoDestino(ligada('sup-dir'), reels, {assinatura: '@x', fonte: 'Archivo'})).toMatchObject({texto: '@x', fonte: 'Archivo'});
    expect(marcaDaguaDoDestino(ligada('sup-dir', {conteudo: 'assinatura'}), reels, {logo: 'midia/l.png'})).toMatchObject({logo: 'midia/l.png'});
    // um logo quadrado enorme não cabe entre as faixas do 9:16: vai para o canto, marcado como não seguro
    const grande = posicaoSegura('vertical', 'sup-dir', reels, {largura: 1000, altura: 1500}, 30);
    expect(grande.segura).toBe(false);
  });

  it('o quadrado só leva margem; um tamanho livre usa as zonas da proporção mais parecida', () => {
    expect(zonasDaMarca(1080, 1080)).toBeNull();
    expect(zonasDaMarca(1000, 500)).toBe('youtube');
    expect(zonasDaMarca(720, 1280)).toBe('vertical');
    const q = marcaDaguaDoDestino(ligada('inf-esq'), {largura: 1080, altura: 1080}, FONTES, 3)!;
    expect(q.x).toBeCloseTo(0.035);
    expect(q.y + q.altura).toBeCloseTo(1 - 0.035);
  });

  it('a proporção do logo dá a largura; o texto, uma estimativa pelo número de letras', () => {
    const f = {largura: 1080, altura: 1920};
    const largo = marcaDaguaDoDestino(ligada('sup-esq'), f, FONTES, 4)!;
    const estreito = marcaDaguaDoDestino(ligada('sup-esq'), f, FONTES, 1)!;
    expect(largo.largura / estreito.largura).toBeCloseTo(4);
    expect(largo.altura * 1920).toBeCloseTo(0.06 * 1080, 0);
    const texto = marcaDaguaDoDestino(ligada('sup-esq', {conteudo: 'assinatura'}), f, FONTES)!;
    expect(texto.texto).toBe('@escritorio.teste');
    expect(texto.largura).toBeGreaterThan(texto.altura * (1920 / 1080));
  });

  it('o logo e a assinatura vêm do tema do vídeo de cenas ou, no carrossel narrado, do logo e do Instagram', () => {
    const doc = {...novoDocCenas({largura: 1080, altura: 1920, fps: 30}), tema: temaDaMarca(KIT_TESTE, {logo: 'midia/logo-teste.png', fontes_arquivos: []})};
    const {props} = resolverCenas(doc);
    expect(fontesDaMarcaDagua(props as unknown as Record<string, unknown>)).toEqual({logo: 'midia/logo-teste.png', assinatura: '@escritorio.teste', fonte: 'Archivo'});
    expect(fontesDaMarcaDagua({composicao: 'CarrosselTema', logo: 'logo-teste.png', marca: {nome: 'Kit de Teste', site: 'teste.adv.br', insta: '@escritorio.teste'}}))
      .toEqual({logo: 'logo-teste.png', assinatura: '@escritorio.teste', fonte: KIT_TESTE.fontes.texto});
    // vídeo sem kit: nada para pôr
    expect(fontesDaMarcaDagua(resolverCenas(novoDocCenas({largura: 1080, altura: 1920, fps: 30})).props as unknown as Record<string, unknown>))
      .toEqual({logo: undefined, assinatura: undefined, fonte: 'Inter'});
  });

  it('escolha guardada fora do lugar volta ao padrão, campo a campo', () => {
    const padrao = configPadraoMarca({largura: 1080, altura: 1350});
    expect(normalizarConfigMarca({ligada: 'sim', conteudo: 'foto', canto: 'meio', tamanho: 9, opacidade: -1}, padrao))
      .toEqual({...padrao, tamanho: TAMANHO_MARCA.max, opacidade: 0.2});
    expect(normalizarPrefsExportacao({marca_dagua: {'../fora': {ligada: true}, feed: {ligada: true}, reels: 'x'}}))
      .toEqual({marca_dagua: {feed: {...padrao, ligada: true}}});
    expect(normalizarPrefsExportacao(null)).toEqual({});
  });

  it('as preferências do projeto juntam por destino em .estudio/exportacao.json e aguentam arquivo estragado', () => {
    const p = new Projeto(tmp);
    expect(lerPrefsExportacao(p)).toEqual({});
    gravarPrefsExportacao(p, {marca_dagua: {reels: ligada('sup-dir')}});
    const r = gravarPrefsExportacao(p, {marca_dagua: {youtube: ligada('sup-esq', {conteudo: 'assinatura', opacidade: 0.5})}});
    expect(Object.keys(r.marca_dagua!).sort()).toEqual(['reels', 'youtube']);
    expect(JSON.parse(readFileSync(path.join(tmp, ARQUIVO_PREFS_EXPORTACAO), 'utf-8'))).toEqual(r);
    expect(lerPrefsExportacao(p).marca_dagua!.youtube).toMatchObject({canto: 'sup-esq', opacidade: 0.5});
    writeFileSync(path.join(tmp, ARQUIVO_PREFS_EXPORTACAO), '{ quebrado');
    expect(lerPrefsExportacao(p)).toEqual({});
  });
});
