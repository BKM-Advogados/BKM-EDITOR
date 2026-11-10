// Gravação na interface (frente Casca): prazo do aviso (transversal-D10), fila de edições e aviso de conflito (D16), selo
// "Salvo" (D11), atalhos de arquivo fora do terminal (D4) e o limite do tamanho livre (D17).
import {describe, expect, it} from 'vitest';
import {acaoDeArquivo} from '../src/renderer/casca/atalhos';
import {
  AVISO_EDICOES_SEGUIDAS, AVISO_OUTRA_MAO, EstadoDeGravacao, FilaPorChave, VALIDADE_AVISO_MS, VALIDADE_ERRO_MS,
  avisoVivo, mensagemDeFalhaNaEdicao, restaDoAviso, validadeDoAviso,
} from '../src/renderer/estado/gravacao';
import {conteudoNovo} from '../src/nucleo/criar-projeto';
import {TAMANHO_MAX, TAMANHO_MIN, formatoDoVideo, limitarTamanho} from '../src/nucleo/formatos';

describe('prazo do aviso (transversal-D10)', () => {
  it('erro fica 9 s e o resto 4 s, no rodapé e na loja', () => {
    expect(validadeDoAviso('erro')).toBe(VALIDADE_ERRO_MS);
    expect(validadeDoAviso('ok')).toBe(VALIDADE_AVISO_MS);
    expect(validadeDoAviso('info')).toBe(4000);
    expect(VALIDADE_ERRO_MS).toBe(9000);
  });

  it('o erro de 5 s atrás ainda aparece; o aviso comum de 5 s atrás não', () => {
    const erro = {tipo: 'erro', em: 1000};
    const ok = {tipo: 'ok', em: 1000};
    expect(avisoVivo(erro, 6000)).toBe(erro);
    expect(avisoVivo(ok, 6000)).toBeNull();
    expect(avisoVivo(erro, 1000 + VALIDADE_ERRO_MS)).toBeNull();
    expect(avisoVivo(undefined, 0)).toBeNull();
  });

  it('quanto falta para vencer', () => {
    expect(restaDoAviso({tipo: 'erro', em: 0}, 3000)).toBe(6000);
    expect(restaDoAviso({tipo: 'info', em: 0}, 3000)).toBe(1000);
    expect(restaDoAviso({tipo: 'info', em: 0}, 9999)).toBe(0);
  });
});

describe('fila de edições por documento (transversal-D16)', () => {
  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('a segunda edição do mesmo documento espera a primeira e sabe que esperou', async () => {
    const fila = new FilaPorChave();
    const ordem: string[] = [];
    const a = fila.enfileirar('doc', async (esperou) => {
      ordem.push(`a-começa-${esperou}`);
      await espera(20);
      ordem.push('a-termina');
      return 'a';
    });
    const b = fila.enfileirar('doc', async (esperou) => {
      ordem.push(`b-começa-${esperou}`);
      return 'b';
    });
    expect(await Promise.all([a, b])).toEqual(['a', 'b']);
    expect(ordem).toEqual(['a-começa-false', 'a-termina', 'b-começa-true']);
  });

  it('documentos diferentes não esperam um pelo outro', async () => {
    const fila = new FilaPorChave();
    const ordem: string[] = [];
    const lento = fila.enfileirar('um', async () => {
      await espera(30);
      ordem.push('um');
    });
    const rapido = fila.enfileirar('dois', async (esperou) => {
      ordem.push(`dois-${esperou}`);
    });
    await Promise.all([lento, rapido]);
    expect(ordem).toEqual(['dois-false', 'um']);
  });

  it('erro de uma edição não trava a seguinte, e a chave volta a não esperar depois', async () => {
    const fila = new FilaPorChave();
    const falha = fila.enfileirar('doc', async () => {
      throw new Error('x');
    });
    const seguinte = fila.enfileirar('doc', async (esperou) => esperou);
    await expect(falha).rejects.toThrow('x');
    await expect(seguinte).resolves.toBe(true);
    await espera(5);
    await expect(fila.enfileirar('doc', async (esperou) => esperou)).resolves.toBe(false);
  });

  it('conflito entre duas edições da pessoa não culpa o agente; sem edição dela na frente, culpa', () => {
    const conflito = 'o documento mudou (versão aaa, esperada bbb); leia de novo e refaça o patch';
    expect(mensagemDeFalhaNaEdicao(conflito, true)).toBe(AVISO_EDICOES_SEGUIDAS);
    expect(mensagemDeFalhaNaEdicao(conflito, false)).toBe(AVISO_OUTRA_MAO);
    expect(mensagemDeFalhaNaEdicao('patch inválido: TEST_OPERATION_FAILED em /a: x', true)).toBe(AVISO_EDICOES_SEGUIDAS);
    expect(mensagemDeFalhaNaEdicao('o arquivo está em uso por outro programa', true)).toBe('o arquivo está em uso por outro programa');
    expect(AVISO_EDICOES_SEGUIDAS).not.toMatch(/agente/);
  });
});

