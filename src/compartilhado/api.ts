// Contrato entre a interface (renderer) e o processo principal. O preload expõe só isto em window.estudio; a interface
// não tem acesso a Node nem ao disco.
import type {Comentario, EntradaDiario, EntradaDocumento, EstadoEditor, Manifesto, Modulo, OperacaoPatch} from '../nucleo/documentos';
import type {IdModelo} from '../nucleo/modelos';
import type {Formato} from '../nucleo/formatos';

export const CANAL = {
  abrirPasta: 'estudio:abrir-pasta',
  abrirExemplo: 'estudio:abrir-exemplo',
  abrirProjeto: 'estudio:abrir-projeto',
  projetoAtual: 'estudio:projeto-atual',
  criarProjeto: 'estudio:criar-projeto',
  fecharProjeto: 'estudio:fechar-projeto',
  duplicarProjeto: 'estudio:duplicar-projeto',
  renomearProjeto: 'estudio:renomear-projeto',
  criarDocumento: 'estudio:criar-documento',
  renomearDocumento: 'estudio:renomear-documento',
  recentes: 'estudio:recentes',
  esquecerRecente: 'estudio:esquecer-recente',
  preferencias: 'estudio:preferencias',
  gravarPreferencias: 'estudio:gravar-preferencias',
  escolherPasta: 'estudio:escolher-pasta',
  mostrarNaPasta: 'estudio:mostrar-na-pasta',
  marcarVersao: 'estudio:marcar-versao',
  escolherMidia: 'estudio:escolher-midia',
  pedirMiniatura: 'estudio:pedir-miniatura',
  miniatura: 'estudio:miniatura',
  ambiente: 'estudio:ambiente',
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
  conversaConta: 'estudio:conversa-conta',
  conversaAbrir: 'estudio:conversa-abrir',
  conversaEnviar: 'estudio:conversa-enviar',
  conversaPermitir: 'estudio:conversa-permitir',
  conversaParar: 'estudio:conversa-parar',
  conversaHibernar: 'estudio:conversa-hibernar',
  conversaFechar: 'estudio:conversa-fechar',
  conversaEvento: 'estudio:conversa-evento',
  exportar: 'estudio:exportar',
  exportarImagem: 'estudio:exportar-imagem',
  progresso: 'estudio:progresso',
  metricas: 'estudio:metricas',
} as const;

/** O projeto aberto. `estado` é o último que a pessoa viu (área, documento, seleção), para reabrir onde parou; `git`
 *  diz se há pontos de restauração; `aviso` traz o que a pessoa precisa saber ao abrir (pasta no OneDrive). */
export type InfoProjeto = {raiz: string; manifesto: Manifesto; base_midia: string; claude: boolean; perfil: Perfil; git: boolean; estado?: EstadoEditor | null;
  aviso?: string};

/** O que a tela inicial mostra antes de qualquer projeto: perfil da máquina, Git e Claude instalados, versão do app. */
export type Ambiente = {perfil: Perfil; git: boolean; claude: boolean; versao: string; pasta_padrao: string};

export type Recente = {raiz: string; nome: string; aberto_em: string; existe: boolean; modulos: Modulo[]; miniatura?: string};

export type Preferencias = {pasta_projetos: string; ao_iniciar: 'inicio' | 'ultimo'; formato_video: string; formato_imagem: string; boas_vindas_vista: boolean};

export type NovoProjeto = {nome?: string; modelo: IdModelo; formato?: Formato | {largura: number; altura: number}; pasta?: string; formato_id?: string};

/** Retângulo da tela (px CSS da janela) que vira a miniatura do projeto na tela inicial. */
export type Retangulo = {x: number; y: number; width: number; height: number};

/** Perfil de desempenho pela RAM da máquina (docs/desempenho.md): leve até 8 GB, padrão até 16 GB, forte acima. */
export type Perfil = {nome: 'leve' | 'padrao' | 'forte'; sessoes_claude: number; escala_previa: number; pixel_ratio: number};

export type Lido<T = unknown> = {doc: T; versao: string};

export type PropsVideo = {props: Record<string, unknown> & {duracao_ms: number}; avisos: string[]} | {erro: string};

