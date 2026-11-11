// Gravação que aguenta arquivo preso (transversal-D8): rename com EPERM/EBUSY tenta de novo e não deixa .tmp para trás.
import {existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {ESPERAS_MS, gravarAtomico, gravarAtomicoNoLugar, renomearComRetry} from '../src/nucleo/gravar-seguro';
import {Projeto} from '../src/nucleo/projeto';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-gravar-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));

const erro = (code: string) => Object.assign(new Error(code), {code});

/** Sistema falso: o rename falha com `codigos` nas primeiras tentativas e depois passa. */
const falso = (codigos: string[]) => {
  const esperas: number[] = [];
  let chamadas = 0;
  return {
    esperas,
    chamadas: () => chamadas,
    renomear: () => {
      const c = codigos[chamadas++];
      if (c) throw erro(c);
    },
    esperar: (ms: number) => void esperas.push(ms),
  };
};

describe('renomearComRetry', () => {
  it('rename que passa de primeira não espera', () => {
    const s = falso([]);
    expect(renomearComRetry('a', 'b', s)).toBe(0);
    expect(s.esperas).toEqual([]);
  });

  it('EPERM e EBUSY passam na segunda e terceira tentativas, com espera crescente', () => {
    const s = falso(['EPERM', 'EBUSY']);
    expect(renomearComRetry('a', 'b', s)).toBe(2);
    expect(s.esperas).toEqual([20, 40]);
  });

  it('desiste depois da última espera e devolve o erro do sistema', () => {
    const s = falso(Array(10).fill('EPERM'));
    expect(() => renomearComRetry('a', 'b', s)).toThrow(/EPERM/);
    expect(s.esperas).toEqual(ESPERAS_MS);
    expect(s.chamadas()).toBe(ESPERAS_MS.length + 1);
    expect(ESPERAS_MS.reduce((a, b) => a + b, 0)).toBeLessThan(1000);
  });

  it('erro que não é de arquivo preso sai na hora', () => {
    const s = falso(['ENOENT']);
    expect(() => renomearComRetry('a', 'b', s)).toThrow(/ENOENT/);
    expect(s.esperas).toEqual([]);
  });
});

describe('gravarAtomico', () => {
  it('grava o texto e não deixa temporário', () => {
    const abs = path.join(tmp, 'doc.json');
    gravarAtomico(abs, '{"a":1}\n');
    expect(readFileSync(abs, 'utf-8')).toBe('{"a":1}\n');
    expect(readdirSync(tmp).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('arquivo que não solta: apaga o temporário e avisa em português', () => {
    const abs = path.join(tmp, 'preso.json');
    const s = falso(Array(10).fill('EBUSY'));
    expect(() => gravarAtomico(abs, 'x', s)).toThrow(/em uso por outro programa/);
    expect(existsSync(abs)).toBe(false);
    expect(readdirSync(tmp).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('pasta sem permissão de escrita: avisa permissão, não "em uso", e não tenta de novo', () => {
    const abs = path.join(tmp, 'sem-permissao.json');
    const s = falso([]);
    const negar = (() => {
      throw erro('EACCES');
    }) as unknown as typeof writeFileSync;
    expect(() => gravarAtomico(abs, 'x', s, negar)).toThrow(/sem permissão para gravar/);
    expect(s.chamadas()).toBe(0);
    expect(s.esperas).toEqual([]);
    expect(existsSync(abs)).toBe(false);
  });

  it('Projeto.gravarTexto grava por ele', () => {
    const p = new Projeto(tmp);
    p.gravarTexto('pasta/dentro.txt', 'oi');
    expect(readFileSync(path.join(tmp, 'pasta', 'dentro.txt'), 'utf-8')).toBe('oi');
  });
});

// modo e symlink só valem onde o sistema os tem (no Windows o modo é só "somente leitura" e symlink pede privilégio)
describe.skipIf(process.platform === 'win32')('gravarAtomicoNoLugar', () => {
  it('o modo do original fica (600 continua 600, mesmo com umask); arquivo novo pode nascer com o modo pedido', () => {
    const abs = path.join(tmp, 'config-600.json');
    writeFileSync(abs, '{}', {mode: 0o600});
    gravarAtomicoNoLugar(abs, '{"a":1}\n');
    expect(readFileSync(abs, 'utf-8')).toBe('{"a":1}\n');
    expect(statSync(abs).mode & 0o777).toBe(0o600);
    const novo = path.join(tmp, 'novo-600.json');
    gravarAtomicoNoLugar(novo, 'x', 0o600);
    expect(statSync(novo).mode & 0o777).toBe(0o600);
    expect(readdirSync(tmp).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('symlink continua symlink: grava no arquivo para onde ele aponta', () => {
    const real = path.join(tmp, 'dotfiles-config.json');
    writeFileSync(real, '{}', {mode: 0o640});
    const link = path.join(tmp, 'link-config.json');
    symlinkSync(real, link);
    gravarAtomicoNoLugar(link, '{"b":2}\n');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, 'utf-8')).toBe('{"b":2}\n');
    expect(statSync(real).mode & 0o777).toBe(0o640);
  });
});
