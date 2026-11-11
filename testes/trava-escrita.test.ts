// A trava de escrita entre processos (auditoria do núcleo, N1): o app e o MCP por stdio da IDE gravando no mesmo projeto
// ao mesmo tempo não perdem mudança nem repetem número no diário; trava de dono morto ou velha sai, trava de dono vivo
// faz esperar e dá "conflito" no prazo; é reentrante e não sobra no disco.
import {spawn, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync} from 'node:fs';
import os, {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {GITIGNORE, gitignoreComRegrasInternas} from '../src/nucleo/criar-projeto';
import {ErroProjeto, Projeto, serializar} from '../src/nucleo/projeto';
import {comTrava} from '../src/nucleo/trava-escrita';

const RAIZ = path.join(__dirname, '..');
const pastas: string[] = [];
afterAll(() => pastas.forEach((p) => rmSync(p, {recursive: true, force: true})));

const projetoMinimo = () => {
  const pasta = mkdtempSync(path.join(tmpdir(), 'estudio-trava-'));
  pastas.push(pasta);
  writeFileSync(path.join(pasta, 'estudio.json'), serializar({formato: 1, nome: 't', documentos: [{id: 'd', modulo: '3d', caminho: 'd.json', titulo: 'D'}]}));
  writeFileSync(path.join(pasta, 'd.json'), serializar({itens: [], cor: 'a'}));
  mkdirSync(path.join(pasta, '.estudio'), {recursive: true});
  return {pasta, p: new Projeto(pasta), lock: path.join(pasta, '.estudio', 'escrita.lock')};
};

const escritor = (pasta: string, n: number, modo: string, nome: string) =>
  new Promise<{ok: number; conflitos: number; outros: number}>((res, rej) => {
    const c = spawn(path.join(RAIZ, 'node_modules', '.bin', 'tsx'), [path.join(__dirname, 'fixtures', 'corrida-escrita.ts'), pasta, String(n), modo, nome],
      {stdio: ['ignore', 'pipe', 'inherit']});
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.on('exit', (code) => (code === 0 ? res(JSON.parse(out)) : rej(new Error(`saiu ${code}`))));
  });

const corrida = async (modo: 'livre' | 'versao') => {
  const {pasta, p} = projetoMinimo();
  const [a, b] = await Promise.all([escritor(pasta, 300, modo, 'app'), escritor(pasta, 300, modo, 'mcp')]);
  const itens = (JSON.parse(readFileSync(path.join(pasta, 'd.json'), 'utf-8')) as {itens: string[]}).itens.length;
  const seqs = p.diario(0, {tolerante: true}).map((e) => e.seq);
  return {ok: a.ok + b.ok, outros: a.outros + b.outros, itens, entradas: seqs.length, repetidos: seqs.length - new Set(seqs).size, pasta};
};

const trava = (lock: string, pid: number, host = os.hostname()) => writeFileSync(lock, `${pid}\n${host}\n${new Date().toISOString()}\nxyz\n`);
const pidMorto = () => spawnSync(process.execPath, ['-e', '']).pid!;
const ocupada = () => new ErroProjeto('ocupada', 'conflito');

describe('N1 dois processos gravando o mesmo projeto', () => {
  it('sem versao_base: nenhuma mudança some e nenhum seq se repete', async () => {
    const r = await corrida('livre');
    expect(r.outros).toBe(0);
    expect(r.ok).toBe(600);
    expect(r.itens).toBe(r.ok);
    expect(r.entradas).toBe(r.ok);
    expect(r.repetidos).toBe(0);
    expect(existsSync(path.join(r.pasta, '.estudio', 'escrita.lock'))).toBe(false);
  }, 120_000);

  it('com versao_base (o caminho do MCP): o que gravou está no arquivo; o resto é conflito legítimo', async () => {
    const r = await corrida('versao');
    expect(r.outros).toBe(0);
    expect(r.itens).toBe(r.ok);
    expect(r.repetidos).toBe(0);
  }, 120_000);
});

describe('trava de escrita', () => {
  it('trava de um processo morto sai na hora', () => {
    const {p, lock} = projetoMinimo();
    trava(lock, pidMorto());
    const ini = Date.now();
    p.aplicarPatch({documento: 'd', patch: [{op: 'replace', path: '/cor', value: 'b'}], autor: 'pessoa', origem: 'interface'});
    expect(Date.now() - ini).toBeLessThan(1000);
    expect(existsSync(lock)).toBe(false);
  });

  it('trava de dono vivo e recente faz esperar e dá conflito no prazo, sem gravar', () => {
    const {p, lock} = projetoMinimo();
    trava(lock, process.ppid);
    const ini = Date.now();
    let erro: unknown;
    try {
      comTrava(lock, () => p.gravarTexto('d.json', '{}'), {prazoMs: 300, ocupada});
    } catch (e) {
      erro = e;
    }
    expect((erro as ErroProjeto).codigo).toBe('conflito');
    expect(Date.now() - ini).toBeGreaterThanOrEqual(300);
    expect(Date.now() - ini).toBeLessThan(2000);
    expect(p.lerJson<{cor: string}>('d.json').doc.cor).toBe('a');
    expect(existsSync(lock)).toBe(true); // a trava é do outro: fica
  });

  it('trava de dono vivo com mais de 10 s é levada', () => {
    const {p, lock} = projetoMinimo();
    trava(lock, process.ppid);
    const antes = new Date(Date.now() - 20_000);
    utimesSync(lock, antes, antes);
    p.aplicarPatch({documento: 'd', patch: [{op: 'replace', path: '/cor', value: 'b'}], autor: 'pessoa', origem: 'interface'});
    expect(p.lerJson<{cor: string}>('d.json').doc.cor).toBe('b');
    expect(existsSync(lock)).toBe(false);
  });

  it('é reentrante (comTrava → aplicarPatch, reverter → aplicar) e não sobra depois de uma exceção', () => {
    const {pasta, p, lock} = projetoMinimo();
    const r = p.comTrava(() => {
      expect(existsSync(lock)).toBe(true);
      const a = p.aplicarPatch({documento: 'd', patch: [{op: 'replace', path: '/cor', value: 'b'}], autor: 'pessoa', origem: 'interface'});
      return p.reverter(a.entrada.seq, {autor: 'pessoa', origem: 'reverter'});
    });
    expect(r.ok).toBe(true);
    expect(existsSync(lock)).toBe(false);
    expect(() => p.comTrava(() => {
      throw new Error('falhou no meio');
    })).toThrow(/falhou no meio/);
    expect(existsSync(lock)).toBe(false);
    expect(readdirSync(path.join(pasta, '.estudio')).filter((f) => f.startsWith('escrita.lock'))).toEqual([]);
  });

  it('a trava e o diário ficam fora do git, também nos projetos antigos', () => {
    expect(GITIGNORE.split('\n')).toEqual(expect.arrayContaining(['.estudio/diario.jsonl', '.estudio/escrita.lock*']));
    expect(gitignoreComRegrasInternas('saidas/')).toBe('saidas/\n.estudio/mcp*\n.estudio/diario.jsonl\n.estudio/escrita.lock*\n');
    expect(gitignoreComRegrasInternas(GITIGNORE)).toBe(GITIGNORE);
  });
});
