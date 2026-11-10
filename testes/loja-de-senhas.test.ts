// Linux: o chaveiro do safeStorage e o que o app diz à pessoa quando a chave só vale na sessão.
import {mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {CofreArquivo} from '../src/main/ia/cofre-arquivo';
import {lojaDeSenhasLinux, textoDoCofre} from '../src/main/loja-de-senhas';

describe('chaveiro do Linux', () => {
  it('Hyprland, Sway e afins: força o Secret Service, que o Chromium não escolhe sozinho', () => {
    expect(lojaDeSenhasLinux({XDG_CURRENT_DESKTOP: 'Hyprland'}, ['electron', '.'])).toBe('gnome-libsecret');
    expect(lojaDeSenhasLinux({XDG_CURRENT_DESKTOP: 'sway'}, [])).toBe('gnome-libsecret');
    expect(lojaDeSenhasLinux({}, [])).toBe('gnome-libsecret');
  });
  it('KDE fica com o que o Chromium escolhe (KWallet); quem passou --password-store manda', () => {
    expect(lojaDeSenhasLinux({XDG_CURRENT_DESKTOP: 'KDE'}, [])).toBeUndefined();
    expect(lojaDeSenhasLinux({XDG_CURRENT_DESKTOP: 'Hyprland'}, ['--password-store=basic'])).toBeUndefined();
  });
  it('o texto diz a verdade: sem chaveiro não finge cifra, e com chaveiro diz qual', () => {
    expect(textoDoCofre({persistente: false, plataforma: 'linux', loja: 'basic_text'})).toMatch(/não há chaveiro ativo.*não grava chave sem cifra/);
    expect(textoDoCofre({persistente: false, plataforma: 'linux'})).not.toMatch(/Windows/);
    expect(textoDoCofre({persistente: true, plataforma: 'linux', loja: 'gnome_libsecret'})).toBe('guardada cifrada pelo chaveiro do sistema (gnome_libsecret)');
    expect(textoDoCofre({persistente: false, plataforma: 'win32'})).toMatch(/Windows não ofereceu/);
  });
});

describe('cofre sem chaveiro (basic_text)', () => {
  let pasta = '';
  afterEach(() => rmSync(pasta, {recursive: true, force: true}));
  it('a chave vale na sessão e nada vai para o disco, nem em texto puro', () => {
    pasta = mkdtempSync(path.join(tmpdir(), 'estudio-cofre-'));
    const cofre = new CofreArquivo(path.join(pasta, 'chaves.json'), {disponivel: () => false, loja: () => 'basic_text',
      cifrar: () => { throw new Error('não deve cifrar'); }, decifrar: () => { throw new Error('não deve decifrar'); }});
    cofre.gravar('deepseek', 'sk-falsa-0123456789');
    expect(cofre.persistente()).toBe(false);
    expect(cofre.loja()).toBe('basic_text');
    expect(cofre.ler('deepseek')).toBe('sk-falsa-0123456789');
    expect(readdirSync(pasta)).toEqual([]);
    // outra execução do app: a chave se foi, e nenhum arquivo a trouxe de volta
    expect(new CofreArquivo(path.join(pasta, 'chaves.json'), {disponivel: () => false, cifrar: () => Buffer.alloc(0), decifrar: () => ''}).ler('deepseek')).toBeUndefined();
  });
});
