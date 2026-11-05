// Modelo de documentos do projeto. Tudo é JSON legível na pasta do projeto: a pessoa edita pela interface, o agente
// edita pelo terminal (MCP "estudio" ou o próprio arquivo), e as duas mãos passam pelo mesmo JSON Patch com versão.
import type {DocCenas} from './cenas';
import type {Efeito} from './efeitos';
import type {Roteiro} from './roteiro/resolver';

export type Modulo = 'video' | 'imagem' | '3d';

export type EntradaDocumento = {id: string; modulo: Modulo; caminho: string; titulo: string};

/** estudio.json na raiz do projeto. */
export type Manifesto = {
  formato: 1;
  nome: string;
  documentos: EntradaDocumento[];
};

// ---------- vídeo ----------
// dois tipos: o vídeo de cenas ("tipo": "cenas", o que se começa do zero) e o carrossel narrado da Cliente (sem "tipo")
export type DocVideo = (Roteiro | DocCenas) & {efeitos?: Efeito[]};

// ---------- imagem ----------
export type CamadaImagem = {
  id: string;
  nome: string;
  tipo: 'imagem' | 'texto' | 'forma';
  x: number;
  y: number;
  largura: number;
  altura: number;
  rotacao?: number; // graus
  opacidade?: number; // 0 a 1
  visivel?: boolean;
  src?: string; // imagem: caminho no projeto
  ajuste?: 'cobrir' | 'conter';
  texto?: string;
  fonte?: string;
  tamanho?: number;
  peso?: number;
  cor?: string;
  alinhar?: 'esquerda' | 'centro' | 'direita';
  forma?: 'retangulo' | 'elipse';
  preenchimento?: string;
  raio?: number;
};

export type DocImagem = {
  formato: 1;
  largura: number;
  altura: number;
  fundo: string;
  camadas: CamadaImagem[]; // de baixo para cima
  efeitos?: Efeito[];
};

// ---------- 3D ----------
export type Vetor3 = [number, number, number];

export type Objeto3D = {
  id: string;
  nome: string;
  tipo: 'caixa' | 'esfera' | 'cilindro' | 'cone' | 'toro' | 'plano';
  posicao: Vetor3;
  rotacao: Vetor3; // graus
  escala: Vetor3;
  cor: string;
  metalico?: number;
  rugosidade?: number;
  visivel?: boolean;
  gira?: Vetor3; // graus por segundo, para a prévia animada
};

export type Luz3D = {id: string; tipo: 'ambiente' | 'direcional' | 'ponto'; cor: string; intensidade: number; posicao?: Vetor3};

export type DocCena3D = {
  formato: 1;
  fundo: string;
  camera: {posicao: Vetor3; alvo: Vetor3; fov: number};
  luzes: Luz3D[];
  objetos: Objeto3D[];
};

export type Documento = DocVideo | DocImagem | DocCena3D;

// ---------- comentários ----------
export type AlvoComentario = {
  objeto?: string; // caminho no documento (JSON Pointer), ex.: /cenas/2/blocos/1 ou /camadas/0 ou /objetos/1
  objeto_id?: string; // id estável do objeto, quando houver
  tempo_ms?: number; // vídeo: ms de saída
  ponto?: {x: number; y: number}; // 0 a 1, relativo ao quadro
  contexto?: string; // texto do objeto ou palavras da narração em volta, para reancorar
};

export type Comentario = {
  id: string;
  documento: string; // id do documento no manifesto
  estado: 'aberto' | 'resolvido';
  autor: string;
  criado_em: string;
  texto: string;
  alvo: AlvoComentario;
  respostas: {autor: string; em: string; texto: string}[];
  resolucao?: {por: string; em: string; nota?: string};
};

export type ArquivoComentarios = {formato: 1; comentarios: Comentario[]};

// ---------- diário de mudanças ----------
export type OperacaoPatch = {op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test'; path: string; value?: unknown; from?: string};

export type EntradaDiario = {
  seq: number;
  em: string;
  documento: string; // caminho relativo do arquivo
  autor: string; // 'pessoa' | 'agente' | 'sistema'
  origem: string; // 'interface' | 'mcp' | 'arquivo' | ...
  rotulo: string;
  versao_antes: string;
  versao_depois: string;
  patch: OperacaoPatch[];
  inverso: OperacaoPatch[];
};

/** Estado do editor que o agente pode consultar (o app grava em .estudio/estado.json). */
export type EstadoEditor = {
  area: 'video' | 'imagem' | '3d' | 'efeitos';
  documento?: string;
  selecao?: string; // caminho do objeto selecionado
  tempo_ms?: number;
  atualizado_em: string;
};
