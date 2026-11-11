// Diálogo de exportar: opções → argumentos do renderMedia, estimativa de tamanho e os nomes dos vários destinos
// (grupo 5 da Ordem sugerida, 06/11/2026).
import {describe, expect, it} from 'vitest';
import {
  argumentosDoRender, bitrateKbps, destinoDoFormato, estimarBytes, estimarExportacao, formatarBytes, ladoDeSaida, nomesDosArquivos, sufixoDestino, trechoValido,
  type OpcoesExportarVideo,
} from '../src/nucleo/exportacao';

const F = {largura: 1080, altura: 1920, fps: 30};
const REELS = {id: 'reels', largura: 1080, altura: 1920};
const base: OpcoesExportarVideo = {destinos: [REELS], codec: 'h264', qualidade: 'alta', escala: 1};

describe('opções do diálogo → renderMedia', () => {
  it('padrão: H.264 no formato do documento, vídeo inteiro', () => {
    const a = argumentosDoRender(base, REELS, F, 12000);
    expect(a).toMatchObject({codec: 'h264', ext: 'mp4', escala: 1, largura: 1080, altura: 1920, frameRange: null, quadros: 360, duracaoMs: 12000});
    expect(a.videoBitrate).toBe('12000k');
  });

  it('escala arredonda os lados para par e baixa o bitrate junto com os pixels', () => {
    const a = argumentosDoRender({...base, escala: 0.75}, {id: 'feed', largura: 1080, altura: 1350}, {...F, altura: 1350}, 10000);
    expect([a.largura, a.altura]).toEqual([810, 1012]); // 1012,5 vira par
    expect(a.escala).toBe(0.75);
    expect(ladoDeSaida(1350, 0.75)).toBe(1012);
    expect(ladoDeSaida(1080, 0.5)).toBe(540);
    expect(Number.parseInt(a.videoBitrate, 10)).toBeLessThan(bitrateKbps('alta', 1080, 1350, 30));
    expect(argumentosDoRender({...base, escala: 0.33}, REELS, F, 1000).escala).toBe(1); // escala fora da lista cai em 1
  });

  it('qualidade, codec e quadros por segundo mexem no bitrate', () => {
    expect(bitrateKbps('alta', 1920, 1080, 30)).toBe(12000);
    expect(bitrateKbps('media', 1920, 1080, 30)).toBe(6000);
    expect(bitrateKbps('leve', 1920, 1080, 30)).toBe(2500);
    expect(bitrateKbps('alta', 1920, 1080, 60)).toBe(18000);
    expect(bitrateKbps('alta', 1920, 1080, 30, 'h265')).toBe(7800);
    expect(bitrateKbps('leve', 320, 240, 30)).toBe(300); // piso
  });

  it('trecho em segundos vira quadros inclusivos; fora do vídeo é ignorado', () => {
    const a = argumentosDoRender({...base, trecho: {de_ms: 2000, ate_ms: 5000}}, REELS, F, 12000);
    expect(a.frameRange).toEqual([60, 149]);
    expect(a.quadros).toBe(90);
    expect(a.duracaoMs).toBe(3000);
    expect(argumentosDoRender({...base, trecho: {de_ms: 0, ate_ms: 12000}}, REELS, F, 12000).frameRange).toBeNull();
    expect(trechoValido({de_ms: 5000, ate_ms: 2000}, 12000)).toBe(false);
    expect(trechoValido({de_ms: 0, ate_ms: 13000}, 12000)).toBe(false);
    expect(trechoValido({de_ms: 1000, ate_ms: 1050}, 12000)).toBe(false);
    expect(argumentosDoRender({...base, trecho: {de_ms: 5000, ate_ms: 2000}}, REELS, F, 12000).frameRange).toBeNull();
  });

  it('WebM e H.265 trocam codec e extensão', () => {
    expect(argumentosDoRender({...base, codec: 'webm'}, REELS, F, 1000)).toMatchObject({codec: 'vp9', ext: 'webm'});
    expect(argumentosDoRender({...base, codec: 'h265'}, REELS, F, 1000)).toMatchObject({codec: 'h265', ext: 'mp4'});
  });
});

describe('estimativa de tamanho', () => {
  it('bitrate × duração, com o áudio quando há', () => {
    expect(estimarBytes(6000, 10000, false)).toBe(7_500_000);
    expect(estimarBytes(6000, 10000, true)).toBe(7_900_000);
    expect(formatarBytes(7_660_000)).toBe('7,3 MB');
    expect(formatarBytes(500_000)).toBe('488 KB');
    expect(formatarBytes(2 * 1024 ** 3)).toBe('2,00 GB');
  });

  it('soma os destinos e respeita o trecho', () => {
    const o: OpcoesExportarVideo = {...base, destinos: [REELS, {id: 'youtube', largura: 1920, altura: 1080}], qualidade: 'media', trecho: {de_ms: 0, ate_ms: 5000}};
    const e = estimarExportacao(o, F, 10000, false);
    expect(e.porDestino).toHaveLength(2);
    expect(e.porDestino[0].bytes).toBe(estimarBytes(6000, 5000, false)); // 1080×1920 tem os pixels do 1080p
    expect(e.porDestino[1]).toMatchObject({largura: 1920, altura: 1080});
    expect(e.total).toBe(e.porDestino[0].bytes + e.porDestino[1].bytes);
  });
});

describe('vários destinos', () => {
  it('nome com sufixo só quando há mais de um ou quando difere do formato do documento', () => {
    expect(nomesDosArquivos('Férias', [REELS], F).map((n) => n.nome)).toEqual(['Férias']);
    expect(nomesDosArquivos('Férias', [{id: 'youtube', largura: 1920, altura: 1080}], F).map((n) => n.nome)).toEqual(['Férias-16x9']);
    expect(nomesDosArquivos('Férias', [REELS, {id: 'feed', largura: 1080, altura: 1350}, {id: 'youtube', largura: 1920, altura: 1080}], F).map((n) => n.nome))
      .toEqual(['Férias-9x16', 'Férias-4x5', 'Férias-16x9']);
    expect(sufixoDestino({largura: 1080, altura: 1080})).toBe('-1x1');
    expect(sufixoDestino({largura: 1000, altura: 500})).toBe('-1000x500');
  });

  it('destino do formato do documento', () => {
    expect(destinoDoFormato({largura: 1080, altura: 1080})).toEqual({id: 'quadrado', largura: 1080, altura: 1080});
    expect(destinoDoFormato({largura: 1000, altura: 500})).toEqual({id: 'personalizado', largura: 1000, altura: 500});
  });
});
