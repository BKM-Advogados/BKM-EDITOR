// Mídia grande fora do git (transversal-D7): extensão pesada sempre, o resto só acima de 25 MB.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {GITIGNORE} from '../src/nucleo/criar-projeto';
import {LIMITE_MIDIA_BYTES, REGRAS_MIDIA_PESADA, arquivosDaMidia, gitignoreComMidiaPesada, regrasQueFaltam} from '../src/nucleo/midia-git';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-midia-git-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));
const MB = 1024 * 1024;

describe('regras de mídia pesada', () => {
  it('projeto novo já nasce com as extensões de vídeo no .gitignore', () => {
    const linhas = GITIGNORE.split('\n');
    expect(linhas).toContain('midia/**/*.mp4');
    expect(linhas).toContain('midia/**/*.mov');
    expect(REGRAS_MIDIA_PESADA.every((r) => linhas.includes(r))).toBe(true);
    expect(linhas).toContain('saidas/'); // o que já existia continua
  });

  it('vídeo de qualquer tamanho entra pela extensão; áudio e imagem só passam do limite', () => {
    const arquivos = [
      {rel: 'midia/bruto.mp4', tamanho: 1.5 * 1024 * MB},
      {rel: 'midia/narracao.wav', tamanho: 60 * MB},
      {rel: 'midia/musica.mp3', tamanho: 4 * MB},
      {rel: 'midia/foto.png', tamanho: 2 * MB},
      {rel: 'midia/sub/rolo-a.jpg', tamanho: LIMITE_MIDIA_BYTES + 1},
      {rel: 'fotos/fora-da-midia.wav', tamanho: 90 * MB},
    ];
    const novas = regrasQueFaltam(arquivos, []);
    expect(novas).toEqual(expect.arrayContaining(REGRAS_MIDIA_PESADA));
    expect(novas).toContain('midia/narracao.wav');
    expect(novas).toContain('midia/sub/rolo-a.jpg');
    expect(novas).not.toContain('midia/bruto.mp4'); // a regra da extensão já cobre
    expect(novas).not.toContain('midia/musica.mp3');
    expect(novas).not.toContain('midia/foto.png');
    expect(novas).not.toContain('fotos/fora-da-midia.wav');
  });

  it('no limite exato o arquivo fica no git', () => {
    expect(regrasQueFaltam([{rel: 'midia/a.wav', tamanho: LIMITE_MIDIA_BYTES}], REGRAS_MIDIA_PESADA)).toEqual([]);
  });

  it('não repete o que o .gitignore já tem e acrescenta só o que falta', () => {
    const base = `${GITIGNORE}midia/narracao.wav\n`;
    expect(gitignoreComMidiaPesada(base, [{rel: 'midia/narracao.wav', tamanho: 60 * MB}])).toBe(base);
    const novo = gitignoreComMidiaPesada(base, [{rel: 'midia/outra.wav', tamanho: 61 * MB}]);
    expect(novo).toBe(`${base}# mídia pesada fica fora do git (vídeo, áudio sem perda e o que passa de 25 MB)\nmidia/outra.wav\n`);
  });

  it('projeto antigo, sem as regras e sem quebra de linha no fim, ganha todas', () => {
    const novo = gitignoreComMidiaPesada('saidas/', []);
    expect(novo.startsWith('saidas/\n# mídia pesada')).toBe(true);
    expect(novo.endsWith('\n')).toBe(true);
    for (const r of REGRAS_MIDIA_PESADA) expect(novo.split('\n')).toContain(r);
  });

  it('aceita caminho com contrabarra do Windows', () => {
    expect(regrasQueFaltam([{rel: 'midia\\sub\\a.wav', tamanho: 40 * MB}], REGRAS_MIDIA_PESADA)).toEqual(['midia/sub/a.wav']);
  });
});

describe('arquivosDaMidia', () => {
  it('lista midia/ com tamanho e caminho com barra, até a profundidade, e ignora o resto do projeto', () => {
    mkdirSync(path.join(tmp, 'midia', 'a', 'b', 'c', 'd', 'e'), {recursive: true});
    mkdirSync(path.join(tmp, 'saidas'), {recursive: true});
    writeFileSync(path.join(tmp, 'midia', 'um.txt'), '12345');
    writeFileSync(path.join(tmp, 'midia', 'a', 'dois.txt'), '12');
    writeFileSync(path.join(tmp, 'midia', 'a', 'b', 'c', 'd', 'e', 'fundo.txt'), 'x');
    writeFileSync(path.join(tmp, 'saidas', 'fora.mp4'), 'x');
    const achados = arquivosDaMidia(tmp).sort((x, y) => x.rel.localeCompare(y.rel));
    expect(achados).toEqual([
      {rel: 'midia/a/dois.txt', tamanho: 2},
      {rel: 'midia/um.txt', tamanho: 5},
    ]);
  });

  it('sem midia/ devolve lista vazia', () => {
    expect(arquivosDaMidia(path.join(tmp, 'nao-existe'))).toEqual([]);
  });
});
