// Ações que criam camadas na imagem (texto, forma, imagem do projeto). O trilho do monitor usa estas funções; cada uma
// é um patch "add" e seleciona a camada nova.
import type {CamadaImagem, DocImagem} from '../../../nucleo/documentos';
import {aplicar, avisar, loja, selecionar} from '../../estado/loja';
import {ENTRELINHA, caminhoNoProjeto, idNovo, medirImagem} from './comum';

const docDe = (documento: string) => loja.get().docs[documento]?.doc as DocImagem | undefined;

export const adicionarCamada = async (documento: string, base: string, camada: Omit<CamadaImagem, 'id'>) => {
  const doc = docDe(documento);
  if (!doc) return false;
  const nova: CamadaImagem = {id: idNovo(base, doc.camadas), ...camada};
  if (!(await aplicar(documento, [{op: 'add', path: '/camadas/-', value: nova}], `nova camada ${nova.id}`))) return false;
  const i = docDe(documento)?.camadas.findIndex((c) => c.id === nova.id) ?? -1;
  if (i >= 0) selecionar({documento, caminho: `/camadas/${i}`});
  return true;
};

/** Texto novo; com ponto (coordenadas do documento), nasce onde a pessoa clicou. */
export const novoTexto = (documento: string, doc: DocImagem, ponto?: {x: number; y: number}) => {
  const tamanho = Math.max(12, Math.round(doc.largura * 0.06));
  const largura = Math.round(doc.largura * (ponto ? 0.6 : 0.8));
  return adicionarCamada(documento, 'texto', {
    nome: 'Texto', tipo: 'texto', texto: 'Novo texto', fonte: 'Archivo', peso: 700, tamanho, cor: '#F4F0EA', alinhar: 'esquerda',
    x: Math.round(ponto ? Math.min(ponto.x, doc.largura - 40) : doc.largura * 0.1), y: Math.round(ponto ? ponto.y : doc.altura * 0.45),
    largura, altura: Math.round(tamanho * ENTRELINHA * 2),
  });
};

/** Forma nova: na caixa desenhada ou, sem caixa, um quadrado de 30% no centro (ou no ponto clicado). */
export const novaForma = (documento: string, doc: DocImagem, caixa?: {x: number; y: number; largura: number; altura: number}) => {
  const lado = Math.max(8, Math.round(Math.min(doc.largura, doc.altura) * 0.3));
  const c = caixa ?? {x: Math.round((doc.largura - lado) / 2), y: Math.round((doc.altura - lado) / 2), largura: lado, altura: lado};
  return adicionarCamada(documento, 'forma', {
    nome: 'Forma', tipo: 'forma', forma: 'retangulo', preenchimento: '#C88155', raio: 0,
    x: Math.round(c.x), y: Math.round(c.y), largura: Math.max(4, Math.round(c.largura)), altura: Math.max(4, Math.round(c.altura)),
  });
};

export const novaImagem = async (documento: string, doc: DocImagem, bruto: string) => {
  const src = caminhoNoProjeto(bruto);
  if (!src) {
    avisar('Use um caminho dentro da pasta do projeto, ex.: midia/logo-exemplo.png', 'erro');
    return false;
  }
  try {
    const {iw, ih} = await medirImagem(src);
    const largura = Math.round(doc.largura * 0.5);
    const altura = Math.max(1, Math.round((largura * ih) / iw));
    const nome = src.split('/').pop()!.replace(/\.[^.]+$/, '');
    return await adicionarCamada(documento, nome, {
      nome, tipo: 'imagem', src, ajuste: 'conter',
      x: Math.round((doc.largura - largura) / 2), y: Math.round((doc.altura - altura) / 2), largura, altura,
    });
  } catch (e) {
    avisar((e as Error).message, 'erro');
    return false;
  }
};
