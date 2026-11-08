// Rodada 3 da frente Fala (docs/legendas.md): os defeitos da área e a régua das legendas. Cada describe cita o id.
import {describe, expect, it} from 'vitest';
import {lerLegendas, textoDeLegenda} from '../src/nucleo/legendas';

const SRT = '1\r\n00:00:01,000 --> 00:00:02,500\r\nA rescisão e o aviso prévio\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nmudança de função\r\n';
/** Windows-1252: ã = E3, é = E9, ç = E7 (o "ANSI" do Bloco de Notas). */
const ansi = (s: string) => Uint8Array.from([...s].map((c) => {
  const n = c.charCodeAt(0);
  if (n > 0xff) throw new Error(`fora do Latin-1: ${c}`);
  return n;
}));

describe('legenda em ANSI importa com os acentos certos (video-N6)', () => {
  it('UTF-8 com e sem BOM, UTF-16 com BOM e Windows-1252', () => {
    const utf8 = new TextEncoder().encode(SRT);
    expect(textoDeLegenda(utf8)).toEqual({texto: SRT, codificacao: 'utf-8'});
    expect(textoDeLegenda(Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8])).texto.replace(/^﻿/, '')).toBe(SRT);
    const utf16 = new Uint8Array(2 + SRT.length * 2);
    utf16.set([0xff, 0xfe]);
    [...SRT].forEach((c, i) => utf16.set([c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8], 2 + i * 2));
    expect(textoDeLegenda(utf16)).toEqual({texto: SRT, codificacao: 'utf-16le'});
    const lido = textoDeLegenda(ansi(SRT));
    expect(lido.codificacao).toBe('windows-1252');
    expect(lido.texto).toBe(SRT);
    expect(lerLegendas(lido.texto, 'x.srt').segmentos.map((s) => s.texto)).toEqual(['A rescisão e o aviso prévio', 'mudança de função']);
    // sem a correção, o UTF-8 frouxo trocava cada acento pelo caractere de substituição
    expect(new TextDecoder('utf-8').decode(ansi(SRT))).toContain('�');
  });
});
