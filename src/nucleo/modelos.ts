// Modelos de projeto que a tela inicial oferece. Só dados (sem disco): a interface importa daqui; criar-projeto.ts grava.
import type {Modulo} from './documentos';

export type IdModelo = 'video-branco' | 'imagem-branco' | '3d-branco' | 'modelo-carrossel' | 'modelo-capa';

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
];
