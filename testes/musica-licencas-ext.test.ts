import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {novaMusica} from '../src/nucleo/musica';
import {classeDaPolitica, conferirOrigem, creditoDaOrigem, licencasDaMusica, podeEntrarNoBundle, POLITICA_LICENCAS, TIPOS_ORIGEM, type OrigemConteudo} from '../src/nucleo/musica-licencas';

const H = 'a'.repeat(64);
const base: OrigemConteudo = {tipo: 'ir', id: 'sala', nome: 'Sala', spdx: 'CC0-1.0', sha256: H};

describe('política A6', () => {
  it('classifica as licenças', () => {
    for (const s of ['MIT', 'BSD-3-Clause', 'Apache-2.0', 'CC0-1.0', 'CC-BY-4.0']) expect(classeDaPolitica(s)).toBe('permitida');
    expect(classeDaPolitica('LGPL-3.0-or-later')).toBe('separada');
    for (const s of ['GPL-3.0', 'GPL-3.0-only', 'AGPL-3.0', 'GPL-2.0+']) expect(classeDaPolitica(s)).toBe('proibida');
    expect(classeDaPolitica('CC-BY-NC-4.0')).toBe('desconhecida');
    expect(POLITICA_LICENCAS.permitidas).toContain('MIT');
  });
  it('LGPL só como módulo separado; GPL nunca', () => {
    expect(podeEntrarNoBundle('LGPL-2.1')).toBe(false);
    expect(podeEntrarNoBundle('LGPL-2.1', {modulo_separado: true})).toBe(true);
    expect(podeEntrarNoBundle('AGPL-3.0', {modulo_separado: true})).toBe(false);
    expect(podeEntrarNoBundle('MIT')).toBe(true);
  });
});

describe('origens estendidas', () => {
  it('cobre os cinco tipos', () => expect(TIPOS_ORIGEM).toEqual(['amostra', 'ir', 'preset', 'modelo_nam', 'modulo_wasm']));
  it('origem válida não tem problema', () => expect(conferirOrigem(base)).toEqual([]));
  it('aponta hash, licença e política', () => {
    expect(conferirOrigem({...base, sha256: 'xyz'}).join()).toMatch(/SHA-256/);
    expect(conferirOrigem({...base, spdx: ''}).join()).toMatch(/falta a licença/);
    expect(conferirOrigem({...base, spdx: 'GPL-3.0'}).join()).toMatch(/proibidas/);
    expect(conferirOrigem({...base, spdx: 'LGPL-3.0'}).join()).toMatch(/módulo separado/);
    expect(conferirOrigem({...base, spdx: 'LGPL-3.0'}, {modulo_separado: true})).toEqual([]);
    expect(conferirOrigem({...base, spdx: 'CC-BY-4.0'}).join()).toMatch(/autor ou crédito/);
  });
  it('crédito: texto próprio vence; CC BY usa título, autor e licença', () => {
    expect(creditoDaOrigem({...base, credito: ' Feito por X '})).toBe('Feito por X');
    const c = creditoDaOrigem({...base, tipo: 'modelo_nam', spdx: 'CC-BY-4.0', autor: 'Ana', titulo: 'Amp'});
    expect(c).toContain('"Amp" por Ana');
    expect(c).toContain('CC BY 4.0');
    expect(creditoDaOrigem({...base, tipo: 'modulo_wasm', spdx: 'Apache-2.0', autor: 'Bia'})).toBe('módulo WASM "Sala" por Bia licença Apache-2.0');
  });
});

describe('compatibilidade e NOTICE', () => {
  it('o comportamento existente não muda', () => {
    const r = licencasDaMusica(novaMusica({titulo: 't'}));
    expect(r.pode_publicar).toBe(true);
    expect(r.sons.every((s) => s.tipo !== undefined)).toBe(true);
  });
  it('NOTICE lista as dependências de áudio e a política', () => {
    const n = readFileSync(new URL('../NOTICE', import.meta.url), 'utf8');
    for (const t of ['remotion', 'onnxruntime-web', 'GPL', 'LGPL', 'CC0']) expect(n).toContain(t);
  });
});
