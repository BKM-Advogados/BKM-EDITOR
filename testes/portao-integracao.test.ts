// As ferramentas que as frentes declararam "cartao" nos docs passam pelo portão como cartão depois da integração
// (rodada 3): sem a linha na tabela, cairiam como "livre" e rodariam sem a pessoa responder.
import {describe, expect, it} from 'vitest';
import {classeDe} from '../src/nucleo/portao';

describe('portão: classes das ferramentas das frentes integradas', () => {
  it.each(['destravar_camadas', 'exportar_musica', 'importar_midi', 'ler_fonte', 'transcrever', 'remover_fundo', 'exportar_legendas'])('%s é cartão', (nome) => {
    expect(classeDe(nome)).toBe('cartao');
  });
  it.each(['aplicar_patch', 'inserir_icone', 'marca_dagua', 'marcar_midia', 'arranjar', 'animar', 'criar_animacao'])('%s é livre', (nome) => {
    expect(classeDe(nome)).toBe('livre');
  });
});
