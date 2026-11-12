// Seletor de fonte da camada de texto da imagem (lógica pura): grupos, fonte do kit e fonte que sumiu.
import {describe, expect, it} from 'vitest';
import {FONTE_RESERVA, familiasParaEsperar, fonteExiste, fontesDaMarca, montarGrupos, opcoesComTitulos, pilhaDeFontes, type FonteConhecida} from '../src/nucleo/fontes-imagem';
import type {MarcaDoDocumento} from '../src/nucleo/documentos';

const marca: MarcaDoDocumento = {id: 'k', nome: 'Kit', cores: {fundo: '#fff', texto: '#000', destaque: '#f00', suave: '#ccc'}, fontes: {titulo: 'Fraunces', texto: 'Inter'}};
const conhecidas: FonteConhecida[] = [
  {nome: 'Archivo', origem: 'google'},
  {nome: 'Inter', origem: 'google'},
  {nome: 'Zilla', origem: 'arquivo'},
  {nome: 'Fraunces', origem: 'arquivo'},
  {nome: 'Zilla', origem: 'arquivo'},
];
const nomesDe = (g: ReturnType<typeof montarGrupos>) => g.map((x) => x.rotulo);

describe('lista de fontes da imagem', () => {
  it('F1 sem kit e sem fonte de arquivo fica como hoje: as quatro fixas e a do sistema', () => {
    const g = montarGrupos(undefined, [{nome: 'Inter', origem: 'google'}]);
    expect(nomesDe(g)).toEqual(['Do app', 'Sistema']);
    expect(g[0].opcoes.map(([v]) => v)).toEqual(['Archivo', 'IBM Plex Mono', 'IBM Plex Sans', 'Inter']);
  });

  it('F2 as fontes de arquivo entram num grupo "Da marca", em ordem e sem repetir', () => {
    const g = montarGrupos(marca, conhecidas);
    expect(nomesDe(g)).toEqual(['Do kit', 'Da marca', 'Do app', 'Sistema']);
    expect(g[1].opcoes.map(([v]) => v)).toEqual(['Fraunces', 'Zilla']);
    expect(fontesDaMarca(conhecidas)).toEqual(['Fraunces', 'Zilla']);
  });

  it('F3 as referências do kit mostram o nome da família do kit', () => {
    const [kit] = montarGrupos(marca, conhecidas);
    expect(kit.opcoes).toEqual([['@titulo', 'Título do kit · Fraunces'], ['@texto', 'Texto do kit · Inter'], ['@mono', 'Mono do kit · Inter']]);
  });

  it('F4 a fonte gravada que sumiu aparece com o nome guardado e o aviso', () => {
    const g = montarGrupos(marca, conhecidas, 'Fonte Velha');
    const ultimo = g[g.length - 1];
    expect(ultimo.rotulo).toBe('Guardada no documento');
    expect(ultimo.opcoes[0][0]).toBe('Fonte Velha');
    expect(ultimo.opcoes[0][1]).toContain('Fonte Velha');
    expect(ultimo.opcoes[0][1]).toContain('não encontrada');
  });

  it('F5 fonte gravada que existe (fixa, de arquivo, genérica ou referência) não ganha grupo de aviso', () => {
    for (const atual of ['Inter', 'Zilla', 'system-ui', '@titulo']) expect(nomesDe(montarGrupos(marca, conhecidas, atual))).not.toContain('Guardada no documento');
  });

  it('F6 os títulos dos grupos viram linhas que não se escolhem', () => {
    const lista = opcoesComTitulos(montarGrupos(undefined, []));
    expect(lista.filter((o) => o.desligado).map((o) => o.rotulo)).toEqual(['DO APP', 'SISTEMA']);
    expect(new Set(lista.map((o) => o.valor)).size).toBe(lista.length);
  });
});

describe('fonte que não existe mais', () => {
  it('F7 fonteExiste reconhece fixa, de arquivo, genérica e referência; o resto não', () => {
    expect(fonteExiste('Inter', [])).toBe(true);
    expect(fonteExiste('Zilla', conhecidas)).toBe(true);
    expect(fonteExiste('system-ui', [])).toBe(true);
    expect(fonteExiste('@mono', [])).toBe(true);
    expect(fonteExiste('Zilla', [])).toBe(false);
  });

  it('F8 o font-family leva a Inter de reserva atrás da família pedida', () => {
    expect(pilhaDeFontes('Zilla', 'system-ui')).toBe('"Zilla", "Inter", system-ui, sans-serif');
    expect(pilhaDeFontes('Inter', 'system-ui')).toBe('"Inter", system-ui, sans-serif');
    expect(pilhaDeFontes(undefined, 'system-ui')).toBe('system-ui');
    expect(FONTE_RESERVA).toBe('Inter');
  });

  it('F9 a exportação espera a reserva só quando alguma família falta', () => {
    expect(familiasParaEsperar(['Zilla', 'system-ui', ''], conhecidas)).toEqual(['Zilla']);
    expect(familiasParaEsperar(['Zilla', 'Sumiu', 'Sumiu'], conhecidas)).toEqual(['Zilla', 'Sumiu', 'Inter']);
    expect(familiasParaEsperar(['system-ui', '@titulo'], [])).toEqual([]);
  });
});
