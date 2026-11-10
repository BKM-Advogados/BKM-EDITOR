// Modelos de projeto que a tela inicial oferece. Só dados (sem disco): a interface importa daqui; criar-projeto.ts grava.
import type {Modulo} from './documentos';

export type IdModelo = 'video-branco' | 'imagem-branco' | '3d-branco' | 'modelo-carrossel' | 'modelo-capa' | 'animacao-branco' | 'animacao-9x16' | 'animacao-logo-pixel';

export type Modelo = {
  id: IdModelo;
  nome: string;
  descricao: string;
  modulo: Modulo;
  formato_fixo?: string; // modelos da Cliente: o formato vem do exemplo
  exemplo?: boolean; // copia de exemplos/exemplo
};

export const MODELOS: Modelo[] = [
  {id: 'video-branco', nome: 'Em branco', descricao: 'Cenas com título, texto, lista, número e imagem. Duração por cena.', modulo: 'video'},
  {id: 'modelo-carrossel', nome: 'Carrossel narrado · Cliente', descricao: 'O C2 da campanha: cenas presas às palavras da narração.', modulo: 'video', formato_fixo: '9:16', exemplo: true},
  {id: 'imagem-branco', nome: 'Em branco', descricao: 'Camadas de texto, forma e imagem.', modulo: 'imagem'},
  {id: 'modelo-capa', nome: 'Capa de carrossel · Cliente', descricao: 'A capa do C2: foto, faixa e título no manual da Cliente.', modulo: 'imagem', formato_fixo: '4:5', exemplo: true},
  {id: '3d-branco', nome: 'Em branco', descricao: 'Cena 3D com câmera, luz e um objeto.', modulo: '3d'},
  {id: 'animacao-branco', nome: 'Em branco (16:9)', descricao: 'Animação 2D com quadros-chave: formas, texto, imagem e pixel.', modulo: 'animacao', formato_fixo: 'youtube'},
  {id: 'animacao-9x16', nome: 'Em branco (9:16)', descricao: 'Animação 2D vertical, para Reels e Shorts.', modulo: 'animacao', formato_fixo: 'reels'},
  {id: 'animacao-logo-pixel', nome: 'Logo em pixels', descricao: 'O logo do kit de marca em pixels, revelado com "decodificar" e um texto que entra suave.', modulo: 'animacao', formato_fixo: 'quadrado'},
];