describe('selo "Salvo" (transversal-D11)', () => {
  it('salvo, gravando e a falha que fica até a próxima gravação dar certo', () => {
    const g = new EstadoDeGravacao();
    expect(g.ler()).toEqual({estado: 'salvo'});
    expect(g.comecar()).toEqual({estado: 'gravando'});
    expect(g.comecar()).toEqual({estado: 'gravando'});
    expect(g.terminar()).toEqual({estado: 'gravando'}); // ainda falta uma
    expect(g.terminar('o arquivo está em uso')).toEqual({estado: 'falhou', erro: 'o arquivo está em uso'});
    g.comecar();
    expect(g.terminar()).toEqual({estado: 'salvo'});
  });

  it('terminar demais não deixa a conta negativa', () => {
    const g = new EstadoDeGravacao();
    g.terminar();
    g.terminar();
    expect(g.comecar()).toEqual({estado: 'gravando'});
    expect(g.terminar()).toEqual({estado: 'salvo'});
  });
});

describe('atalhos de arquivo (transversal-D4)', () => {
  // fora do Mac o comando é o Ctrl; o Cmd do Mac tem os testes dele em testes/portes.test.ts (o terceiro argumento diz o sistema)
  const ctrl = (key: string, extra: Partial<{altKey: boolean; shiftKey: boolean; ctrlKey: boolean}> = {}) => ({key, ctrlKey: true, altKey: false, shiftKey: false, ...extra});

  it('Ctrl+O, N e W valem fora do terminal', () => {
    expect(acaoDeArquivo(ctrl('o'), false, false)).toBe('abrir');
    expect(acaoDeArquivo(ctrl('N'), false, false)).toBe('novo');
    expect(acaoDeArquivo(ctrl('w'), false, false)).toBe('fechar');
  });

  it('no terminal ficam com ele: o Ctrl+W apaga a palavra', () => {
    expect(acaoDeArquivo(ctrl('w'), true, false)).toBeNull();
    expect(acaoDeArquivo(ctrl('n'), true, false)).toBeNull();
    expect(acaoDeArquivo(ctrl('o'), true, false)).toBeNull();
  });

  it('outras teclas, ou com Alt ou Shift, não são de arquivo', () => {
    expect(acaoDeArquivo(ctrl('s'), false, false)).toBeNull();
    expect(acaoDeArquivo(ctrl('w', {shiftKey: true}), false, false)).toBeNull();
    expect(acaoDeArquivo(ctrl('w', {altKey: true}), false, false)).toBeNull();
    expect(acaoDeArquivo(ctrl('w', {ctrlKey: false}), false, false)).toBeNull();
    expect(acaoDeArquivo(ctrl('constructor'), false, false)).toBeNull();
  });
});

describe('tamanho livre (transversal-D17)', () => {
  it('limita entre 16 e 7680 e arredonda; vazio ou zero volta ao padrão', () => {
    expect(limitarTamanho(9000)).toBe(TAMANHO_MAX);
    expect(limitarTamanho(5)).toBe(TAMANHO_MIN);
    expect(limitarTamanho(1080.6)).toBe(1081);
    expect(limitarTamanho('1920')).toBe(1920);
    expect(limitarTamanho(0, 720)).toBe(720);
    expect(limitarTamanho('', 720)).toBe(720);
    expect(limitarTamanho('abc', 720)).toBe(720);
    expect(limitarTamanho(NaN)).toBe(1080);
    expect(limitarTamanho(-40, 640)).toBe(640);
  });

  it('o documento novo nasce com um tamanho que a prévia e o MP4 aceitam', () => {
    const doc = conteudoNovo('video', {largura: 9000, altura: 4, fps: 30}) as {formato: {largura: number; altura: number}};
    expect(doc.formato).toMatchObject({largura: 7680, altura: 16});
    expect(formatoDoVideo(doc)).toMatchObject({largura: 7680, altura: 16}); // não cai em silêncio para 1080×1920
    const img = conteudoNovo('imagem', {largura: 12000, altura: 800}) as {largura: number; altura: number};
    expect(img).toMatchObject({largura: 7680, altura: 800});
  });
});
