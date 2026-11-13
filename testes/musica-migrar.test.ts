// Esquema versionado da música (M-02): a cadeia de migradores leva qualquer documento ao formato atual, sem tocar no
// original, sem mudar nada na segunda vez e sem mudar o som (o PCM do documento migrado é o mesmo, amostra por amostra).
import {createHash} from 'node:crypto';
import jsonpatch from 'fast-json-patch';
import {describe, expect, it} from 'vitest';
import {FORMATO_MUSICA, novaMusica, type DocMusica} from '../src/nucleo/musica';
import {FORMATO_ATUAL, MIGRADORES, formatoDe, migrarMusica, patchDaMigracao, type Migrador} from '../src/nucleo/musica-migrar';
import {musicaDoModelo} from '../src/nucleo/musica-modelos';
import {renderizarMusica} from '../src/nucleo/musica-som';

/** Uma música pequena que passa por bateria, sintetizador, mixer, retornos, limitador, sidechain e automação. */
const musicaCheia = (): DocMusica => {
  const d = novaMusica({bpm: 128});
  d.swing = 0.3;
  d.canais.push({id: 'bat', nome: 'Bateria', tipo: 'bateria', kit: 'eletronico', pecas: {caixa: {volume_db: -3, afinacao: 2}}});
  d.canais.push({id: 'sin', nome: 'Baixo', tipo: 'sintetizador', preset: 'baixo', macros: {brilho: 0.7}});
  d.padroes.push({id: 'p1', canal: 'bat', dur: 4, notas: [{peca: 'bumbo', em: 0}, {peca: 'caixa', em: 1}, {peca: 'chimbal_fechado', em: 0.5}, {peca: 'bumbo', em: 2}]});
  d.padroes.push({id: 'p2', canal: 'sin', dur: 4, notas: [{nota: 36, em: 0, dur: 1}, {nota: 43, em: 2, dur: 1}]});
  d.arranjo.clipes.push({id: 'c1', canal: 'bat', em: 0, dur: 8, padrao: 'p1'}, {id: 'c2', canal: 'sin', em: 0, dur: 8, padrao: 'p2'});
  d.mixer.faixas.push({id: 'bat', volume_db: -2, eq: {graves_db: 3}, compressor: {ativo: true, limiar_db: -20, razao: 4}, reverb: 0.2, delay: 0.1});
  d.mixer.faixas.push({id: 'sin', volume_db: -4, pan: -0.3, sidechain: {de: 'bat', quanto_db: 8}});
  d.automacoes = [{alvo: 'sin', pontos: [{em: 0, db: -12}, {em: 4, db: -4}]}];
  return d;
};

const hashPcm = (doc: DocMusica) => {
  const r = renderizarMusica(doc, {});
  const h = createHash('sha256');
  for (const c of r.canais) h.update(Buffer.from(c.buffer, c.byteOffset, c.byteLength));
  return h.digest('hex');
};

const semFormato = (d: DocMusica) => {
  const {formato: _f, ...resto} = d;
  return resto;
};

describe('cadeia de migradores', () => {
  it('é contínua do formato 0 ao atual e o atual é o que o app escreve', () => {
    expect(FORMATO_ATUAL).toBe(FORMATO_MUSICA);
    expect(novaMusica().formato).toBe(FORMATO_ATUAL);
    let f = 0;
    for (const m of [...MIGRADORES].sort((a, b) => a.de - b.de)) {
      expect(m.de).toBe(f);
      expect(m.para).toBeGreaterThan(m.de);
      f = m.para;
    }
    expect(f).toBe(FORMATO_ATUAL);
  });

  it('formatoDe: sem campo ou com valor estranho é 0', () => {
    expect(formatoDe({})).toBe(0);
    expect(formatoDe({formato: '1'})).toBe(0);
    expect(formatoDe({formato: 1.5})).toBe(0);
    expect(formatoDe({formato: -1})).toBe(0);
    expect(formatoDe(null)).toBe(0);
    expect(formatoDe({formato: 1})).toBe(1);
    expect(formatoDe({formato: 7})).toBe(7);
  });

  it('cada migrador é idempotente: aplicado ao que já está no formato de chegada, não muda nada', () => {
    for (const m of MIGRADORES) {
      const base = {...semFormato(musicaCheia()), formato: m.de};
      const uma = m.migrar(structuredClone(base));
      const duas = m.migrar(structuredClone(uma));
      expect(duas).toEqual(uma);
      expect(formatoDe(uma)).toBe(m.para);
    }
  });
});

