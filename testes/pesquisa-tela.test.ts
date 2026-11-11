// Jargão fora da tela (ux/pesquisa-ux-visual.md, item 9): nome de arquivo como título de fonte vira palavras, e o painel
// não fala mais no nome interno antigo do campo da observação.
import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {tituloLegivel} from '../src/renderer/paineis/Pesquisa';

describe('painel Pesquisa', () => {
  it('título de fonte que é nome de arquivo vira palavras, com o órgão ou o site na frente', () => {
    expect(tituloLegivel({titulo: 'Del5452compilado', url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452compilado.htm'}))
      .toBe('planalto.gov.br · Del 5452 compilado');
    expect(tituloLegivel({titulo: 'lei_14020-2020.pdf', url: 'https://x.gov.br/a.pdf', orgao: 'Presidência'})).toBe('Presidência · Lei 14020 2020');
    expect(tituloLegivel({titulo: 'CLT - Decreto-Lei nº 5.452', url: 'https://x.gov.br'})).toBe('CLT - Decreto-Lei nº 5.452');
    expect(tituloLegivel({url: 'https://www.tst.jus.br/sumulas/sumula_331'})).toBe('tst.jus.br · Sumula 331');
  });

  it('a observação é "de quem baixou", sem o nome interno antigo do campo', () => {
    const tsx = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'paineis', 'Pesquisa.tsx'), 'utf8');
    expect(tsx.toLowerCase()).not.toContain(['vix', 'sys'].join('')); // em pedaços: o nome não fica escrito no repositório
    expect(tsx).toContain('Observação de quem baixou');
  });
});
