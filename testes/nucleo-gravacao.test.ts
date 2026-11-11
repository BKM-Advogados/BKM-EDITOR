// Gravações transacionais dentro da trava (auditoria do núcleo, fase F3): N6 (o diário falha depois do documento
// gravado: o documento volta) e N8 (o manifesto falha depois do arquivo do documento novo: o arquivo sai, e um órfão
// antigo no disco não bloqueia criar documento daquele módulo).
import {existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {documentoNovo} from '../src/nucleo/criar-projeto';
import {comNovaTentativa} from '../src/nucleo/gravar-seguro';
import {Projeto, serializar} from '../src/nucleo/projeto';

const pastas: string[] = [];
afterAll(() => pastas.forEach((p) => rmSync(p, {recursive: true, force: true})));

const projetoMinimo = () => {
  const pasta = mkdtempSync(path.join(tmpdir(), 'estudio-gravacao-'));
  pastas.push(pasta);
  writeFileSync(path.join(pasta, 'estudio.json'), serializar({formato: 1, nome: 't', documentos: [{id: 'd', modulo: '3d', caminho: 'd.json', titulo: 'D'}]}));
  writeFileSync(path.join(pasta, 'd.json'), serializar({itens: [], cor: 'a'}));
  mkdirSync(path.join(pasta, '.estudio'), {recursive: true});
  return {pasta, p: new Projeto(pasta)};
};

describe('N6 o diário não grava depois do documento', () => {
  it('aplicarPatch lança e o documento volta ao que era (sem entrada no diário, sem desfazer perdido)', () => {
    const {pasta, p} = projetoMinimo();
    p.aplicarPatch({documento: 'd', patch: [{op: 'replace', path: '/cor', value: 'b'}], autor: 'pessoa', origem: 'interface'});
    const original = p.registrar.bind(p);
    p.registrar = () => {
      throw Object.assign(new Error('ENOSPC: sem espaço no disco'), {code: 'ENOSPC'});
    };
    expect(() => p.aplicarPatch({documento: 'd', patch: [{op: 'replace', path: '/cor', value: 'mudou'}], autor: 'pessoa', origem: 'interface'})).toThrow(/ENOSPC/);
    expect(p.lerJson<{cor: string}>('d.json').doc.cor).toBe('b');
    p.registrar = original;
    expect(p.diario().map((e) => e.seq)).toEqual([1]);
    expect(readdirSync(pasta).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('o diário que nem abre (no lugar dele há uma pasta) não deixa o documento mudado', () => {
    const {pasta, p} = projetoMinimo();
    mkdirSync(path.join(pasta, '.estudio', 'diario.jsonl'));
    expect(() => p.aplicarPatch({documento: 'd', patch: [{op: 'replace', path: '/cor', value: 'mudou'}], autor: 'pessoa', origem: 'interface'})).toThrow();
    expect(p.lerJson<{cor: string}>('d.json').doc.cor).toBe('a');
  });

  it('a pesquisa que ainda não existia não fica gravada sem o diário', () => {
    const {p} = projetoMinimo();
    p.registrar = () => {
      throw new Error('EACCES');
    };
    expect(() => p.alterarPesquisa((x) => void x.fontes.push({id: 'f1'} as never), {autor: 'agente', origem: 'A', rotulo: 'fonte'})).toThrow(/EACCES/);
    expect(p.existe('pesquisa/pesquisa.json')).toBe(false);
  });

  it('o append preso uma vez (EBUSY do OneDrive) grava na segunda', () => {
    let tentativas = 0;
    const esperas: number[] = [];
    const r = comNovaTentativa(() => {
      if (tentativas++ === 0) throw Object.assign(new Error('EBUSY'), {code: 'EBUSY'});
      return 'aberto';
    }, (ms) => esperas.push(ms));
    expect(r).toBe('aberto');
    expect(tentativas).toBe(2);
    expect(esperas).toEqual([20]);
    expect(() => comNovaTentativa(() => {
      throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'});
    }, () => undefined)).toThrow(/ENOENT/); // erro que não passa sozinho não espera
  });
});

describe('N8 documento órfão', () => {
  it('o manifesto preso apaga o arquivo do documento novo, e a nova tentativa usa o mesmo nome', () => {
    const {pasta, p} = projetoMinimo();
    const gravar = p.gravarTexto.bind(p);
    let falhar = true;
    p.gravarTexto = (rel: string, texto: string) => {
      if (rel === 'estudio.json' && falhar) throw new Error('o arquivo está em uso por outro programa (OneDrive ou antivírus?)');
      gravar(rel, texto);
    };
    const n1 = documentoNovo(p.manifesto(), 'video', {existe: (rel) => p.existe(rel)});
    expect(() => p.adicionarDocumento(n1.entrada, n1.conteudo)).toThrow(/em uso/);
    expect(existsSync(path.join(pasta, n1.entrada.caminho))).toBe(false);
    falhar = false;
    const n2 = documentoNovo(p.manifesto(), 'video', {existe: (rel) => p.existe(rel)});
    expect(p.adicionarDocumento(n2.entrada, n2.conteudo).caminho).toBe('video/video.json');
    expect(p.manifesto().documentos.map((d) => d.id)).toEqual(['d', 'video']);
  });

  it('um órfão antigo no disco faz o documento novo sair com o próximo nome', () => {
    const {pasta, p} = projetoMinimo();
    mkdirSync(path.join(pasta, 'video'));
    writeFileSync(path.join(pasta, 'video', 'video.json'), '{}');
    const n = documentoNovo(p.manifesto(), 'video', {existe: (rel) => p.existe(rel)});
    expect(n.entrada.caminho).toBe('video/video-2.json');
    expect(p.adicionarDocumento(n.entrada, n.conteudo).id).toBe('video-2');
  });
});