export type Mudanca = {arquivo: string; autor?: string};

export type Metricas = {memoria_mb: number; processos: {tipo: string; memoria_mb: number; cpu: number}[]};

export type Progresso = {tipo: 'status' | 'progresso'; mensagem?: string; etapa?: string; progresso?: number};

/** Login do Claude Code da pessoa, lido de `claude auth status`. chave_api: há ANTHROPIC_API_KEY, que no modo -p tem prioridade. */
export type ContaClaude = {instalado: boolean; logado: boolean; metodo: string; email?: string; plano?: string; chave_api: boolean};

/** O que a conversa com o Claude (claude -p, stream-json) manda para a interface desenhar. */
export type EventoConversa =
  | {tipo: 'pronto'; sessao: string; modelo?: string}
  | {tipo: 'estado'; estado: string}
  | {tipo: 'texto'; delta: string}
  | {tipo: 'mensagem'; texto: string}
  | {tipo: 'ferramenta'; uso: string; nome: string; entrada: Record<string, unknown>}
  | {tipo: 'resultado'; uso: string; ok: boolean; texto: string}
  | {tipo: 'permissao'; pedido: string; ferramenta: string; entrada: Record<string, unknown>; titulo?: string; motivo?: string; pode_sempre: boolean}
  | {tipo: 'permissao-cancelada'; pedido: string}
  | {tipo: 'fim'; erro: boolean; texto?: string; custo_usd?: number; duracao_ms?: number}
  | {tipo: 'hibernou'}
  | {tipo: 'saiu'; codigo: number | null; detalhe?: string}
  | {tipo: 'erro'; mensagem: string};

export type ApiEstudio = {
  abrirPasta: () => Promise<InfoProjeto | null>;
  abrirExemplo: () => Promise<InfoProjeto>;
  abrirProjeto: (raiz: string) => Promise<InfoProjeto>;
  projetoAtual: () => Promise<InfoProjeto | null>;
  criarProjeto: (o: NovoProjeto) => Promise<InfoProjeto>;
  fecharProjeto: () => Promise<void>;
  duplicarProjeto: (o: {raiz?: string; nome: string}) => Promise<InfoProjeto>;
  renomearProjeto: (nome: string) => Promise<Manifesto>;
  criarDocumento: (o: {modulo: Modulo; formato?: Formato | {largura: number; altura: number}; titulo?: string}) => Promise<EntradaDocumento>;
  renomearDocumento: (id: string, titulo: string) => Promise<EntradaDocumento>;
  ambiente: () => Promise<Ambiente>;
  recentes: () => Promise<Recente[]>;
  esquecerRecente: (raiz: string) => Promise<void>;
  preferencias: () => Promise<Preferencias>;
  gravarPreferencias: (p: Partial<Preferencias>) => Promise<Preferencias>;
  escolherPasta: (titulo?: string) => Promise<string | null>;
  mostrarNaPasta: (caminho?: string) => void;
  marcarVersao: () => Promise<{ok: boolean; mensagem: string}>;
  /** Escolhe um arquivo e copia para midia/ do projeto; devolve o caminho no projeto ("midia/foto.jpg"). */
  escolherMidia: (tipo: 'imagem' | 'audio' | 'video') => Promise<string | null>;
  /** O processo principal pede o retângulo da miniatura antes de fechar o projeto ou a janela. */
  aoPedirMiniatura: (cb: () => Retangulo | null) => () => void;
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
  // o Claude como conversa: o mesmo claude da pessoa no modo sem tela; `sessao` retoma uma conversa existente
  conversa: {
    conta: () => Promise<ContaClaude>;
    abrir: (o?: {sessao?: string}) => Promise<{id: number; sessao: string}>;
    enviar: (id: number, texto: string) => Promise<void>;
    permitir: (id: number, pedido: string, decisao: 'permitir' | 'negar', sempre?: boolean) => void;
    parar: (id: number) => void;
    hibernar: (id: number) => Promise<string | null>;
    fechar: (id: number) => void;
    aoEvento: (cb: (id: number, e: EventoConversa) => void) => () => void;
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
