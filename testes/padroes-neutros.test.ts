// Visual neutro (ux/pesquisa-ux-visual.md §4.7): nenhum padrão de conteúdo nasce com cor de cliente nem com o azul de
// seleção da interface, e o único kit de fábrica é o Neutro, com destaque branco (o peso marca o trecho).
import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {MARCA_NEUTRO, MARCAS_INICIAIS} from '../src/nucleo/marca';
import {TEMA_NEUTRO} from '../src/nucleo/cenas';
import {TEMA_ANIMACAO_NEUTRO} from '../src/nucleo/animacao';
import {novoDoc3d} from '../src/nucleo/cena3d';
import {lerEfeitos, novoEfeito, TOM_PADRAO} from '../src/nucleo/efeitos';
import {COR_NOVA} from '../src/renderer/modulos/tres/comum';
import {destaqueSemCor} from '../src/composicoes/cenas/VideoCenas';

const ACENTO_DA_INTERFACE = '#70B8FF';
const COBRE_DE_CLIENTE = '#C88155';
const proibidas = [ACENTO_DA_INTERFACE, COBRE_DE_CLIENTE];
const nao = (cor: string | undefined) => expect(proibidas).not.toContain(cor?.toUpperCase());

describe('padrões de conteúdo neutros', () => {
  it('o único kit de fábrica é o Neutro, com destaque branco', () => {
    expect(MARCAS_INICIAIS.map((m) => m.id)).toEqual(['neutro']);
    expect(MARCA_NEUTRO.cores.destaque).toBe('#FFFFFF');
    expect(TEMA_NEUTRO.destaque).toBe('#FFFFFF');
    expect(TEMA_ANIMACAO_NEUTRO.destaque).toBe('#FFFFFF');
  });

  it('o destaque branco ganha peso na composição; um destaque colorido fica só na cor', () => {
    expect(destaqueSemCor(TEMA_NEUTRO.destaque)).toBe(true);
    expect(destaqueSemCor('#C9A961')).toBe(false);
    expect(destaqueSemCor('#70B8FF')).toBe(false);
  });

  it('objeto 3D novo, caixa da cena nova e Tom de cor nascem sem cor de cliente nem o azul da interface', () => {
    nao(COR_NOVA);
    for (const o of novoDoc3d().objetos) nao(o.cor);
    nao(TOM_PADRAO);
    nao(novoEfeito('tom').cor);
    expect(novoEfeito('tom').cor).toBe(TOM_PADRAO);
    expect(lerEfeitos([{id: 't', tipo: 'tom', valor: 0.2}])[0].efeito?.cor).toBe(TOM_PADRAO);
  });

  it('a interface não cita marca de cliente nem usa o cobre como padrão', () => {
    // o nome do escritório vai montado, para não ficar escrito no repositório
    const citaMarca = new RegExp(`\\bKS\\b|\\b${['B', 'K', 'M'].join('')}\\b|Ver um pronto`);
    const raiz = path.join(__dirname, '..', 'src', 'renderer');
    const achados: string[] = [];
    const ver = (dir: string) => {
      for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) ver(p);
        else if (/\.(tsx?|css)$/.test(e.name)) {
          const t = fs.readFileSync(p, 'utf8');
          if (citaMarca.test(t) || /c88155/i.test(t)) achados.push(path.relative(raiz, p));
        }
      }
    };
    ver(raiz);
    expect(achados).toEqual([]);
  });
});

describe('o branco do Neutro e o texto branco da imagem', async () => {
  const {patchDaMarca} = await import('../src/nucleo/marca');
  const {novoDocImagem} = await import('../src/nucleo/criar-projeto');
  const {KIT_TESTE} = await import('./fixtures/kit-teste');
  it('texto branco (o padrão da camada) vira o texto do kit novo, não o destaque', () => {
    const img = {...novoDocImagem(1080, 1350), camadas: [{id: 't', nome: 'T', tipo: 'texto' as const, x: 0, y: 0, largura: 10, altura: 10, texto: 'Oi', cor: '#FFFFFF'}]};
    expect(patchDaMarca(img, KIT_TESTE)).toContainEqual({op: 'replace', path: '/camadas/0/cor', value: KIT_TESTE.cores.texto});
  });
});
