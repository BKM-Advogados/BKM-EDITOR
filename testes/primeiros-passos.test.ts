// Primeiros passos (Onda B, frente do editor): o fato que marca cada passo, o texto de exemplo que não conta, a
// leitura das preferências e quando a lista aparece.
import {describe, expect, it} from 'vitest';
import {andamentoPassos, IDS_PASSOS, juntarPassos, mostrarPassos, normalizarPassos, passosFeitosAgora, PASSOS_VAZIO, temTextoEscrito,
  type FatosDosPassos} from '../src/nucleo/primeiros-passos';
import {novoDocCenas} from '../src/nucleo/cenas';
import {conteudoNovo} from '../src/nucleo/criar-projeto';

const NADA: FatosDosPassos = {midias: 0, documentos: [], diario: [], tocou: false, exportou: false};
const videoNovo = () => novoDocCenas({largura: 1080, altura: 1920, fps: 30});

describe('o fato de cada passo', () => {
  it('projeto novo: nenhum passo feito', () => {
    expect(passosFeitosAgora({...NADA, documentos: [{modulo: 'video', doc: videoNovo()}], diario: [{autor: 'pessoa'}]})).toEqual([]);
  });

  it('mídia: algum arquivo em midia/', () => {
    expect(passosFeitosAgora({...NADA, midias: 1})).toEqual(['midia']);
  });

  it('prévia e exportação: o que o editor viu nesta sessão', () => {
    expect(passosFeitosAgora({...NADA, tocou: true})).toEqual(['previa']);
    expect(passosFeitosAgora({...NADA, exportou: true})).toEqual(['exportar']);
  });

  it('Claude: alguma entrada do agente no diário (a da pessoa não conta)', () => {
    expect(passosFeitosAgora({...NADA, diario: [{autor: 'pessoa'}, {autor: 'sistema'}]})).toEqual([]);
    expect(passosFeitosAgora({...NADA, diario: [{autor: 'pessoa'}, {autor: 'agente'}]})).toEqual(['claude']);
  });

  it('todos juntos, na ordem da lista', () => {
    const doc = videoNovo();
    doc.cenas[0].blocos[0].texto = 'Férias proporcionais';
    expect(passosFeitosAgora({midias: 3, documentos: [{modulo: 'video', doc}], diario: [{autor: 'agente'}], tocou: true, exportou: true})).toEqual(IDS_PASSOS);
  });
});

describe('texto escrito', () => {
  it('o texto de exemplo do vídeo novo não conta; o trocado conta', () => {
    const doc = videoNovo();
    expect(temTextoEscrito([{modulo: 'video', doc}])).toBe(false);
    doc.cenas[0].blocos[0].texto = '  seu TÍTULO ';
    expect(temTextoEscrito([{modulo: 'video', doc}])).toBe(false);
    doc.cenas[0].blocos[0].texto = 'Quanto você recebe nas férias';
    expect(temTextoEscrito([{modulo: 'video', doc}])).toBe(true);
  });

  it('só a primeira cena conta; lista e rótulo do número também', () => {
    const doc = videoNovo();
    doc.cenas.push({id: 'cena-2', duracao_ms: 3000, blocos: [{id: 'b', tipo: 'texto', x: 0, y: 0, largura: 1, texto: 'Na segunda cena'}]});
    expect(temTextoEscrito([{modulo: 'video', doc}])).toBe(false);
    doc.cenas[0].blocos.push({id: 'l', tipo: 'lista', x: 0, y: 0, largura: 1, itens: ['Primeiro ponto', 'Saldo de salário']});
    expect(temTextoEscrito([{modulo: 'video', doc}])).toBe(true);
    const n = videoNovo();
    n.cenas[0].blocos = [{id: 'n', tipo: 'numero', x: 0, y: 0, largura: 1, ate: 30, rotulo: 'dias de férias'}];
    expect(temTextoEscrito([{modulo: 'video', doc: n}])).toBe(true);
  });

  it('sem vídeo de cenas: a camada de texto da imagem ou da animação', () => {
    const img = conteudoNovo('imagem', {largura: 1080, altura: 1350}) as {camadas: {texto?: string}[]};
    expect(temTextoEscrito([{modulo: 'imagem', doc: img}])).toBe(false);
    img.camadas[0].texto = 'Promoção de novembro';
    expect(temTextoEscrito([{modulo: 'imagem', doc: img}])).toBe(true);
    const carrossel = {largura: 1080, altura: 1350, camadas: [], paginas: [{id: 'p1', camadas: [{tipo: 'texto', texto: 'Página um'}]}]};
    expect(temTextoEscrito([{modulo: 'imagem', doc: carrossel}])).toBe(true);
    expect(temTextoEscrito([{modulo: 'animacao', doc: {camadas: [{tipo: 'texto', texto: 'Seu texto'}]}}])).toBe(false);
    expect(temTextoEscrito([{modulo: 'animacao', doc: {camadas: [{tipo: 'texto', texto: 'Olá'}]}}])).toBe(true);
  });

  it('com vídeo de cenas no projeto, o texto da imagem não basta', () => {
    expect(temTextoEscrito([{modulo: 'video', doc: videoNovo()}, {modulo: 'imagem', doc: {camadas: [{tipo: 'texto', texto: 'Capa'}]}}])).toBe(false);
  });
});

describe('estado nas preferências', () => {
  it('lê o que veio do disco: fora o que não é passo, sem repetidos, na ordem', () => {
    expect(normalizarPassos(undefined)).toEqual(PASSOS_VAZIO);
    expect(normalizarPassos('lixo')).toEqual(PASSOS_VAZIO);
    expect(normalizarPassos({feitos: ['exportar', 'midia', 'voar', 3, 'midia'], dispensado: 'sim'})).toEqual({feitos: ['midia', 'exportar'], dispensado: false});
    expect(normalizarPassos({feitos: [], dispensado: true}).dispensado).toBe(true);
  });

  it('juntar não desmarca e devolve o mesmo objeto quando nada é novo', () => {
    const e = {feitos: ['midia' as const], dispensado: false};
    expect(juntarPassos(e, [])).toBe(e);
    expect(juntarPassos(e, ['midia'])).toBe(e);
    expect(juntarPassos(e, ['claude', 'texto'])).toEqual({feitos: ['midia', 'texto', 'claude'], dispensado: false});
  });

  it('a lista aparece até concluir ou até "Não mostrar mais"', () => {
    expect(mostrarPassos(PASSOS_VAZIO)).toBe(true);
    expect(mostrarPassos({feitos: ['midia'], dispensado: true})).toBe(false);
    expect(mostrarPassos({feitos: IDS_PASSOS, dispensado: false})).toBe(false);
    expect(andamentoPassos({feitos: ['midia', 'texto'], dispensado: false})).toBe('2 de 5');
  });
});
