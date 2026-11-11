// O commit automático do projeto aberto (decisão da reformulação): o diário e a trava de escrita ficam fora do git, também
// no projeto antigo que já versionava o diário (sai do índice e fica no disco); e o app publica e retira o endereço do
// MCP para a IDE (.estudio/mcp-app.json).
import {execFileSync} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {SessaoProjeto} from '../src/main/sessao-projeto';
import {ARQUIVO_MCP_APP, appAberto} from '../src/nucleo/mcp-app';

const pastas: string[] = [];
afterAll(() => pastas.forEach((p) => rmSync(p, {recursive: true, force: true})));

const git = (cwd: string, ...a: string[]) => execFileSync('git', a, {cwd, encoding: 'utf-8'});

describe('commit automático', () => {
  it('o diário já versionado sai do índice e fica no disco; o .gitignore ganha o diário e a trava', async () => {
    const pasta = mkdtempSync(path.join(tmpdir(), 'estudio-sessao-'));
    pastas.push(pasta);
    cpSync(path.join(__dirname, 'fixtures', 'projeto'), pasta, {recursive: true, filter: (f) => !f.endsWith('.mp4')});
    mkdirSync(path.join(pasta, '.estudio'), {recursive: true});
    writeFileSync(path.join(pasta, '.estudio', 'diario.jsonl'), '{"seq":1}\n');
    writeFileSync(path.join(pasta, '.gitignore'), 'saidas/\n');
    git(pasta, 'init', '-q');
    git(pasta, 'add', '-A');
    git(pasta, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'antigo');
    expect(git(pasta, 'ls-files', '.estudio/diario.jsonl').trim()).toBe('.estudio/diario.jsonl');

    const s = new SessaoProjeto(pasta, () => undefined);
    await s.abrir();
    s.publicarMcp({url: 'http://127.0.0.1:1/mcp', headers: {Authorization: 'Bearer tok123'}});
    expect(appAberto(pasta)).toMatchObject({token: 'tok123', pid: process.pid});
    expect(await s.marcarVersao()).toBe(true);
    await s.fechar();

    expect(git(pasta, 'ls-files', '.estudio/diario.jsonl').trim()).toBe('');
    expect(readFileSync(path.join(pasta, '.estudio', 'diario.jsonl'), 'utf-8')).toBe('{"seq":1}\n');
    expect(readFileSync(path.join(pasta, '.gitignore'), 'utf-8').split('\n')).toEqual(expect.arrayContaining(['.estudio/diario.jsonl', '.estudio/escrita.lock*']));
    expect(git(pasta, 'status', '--porcelain').trim()).toBe('');
    expect(existsSync(path.join(pasta, ARQUIVO_MCP_APP))).toBe(false); // fechado: a IDE volta a gravar direto
  });
});
