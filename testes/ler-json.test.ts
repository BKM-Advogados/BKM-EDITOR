// O ler-json da tela (auditoria do processo principal, P6): opcional ausente ou sem projeto é null (sem erro no log a cada
// abertura); o obrigatório continua lançando; nenhum dos dois sai da pasta do projeto.
import {cpSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {lerJsonDaTela} from '../src/main/ler-json';
import {Projeto} from '../src/nucleo/projeto';

const pasta = mkdtempSync(path.join(os.tmpdir(), 'estudio-ler-json-'));
afterAll(() => rmSync(pasta, {recursive: true, force: true}));
cpSync(path.join(__dirname, 'fixtures', 'projeto'), pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
const projeto = new Projeto(pasta);

describe('ler-json da tela (P6)', () => {
  it('opcional ausente, ou sem projeto aberto, é null', () => {
    expect(lerJsonDaTela(projeto, '.estudio/transicoes.json', {opcional: true})).toBeNull();
    expect(lerJsonDaTela(null, '.estudio/selecao.json', {opcional: true})).toBeNull();
  });
  it('opcional presente é lido', () => {
    writeFileSync(path.join(pasta, '.estudio-sel.json'), '{"documento":"x"}');
    expect(lerJsonDaTela(projeto, '.estudio-sel.json', {opcional: true})).toEqual({documento: 'x'});
  });
  it('o obrigatório continua lançando, e ninguém sai do projeto', () => {
    expect(() => lerJsonDaTela(projeto, 'nao-existe.json')).toThrow(/não achado/);
    expect(() => lerJsonDaTela(null, 'estudio.json')).toThrow(/nenhum projeto aberto/);
    expect(() => lerJsonDaTela(projeto, '../fora.json', {opcional: true})).toThrow(/fora do projeto/);
  });
});
