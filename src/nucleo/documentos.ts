// Modelo de documentos do projeto. Tudo é JSON legível na pasta do projeto: a pessoa edita pela interface, o agente
// edita pelo terminal (MCP "estudio" ou o próprio arquivo), e as duas mãos passam pelo mesmo JSON Patch com versão.
import type {DocCenas} from './cenas';
import type {Efeito} from './efeitos';
import type {Roteiro} from './roteiro/resolver';
import {ehDocAnimacao, type DocAnimacao} from './animacao';
import type {DocMusica} from './musica'; // frente Música

export type Modulo = 'video' | 'imagem' | '3d' | 'musica' | 'animacao';

export type EntradaDocumento = {id: string; modulo: Modulo; caminho: string; titulo: string};

/** estudio.json na raiz do projeto. */
export type Manifesto = {
  formato: 1;
  nome: string;
  documentos: EntradaDocumento[];
};

// ---------- vídeo ----------
// dois tipos: o vídeo de cenas ("tipo": "cenas", o que se começa do zero) e o carrossel narrado (sem "tipo")
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
  forma?: 'retangulo' | 'elipse' | 'icone' | 'linha'; // 'icone': ícone do Lucide (campo `icone`); 'linha': segmento com pontas e setas (campo `linha`)
  preenchimento?: string;
  raio?: number;
  // acabamento (src/nucleo/acabamento.ts, docs/imagem.md): o mesmo desenho na prévia e no PNG
  sombra?: Sombra;
  contorno?: Contorno;
  degrade?: Degrade; // texto e forma: no lugar de `cor` e `preenchimento`
  mascara?: string; // imagem: id da forma ou do texto logo acima, que a recorta
  src_original?: string; // imagem: o arquivo de antes do "remover fundo", para voltar
  // ícones (frente Marca, rodada 3, src/nucleo/icones.ts): forma 'icone'; a cor é `preenchimento` (ou `degrade`)
  icone?: string; // nome do ícone do Lucide, em inglês e com hífen: "scale", "file-text"
  icone_espessura?: number; // espessura do traço na grade de 24 do ícone (padrão 2); acompanha a caixa
  // linha e seta (frente Marca, rodada 3, src/nucleo/linha.ts): forma 'linha'; a cor é `preenchimento`, o ângulo é `rotacao`
  linha?: Linha;
  // listas (frente Marca, rodada 3, src/nucleo/lista.ts): texto com um item por linha, marcador na margem e recuo pendente
  lista?: 'marcadores' | 'numerada';
  lista_marcador?: string; // o marcador da lista com marcadores (padrão "•"); até 4 letras
  lista_recuo?: number; // onde o texto dos itens começa, em px (padrão: o maior marcador mais 40% do tamanho da letra)
  // seleção e layout (rodada 3, B2: src/nucleo/layout-imagem.ts e travas-imagem.ts)
  grupo?: string; // id do grupo: as camadas com o mesmo grupo são escolhidas e andam juntas (Ctrl+G)
  travada?: boolean; // não anda nem muda de tamanho na tela; patch da IA nela é recusado
  caber?: boolean; // texto: o maior tamanho que cabe na caixa (o `tamanho` fica de lado), igual na prévia, no PNG e no PDF
};

/** Sombra projetada, na direção da página (não gira com a camada). Desfoque e deslocamento em px do documento. */
export type Sombra = {cor?: string; opacidade?: number; desfoque?: number; x?: number; y?: number};

/** Como o traço se desenha, no contorno e na linha: sólido, tracejado ou pontilhado; pontas retas, redondas ou quadradas;
 *  junção redonda, pontuda ou chanfrada (o canto do retângulo, a dobra do texto). */
export type EstiloDeTraco = 'solido' | 'tracejado' | 'pontilhado';
export type PontaDeTraco = 'redonda' | 'reta' | 'quadrada';
export type JuncaoDeTraco = 'redonda' | 'pontuda' | 'chanfrada';
/** O que fica na ponta de uma linha. */
export type PontaDeSeta = 'nenhuma' | 'seta' | 'triangulo' | 'losango' | 'circulo' | 'barra';

/** Contorno: por fora (padrão), centrado na borda ou por dentro. Sólido, de pontas e junções redondas se não disser outra coisa. */
export type Contorno = {cor?: string; espessura: number; posicao?: 'fora' | 'centro' | 'dentro'; estilo?: EstiloDeTraco; pontas?: PontaDeTraco; juncao?: JuncaoDeTraco};

