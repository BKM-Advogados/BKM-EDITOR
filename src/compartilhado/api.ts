// Contrato entre a interface (renderer) e o processo principal. O preload expõe só isto em window.estudio; a interface
// não tem acesso a Node nem ao disco.
import type {Comentario, EntradaDiario, EstadoEditor, Manifesto, OperacaoPatch} from '../nucleo/documentos';

export const CANAL = {
  abrirPasta: 'estudio:abrir-pasta',
  abrirExemplo: 'estudio:abrir-exemplo',
  projetoAtual: 'estudio:projeto-atual',
  lerDocumento: 'estudio:ler-documento',
  lerJson: 'estudio:ler-json',
  aplicarPatch: 'estudio:aplicar-patch',
  desfazer: 'estudio:desfazer',
  propsVideo: 'estudio:props-video',
  comentarios: 'estudio:comentarios',
  novoComentario: 'estudio:novo-comentario',
  responder: 'estudio:responder',
  resolverComentario: 'estudio:resolver-comentario',
  reabrir: 'estudio:reabrir',
  diario: 'estudio:diario',
  gravarEstado: 'estudio:gravar-estado',
  mudou: 'estudio:mudou',
  terminalCriar: 'estudio:terminal-criar',
  terminalEscrever: 'estudio:terminal-escrever',
  terminalTamanho: 'estudio:terminal-tamanho',
  terminalFechar: 'estudio:terminal-fechar',
  terminalDados: 'estudio:terminal-dados',
  terminalSaiu: 'estudio:terminal-saiu',
  exportar: 'estudio:exportar',
  exportarImagem: 'estudio:exportar-imagem',
  progresso: 'estudio:progresso',
  metricas: 'estudio:metricas',
} as const;

export type InfoProjeto = {raiz: string; manifesto: Manifesto; base_midia: string; claude: boolean; perfil: Perfil};

/** Perfil de desempenho pela RAM da máquina (docs/desempenho.md): leve até 8 GB, padrão até 16 GB, forte acima. */
export type Perfil = {nome: 'leve' | 'padrao' | 'forte'; sessoes_claude: number; escala_previa: number; pixel_ratio: number};

export type Lido<T = unknown> = {doc: T; versao: string};

export type PropsVideo = {props: Record<string, unknown> & {duracao_ms: number}; avisos: string[]} | {erro: string};

export type Mudanca = {arquivo: string; autor?: string};

export type Metricas = {memoria_mb: number; processos: {tipo: string; memoria_mb: number; cpu: number}[]};

export type Progresso = {tipo: 'status' | 'progresso'; mensagem?: string; etapa?: string; progresso?: number};

export type ApiEstudio = {
  abrirPasta: () => Promise<InfoProjeto | null>;
  abrirExemplo: () => Promise<InfoProjeto>;
  projetoAtual: () => Promise<InfoProjeto | null>;
  lerDocumento: <T = unknown>(documento: string) => Promise<Lido<T>>;
  lerJson: <T = unknown>(caminho: string) => Promise<T>; // qualquer JSON do projeto, só leitura (ex.: palavras da narração)
  aplicarPatch: (p: {documento: string; versao_base?: string; patch: OperacaoPatch[]; rotulo?: string}) => Promise<{versao: string; seq: number}>;
  desfazer: () => Promise<{ok: boolean; mensagem: string}>;
  propsVideo: (documento: string) => Promise<PropsVideo>;
  comentarios: () => Promise<Comentario[]>;
  novoComentario: (c: Pick<Comentario, 'documento' | 'texto' | 'alvo'>) => Promise<Comentario>;
  responder: (id: string, texto: string) => Promise<Comentario>;
  resolverComentario: (id: string) => Promise<Comentario>;
  reabrir: (id: string) => Promise<Comentario>;
  diario: (desde?: number) => Promise<EntradaDiario[]>;
  gravarEstado: (e: Omit<EstadoEditor, 'atualizado_em'>) => void;
  aoMudar: (cb: (m: Mudanca) => void) => () => void;
  terminal: {
    // claude: `sessao` retoma uma sessão hibernada (claude --resume); sem ela, nasce uma nova com id gerado pelo app
    criar: (o: {tipo: 'claude' | 'shell'; colunas: number; linhas: number; sessao?: string}) => Promise<{id: number; sessao?: string}>;
    escrever: (id: number, dados: string) => void;
    tamanho: (id: number, colunas: number, linhas: number) => void;
    fechar: (id: number) => void;
    aoReceber: (cb: (id: number, dados: string) => void) => () => void;
    aoSair: (cb: (id: number, codigo: number) => void) => () => void;
  };
  exportarVideo: (documento: string) => Promise<{ok: boolean; arquivo?: string; mensagem?: string}>;
  exportarImagem: (documento: string, pngBase64: string) => Promise<{ok: boolean; arquivo?: string}>;
  aoProgresso: (cb: (p: Progresso) => void) => () => void;
  metricas: () => Promise<Metricas>;
};

declare global {
  interface Window {
    estudio: ApiEstudio;
  }
}
