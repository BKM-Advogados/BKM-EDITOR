// As camadas que a interface cria de um clique (texto e forma), sem DOM: nascem na marca da peça, não na da Cliente. A fonte é
// a referência "@titulo" e a cor, "@texto" e "@destaque" (cor-marca.ts), lidas do kit que a imagem guarda (`marca`), então a
// peça da BKM não traz o cobre da Cliente e trocar de kit leva as camadas junto. Imagem sem kit usa o neutro.
import type {CamadaImagem, DocImagem} from './documentos';

const ENTRELINHA = 1.15;

/** Texto novo, em 6% da largura; com ponto (coordenadas do documento), nasce onde a pessoa clicou. */
export const textoNovo = (doc: Pick<DocImagem, 'largura' | 'altura'>, ponto?: {x: number; y: number}): Omit<CamadaImagem, 'id'> => {
  const tamanho = Math.max(12, Math.round(doc.largura * 0.06));
  const larguraPadrao = Math.round(doc.largura * (ponto ? 0.6 : 0.8));
  const x0 = Math.round(ponto ? Math.min(ponto.x, doc.largura - 40) : doc.largura * 0.1);
  // clicado perto da borda direita, a caixa encolhe (até 20% da prancheta) e recua para caber: uma caixa para fora da
  // página estica a área rolável do monitor e a prancheta sai do lugar
  const largura = ponto ? Math.max(Math.round(doc.largura * 0.2), Math.min(larguraPadrao, doc.largura - x0 - 20)) : larguraPadrao;
  return {
    nome: 'Texto', tipo: 'texto', texto: 'Novo texto', fonte: '@titulo', peso: 700, tamanho, cor: '@texto', alinhar: 'esquerda',
    x: ponto ? Math.max(0, Math.min(x0, doc.largura - largura - 20)) : x0, y: Math.round(ponto ? ponto.y : doc.altura * 0.45),
    largura, altura: Math.round(tamanho * ENTRELINHA * 2),
  };
};

/** Forma nova: na caixa desenhada ou, sem caixa, um quadrado de 30% no centro. Cor de destaque do kit. */
export const formaNova = (doc: Pick<DocImagem, 'largura' | 'altura'>, caixa?: {x: number; y: number; largura: number; altura: number}): Omit<CamadaImagem, 'id'> => {
  const lado = Math.max(8, Math.round(Math.min(doc.largura, doc.altura) * 0.3));
  const c = caixa ?? {x: Math.round((doc.largura - lado) / 2), y: Math.round((doc.altura - lado) / 2), largura: lado, altura: lado};
  return {
    nome: 'Forma', tipo: 'forma', forma: 'retangulo', preenchimento: '@destaque', raio: 0,
    x: Math.round(c.x), y: Math.round(c.y), largura: Math.max(4, Math.round(c.largura)), altura: Math.max(4, Math.round(c.altura)),
  };
};

export type OpcoesIcone = {x?: number; y?: number; tamanho?: number; cor?: string; espessura?: number};

/** Ícone novo do Lucide: quadrado de 16% do menor lado, no centro (ou com o canto no ponto dado), na cor de destaque do kit
 *  (referência "@destaque"). A caixa é quadrada porque o ícone é; `largura` e `altura` mudam depois como as de uma forma. */
export const iconeNovo = (doc: Pick<DocImagem, 'largura' | 'altura'>, nome: string, o: OpcoesIcone = {}): Omit<CamadaImagem, 'id'> => {
  const lado = Math.max(8, Math.round(o.tamanho ?? Math.min(doc.largura, doc.altura) * 0.16));
  return {
    nome: `Ícone · ${nome}`, tipo: 'forma', forma: 'icone', icone: nome, preenchimento: o.cor ?? '@destaque', raio: 0,
    ...(o.espessura !== undefined ? {icone_espessura: o.espessura} : {}),
    x: Math.round(o.x ?? (doc.largura - lado) / 2), y: Math.round(o.y ?? (doc.altura - lado) / 2), largura: lado, altura: lado,
  };
};
