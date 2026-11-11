// Sessão do projeto (auditoria do processo principal, P4, P7, P11 e P12): fechar no meio do abrir não deixa observador
// vivo; o Ctrl+S diz a verdade sobre o commit e espera o commit automático em andamento (um git por vez); fechar espera
// o commit que já rodava; pasta só de leitura abre sem pontos de restauração em vez de ficar meio aberta.
import {execFileSync} from 'node:child_process';
import {chmodSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {SessaoProjeto} from '../src/main/sessao-projeto';

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pastas: string[] = [];
afterAll(() => {
  for (const p of pastas) rmSync(p, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
});
const projeto = () => {
  const raiz = mkdtempSync(path.join(os.tmpdir(), 'estudio-sessao-'));
  pastas.push(raiz);
  writeFileSync(path.join(raiz, 'estudio.json'), '{"nome":"x","documentos":[]}');
  return raiz;
};
const status = (raiz: string) => execFileSync('git', ['status', '--porcelain'], {cwd: raiz}).toString().trim();
const root = process.getuid?.() === 0;

describe('sessão do projeto (P4, P7, P11, P12)', () => {
  it('P4: fechar() durante abrir() não deixa observador vivo', async () => {
    const raiz = projeto();
    const avisos: string[] = [];
    const s = new SessaoProjeto(raiz, (a) => avisos.push(a));
    const abrindo = s.abrir();
    await s.fechar();
    await abrindo.catch(() => undefined);
    await esperar(400);
    writeFileSync(path.join(raiz, 'depois.json'), '{}');
    await esperar(1200);
    expect(avisos).toEqual([]);
  });

  it('P7: marcarVersao() devolve false quando o commit falha (index.lock)', async () => {
    const raiz = projeto();
    const s = new SessaoProjeto(raiz, () => undefined);
    await s.abrir();
    writeFileSync(path.join(raiz, 'mudou.json'), '{}');
    writeFileSync(path.join(raiz, '.git', 'index.lock'), '');
    expect(await s.marcarVersao()).toBe(false);
    rmSync(path.join(raiz, '.git', 'index.lock'));
    await s.fechar();
  });

  it('P7: Ctrl+S no meio do commit automático espera a vez e commita (sem "não conseguiu" pelo index.lock)', async () => {
    const resultados: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      const raiz = projeto();
      for (let k = 0; k < 300; k++) writeFileSync(path.join(raiz, `f${k}.json`), `{"k":${k}}`);
      const s = new SessaoProjeto(raiz, () => undefined);
      await s.abrir();
      writeFileSync(path.join(raiz, 'a.json'), '{}');
      const auto = s.salvarVersao();
      await esperar(5);
      writeFileSync(path.join(raiz, 'b.json'), '{}');
      resultados.push(await s.marcarVersao());
      await auto;
      expect(status(raiz)).toBe('');
      await s.fechar();
    }
    expect(resultados).toEqual([true, true, true]);
  });

  it('P11: fechar() espera o commit que estava rodando', async () => {
    const raiz = projeto();
    for (let k = 0; k < 300; k++) writeFileSync(path.join(raiz, `f${k}.json`), `{"k":${k}}`);
    const s = new SessaoProjeto(raiz, () => undefined);
    await s.abrir();
    writeFileSync(path.join(raiz, 'ultima.json'), '{}');
    void s.salvarVersao(); // o relógio de 8 s disparou um instante antes de fechar
    await s.fechar();
    expect(status(raiz)).toBe('');
  });

  it.skipIf(root || process.platform === 'win32')('P12: pasta só de leitura abre sem git, sem rejeitar', async () => {
    const raiz = projeto();
    chmodSync(raiz, 0o555);
    const s = new SessaoProjeto(raiz, () => undefined);
    try {
      await expect(s.abrir()).resolves.toBeUndefined();
      expect(s.temGit).toBe(false);
    } finally {
      await s.fechar();
      chmodSync(raiz, 0o755);
    }
  });
});