describe('migrarMusica', () => {
  it('documento do formato atual volta o mesmo objeto, sem patch', () => {
    const d = musicaCheia();
    const r = migrarMusica(d);
    expect(r.doc).toBe(d);
    expect(r).toMatchObject({de: FORMATO_ATUAL, para: FORMATO_ATUAL, mudou: false, futuro: false, aplicados: []});
    expect(patchDaMigracao(d)).toEqual([]);
  });

  it('documento sem formato sobe ao atual sem tocar no original, e migrar de novo não muda mais nada', () => {
    const antigo = semFormato(musicaCheia());
    const copia = structuredClone(antigo);
    const r = migrarMusica(antigo);
    expect(antigo).toEqual(copia); // puro
    expect(r.mudou).toBe(true);
    expect(r.de).toBe(0);
    expect(r.para).toBe(FORMATO_ATUAL);
    expect(r.aplicados.length).toBeGreaterThan(0);
    expect(r.doc.formato).toBe(FORMATO_ATUAL);
    const de_novo = migrarMusica(r.doc);
    expect(de_novo.mudou).toBe(false);
    expect(de_novo.doc).toBe(r.doc);
  });

  it('o patch da migração, aplicado, dá o documento migrado (e passa pelo aplicar_patch com diário)', () => {
    const antigo = semFormato(musicaCheia());
    const patch = patchDaMigracao(antigo);
    expect(patch).toEqual([{op: 'add', path: '/formato', value: FORMATO_ATUAL}]);
    const aplicado = jsonpatch.applyPatch(structuredClone(antigo), patch, true, false).newDocument;
    expect(aplicado).toEqual(migrarMusica(antigo).doc);
  });

  it('formato com valor estranho é lido como 0, com aviso', () => {
    const r = migrarMusica({...semFormato(musicaCheia()), formato: '1'});
    expect(r.de).toBe(0);
    expect(r.doc.formato).toBe(FORMATO_ATUAL);
    expect(r.avisos.join(' ')).toMatch(/não é um número inteiro/);
  });

  it('formato mais novo que o do app fica como está, com aviso', () => {
    const futuro = {...musicaCheia(), formato: FORMATO_ATUAL + 5};
    const r = migrarMusica(futuro);
    expect(r.doc).toBe(futuro);
    expect(r).toMatchObject({futuro: true, mudou: false, de: FORMATO_ATUAL + 5});
    expect(r.avisos.join(' ')).toMatch(/mais novo/);
    expect(patchDaMigracao(futuro)).toEqual([]);
  });

  it('encadeia vários migradores em ordem e recusa cadeia com buraco', () => {
    const cadeia: Migrador[] = [
      {de: 0, para: 1, descricao: 'a', migrar: (d) => ({...d, formato: 1})},
      {de: 1, para: 2, descricao: 'b', migrar: (d) => ({...d, formato: 2, b: true})},
      {de: 2, para: 3, descricao: 'c', migrar: (d) => ({...d, formato: 3, c: (d as {b?: boolean}).b === true})},
    ];
    const r = migrarMusica({tipo: 'musica'}, cadeia, 3);
    expect(r.aplicados).toEqual(['a', 'b', 'c']);
    expect(r.doc).toEqual({tipo: 'musica', formato: 3, b: true, c: true});
    expect(migrarMusica({tipo: 'musica', formato: 2, b: true}, cadeia, 3).aplicados).toEqual(['c']);
    expect(() => migrarMusica({formato: 1}, [cadeia[0], cadeia[2]], 3)).toThrow(/falta o migrador do formato 1/);
  });
});

describe('migrar não muda o som (A4)', () => {
  const casos: [string, () => DocMusica][] = [
    ['música cheia', musicaCheia],
    ['modelo Batida', () => musicaDoModelo('batida', undefined, {compassos: 2})],
    ['modelo Trilha para vídeo', () => musicaDoModelo('trilha_video', undefined, {compassos: 2})],
    ['modelo Efeito sonoro', () => musicaDoModelo('efeito_sonoro')],
  ];
  for (const [nome, fazer] of casos) {
    it(`${nome}: o PCM do documento antigo migrado é o mesmo`, () => {
      const atual = fazer();
      const antigo = semFormato(fazer()) as unknown as DocMusica;
      const migrado = migrarMusica(antigo).doc as unknown as DocMusica;
      const h = hashPcm(atual);
      expect(hashPcm(antigo)).toBe(h);
      expect(hashPcm(migrado)).toBe(h);
    });
  }
});
