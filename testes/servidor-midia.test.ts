// Servidor de mídia (auditoria do processo principal, P2 e P3): arquivo trancado e busca abortada no <video> sem exceção
// solta nem descritor vazado; links simbólicos resolvidos antes de servir, com a exceção decidida (decisoes.md): um link
// em midia/ para fora do projeto serve mídia para leitura; o .git segue barrado em qualquer grafia.
import {chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {ServidorMidia} from '../src/main/servidor-midia';

const get = (url: string, abortar = false) => new Promise<{status: number; corpo: string}>((ok) => {
  const req = http.get(url, (res) => {
    if (abortar) return (res.destroy(), ok({status: res.statusCode!, corpo: ''}));
    let c = '';
    res.on('data', (d) => (c += d));
    res.on('end', () => ok({status: res.statusCode!, corpo: c}));
  });
  req.on('error', () => ok({status: -1, corpo: ''}));
  req.setTimeout(1500, () => (req.destroy(), ok({status: -2, corpo: ''})));
});
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const capturar = () => {
  const lista: string[] = [];
  const h = (e: unknown) => lista.push(String((e as Error)?.message ?? e));
  process.on('uncaughtException', h);
  process.on('unhandledRejection', h);
  return {lista, soltar: () => (process.off('uncaughtException', h), process.off('unhandledRejection', h))};
};
const root = process.getuid?.() === 0;
const posix = process.platform !== 'win32';

describe.skipIf(!posix)('servidor de mídia (P2, P3)', () => {
  let s: ServidorMidia;
  let raiz = '';
  let fora = '';
  beforeAll(async () => {
    raiz = mkdtempSync(path.join(os.tmpdir(), 'estudio-srv-midia-'));
    fora = mkdtempSync(path.join(os.tmpdir(), 'estudio-srv-fora-'));
    writeFileSync(path.join(fora, 'segredo.txt'), 'SEGREDO');
    writeFileSync(path.join(fora, 'foto.png'), 'FOTO-DE-FORA');
    mkdirSync(path.join(fora, '.git'));
    writeFileSync(path.join(fora, '.git', 'x.png'), 'GIT-DE-FORA');
    mkdirSync(path.join(raiz, 'midia', 'sub'), {recursive: true});
    mkdirSync(path.join(raiz, '.git'));
    writeFileSync(path.join(raiz, '.git', 'config'), 'x');
    symlinkSync(fora, path.join(raiz, 'midia', 'atalho'));
    symlinkSync(fora, path.join(raiz, 'atalho-na-raiz'));
    symlinkSync(path.join(raiz, '.git'), path.join(raiz, 'midia', 'git-disfarcado'));
    symlinkSync(path.join(raiz, 'midia', 'sub'), path.join(raiz, 'midia', 'atalho-dentro'));
    writeFileSync(path.join(raiz, 'midia', 'sub', 'ok.png'), 'PNG');
    writeFileSync(path.join(raiz, 'midia', 'trancado.mp4'), 'x');
    chmodSync(path.join(raiz, 'midia', 'trancado.mp4'), 0o000);
    writeFileSync(path.join(raiz, 'midia', 'grande.mp4'), Buffer.alloc(8 * 1024 * 1024));
    s = new ServidorMidia();
    await s.iniciar();
    s.servir(raiz);
  });
  afterAll(() => {
    s.parar();
    chmodSync(path.join(raiz, 'midia', 'trancado.mp4'), 0o644);
    rmSync(raiz, {recursive: true, force: true});
    rmSync(fora, {recursive: true, force: true});
  });

  it('P3: link de midia/ para fora do projeto serve mídia para leitura (decisão), mas não texto nem um .git', async () => {
    expect(await get(`${s.base}/midia/atalho/foto.png`)).toEqual({status: 200, corpo: 'FOTO-DE-FORA'});
    const texto = await get(`${s.base}/midia/atalho/segredo.txt`);
    expect(texto.corpo).not.toContain('SEGREDO');
    expect(texto.status).toBe(403);
    expect((await get(`${s.base}/midia/atalho/.git/x.png`)).status).toBe(403);
  });
  it('P3: link fora de midia/ para fora do projeto é recusado', async () => {
    const r = await get(`${s.base}/atalho-na-raiz/foto.png`);
    expect(r.corpo).not.toContain('FOTO-DE-FORA');
    expect(r.status).toBe(403);
  });
  it('P3: o .git é barrado em qualquer caixa e pelo link que leva a ele', async () => {
    expect((await get(`${s.base}/.git/config`)).status).toBe(403);
    expect((await get(`${s.base}/.GIT/config`)).status).toBe(403);
    expect((await get(`${s.base}/midia/git-disfarcado/config`)).status).toBe(403);
  });
  it('P3 (sem regressão): link que fica dentro do projeto continua servindo; pasta e inexistente dão 404', async () => {
    expect(await get(`${s.base}/midia/atalho-dentro/ok.png`)).toEqual({status: 200, corpo: 'PNG'});
    expect((await get(`${s.base}/midia/sub`)).status).toBe(404);
    expect((await get(`${s.base}/midia/nao-existe.png`)).status).toBe(404);
  });
  it.skipIf(root)('P2: arquivo sem leitura responde 403 e não solta exceção', async () => {
    const t = capturar();
    const r = await get(`${s.base}/midia/trancado.mp4`);
    await esperar(200);
    t.soltar();
    expect(t.lista).toEqual([]);
    expect(r.status).toBe(403);
  });
  it.skipIf(!existsProc())('P2: pedidos abortados (busca no <video>) não deixam descritores abertos', async () => {
    const fds = () => readdirSync('/proc/self/fd').length;
    const antes = fds();
    for (let i = 0; i < 20; i++) await get(`${s.base}/midia/grande.mp4`, true);
    await esperar(800);
    expect(fds() - antes).toBeLessThan(5);
  });
});

function existsProc() {
  try {
    readdirSync('/proc/self/fd');
    return true;
  } catch {
    return false;
  }
}
