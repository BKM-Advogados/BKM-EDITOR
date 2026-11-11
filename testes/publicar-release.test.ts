// scripts/publicar-release.mjs e scripts/conferir-latest-yml.mjs (docs/atualizacao.md), pela linha de comando, com os
// artifacts do CI de mentira numa pasta temporária. Só o --seco: nada fala com o GitHub.
import {spawnSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {lerSomas, nomeDoArquivo} from '../src/nucleo/atualizacao';

const raiz = path.resolve(__dirname, '..');
const rodar = (script: string, args: string[]) => {
  const r = spawnSync(process.execPath, [path.join(raiz, 'scripts', script), ...args], {cwd: raiz, encoding: 'utf-8'});
  return {codigo: r.status, saida: `${r.stdout}${r.stderr}`};
};
const sha = (alg: 'sha256' | 'sha512', b: Buffer, enc: 'hex' | 'base64') => createHash(alg).update(b).digest(enc);

let tmp: string;
let artifacts: string;
let saida: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-release-'));
  artifacts = path.join(tmp, 'artifacts');
  saida = path.join(tmp, 'release');
});
afterEach(() => rmSync(tmp, {recursive: true, force: true}));

const gravar = (relativo: string, conteudo: Buffer | string) => {
  const p = path.join(artifacts, ...relativo.split('/'));
  mkdirSync(path.dirname(p), {recursive: true});
  writeFileSync(p, conteudo);
};
/** O latest.yml como o electron-builder 26 grava ao lado do Setup .exe (formato conferido gerando o NSIS de verdade). */
const latest = (v: string, exe: Buffer, extra = '') => `version: ${v}
files:
  - url: Estudio-Setup-${v}.exe
    sha512: ${sha('sha512', exe, 'base64')}
    size: ${exe.length}
path: Estudio-Setup-${v}.exe
sha512: ${sha('sha512', exe, 'base64')}
releaseDate: '2026-11-12T10:00:00.000Z'
${extra}`;

/** Os artifacts das quatro linhas do CI e o do Claude Desktop, com as pastas que o upload-artifact cria. */
const ci = (v: string, o: {semDmgX64?: boolean; semLatest?: boolean; latestExtra?: string} = {}) => {
  const exe = randomBytes(4096);
  gravar(`estudio-win-x64/instalador/Estudio-Setup-${v}.exe`, exe);
  gravar(`estudio-win-x64/instalador/Estudio-Setup-${v}.exe.blockmap`, randomBytes(64));
  if (!o.semLatest) gravar('estudio-win-x64/instalador/latest.yml', latest(v, exe, o.latestExtra));
  gravar(`estudio-win-x64/pacote/make/zip/win32/x64/Estudio-win32-x64-${v}.zip`, 'portátil do Windows');
  gravar(`estudio-linux-x64/pacote/make/zip/linux/x64/Estudio-linux-x64-${v}.zip`, 'zip do Linux');
  gravar(`estudio-mac-arm64/instalador/Estudio-${v}-arm64.dmg`, 'dmg arm64');
  gravar(`estudio-mac-arm64/pacote/make/zip/darwin/arm64/Estudio-darwin-arm64-${v}.zip`, 'portátil do Mac');
  if (!o.semDmgX64) gravar(`estudio-mac-x64/instalador/Estudio-${v}-x64.dmg`, 'dmg x64');
  gravar(`estudio-claude-desktop/Estudio-${v}.mcpb`, 'extensão');
  return exe;
};

