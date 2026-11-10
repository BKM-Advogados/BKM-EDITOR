// O diário depois da rodada 3 (frente IA): linha quebrada não derruba (transversal-D2), o próximo número sai do fim do
// arquivo mesmo com entradas grandes (transversal-D15), o Reverter por seq confere o valor antes (e passa por cima só
// com forcar), e o Ctrl+Z lembra o que já desfez depois de reabrir o projeto (transversal-D1).
import {appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {cortarResultado} from '../src/compartilhado/ferramentas';
import {Projeto} from '../src/nucleo/projeto';

let pasta = '';
beforeEach(() => {
  pasta = mkdtempSync(path.join(tmpdir(), 'estudio-diario-'));
  cpSync(path.join(__dirname, 'fixtures', 'projeto'), pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
});
afterEach(() => rmSync(pasta, {recursive: true, force: true, maxRetries: 10, retryDelay: 100}));

const cor = (p: Projeto) => (p.lerJson<{objetos: {cor: string}[]}>(p.arquivoDoDocumento('cena3d')).doc.objetos[0].cor);
const trocarCor = (p: Projeto, nova: string, quem = {autor: 'pessoa', origem: 'interface'}) =>
  p.aplicarPatch({documento: 'cena3d', patch: [{op: 'replace', path: '/objetos/0/cor', value: nova}], rotulo: `cor ${nova}`, ...quem});

describe('diário', () => {
  it('linha quebrada no meio do arquivo é pulada e a próxima edição grava numa linha própria (D2)', () => {
    const p = new Projeto(pasta);
    trocarCor(p, '#111111');
    appendFileSync(p.caminho('.estudio/diario.jsonl'), '{"seq": 2, "em": "quebr'); // queda de energia no meio da linha
    const r = trocarCor(p, '#222222');
    expect(r.entrada.seq).toBe(2);
    expect(p.diario(0, {tolerante: true}).map((e) => e.seq)).toEqual([1, 2]);
    expect(() => p.diario()).toThrow(); // o modo estrito (faxina do Som) continua acusando a linha quebrada
    expect(readFileSync(p.caminho('.estudio/diario.jsonl'), 'utf-8').split('\n').filter(Boolean)).toHaveLength(3);
  });

  it('o próximo número sai do fim do arquivo, mesmo com entrada maior que a janela de leitura (D15)', () => {
    const p = new Projeto(pasta);
    trocarCor(p, '#111111');
    const grande = 'x'.repeat(200_000);
    p.aplicarPatch({documento: 'cena3d', patch: [{op: 'add', path: '/objetos/0/nota', value: grande}], autor: 'agente', origem: 'Claude 1'});
    expect(p.ultimaSeq()).toBe(2);
    expect(trocarCor(p, '#333333').entrada.seq).toBe(3);
    const marca = p.marcaDoDiario();
    trocarCor(p, '#444444');
    expect(p.entradasDesde(marca).map((e) => e.seq)).toEqual([4]);
  });

  it('reverter confere o valor: volta se ninguém mexeu, recusa se mudou depois, e passa por cima com forcar', () => {
    const p = new Projeto(pasta);
    const original = cor(p);
    const a = trocarCor(p, '#AAAAAA', {autor: 'agente', origem: 'DeepSeek 1'});
    expect(p.reverter(a.entrada.seq, {autor: 'pessoa', origem: 'reverter'})).toMatchObject({ok: true});
    expect(cor(p)).toBe(original);
    expect(p.reverter(a.entrada.seq, {autor: 'pessoa', origem: 'reverter'})).toMatchObject({ok: false, mensagem: expect.stringMatching(/já foi revertida/)});
    const b = trocarCor(p, '#BBBBBB', {autor: 'agente', origem: 'DeepSeek 1'});
    trocarCor(p, '#CCCCCC');
    expect(p.reverter(b.entrada.seq, {autor: 'pessoa', origem: 'reverter'})).toMatchObject({ok: false, mudou_depois: true});
    expect(cor(p)).toBe('#CCCCCC');
    expect(p.reverter(b.entrada.seq, {autor: 'pessoa', origem: 'reverter', forcar: true})).toMatchObject({ok: true});
    expect(cor(p)).toBe(original); // b trocou o original (o a já tinha sido revertido) por #BBBBBB
    expect(p.diario().slice(-1)[0]).toMatchObject({desfaz: b.entrada.seq, origem: 'reverter'});
  });

  it('mudança que não é troca só reverte sem perguntar se for a última do documento', () => {
    const p = new Projeto(pasta);
    const a = p.aplicarPatch({documento: 'cena3d', patch: [{op: 'add', path: '/objetos/0/nota', value: 'oi'}], autor: 'agente', origem: 'Claude 1'});
    trocarCor(p, '#DDDDDD');
    expect(p.reverter(a.entrada.seq, {autor: 'pessoa', origem: 'reverter'})).toMatchObject({ok: false, mudou_depois: true});
  });

  it('o Ctrl+Z lembra o que já desfez depois de reabrir o projeto (D1)', () => {
    const p = new Projeto(pasta);
    const original = cor(p);
    trocarCor(p, '#010101');
    trocarCor(p, '#020202');
    const como = {autor: 'pessoa', origem: 'interface', como: {autor: 'pessoa', origem: 'desfazer'}};
    expect(p.desfazerUltima(como)).toMatchObject({ok: true});
    expect(cor(p)).toBe('#010101');
    const reaberto = new Projeto(pasta); // o app fechou e abriu de novo: nada em memória
    expect(reaberto.desfazerUltima(como)).toMatchObject({ok: true});
    expect(cor(reaberto)).toBe(original);
    expect(reaberto.desfazerUltima(como)).toMatchObject({ok: false, mensagem: 'nada para desfazer'});
  });

  it('o corte do resultado para a tela não perde as mudanças do diário', () => {
    const texto = `${'a'.repeat(9000)}\n{"estudio_mudancas":[{"seq":7,"documento":"video/c2.json","rotulo":"x"}]}`;
    const c = cortarResultado(texto);
    expect(c.length).toBeLessThanOrEqual(4002);
    expect(c.endsWith('{"estudio_mudancas":[{"seq":7,"documento":"video/c2.json","rotulo":"x"}]}')).toBe(true);
  });
});
