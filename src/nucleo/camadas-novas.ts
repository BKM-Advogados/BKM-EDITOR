// As camadas que a interface cria de um clique (texto e forma), sem DOM: nascem na marca da peça, não na da Cliente. A fonte é
// a referência "@titulo" e a cor, "@texto" e "@destaque" (cor-marca.ts), lidas do kit que a imagem guarda (`marca`), então a
// peça da BKM não traz o cobre da Cliente e trocar de kit leva as camadas junto. Imagem sem kit usa o neutro.
import type {CamadaImagem, DocImagem} from './documentos';

const ENTRELINHA = 1.15;

/** Texto novo, em 6% da largura; com ponto (coordenadas do documento), nasce onde a pessoa clicou. */
export const textoNovo = (doc: Pick<DocImagem, 'largura' | 'altura'>, ponto?: {x: number; y: number}): Omit<CamadaImagem, 'id'> => {
  const tamanho = Math.max(12, Math.round(doc.largura * 0.06));
  const largura = Math.round(doc.largura * (ponto ? 0.6 : 0.8));
  return {
    nome: 'Texto', tipo: 'texto', texto: 'Novo texto', fonte: '@titulo', peso: 700, tamanho, cor: '@texto', alinhar: 'esquerda',
    x: Math.round(ponto ? Math.min(ponto.x, doc.largura - 40) : doc.largura * 0.1), y: Math.round(ponto ? ponto.y : doc.altura * 0.45),
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
