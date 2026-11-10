// Rodada 3, frente C, carrossel narrado: a cena de dúvida não exige "ficou" e "procure" na narração (video-D6) e o bloco foto
// traz a própria foto e o próprio crédito (video-D7). O que já saía do roteiro de teste continua igual (testes/resolver.test.ts).
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {resolverRoteiro, type Palavra, type Roteiro} from '../src/nucleo/roteiro/resolver';

const REF = path.join(__dirname, 'fixtures', 'carrossel');
const FOTO = {src: 'foto.jpg', credito: 'Foto ilustrativa'}; // a foto padrão do roteiro de teste
const ler = <T>(arq: string): T => JSON.parse(readFileSync(path.join(REF, arq), 'utf-8')) as T;
const roteiro = () => ler<Roteiro>('roteiro.json');
const palavras = () => ler<Palavra[]>('palavras.json');

type Cena = {tipo: string; ev: Record<string, number>; blocos?: {tipo: string; src?: string; credito?: string}[]};
const duvida = (cenas: unknown) => (cenas as Cena[]).find((c) => c.tipo === 'duvida')!;

describe('cena de dúvida opcional (video-D6)', () => {
  it('com "ficou" e "procure" na narração, os tempos saem das palavras, como antes', () => {
    const {props, avisos} = resolverRoteiro(roteiro(), palavras());
    expect(duvida(props.cenas).ev).toEqual({duvida: expect.any(Number), advogado: expect.any(Number)});
    expect(avisos.filter((a) => a.includes('cena de dúvida'))).toEqual([]);
  });

  it('narração que fecha com "Tem dúvida? Fale com um advogado" monta o vídeo, com aviso e sem os tempos', () => {
    const sem = palavras().map((p) => (/^(ficou|procure)/i.test(p.w.trim()) ? {...p, w: p.w.replace(/ficou|procure/i, 'fale')} : p));
    const r = roteiro();
    r.cenas.find((c) => c.tipo === 'duvida')!.inicio = 'Fale@76400'; // o autor começa a cena por outra palavra
    const {props, avisos} = resolverRoteiro(r, sem);
    expect(duvida(props.cenas).ev).toEqual({}); // a composição usa o começo da cena e +1,5 s
    expect(avisos.filter((a) => a.includes('cena de dúvida')).map((a) => a.match(/"(\w+)"/)![1])).toEqual(['ficou', 'procure']);
    // o resto do vídeo não muda
    expect(props.duracao_ms).toBe(resolverRoteiro(roteiro(), palavras()).props.duracao_ms);
  });

  it('só uma das duas palavras faltando avisa só dela e guarda a outra', () => {
    const sem = palavras().map((p) => (/^procure/i.test(p.w.trim()) ? {...p, w: 'Fale'} : p));
    const {props, avisos} = resolverRoteiro(roteiro(), sem);
    expect(Object.keys(duvida(props.cenas).ev)).toEqual(['duvida']);
    expect(avisos.filter((a) => a.includes('cena de dúvida'))).toHaveLength(1);
  });
});

describe('foto do bloco (video-D7)', () => {
  const fotos = (cenas: unknown) => (cenas as Cena[]).flatMap((c) => c.blocos ?? []).filter((b) => b.tipo === 'foto');

  it('sem src no bloco, a foto e o crédito padrão do roteiro, como antes', () => {
    const {props} = resolverRoteiro(roteiro(), palavras());
    expect(props.foto).toEqual(FOTO);
    expect(fotos(props.cenas).every((b) => b.src === undefined)).toBe(true);
  });

  it('com src e credito no bloco, ele leva os seus e a foto padrão não vai nas props', () => {
    const r = roteiro();
    const b = r.cenas.flatMap((c) => (c.blocos ?? []) as Record<string, unknown>[]).find((x) => x.tipo === 'foto')!;
    Object.assign(b, {src: 'midia/cidade.jpg', credito: 'Foto: Prefeitura · CC0'});
    const {props} = resolverRoteiro(r, palavras());
    expect(fotos(props.cenas)[0]).toMatchObject({src: 'midia/cidade.jpg', credito: 'Foto: Prefeitura · CC0'});
    expect(props.foto).toBeUndefined();
  });

  it('um bloco com foto própria e outro sem: a padrão fica só para o que não trouxe', () => {
    const r = roteiro();
    const b = r.cenas.flatMap((c) => (c.blocos ?? []) as Record<string, unknown>[]).find((x) => x.tipo === 'foto')!;
    const copia = {...b};
    Object.assign(b, {src: 'midia/cidade.jpg'});
    (r.cenas[1].blocos as Record<string, unknown>[]).push(copia);
    const {props} = resolverRoteiro(r, palavras());
    expect(props.foto).toEqual(FOTO);
    expect(fotos(props.cenas).map((x) => x.src)).toEqual(['midia/cidade.jpg', undefined]);
  });
});
