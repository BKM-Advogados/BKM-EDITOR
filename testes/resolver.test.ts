// Resolver do roteiro do carrossel narrado. O porte do preparar_carrossel.py foi conferido, na época, contra as props que o
// script em Python dava; o script não existe mais, então a referência (fixtures/carrossel/props.json) é uma foto das props
// que esta implementação dá para um roteiro sintético, mais asserções sobre as regras (cortes, pausas, sons, legendas).
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {ABERTURA_MS, arredondar, FINAL_MS, norm, padroesDaMidia, PAUSA_GANCHO, PAUSA_PARTE, resolverRoteiro, type Palavra, type Roteiro} from '../src/nucleo/roteiro/resolver';

// roteiro e narração sintéticos ("documentos em ordem", tempos inventados) e as props que o resolver deu para eles
const REF = path.join(__dirname, 'fixtures', 'carrossel');
const ler = <T>(arq: string): T => JSON.parse(readFileSync(path.join(REF, arq), 'utf-8')) as T;

const semOrigem = (cenas: Record<string, unknown>[]) =>
  cenas.map(({origem: _oc, ...c}) => ({...c, blocos: (c.blocos as Record<string, unknown>[] | undefined)?.map(({origem: _o, ...b}) => b)}))
    .map((c) => (c.blocos === undefined ? (({blocos: _b, ...resto}) => resto)(c) : c));

describe('resolver do roteiro', () => {
  const roteiro = ler<Roteiro>('roteiro.json');
  const palavras = ler<Palavra[]>('palavras.json');
  const foto = ler<Record<string, unknown>>('props.json');
  const {props, trechos} = resolverRoteiro(roteiro, palavras);

  it('arredonda como o Python', () => {
    expect([arredondar(0.5), arredondar(1.5), arredondar(2.5), arredondar(2.4), arredondar(2.6)]).toEqual([0, 2, 2, 2, 3]);
  });

  it('normaliza palavras sem acento, caixa e pontuação', () => {
    expect(norm(' Benefícios, ')).toBe('beneficios');
    expect(norm('“Você”')).toBe('voce');
  });

  it('dá a mesma duração, cenas, legendas e sons da referência', () => {
    expect(props.duracao_ms).toBe(foto.duracao_ms);
    expect(props.total_partes).toBe(foto.total_partes);
    expect(semOrigem(props.cenas)).toEqual(semOrigem(foto.cenas as Record<string, unknown>[]));
    expect(props.legendas).toEqual(foto.legendas);
    expect(props.sons).toEqual(foto.sons);
    expect(props.foto).toEqual(foto.foto);
    expect(props).toEqual(foto);
  });

  it('a duração é abertura + narração + pausas + cartão final', () => {
    const pausas = PAUSA_GANCHO + 2 * PAUSA_PARTE + 500 + (roteiro.pausas ?? []).reduce((s, p) => s + p.ms, 0);
    // a cena 1 (gancho → parte 1) leva a pausa do roteiro (1200), as outras partes a padrão, a dúvida 500
    expect(props.duracao_ms).toBe(ABERTURA_MS + palavras[palavras.length - 1].e + 500 + pausas + FINAL_MS);
    const cenas = props.cenas as {tipo: string; t_in: number; t_out: number}[];
    expect(cenas.map((c) => c.tipo)).toEqual(['abertura', 'gancho', 'parte', 'parte', 'parte', 'duvida', 'final']);
    for (let i = 1; i < cenas.length; i++) expect(cenas[i].t_in).toBe(cenas[i - 1].t_out);
  });

  it('as legendas têm até 4 palavras, fecham na pontuação e juntam o "%" ao número', () => {
    const legendas = props.legendas as {palavras: Palavra[]}[];
    expect(Math.max(...legendas.map((l) => l.palavras.length))).toBeLessThanOrEqual(4);
    const todas = legendas.flatMap((l) => l.palavras.map((p) => p.w));
    expect(todas).toContain('90%');
    expect(todas).toContain('e-mail,');
    expect(todas).toHaveLength(palavras.length - 2);
  });

  it('o tema, a marca e a foto vêm do roteiro; sem eles, o neutro, a marca vazia e o que a mídia tem', () => {
    expect(props).toMatchObject({tema_carrossel: 'neutro', marca: {nome: 'Escritório Exemplo'}, foto: {src: 'foto.jpg', credito: 'Foto ilustrativa'}});
    expect(props.logo).toBeUndefined();
    const antigo = {...roteiro, tema: 'c2', marca: undefined, foto: undefined};
    const semNada = resolverRoteiro(antigo, palavras).props;
    expect(semNada).toMatchObject({tema_carrossel: 'neutro', marca: {nome: '', site: '', insta: ''}});
    expect(semNada.foto).toBeUndefined();
    const daMidia = resolverRoteiro(antigo, palavras, padroesDaMidia(['narracao.wav', 'logo-escritorio.png', 'b.jpg', 'a.webp', 'sfx'])).props;
    expect(daMidia).toMatchObject({logo: 'logo-escritorio.png', foto: {src: 'a.webp', credito: ''}});
    expect(resolverRoteiro({...roteiro, logo: 'marca.svg'}, palavras, {logo: 'logo-x.png'}).props.logo).toBe('marca.svg');
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
    expect(fim.em + (fim.ate - fim.de)).toBe((foto.duracao_ms as number) - FINAL_MS);
  });
});