describe('publicar-release --seco', () => {
  it('junta os arquivos com os nomes que o app procura e gera o SHA256SUMS.txt', () => {
    ci('2.0.1');
    const r = rodar('publicar-release.mjs', ['--pasta', artifacts, '--tag', 'v4.0.1', '--seco', '--saida', saida]);
    expect(r.codigo, r.saida).toBe(0);
    const nomes = readdirSync(saida).sort();
    expect(nomes).toEqual(['Estudio-2.0.1-arm64.dmg', 'Estudio-2.0.1-x64.dmg', 'Estudio-2.0.1.mcpb', 'Estudio-Setup-2.0.1.exe',
      'Estudio-Setup-2.0.1.exe.blockmap', 'Estudio-linux-x64-2.0.1.zip', 'SHA256SUMS.txt', 'latest.yml'].sort());
    for (const [p, a] of [['win32', 'x64'], ['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'x64']]) expect(nomes).toContain(nomeDoArquivo(p, a, '2.0.1'));
    // o SHA256SUMS.txt cobre todos os outros, e o app (lerSomas) lê cada um
    const somas = lerSomas(readFileSync(path.join(saida, 'SHA256SUMS.txt'), 'utf-8'));
    expect([...somas.keys()].sort()).toEqual(nomes.filter((n) => n !== 'SHA256SUMS.txt').sort());
    for (const [n, h] of somas) expect(h, n).toBe(sha('sha256', readFileSync(path.join(saida, n)), 'hex'));
    expect(r.saida).toContain('release v4.0.1: "Estúdio V4 (2.0.1)", versão do pacote 2.0.1');
    expect(r.saida).toContain('fora da release: Estudio-darwin-arm64-2.0.1.zip, Estudio-win32-x64-2.0.1.zip');
    expect(r.saida).toMatch(/gh release create v4\.0\.1 .* --repo BKM-Advogados\/BKM-EDITOR --title 'Estúdio V4 \(2\.0\.1\)' --notes-file .* --verify-tag/);
    expect(r.saida).not.toContain('--prerelease');
    expect(r.saida).toContain('--seco: nada foi publicado.');
  });

  it('tag ou versão com hífen sai como pre-release; o título pode ser outro', () => {
    ci('2.0.2-teste.1');
    const r = rodar('publicar-release.mjs', ['--pasta', artifacts, '--tag', 'v4.0.2-teste.1', '--seco', '--saida', saida, '--titulo', 'Teste da atualização']);
    expect(r.codigo, r.saida).toBe(0);
    expect(r.saida).toContain('(pre-release)');
    expect(r.saida).toMatch(/--title 'Teste da atualização' .*--prerelease/);
  });

  it('latest.yml que não confere com o instalador recusa', () => {
    const exe = ci('2.0.1');
    gravar('estudio-win-x64/instalador/latest.yml', latest('2.0.1', Buffer.concat([exe, Buffer.from('x')])));
    const r = rodar('publicar-release.mjs', ['--pasta', artifacts, '--tag', 'v4.0.1', '--seco', '--saida', saida]);
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain('o sha512 do latest.yml não é o do Estudio-Setup-2.0.1.exe');
  });

  it('falta de arquivo recusa; --parcial aceita, mas não o Windows sem latest.yml', () => {
    ci('2.0.1', {semDmgX64: true});
    const sem = rodar('publicar-release.mjs', ['--pasta', artifacts, '--tag', 'v4.0.1', '--seco', '--saida', saida]);
    expect(sem.codigo).toBe(1);
    expect(sem.saida).toContain('faltam Estudio-2.0.1-x64.dmg');
    const parcial = rodar('publicar-release.mjs', ['--pasta', artifacts, '--tag', 'v4.0.1', '--seco', '--saida', saida, '--parcial']);
    expect(parcial.codigo, parcial.saida).toBe(0);
    expect(parcial.saida).toContain('faltando (--parcial): Estudio-2.0.1-x64.dmg');

    rmSync(artifacts, {recursive: true, force: true});
    ci('2.0.1', {semLatest: true});
    const win = rodar('publicar-release.mjs', ['--pasta', artifacts, '--tag', 'v4.0.1', '--seco', '--saida', saida, '--parcial']);
    expect(win.codigo).toBe(1);
    expect(win.saida).toContain('o instalador do Windows veio sem latest.yml');
  });

  it('artifacts de versões diferentes, tag errada, origem e notas que faltam', () => {
    ci('2.0.1');
    gravar('estudio-mac-x64/instalador/Estudio-2.0.0-x64.dmg', 'velho');
    expect(rodar('publicar-release.mjs', ['--pasta', artifacts, '--tag', 'v4.0.1', '--seco', '--saida', saida]).saida).toContain('misturam versões');
    expect(rodar('publicar-release.mjs', ['--pasta', artifacts, '--tag', '4.0.1', '--seco']).saida).toContain('--tag v<maior>');
    expect(rodar('publicar-release.mjs', ['--tag', 'v4.0.1', '--seco']).saida).toContain('--execucao <id> ou --pasta');
    // sem --seco, as notas são obrigatórias, e a conferência para antes de qualquer chamada ao gh
    const r = rodar('publicar-release.mjs', ['--pasta', artifacts, '--tag', 'v4.0.1', '--saida', saida]);
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain('--notas <arquivo.md>');
  });
});

describe('conferir-latest-yml', () => {
  const pasta = () => path.join(artifacts, 'estudio-win-x64', 'instalador');

  it('confere versão, nome, sha512 e .blockmap', () => {
    ci('2.0.1');
    const r = rodar('conferir-latest-yml.mjs', [pasta(), '2.0.1']);
    expect(r.codigo, r.saida).toBe(0);
    expect(r.saida).toContain('latest.yml confere: Estudio-Setup-2.0.1.exe, Estudio-Setup-2.0.1.exe.blockmap, latest.yml (versão 2.0.1)');
    expect(rodar('conferir-latest-yml.mjs', [pasta(), '2.0.2']).saida).toContain('o latest.yml diz versão 2.0.1, e o instalador é da 2.0.2');
    rmSync(path.join(pasta(), 'Estudio-Setup-2.0.1.exe.blockmap'));
    expect(rodar('conferir-latest-yml.mjs', [pasta()]).saida).toContain('falta o Estudio-Setup-2.0.1.exe.blockmap');
  });

  it('recusa o latest.yml que pede administrador e a pasta sem latest.yml', () => {
    ci('2.0.1', {latestExtra: 'isAdminRightsRequired: true\n'});
    expect(rodar('conferir-latest-yml.mjs', [pasta()]).saida).toContain('pede administrador');
    expect(rodar('conferir-latest-yml.mjs', [tmp]).saida).toContain('falta o latest.yml');
  });
});
