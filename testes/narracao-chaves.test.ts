// Chaves da narração por IA no processo principal (docs/narracao.md): a do Google Cloud TTS é testada na lista de vozes antes
// de gravar (recusada ou com a API desativada não grava; sem rede grava e avisa), a do Gemini é a mesma das conversas, a
// tela só vê a origem e os 4 últimos caracteres, e o MCP por stdio acha as chaves nas variáveis de ambiente.
import {beforeEach, describe, expect, it} from 'vitest';
import {CofreMemoria} from '../src/main/ia/chaves';
import {definirCofre} from '../src/main/ipc-ia';
import {estadoDaNarracao, gravarChaveTts} from '../src/main/ipc-narracao';
import {servicoDoAmbiente, servicoDoCofre} from '../src/main/narracao';
import {CHAVE_GEMINI, CHAVE_TTS, criarGoogleFalso} from './fixtures/narracao-falsa';

let cofre: CofreMemoria;
beforeEach(() => {
  cofre = new CofreMemoria();
  definirCofre(cofre);
});

describe('chave do Google Cloud TTS', () => {
  it('aceita: testa em GET /v1/voices (sem custo), grava e diz quantas vozes viu', async () => {
    const g = criarGoogleFalso();
    const r = await gravarChaveTts(`  ${CHAVE_TTS} `, g.fetch);
    expect(r.ok).toBe(true);
    expect(r.mensagem).toMatch(/chave aceita \(2 vozes Chirp 3: HD em português\)/);
    expect(cofre.ler('google-tts')).toBe(CHAVE_TTS);
    expect(g.pedidos.map((p) => [p.metodo, p.url])).toEqual([['GET', 'https://texttospeech.googleapis.com/v1/voices?languageCode=pt-BR']]);
  });

  it('recusada: não grava, e a mensagem não traz a chave', async () => {
    const r = await gravarChaveTts('AIzaRECUSADA1234', criarGoogleFalso().fetch);
    expect(r.ok).toBe(false);
    expect(r.mensagem).toMatch(/a chave do Google Cloud TTS não tem permissão|foi recusada/);
    expect(r.mensagem).not.toContain('AIzaRECUSADA1234');
    expect(cofre.ler('google-tts')).toBeUndefined();
  });

  it('API desativada no projeto da chave: não grava e diz onde ativar', async () => {
    const g = criarGoogleFalso({respostas: [() => new Response(JSON.stringify({error: {code: 403, message: 'Cloud Text-to-Speech API has not been used in project 1 before or it is disabled.',
      status: 'PERMISSION_DENIED', details: [{reason: 'SERVICE_DISABLED'}]}}), {status: 403})]});
    const r = await gravarChaveTts(CHAVE_TTS, g.fetch);
    expect(r).toMatchObject({ok: false, mensagem: expect.stringContaining('texttospeech.googleapis.com')});
    expect(cofre.ler('google-tts')).toBeUndefined();
  });

  it('sem rede: grava e avisa que não deu para testar', async () => {
    const f = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const r = await gravarChaveTts(CHAVE_TTS, f);
    expect(r.ok).toBe(true);
    expect(r.mensagem).toMatch(/não deu para testar agora/);
    expect(cofre.ler('google-tts')).toBe(CHAVE_TTS);
  });

  it('curta ou com espaço: nem tenta', async () => {
    const g = criarGoogleFalso();
    expect((await gravarChaveTts('abc', g.fetch)).ok).toBe(false);
    expect((await gravarChaveTts('AIza com espaço', g.fetch)).ok).toBe(false);
    expect(g.pedidos).toHaveLength(0);
  });
});

describe('o que a tela vê e de onde vem a chave', () => {
  it('a tela recebe a origem e os 4 últimos caracteres; o Gemini TTS usa a chave do Gemini das conversas', () => {
    cofre.gravar('gemini', CHAVE_GEMINI);
    const e = estadoDaNarracao();
    expect(e.gemini).toEqual({pronto: true, origem: 'cofre', final: '1234'});
    expect(e['google-tts'].pronto).toBe(false);
    expect(JSON.stringify(e)).not.toContain(CHAVE_GEMINI);
    const s = servicoDoCofre({cofre: () => cofre});
    expect(s.chave('gemini')).toBe(CHAVE_GEMINI);
    expect(s.chave('google-tts')).toBeUndefined();
    expect(s.ondePorChave?.('google-tts')).toMatch(/Configurações › IA/);
  });

  it('stdio: GEMINI_API_KEY ou GOOGLE_API_KEY, e GOOGLE_TTS_API_KEY', () => {
    expect(servicoDoAmbiente({GEMINI_API_KEY: 'g1-12345678'}).chave('gemini')).toBe('g1-12345678');
    expect(servicoDoAmbiente({GOOGLE_API_KEY: 'g2-12345678'}).chave('gemini')).toBe('g2-12345678');
    expect(servicoDoAmbiente({GOOGLE_TTS_API_KEY: 't-12345678'}).chave('google-tts')).toBe('t-12345678');
    expect(servicoDoAmbiente({GOOGLE_API_KEY: 'g2-12345678'}).chave('google-tts')).toBeUndefined();
    expect(servicoDoAmbiente({}).ondePorChave?.('gemini')).toMatch(/GEMINI_API_KEY/);
    expect(servicoDoAmbiente({}).custo?.('gemini', 'gemini-3.8-flash-tts', {tokens_entrada: 0, tokens_saida: 1500, caracteres: 0, bytes: 0, palavras: 0, segundos: 60},
      new Date('2026-11-10'))?.usd).toBeCloseTo(0.0135, 4);
  });

  it('o uso do mês: tokens no Gemini TTS, caracteres no Cloud TTS', () => {
    const usos: [string, unknown, number | undefined][] = [];
    const s = servicoDoCofre({cofre: () => cofre, registrarUso: (id, u, c) => usos.push([id, u, c])});
    s.aoUso?.('gemini', 'gemini-3.8-flash-tts', {entrada: 10, saida: 500, caracteres: 40}, 0.0045);
    s.aoUso?.('google-tts', 'chirp3-hd', {entrada: 10, saida: 0, caracteres: 40}, 0.0012);
    expect(usos).toEqual([['gemini-tts', {entrada: 10, entrada_cache: 0, saida: 500}, 0.0045], ['google-tts', {entrada: 40, entrada_cache: 0, saida: 0}, 0.0012]]);
  });
});
