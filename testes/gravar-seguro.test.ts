// Gravação que aguenta arquivo preso (transversal-D8): rename com EPERM/EBUSY tenta de novo e não deixa .tmp para trás.
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {ESPERAS_MS, gravarAtomico, renomearComRetry} from '../src/nucleo/gravar-seguro';
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

  it('Projeto.gravarTexto grava por ele', () => {
    const p = new Projeto(tmp);
    p.gravarTexto('pasta/dentro.txt', 'oi');
    expect(readFileSync(path.join(tmp, 'pasta', 'dentro.txt'), 'utf-8')).toBe('oi');
  });
});
