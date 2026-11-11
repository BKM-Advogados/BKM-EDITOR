// O kit Neutro gravado antes da reformulação (destaque azul #70B8FF) vira o Neutro de hoje (destaque branco) quando a
// pessoa nunca mexeu nele; com qualquer mudança, fica como está.
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {MARCA_NEUTRO, MARCA_NEUTRO_ANTIGO} from '../src/nucleo/marca';
import {PastaMarcas} from '../src/nucleo/pasta-marcas';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-neutro-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));

/** Uma pasta de kits com o marca.json do Neutro dado (texto cru, como estaria no disco). */
const pastaCom = (nome: string, conteudo: string) => {
  const pasta = path.join(tmp, nome);
  mkdirSync(path.join(pasta, 'neutro'), {recursive: true});
  writeFileSync(path.join(pasta, 'neutro', 'marca.json'), conteudo);
  return {marcas: new PastaMarcas({pasta: () => pasta}), arq: path.join(pasta, 'neutro', 'marca.json')};
};
// o arquivo como a versão antiga gravava
const GRAVADO_ANTES = `{
  "formato": 1,
  "id": "neutro",
  "nome": "Neutro",
  "cores": {
    "fundo": "#111418",
    "texto": "#F2F2F2",
    "destaque": "#70B8FF",
    "suave": "#A3ABB5"
  },
  "fontes": {
    "titulo": "Inter",
    "texto": "Inter",
    "arquivos": []
  },
  "notas": "O tema padrão do Estúdio, igual ao de um vídeo novo sem kit."
}
`;

describe('Neutro de fábrica antigo', () => {
  it('o antigo é o de hoje com o destaque azul', () => {
    expect(MARCA_NEUTRO.cores.destaque).toBe('#FFFFFF');
    expect(MARCA_NEUTRO_ANTIGO).toEqual({...MARCA_NEUTRO, cores: {...MARCA_NEUTRO.cores, destaque: '#70B8FF'}});
  });

  it('intacto: garantir troca pelo de hoje, e só uma vez', () => {
    const {marcas, arq} = pastaCom('intacto', GRAVADO_ANTES);
    marcas.garantir();
    expect(marcas.ler('neutro').cores.destaque).toBe('#FFFFFF');
    // a pessoa volta o azul depois da troca: não é desfeito de novo
    writeFileSync(arq, GRAVADO_ANTES);
    marcas.garantir();
    expect(marcas.listar()[0].cores.destaque).toBe('#70B8FF');
  });

  it('intacto com outra ordem de chaves, hex em minúscula e BOM: troca também (pelo listar)', () => {
    const o = JSON.parse(GRAVADO_ANTES);
    const embaralhado = {notas: o.notas, fontes: {arquivos: [], texto: 'Inter', titulo: 'Inter'}, cores: {suave: '#a3abb5', destaque: '#70b8ff', texto: '#f2f2f2', fundo: '#111418'}, nome: 'Neutro', id: 'neutro', formato: 1};
    const {marcas} = pastaCom('embaralhado', '\uFEFF' + JSON.stringify(embaralhado));
    expect(marcas.listar().find((m) => m.id === 'neutro')?.cores.destaque).toBe('#FFFFFF');
  });

  it.each([
    ['outra cor', (o: any) => (o.cores.fundo = '#000000')],
    ['outra fonte', (o: any) => (o.fontes.titulo = 'Archivo')],
    ['cor de apoio', (o: any) => (o.cores.ouro = '#C9A961')],
    ['logo', (o: any) => (o.logo = 'logo.png')],
    ['outra nota', (o: any) => (o.notas = 'meu')],
    ['outro nome', (o: any) => (o.nome = 'Neutro meu')],
    ['sem a nota', (o: any) => delete o.notas],
  ])('mexido (%s): fica como está', (_, mexer) => {
    const o = JSON.parse(GRAVADO_ANTES);
    mexer(o);
    const texto = JSON.stringify(o, null, 2);
    const {marcas, arq} = pastaCom(`mexido-${_}`, texto);
    marcas.garantir();
    marcas.listar();
    expect(readFileSync(arq, 'utf-8')).toBe(texto);
  });
});
