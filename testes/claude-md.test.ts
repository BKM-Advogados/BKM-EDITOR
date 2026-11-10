// CLAUDE.md do projeto refeito ao abrir (integração da rodada 2, 07/11/2026): a parte do app fica entre marcas e acompanha
// a versão instalada; o que a pessoa escreveu fora delas e o CLAUDE.md escrito à mão do carrossel da Cliente ficam como estão.
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {MARCA_CLAUDE_FIM, MARCA_CLAUDE_INICIO, MARCA_IMAGEM_INICIO, claudeMd, claudeMdAtualizado, gravarPlano, planoDoProjeto, regerarClaudeMd} from '../src/nucleo/criar-projeto';
import {EFEITOS} from '../src/nucleo/efeitos';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-claude-md-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));
const EXEMPLO = path.join(__dirname, '..', 'exemplos', 'exemplo');

// o texto que a 0.3.0 gravava, tal como o `claudeMd` do commit 580050c o gerava (sem as marcas), por módulo
const texto030 = (modulo: 'video' | 'imagem') => readFileSync(path.join(__dirname, 'fixtures', `claude-md-030-${modulo}.md`), 'utf-8');

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

  it('legendas: em e sai são do vídeo de quando a legenda nasceu, e a correção é por editar_legenda (som-N7, video-N5, transversal-N8)', () => {
    const video = claudeMd(['video']);
    expect(video).toContain('**de quando a legenda nasceu**');
    for (const f of ['ler_legendas', 'editar_legenda']) expect(video).toContain(`\`${f}\``);
    expect(video).toContain('Não\n  escreva `texto`, `palavras`, `em` ou `sai` de legenda por `aplicar_patch`');
    expect(video).not.toContain('texto por patch nos segmentos');
    expect(claudeMd(['imagem'])).not.toContain('`editar_legenda`');
  });

  it('efeitos: todos os tipos da lista do app, com a faixa do valor, no vídeo e na imagem (tres-efeitos-N2)', () => {
    for (const modulos of [['video'], ['imagem']] as const) {
      const md = claudeMd([...modulos]);
      const trecho = md.slice(md.indexOf('- Efeitos'), md.indexOf('- Kit de marca'));
      const listados = [...trecho.split('Tipos e faixa do `valor`:')[1].matchAll(/`(\w+)` (−?\d+) a (\d+)/g)].map((m) => [m[1], Number(m[2].replace('−', '-')), Number(m[3])]);
      expect(listados).toEqual(EFEITOS.map((d) => [d.tipo, d.min, d.max]));
      expect(trecho).toContain('preto e branco é `saturacao` 0');
      expect(trecho).toContain('não invente');
    }
    expect(claudeMd(['3d'])).not.toContain('- Efeitos');
  });

  it('3D: tipos de objeto e de luz, vetores [x, y, z], intensidade e câmera (tres-efeitos-N2)', () => {
    const md = claudeMd(['3d']);
    for (const t of ['caixa', 'esfera', 'cilindro', 'cone', 'toro', 'plano', 'ambiente', 'direcional', 'ponto']) expect(md).toContain(`\`${t}\``);
    for (const c of ['`posicao`', '`rotacao`', '`escala`', '`cor`', '`metalico`', '`rugosidade`', '`gira`', '`intensidade`', '`camera`', '`alvo`', '`fov`']) expect(md).toContain(c);
    expect(md).toContain('[x, y, z]');
    expect(md).toContain('[-90, 0, 0]');
  });

  it('o vídeo de cenas explica a narração por IA: os campos e as ferramentas (docs/narracao.md)', () => {
    const video = claudeMd(['video']);
    for (const c of ['`cenas[i].narracao` {`texto`}', '`provedor`', '`gemini-3.8-flash-tts`', '`estilo`', '`velocidade`', '`folga_ms`', '`margem_ms`', '`pronuncias`', '`narracao_ia`',
      'midia/narracao/<hash>.wav']) expect(video).toContain(c);
    for (const f of ['narrar', 'vozes_narracao', 'configurar_narracao', 'pronuncias_narracao', 'ajustar_cenas_a_fala']) expect(video).toContain(`\`${f}\``);
    expect(video).toContain('`previa: true`');
    expect(claudeMd(['imagem'])).not.toContain('`narrar`');
  });

  it('a lista de "Como trabalhar" é numerada em sequência', () => {
    const md = claudeMd(['video', 'imagem']);
    const numeros = [...md.split('## Como trabalhar')[1].split('## Pesquisa')[0].matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    expect(numeros).toEqual(numeros.map((_, i) => i + 1));
    expect(numeros.length).toBe(9); // + a narração por IA
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
    const atual = `${texto030('imagem')}\n## Combinados\n\nTítulos sempre em caixa alta.\n`;
    expect(atual).not.toContain('`mascara`'); // o texto da 0.3.0 é mesmo o antigo
    const novo = claudeMdAtualizado(atual, ['imagem'])!;
    expect(novo.startsWith(MARCA_CLAUDE_INICIO)).toBe(true);
    expect(novo).toContain('`mascara`');
    expect(novo.split('# Projeto do Estúdio').length).toBe(2); // o texto antigo do app não fica duplicado
    expect(novo).not.toContain('## Anotações do texto anterior'); // o texto do app puro não gera anotação nenhuma
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
    writeFileSync(path.join(destino, 'CLAUDE.md'), texto030('video'), 'utf-8');
    expect(regerarClaudeMd(destino)).toBe(true);
    const md = readFileSync(path.join(destino, 'CLAUDE.md'), 'utf-8');
    expect(md).toContain('`legendas`');
    expect(md).not.toContain('`mascara`'); // o projeto só tem vídeo
    expect(regerarClaudeMd(destino)).toBe(false);
  });

  it('o que a pessoa escreveu dentro do texto da 0.3.0 não some ao abrir com a versão nova (imagem-N5)', () => {
    const acrescimo = '- `midia/ana.jpg`: use sempre a foto da Ana nas capas.';
    const antigo = texto030('imagem').replace('## Arquivos\n', `## Arquivos\n\n${acrescimo}\n`);
    expect(antigo).toContain(acrescimo);
    const novo = claudeMdAtualizado(antigo, ['imagem'])!;
    expect(novo).toContain(acrescimo);
    const secao = novo.split('## Anotações do texto anterior')[1];
    expect(secao).toBeDefined();
    // só a linha dela entra na seção: nenhuma linha do texto do app se repete ali
    const linhas = secao.split('\n').filter((l) => l.trim() && !l.startsWith('O Estúdio refez'));
    expect(linhas).toEqual([acrescimo]);
    // e na abertura seguinte já não muda nada
    expect(claudeMdAtualizado(novo, ['imagem'])).toBeNull();
  });

  it('o CLAUDE.md do modelo da Cliente também lê a parte da imagem (imagem-N3)', () => {
    const doExemplo = readFileSync(path.join(EXEMPLO, 'CLAUDE.md'), 'utf-8');
    for (const campo of ['`mascara`', '`sombra`', '`degrade`', '`paginas[]`']) expect(doExemplo).toContain(campo);
    expect(claudeMdAtualizado(doExemplo, ['video', 'imagem', '3d'])).toBeNull(); // o exemplo já vem em dia
    // projeto da Cliente criado antes, sem o bloco: ganha no fim, e o texto à mão fica como está
    const semBloco = `${doExemplo.slice(0, doExemplo.indexOf(MARCA_IMAGEM_INICIO)).trimEnd()}\n`;
    expect(semBloco).not.toContain('`mascara`');
    const novo = claudeMdAtualizado(semBloco, ['video', 'imagem'])!;
    expect(novo.startsWith(semBloco.trimEnd())).toBe(true);
    expect(novo).toContain('`mascara`');
    expect(claudeMdAtualizado(novo, ['video', 'imagem'])).toBeNull();
    // bloco de uma versão velha é refeito; o que está fora dele, não
    const velho = `${novo.replace('`degrade`', '`degrade_velho`')}\nNota da Ana depois do bloco.\n`;
    const refeito = claudeMdAtualizado(velho, ['video', 'imagem'])!;
    expect(refeito).toContain('`degrade`');
    expect(refeito).not.toContain('`degrade_velho`');
    expect(refeito.endsWith('\nNota da Ana depois do bloco.\n')).toBe(true);
    // projeto sem imagem não recebe o bloco; CLAUDE.md da pessoa (sem as marcas nem a frase do exemplo) fica como está
    expect(claudeMdAtualizado(semBloco, ['video'])).toBeNull();
    expect(claudeMdAtualizado('# Meu projeto\n\nRegras minhas.\n', ['imagem'])).toBeNull();
  });

  it('o modelo "Carrossel narrado Cliente" nasce com a parte da imagem no CLAUDE.md', () => {
    const destino = gravarPlano(path.join(tmp, 'cliente'), planoDoProjeto({nome: 'Cliente', modelo: 'modelo-carrossel'}), EXEMPLO);
    const md = readFileSync(path.join(destino, 'CLAUDE.md'), 'utf-8');
    expect(md).toContain(MARCA_IMAGEM_INICIO);
    expect(md).toContain('`mascara`');
    expect(regerarClaudeMd(destino)).toBe(false); // ao abrir, nada muda
  });

  it('projeto sem CLAUDE.md ganha um; pasta sem manifesto não quebra', () => {
    const destino = gravarPlano(path.join(tmp, 'sem-claude'), planoDoProjeto({nome: 'S', modelo: 'video-branco'}));
    rmSync(path.join(destino, 'CLAUDE.md'));
    expect(regerarClaudeMd(destino)).toBe(true);
    expect(readFileSync(path.join(destino, 'CLAUDE.md'), 'utf-8')).toContain(MARCA_CLAUDE_INICIO);
    expect(regerarClaudeMd(path.join(tmp, 'nao-existe'))).toBe(false);
  });
});