/** Linha ou seta (forma 'linha'): um segmento horizontal no meio da caixa, de ponta a ponta, que gira com `rotacao`. */
export type Linha = {espessura?: number; estilo?: EstiloDeTraco; pontas?: PontaDeTraco; juncao?: JuncaoDeTraco; inicio?: PontaDeSeta; fim?: PontaDeSeta; tamanho_seta?: number};

/** Parada do degradê: cor, posição de 0 a 1 e opacidade de 0 a 1. */
export type ParadaDegrade = {cor: string; posicao: number; opacidade?: number};

/** Degradê na caixa da camada (ou da prancheta). Linear: `angulo` como no CSS (180 = de cima para baixo, o padrão).
 *  Radial: elipse do centro (x e y de 0 a 1, padrão o meio) até o canto mais longe. */
export type Degrade = {tipo: 'linear' | 'radial'; angulo?: number; centro?: {x: number; y: number}; paradas: ParadaDegrade[]};

/** Uma página (prancheta) do carrossel: as camadas dela, no tamanho comum do documento. */
export type PaginaImagem = {
  id: string;
  nome: string;
  camadas: CamadaImagem[]; // de baixo para cima
};

// Uma prancheta só tem `camadas` na raiz (as capas e os projetos de antes). O carrossel tem `paginas`, cada uma
// com as suas camadas, e a lista `camadas` da raiz fica vazia. Documento sem `paginas` vale como uma página só, em
// memória, sem reescrever o arquivo (src/nucleo/carrossel.ts, docs/carrossel.md).
/** O kit que a imagem recebeu, copiado para o documento: `id` do kit, as cores por nome (fundo, texto, destaque, suave e
 *  o apoio) e as fontes. As cores "@destaque" das camadas se leem daqui (src/nucleo/cor-marca.ts), e ele diz de que kit
 *  vêm as cores e as fontes na hora de aplicar outro. */
export type MarcaDoDocumento = {id: string; nome?: string; cores: Record<string, string>; fontes: {titulo: string; texto: string; mono?: string}};

export type DocImagem = {
  formato: 1;
  largura: number;
  altura: number;
  fundo: string;
  camadas: CamadaImagem[]; // de baixo para cima; num carrossel fica vazia e cada página tem as suas
  paginas?: PaginaImagem[];
  efeitos?: Efeito[];
  fundo_degrade?: Degrade; // por cima da cor de `fundo`, em todas as páginas (acabamento, docs/imagem.md)
  marca?: MarcaDoDocumento; // o kit aplicado; cor "@destaque" numa camada vem daqui (frente Marca, rodada 3)
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

export type Documento = DocVideo | DocImagem | DocCena3D | DocMusica | DocAnimacao;

// ---------- comentários ----------
export type AlvoComentario = {
  objeto?: string; // caminho no documento (JSON Pointer), ex.: /cenas/2/blocos/1 ou /camadas/0 ou /objetos/1
  objeto_id?: string; // id estável do objeto, quando houver
  tempo_ms?: number; // vídeo: ms de saída
  ponto?: {x: number; y: number}; // 0 a 1, relativo ao quadro
  contexto?: string; // texto do objeto ou palavras da narração em volta, para reancorar
  pagina_id?: string; // imagem com várias páginas: id da página do objeto (o caminho muda quando as páginas mudam; B2, rodada 3)
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
  desfaz?: number; // frente IA (rodada 3): esta entrada reverteu a de seq indicado (Ctrl+Z, Reverter do cartão ou do Histórico)
  transicao?: string; // frente Música: feita durante a transição (levar_para), para o histórico agrupar e "Reverter tudo"
};

/** Estado do editor que o agente pode consultar (o app grava em .estudio/estado.json). */
export type EstadoEditor = {
  area: 'video' | 'imagem' | '3d' | 'efeitos' | 'musica' | 'animacao';
  documento?: string;
  selecao?: string; // caminho do objeto selecionado
  tempo_ms?: number;
  pagina?: string; // imagem com várias páginas: caminho da página ativa, ex.: /paginas/2
  atualizado_em: string;
  selecao_varias?: string[]; // imagem (B2, rodada 3): todos os caminhos da seleção múltipla, o principal primeiro
};

/** Documento de imagem (prancheta ou páginas). A animação também tem `camadas` e `largura`, mas não é imagem: as
 *  ferramentas e o kit da imagem gravariam nela campos que ela não lê. */
export const ehDocImagem = (doc: unknown): doc is DocImagem => {
  const d = doc as Partial<DocImagem> | null;
  return Boolean(d) && typeof d === 'object' && !ehDocAnimacao(d) && (Array.isArray(d!.camadas) || Array.isArray(d!.paginas)) && typeof d!.largura === 'number';
};
