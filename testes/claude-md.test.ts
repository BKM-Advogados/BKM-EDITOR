// CLAUDE.md do projeto refeito ao abrir (integração da rodada 2, 07/11/2026): a parte do app fica entre marcas e acompanha
// a versão instalada; o que a pessoa escreveu fora delas e o CLAUDE.md escrito à mão do carrossel da Cliente ficam como estão.
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {MARCA_CLAUDE_FIM, MARCA_CLAUDE_INICIO, claudeMd, claudeMdAtualizado, gravarPlano, planoDoProjeto, regerarClaudeMd} from '../src/nucleo/criar-projeto';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-claude-md-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));
const EXEMPLO = path.join(__dirname, '..', 'exemplos', 'exemplo');

// o texto que a 0.3.0 gravava: o de hoje sem as marcas e sem os campos da rodada 2
const TEXTO_DA_030 = [
  '# Projeto do Estúdio',
  '',
  'Esta pasta é um projeto do Estúdio, aberto no app. A pessoa edita na interface; você edita pelas ferramentas do MCP',
  '`estudio`. Os dois mexem nos mesmos arquivos JSON, e o app recarrega a tela sozinho quando um arquivo muda.',
  '',
  '## Arquivos',
  '',
  '- Imagem: `largura`, `altura`, `fundo` e `camadas`. Exporta PNG por página e PDF.',
  '',
  'Tudo o que você faz cai nos documentos, e a pessoa edita depois. Não grave fora da pasta do projeto.',
  '',
].join('\n');

describe('CLAUDE.md do projeto', () => {
  it('a parte do app vem entre as marcas', () => {
    const md = claudeMd(['video']);
    expect(md.startsWith(`${MARCA_CLAUDE_INICIO}\n# Projeto do Estúdio`)).toBe(true);
    expect(md.trimEnd().endsWith(MARCA_CLAUDE_FIM)).toBe(true);
  });

  it('ensina os campos e as ferramentas da rodada 2', () => {
    const video = claudeMd(['video']);
    for (const campo of ['`movimento`', '`aproximar`', '`audio.alvo_lufs`', '`audio.pico_dbtp`', '`limpeza`', '`legendas`', '`predefinicao`', '`karaoke`']) {
      expect(video).toContain(campo);
    }
    for (const f of ['transcrever', 'exportar_legendas', 'importar_legendas']) expect(video).toContain(`\`${f}\``);
    expect(video).not.toContain('`remover_fundo`');
    const imagem = claudeMd(['imagem']);
    for (const campo of ['`sombra`', '`contorno`', '`degrade`', '`fundo_degrade`', '`mascara`', '`src_original`', '`remover_fundo`']) {
      expect(imagem).toContain(campo);
    }
    expect(imagem).not.toContain('`transcrever`');
    expect(imagem).toContain('o MCP não exporta');
    expect(imagem).not.toContain('Exporta PNG por página e PDF.');
  });

  it('a lista de "Como trabalhar" é numerada em sequência', () => {
    const md = claudeMd(['video', 'imagem']);
    const numeros = [...md.split('## Como trabalhar')[1].split('## Pesquisa')[0].matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    expect(numeros).toEqual(numeros.map((_, i) => i + 1));
    expect(numeros.length).toBe(8);
  });

  it('sem arquivo, grava o texto gerado; igual, não grava', () => {
    const gerado = claudeMd(['video']);
    expect(claudeMdAtualizado(null, ['video'])).toBe(gerado);
    expect(claudeMdAtualizado(gerado, ['video'])).toBeNull();
    expect(claudeMdAtualizado(gerado.replace(/\n/g, '\r\n'), ['video'])).toBeNull();
  });

  it('com as marcas, troca só o que está entre elas', () => {
    const antigo = claudeMd(['imagem']).replace('`fundo_degrade`', '`campo_velho`');
    const atual = `Notas da pessoa no topo.\n\n${antigo}\n## Combinados\n\nSempre a foto da Ana.\n`;
    const novo = claudeMdAtualizado(atual, ['imagem'])!;
    expect(novo.startsWith('Notas da pessoa no topo.\n\n')).toBe(true);
    expect(novo).toContain('`fundo_degrade`');
    expect(novo).not.toContain('`campo_velho`');
    expect(novo.endsWith('\n## Combinados\n\nSempre a foto da Ana.\n')).toBe(true);
    expect(novo.split(MARCA_CLAUDE_INICIO).length).toBe(2);
  });

  it('o texto antigo do app, sem marcas, vira o novo e guarda o que a pessoa acrescentou', () => {
    const atual = `${TEXTO_DA_030}\n## Combinados\n\nTítulos sempre em caixa alta.\n`;
    const novo = claudeMdAtualizado(atual, ['imagem'])!;
    expect(novo.startsWith(MARCA_CLAUDE_INICIO)).toBe(true);
    expect(novo).toContain('`mascara`');
    expect(novo).not.toContain('Exporta PNG por página e PDF.');
    expect(novo.trimEnd().endsWith('## Combinados\n\nTítulos sempre em caixa alta.')).toBe(true);
    // e na abertura seguinte já não muda nada
    expect(claudeMdAtualizado(novo, ['imagem'])).toBeNull();
  });

  it('não mexe no CLAUDE.md escrito à mão do carrossel da Cliente nem num da pessoa', () => {
    const doExemplo = readFileSync(path.join(EXEMPLO, 'CLAUDE.md'), 'utf-8');
    expect(claudeMdAtualizado(doExemplo, ['video', 'imagem'])).toBeNull();
    expect(claudeMdAtualizado('# Meu projeto\n\nRegras minhas.\n', ['video'])).toBeNull();
  });

  it('ao abrir, um projeto criado na 0.3.0 ganha o texto novo, e o manifesto decide as seções', () => {
    const destino = gravarPlano(path.join(tmp, 'antigo'), planoDoProjeto({nome: 'Antigo', modelo: 'video-branco'}));
    writeFileSync(path.join(destino, 'CLAUDE.md'), TEXTO_DA_030, 'utf-8');
    expect(regerarClaudeMd(destino)).toBe(true);
    const md = readFileSync(path.join(destino, 'CLAUDE.md'), 'utf-8');
    expect(md).toContain('`legendas`');
    expect(md).not.toContain('`mascara`'); // o projeto só tem vídeo
    expect(regerarClaudeMd(destino)).toBe(false);
  });

  it('projeto sem CLAUDE.md ganha um; pasta sem manifesto não quebra', () => {
    const destino = gravarPlano(path.join(tmp, 'sem-claude'), planoDoProjeto({nome: 'S', modelo: 'video-branco'}));
    rmSync(path.join(destino, 'CLAUDE.md'));
    expect(regerarClaudeMd(destino)).toBe(true);
    expect(readFileSync(path.join(destino, 'CLAUDE.md'), 'utf-8')).toContain(MARCA_CLAUDE_INICIO);
    expect(regerarClaudeMd(path.join(tmp, 'nao-existe'))).toBe(false);
  });
});
