// Modelos de projeto que a tela inicial oferece. Só dados (sem disco): a interface importa daqui; criar-projeto.ts grava.
// O projeto de exemplo ("Ver um pronto") não é um modelo: ver exemplo.ts.
import type {Modulo} from './documentos';

export type IdModelo = 'video-branco' | 'video-carrossel-narrado' | 'imagem-branco' | '3d-branco' | 'animacao-branco' | 'animacao-9x16' | 'animacao-logo-pixel';

export type Modelo = {
  id: IdModelo;
  nome: string;
  descricao: string;
  modulo: Modulo;
  formato_fixo?: string; // o formato vem do modelo (id de formatos.ts)
};

export const MODELOS: Modelo[] = [
  {id: 'video-branco', nome: 'Em branco', descricao: 'Cenas com título, texto, lista, número e imagem. Duração por cena.', modulo: 'video'},
  // carrossel narrado em cima do vídeo de cenas (modelo-carrossel-narrado.ts; a decisão está em docs/carrossel-narrado.md)
  {id: 'video-carrossel-narrado', nome: 'Carrossel narrado', descricao: 'Gancho, partes, dúvida e fecho, com a fala de cada cena para narrar. As cenas acompanham a narração.',
    modulo: 'video', formato_fixo: 'reels'},
  {id: 'imagem-branco', nome: 'Em branco', descricao: 'Camadas de texto, forma e imagem.', modulo: 'imagem'},
  {id: '3d-branco', nome: 'Em branco', descricao: 'Cena 3D com câmera, luz e um objeto.', modulo: '3d'},
  {id: 'animacao-branco', nome: 'Em branco (16:9)', descricao: 'Animação 2D com quadros-chave: formas, texto, imagem e pixel.', modulo: 'animacao', formato_fixo: 'youtube'},
  {id: 'animacao-9x16', nome: 'Em branco (9:16)', descricao: 'Animação 2D vertical, para Reels e Shorts.', modulo: 'animacao', formato_fixo: 'reels'},
  {id: 'animacao-logo-pixel', nome: 'Logo em pixels', descricao: 'O logo do kit de marca em pixels, revelado com "decodificar" e um texto que entra suave.', modulo: 'animacao', formato_fixo: 'quadrado'},
];
