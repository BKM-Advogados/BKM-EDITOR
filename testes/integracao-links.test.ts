// Revisão da integração: as gravações do processo principal (narração gravada, recorte sem fundo, trilha importada,
// faxina dos renders da música) também respeitam o link simbólico em midia/ para fora do projeto: por ele só se lê.
import {existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {codificarWavPcm} from '../src/nucleo/gravacao';
import {importarTrilha} from '../src/nucleo/pasta-trilhas';
import {Projeto, serializar} from '../src/nucleo/projeto';
import {salvarTomada} from '../src/main/ipc-gravacao';
import {gravarSemFundo} from '../src/main/remover-fundo';
import {apagarRendersSemUso} from '../src/main/musica-render';

const pastas: string[] = [];
afterAll(() => pastas.forEach((p) => rmSync(p, {recursive: true, force: true})));
const pastaNova = (nome: string) => {
  const p = mkdtempSync(path.join(tmpdir(), `estudio-${nome}-`));
  pastas.push(p);
  return p;
};

/** Projeto cujo midia/ inteiro é um link para uma pasta de fora (um disco de vídeo bruto). */
const comMidiaFora = () => {
  const pasta = pastaNova('links');
  writeFileSync(path.join(pasta, 'estudio.json'), serializar({formato: 1, nome: 't', documentos: []}));
  mkdirSync(path.join(pasta, '.estudio'));
  const fora = pastaNova('fora');
  writeFileSync(path.join(fora, 'ana.jpg'), 'jpg');
  symlinkSync(fora, path.join(pasta, 'midia'));
  return {p: new Projeto(pasta), fora, antes: readdirSync(fora).sort()};
};

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('link simbólico em midia/ para fora: as gravações do app não passam por ele', () => {
  it('a narração gravada é recusada e nada aparece fora', () => {
    const {p, fora, antes} = comMidiaFora();
    expect(() => salvarTomada(p, codificarWavPcm([new Float32Array(4800)], 48000))).toThrow(/link simbólico/);
    expect(readdirSync(fora).sort()).toEqual(antes);
  });

  it('o recorte sem fundo é recusado', () => {
    const {p, fora, antes} = comMidiaFora();
    expect(() => gravarSemFundo(p, 'midia/ana.jpg', `data:image/png;base64,${PNG}`)).toThrow(/link simbólico/);
    expect(readdirSync(fora).sort()).toEqual(antes);
  });

  it('a trilha da biblioteca não é copiada para lá', () => {
    const {p, fora, antes} = comMidiaFora();
    const trilhas = pastaNova('trilhas');
    writeFileSync(path.join(trilhas, 'tema.mp3'), 'ID3');
    expect(() => importarTrilha(p, trilhas, path.join(trilhas, 'tema.mp3'))).toThrow(/link simbólico/);
    expect(readdirSync(fora).sort()).toEqual(antes);
  });

  it('a faxina dos renders da música não apaga nada fora do projeto', () => {
    const {p, fora} = comMidiaFora();
    mkdirSync(path.join(fora, 'musica'));
    const render = path.join(fora, 'musica', 'tema.0123456789abcdef.wav');
    writeFileSync(render, 'RIFF');
    expect(apagarRendersSemUso(p)).toEqual([]);
    expect(existsSync(render)).toBe(true);
  });
});
