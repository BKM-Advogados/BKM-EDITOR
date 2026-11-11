// Exportar a música não grava por cima (auditoria de render, R9): como o vídeo, a imagem, o carrossel e as legendas, um
// nome que já existe em saidas/ vira "<título> (2)", com o mesmo sufixo no comprovante e nos stems; por cima, só se pedido.
import {mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {documentoNovo, gravarPlano, planoDoProjeto} from '../src/nucleo/criar-projeto';
import {Projeto} from '../src/nucleo/projeto';
import {baseLivre, exportarMusica} from '../src/main/musica-render';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-musica-nome-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));

const projetoComMusica = (nome: string) => {
  const p = new Projeto(gravarPlano(path.join(tmp, nome), planoDoProjeto({nome, modelo: 'video-branco'})));
  const {entrada, conteudo} = documentoNovo(p.manifesto(), 'musica', {titulo: 'Tema'});
  p.adicionarDocumento(entrada, conteudo);
  return {p, id: entrada.id};
};

describe('R9 · exportar a música sem gravar por cima', () => {
  it('baseLivre pula o nome em que qualquer arquivo da exportação já existe', () => {
    const existentes = new Set(['saidas/Tema.wav', 'saidas/Tema (2).licencas.json']);
    expect(baseLivre((r) => existentes.has(r), 'Tema', ['.wav', '.licencas.json'])).toBe('saidas/Tema (3)');
    expect(baseLivre((r) => existentes.has(r), 'Outro', ['.wav'])).toBe('saidas/Outro');
  });

  it('a segunda exportação sai com "(2)", inclusive o comprovante e os stems; a primeira fica intacta', async () => {
    const {p, id} = projetoComMusica('wav');
    const a = await exportarMusica(p, id, {formato: 'wav', stems: true});
    const b = await exportarMusica(p, id, {formato: 'wav', stems: true});
    expect(a.arquivos[0]).toBe('saidas/Tema.wav');
    expect(b.arquivos[0]).toBe('saidas/Tema (2).wav');
    expect(b.arquivos.filter((x) => !x.startsWith('saidas/Tema (2)'))).toEqual([]);
    for (const x of [...a.arquivos, ...b.arquivos]) expect(p.existe(x), x).toBe(true);
    expect(JSON.parse(p.lerTexto('saidas/Tema.licencas.json')).arquivo).toBe('saidas/Tema.wav');
  });

  it('MIDI também; com sobrescrever, grava por cima', async () => {
    const {p, id} = projetoComMusica('mid');
    expect((await exportarMusica(p, id, {formato: 'mid'})).arquivos).toEqual(['saidas/Tema.mid']);
    expect((await exportarMusica(p, id, {formato: 'mid'})).arquivos).toEqual(['saidas/Tema (2).mid']);
    expect((await exportarMusica(p, id, {formato: 'mid', sobrescrever: true})).arquivos).toEqual(['saidas/Tema.mid']);
  });
});
