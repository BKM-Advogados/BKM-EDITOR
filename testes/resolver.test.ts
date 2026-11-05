// O porte em TypeScript tem de dar as mesmas props que o preparar_carrossel.py deu no Mac para o C2 (04/11/2026).
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {arredondar, norm, resolverRoteiro, type Palavra, type Roteiro} from '../src/nucleo/roteiro/resolver';

// roteiro, palavras e as props que o preparar_carrossel.py gerou no Mac para o C2 (04/11/2026)
const REF = path.join(__dirname, 'fixtures', 'c2');
const ler = <T>(arq: string): T => JSON.parse(readFileSync(path.join(REF, arq), 'utf-8')) as T;

const semOrigem = (cenas: Record<string, unknown>[]) =>
  cenas.map(({origem: _oc, ...c}) => ({...c, blocos: (c.blocos as Record<string, unknown>[] | undefined)?.map(({origem: _o, ...b}) => b)}))
    .map((c) => (c.blocos === undefined ? (({blocos: _b, ...resto}) => resto)(c) : c));

describe('resolver do roteiro', () => {
  const roteiro = ler<Roteiro>('roteiro.json');
  const palavras = ler<Palavra[]>('palavras.json');
  const python = ler<Record<string, unknown>>('props-python.json');
  const {props, trechos} = resolverRoteiro(roteiro, palavras);

  it('arredonda como o Python', () => {
    expect([arredondar(0.5), arredondar(1.5), arredondar(2.5), arredondar(2.4), arredondar(2.6)]).toEqual([0, 2, 2, 2, 3]);
  });

  it('normaliza palavras sem acento, caixa e pontuação', () => {
    expect(norm(' Benefícios, ')).toBe('beneficios');
    expect(norm('“Você”')).toBe('voce');
  });

  it('dá a mesma duração, cenas, legendas e sons do preparar_carrossel.py', () => {
    expect(props.duracao_ms).toBe(python.duracao_ms);
    expect(props.total_partes).toBe(python.total_partes);
    expect(semOrigem(props.cenas)).toEqual(python.cenas);
    expect(props.legendas).toEqual(python.legendas);
    expect(props.sons).toEqual(python.sons);
    expect(props.foto).toEqual(python.foto);
  });

  it('marca a origem de cada bloco no roteiro', () => {
    const b = (props.cenas[3].blocos as Record<string, unknown>[])[1];
    expect(b.tipo).toBe('numero');
    expect(b.origem).toBe('/cenas/2/blocos/1');
  });

  it('toca a narração em trechos contíguos, cada um depois da sua pausa', () => {
    expect(trechos[0]).toMatchObject({de: 0, em: 1600});
    for (let i = 1; i < trechos.length; i++) expect(trechos[i].de).toBe(trechos[i - 1].ate);
    const fim = trechos[trechos.length - 1];
    expect(fim.em + (fim.ate - fim.de)).toBe((python.duracao_ms as number) - 3500);
  });
});
