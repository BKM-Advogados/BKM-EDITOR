// Onda B, tela inicial: o carrossel narrado como modelo do vídeo de cenas (src/nucleo/modelo-carrossel-narrado.ts). Nasce
// vertical 9:16 seja qual for o formato marcado, com gancho, partes, dúvida e fecho, a fala de cada cena pronta para a
// narração por IA e as durações estimadas pela fala; toca sem aviso e deixa a faixa das legendas livre.
import {mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {resolverCenas, type DocCenas} from '../src/nucleo/cenas';
import {gravarPlano, planoDoProjeto} from '../src/nucleo/criar-projeto';
import {modeloCarrosselNarrado} from '../src/nucleo/modelo-carrossel-narrado';
import {MODELOS} from '../src/nucleo/modelos';
import {configDaNarracao, medirFala} from '../src/nucleo/narracao';
import {itensDaNarracao} from '../src/nucleo/narracao-cenas';
import {formatoDoPedido} from '../src/nucleo/novo-projeto';
import {Projeto} from '../src/nucleo/projeto';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-carrossel-narrado-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));

describe('modelo Carrossel narrado', () => {
  it('está nos modelos do vídeo, com o formato preso em Reels (9:16)', () => {
    const m = MODELOS.find((x) => x.id === 'video-carrossel-narrado');
    expect(m).toMatchObject({modulo: 'video', formato_fixo: 'reels'});
    expect(formatoDoPedido('video-carrossel-narrado', 'youtube')).toMatchObject({largura: 1080, altura: 1920});
  });

  it('o projeto nasce com um vídeo de cenas vertical que toca sem aviso', () => {
    const raiz = gravarPlano(path.join(tmp, 'Carrossel'), planoDoProjeto({nome: 'Carrossel', modelo: 'video-carrossel-narrado', formato: {largura: 1920, altura: 1080}}));
    const p = new Projeto(raiz);
    expect(p.manifesto().documentos).toEqual([{id: 'video', modulo: 'video', caminho: 'video/video.json', titulo: 'Carrossel narrado'}]);
    const doc = p.lerJson<DocCenas>('video/video.json').doc;
    expect(doc).toEqual(modeloCarrosselNarrado());
    expect(doc.formato).toEqual({largura: 1080, altura: 1920, fps: 30});
    expect(resolverCenas(doc).avisos).toEqual([]);
    expect(doc.cenas.map((c) => c.id)).toEqual(['gancho', 'parte-1', 'parte-2', 'duvida', 'fecho']);
  });

  it('cada cena tem a fala escrita, pronta para gerar, e dura pelo menos a fala estimada', () => {
    const doc = modeloCarrosselNarrado();
    const cfg = configDaNarracao(doc.narracao);
    for (const c of doc.cenas) {
      expect(c.narracao?.texto, c.id).toBeTruthy();
      expect(c.duracao_ms, c.id).toBeGreaterThanOrEqual(medirFala(c.narracao!.texto, cfg).segundos * 1000 + cfg.folga_ms);
    }
    expect(itensDaNarracao(doc).map((i) => i.estado)).toEqual(doc.cenas.map(() => 'pendente'));
  });

  it('os blocos entram dentro da cena e ficam acima da faixa das legendas', () => {
    for (const c of modeloCarrosselNarrado().cenas) {
      for (const b of c.blocos) {
        expect(b.em ?? 0, b.id).toBeLessThan(c.duracao_ms - 500);
        expect(b.y, b.id).toBeLessThanOrEqual(0.68);
      }
    }
  });
});
