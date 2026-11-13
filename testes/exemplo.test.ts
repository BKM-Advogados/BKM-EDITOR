// O projeto de exemplo de "Ver um exemplo" (exemplos/exemplo, gerado por scripts/gerar-exemplo.ts): a pasta versionada é
// a que o gerador grava, o vídeo toca sem aviso, toda imagem citada existe, nada de marca de ninguém, e cada clique cria
// uma cópia nova (o mesmo caminho do IPC abrirExemplo do main.ts: pastaLivre + planoDoExemplo + gravarPlano).
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {resolverCenas, type DocCenas} from '../src/nucleo/cenas';
import {gravarPlano, pastaLivre, planoDoExemplo, regerarClaudeMd} from '../src/nucleo/criar-projeto';
import {EXEMPLO} from '../src/nucleo/exemplo';
import {arquivosDoExemplo, DOC_DO_EXEMPLO} from '../src/nucleo/exemplo-conteudo';
import {Projeto} from '../src/nucleo/projeto';

const RAIZ = path.join(__dirname, '..');
const PASTA = path.join(RAIZ, 'exemplos', EXEMPLO.pasta);
const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-exemplo-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));

const arquivosDaPasta = (raiz: string, rel = ''): string[] =>
  readdirSync(path.join(raiz, rel), {withFileTypes: true}).flatMap((d) => {
    const r = rel ? `${rel}/${d.name}` : d.name;
    return d.isDirectory() ? arquivosDaPasta(raiz, r) : [r];
  });

describe('projeto de exemplo', () => {
  it('a pasta versionada é exatamente a que o gerador grava (npm run exemplo)', () => {
    const esperado = arquivosDoExemplo();
    expect(arquivosDaPasta(PASTA).sort()).toEqual(Object.keys(esperado).sort());
    for (const [rel, texto] of Object.entries(esperado)) expect(readFileSync(path.join(PASTA, rel), 'utf-8').replace(/\r\n/g, '\n'), rel).toBe(texto);
  });

  it('é leve: menos de 20 KB no total', () => {
    const total = arquivosDaPasta(PASTA).reduce((s, rel) => s + statSync(path.join(PASTA, rel)).size, 0);
    expect(total).toBeLessThan(20 * 1024);
  });

  it('o vídeo toca sem aviso, mostra título, texto, lista, número e imagem, e toda imagem citada existe', () => {
    const p = new Projeto(PASTA);
    const m = p.manifesto();
    expect(m.documentos.map((d) => d.modulo)).toEqual(['video']);
    const doc = p.lerJson<DocCenas>(m.documentos[0].caminho).doc;
    expect(doc).toEqual(DOC_DO_EXEMPLO);
    expect(resolverCenas(doc).avisos).toEqual([]);
    const tipos = new Set(doc.cenas.flatMap((c) => c.blocos.map((b) => b.tipo)));
    for (const t of ['titulo', 'texto', 'lista', 'numero', 'imagem']) expect(tipos).toContain(t);
    const imagens = doc.cenas.flatMap((c) => c.blocos.filter((b) => b.tipo === 'imagem').map((b) => b.src!));
    expect(imagens.length).toBeGreaterThan(0);
    for (const src of imagens) expect(existsSync(path.join(PASTA, src)), src).toBe(true);
    expect(doc.formato).toMatchObject({largura: 1080, altura: 1920});
  });

  it('não traz marca de ninguém: tema neutro, sem logo, sem foto e sem nome de escritório', () => {
    const tudo = Object.values(arquivosDoExemplo()).join('\n');
    expect(tudo).not.toMatch(/bkm|advogad|escrit[oó]rio|logo|https?:\/\/(?!www\.w3\.org)/i);
    expect(arquivosDaPasta(PASTA).every((rel) => /\.(json|svg)$/.test(rel))).toBe(true); // nada de foto, áudio ou fonte de fora
    expect(existsSync(path.join(PASTA, 'CLAUDE.md'))).toBe(false); // o app escreve o guia da versão instalada ao abrir
  });

  it('cada clique cria uma cópia nova, e mexer na cópia não muda o exemplo nem a outra cópia', () => {
    const abrirExemplo = () => {
      const destino = pastaLivre(tmp, EXEMPLO.nome);
      return gravarPlano(destino, planoDoExemplo(EXEMPLO.nome), PASTA);
    };
    const a = abrirExemplo();
    const b = abrirExemplo();
    expect(path.basename(a)).toBe('Exemplo');
    expect(path.basename(b)).toBe('Exemplo (2)');
    for (const raiz of [a, b]) {
      expect(new Projeto(raiz).manifesto().nome).toBe('Exemplo');
      expect(existsSync(path.join(raiz, '.gitignore'))).toBe(true);
      expect(regerarClaudeMd(raiz)).toBe(true); // como o abrirProjeto do main faz
      expect(readFileSync(path.join(raiz, 'CLAUDE.md'), 'utf-8')).toContain('vídeo de cenas');
    }
    writeFileSync(path.join(a, 'video', 'video.json'), '{}', 'utf-8');
    expect(JSON.parse(readFileSync(path.join(b, 'video', 'video.json'), 'utf-8'))).toEqual(DOC_DO_EXEMPLO);
    expect(JSON.parse(readFileSync(path.join(PASTA, 'video', 'video.json'), 'utf-8'))).toEqual(DOC_DO_EXEMPLO);
  });

  it('o pacote leva exemplos/ (forge.config.ts) e o botão aparece quando há o estudio.json', () => {
    expect(readFileSync(path.join(RAIZ, 'forge.config.ts'), 'utf-8')).toMatch(/existsSync\("exemplos"\) \? \["exemplos"\]/);
    expect(existsSync(path.join(PASTA, 'estudio.json'))).toBe(true); // temExemplo() do main.ts
  });
});
