// Rodada 3, frente C, marca d'água: placa atrás da marca (contraste de 3:1 com o fundo) e largura da assinatura medida, não
// estimada. O que se mede em pixels está em testes/contraste.test.ts e no script scripts/medir-contraste-teste.mjs.
import {describe, expect, it} from 'vitest';
import {PLACAS} from '../src/nucleo/contraste';
import {CANTOS_MARCA, configPadraoMarca, marcaDaguaDoDestino, normalizarConfigMarca, normalizarPrefsExportacao, TAMANHO_MARCA, type ConfigMarcaDagua} from '../src/nucleo/exportacao';
import {FORMATOS_VIDEO} from '../src/nucleo/formatos';
import {conjuntoDe, livreDasZonas, zonasDaMarca, type CantoMarca} from '../src/nucleo/zonas-seguras';

const FONTES = {logo: 'midia/logo-exemplo.png', assinatura: '@escritorioexemplo', fonte: 'Archivo'};
const ligada = (canto: CantoMarca, extra: Partial<ConfigMarcaDagua> = {}): ConfigMarcaDagua => ({ligada: true, conteudo: 'logo', canto, tamanho: 0.06, opacidade: 0.85, ...extra});
const REELS = {largura: 1080, altura: 1920};

describe('placa atrás da marca', () => {
  it('a caixa é a placa: a marca ganha um respiro de um quarto da altura e a caixa cresce junto', () => {
    const sem = marcaDaguaDoDestino(ligada('sup-dir'), REELS, FONTES, 3)!;
    const com = marcaDaguaDoDestino(ligada('sup-dir', {placa: 'escura'}), REELS, FONTES, 3)!;
    expect(sem.placa).toBeUndefined();
    expect(com.placa).toEqual({cor: PLACAS.escura, pad: expect.any(Number)});
    const conteudo = 0.06 * 1080; // a altura da marca em si
    expect(com.altura * 1920).toBeCloseTo(conteudo * 1.5, 0);
    expect(com.largura * 1080).toBeCloseTo(conteudo * 3 + conteudo * 0.5, 0);
    expect(com.placa!.pad * 1080).toBeCloseTo(conteudo * 0.25, 1);
    expect(marcaDaguaDoDestino(ligada('sup-dir', {placa: 'clara'}), REELS, FONTES, 3)!.placa!.cor).toBe(PLACAS.clara);
  });

  it('com placa, em todo formato, canto e tamanho, a caixa continua fora das zonas da rede e dentro do quadro', () => {
    for (const f of FORMATOS_VIDEO) {
      const zonas = conjuntoDe(zonasDaMarca(f.largura, f.altura))?.zonas ?? [];
      for (const {id: canto} of CANTOS_MARCA) {
        for (const tamanho of [TAMANHO_MARCA.min, 0.06, 0.1]) {
          const m = marcaDaguaDoDestino(ligada(canto, {tamanho, placa: 'escura'}), f, FONTES, 3)!;
          const onde = `${f.id} ${canto} ${tamanho}`;
          expect(m.segura, onde).toBe(true);
          expect(livreDasZonas(zonas, {x: m.x, y: m.y, largura: m.largura, altura: m.altura}), onde).toBe(true);
        }
      }
    }
  });

  it('a escolha da placa é lida com calma e lembrada por destino', () => {
    const padrao = configPadraoMarca(REELS, FONTES);
    expect(normalizarConfigMarca({placa: 'escura'}, padrao).placa).toBe('escura');
    expect(normalizarConfigMarca({placa: 'clara'}, padrao).placa).toBe('clara');
    expect(normalizarConfigMarca({placa: 'vermelha'}, padrao).placa).toBeUndefined();
    expect(normalizarConfigMarca({placa: 7}, padrao)).toEqual(padrao); // sem placa, igual ao padrão
    expect(normalizarPrefsExportacao({marca_dagua: {reels: {ligada: true, placa: 'escura'}}}).marca_dagua!.reels.placa).toBe('escura');
  });
});

describe('largura da assinatura medida', () => {
  it('com a proporção medida na fonte do kit, a caixa tem a largura dela; sem, a estimativa pelas letras', () => {
    const conteudo = 0.06 * 1080;
    const estimada = marcaDaguaDoDestino(ligada('sup-esq', {conteudo: 'assinatura'}), REELS, FONTES)!;
    expect(estimada.largura * 1080).toBeCloseTo('@escritorioexemplo'.length * conteudo * 0.8 * 0.6, -1); // 0,6 da letra por caractere
    // uma fonte estreita: a assinatura inteira mede 5,1 alturas (a estimativa dava 7,2)
    const medida = marcaDaguaDoDestino(ligada('sup-esq', {conteudo: 'assinatura'}), REELS, FONTES, undefined, null, 5.1)!;
    expect(medida.largura * 1080).toBeCloseTo(conteudo * 5.1, 0);
    expect(medida.largura).toBeLessThan(estimada.largura);
  });

  it('o logo continua pela proporção dele; valor sem sentido volta à estimativa; a largura passa de 60% do quadro: presa', () => {
    const logo = marcaDaguaDoDestino(ligada('sup-dir'), REELS, FONTES, 4, null, 5.1)!;
    expect(logo.largura * 1080).toBeCloseTo(0.06 * 1080 * 4, 0);
    const estimada = marcaDaguaDoDestino(ligada('sup-esq', {conteudo: 'assinatura'}), REELS, FONTES)!;
    expect(marcaDaguaDoDestino(ligada('sup-esq', {conteudo: 'assinatura'}), REELS, FONTES, undefined, null, NaN)).toEqual(estimada);
    expect(marcaDaguaDoDestino(ligada('sup-esq', {conteudo: 'assinatura'}), REELS, FONTES, undefined, null, -3)).toEqual(estimada);
    expect(marcaDaguaDoDestino(ligada('sup-esq', {conteudo: 'assinatura'}), REELS, FONTES, undefined, null, 40)!.largura).toBeLessThanOrEqual(0.6 + 1e-9);
  });

  it('a assinatura mais larga que o estimado ainda fica fora das zonas, porque o cálculo usa a medida', () => {
    const f = FORMATOS_VIDEO.find((x) => x.id === 'reels')!;
    const zonas = conjuntoDe('vertical')!.zonas;
    const m = marcaDaguaDoDestino(ligada('sup-dir', {conteudo: 'assinatura'}), f, FONTES, undefined, null, 9)!;
    expect(m.segura).toBe(true);
    expect(livreDasZonas(zonas, {x: m.x, y: m.y, largura: m.largura, altura: m.altura})).toBe(true);
  });
});
