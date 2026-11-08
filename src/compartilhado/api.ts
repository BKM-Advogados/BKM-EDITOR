// Contrato entre a interface (renderer) e o processo principal. O preload expõe só isto em window.estudio; a interface
// não tem acesso a Node nem ao disco.
import type {Comentario, EntradaDiario, EntradaDocumento, EstadoEditor, Manifesto, Modulo, OperacaoPatch} from '../nucleo/documentos';
import type {IdModelo} from '../nucleo/modelos';
import type {Formato} from '../nucleo/formatos';
import type {Envelope, IntensidadeLimpeza, LimpezaClipe} from '../nucleo/audio';
import type {MedidasLoudness} from '../nucleo/loudness';
import type {FonteArquivo, Marca} from '../nucleo/marca';
import type {OpcoesExportarImagem, OpcoesExportarVideo, PrefsExportacao} from '../nucleo/exportacao';
import type {Pesquisa} from '../nucleo/pesquisa';
import type {EstadoModeloFundo} from '../nucleo/remover-fundo';
import type {EstadoDaFala} from '../nucleo/legendas'; // frente Fala

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
  // som do vídeo de cenas (src/main/ipc-audio.ts)
  audioGravarEnvelope: 'estudio:audio-gravar-envelope',
  audioListarTrilhas: 'estudio:audio-listar-trilhas',
  audioImportarTrilha: 'estudio:audio-importar-trilha',
  // limpeza de voz e medidor de loudness (src/main/limpeza-voz.ts e loudness.ts)
  audioLimparVoz: 'estudio:audio-limpar-voz',
  audioLimpezaCancelar: 'estudio:audio-limpeza-cancelar',
  audioLimpezaProgresso: 'estudio:audio-limpeza-progresso',
  audioMedirLoudness: 'estudio:audio-medir-loudness',
  marcasListar: 'estudio:marcas-listar',
  marcasGravar: 'estudio:marcas-gravar',
  marcasCriar: 'estudio:marcas-criar',
  marcasDuplicar: 'estudio:marcas-duplicar',
  marcasImportarLogo: 'estudio:marcas-importar-logo',
  marcasImportarFonte: 'estudio:marcas-importar-fonte',
  marcasAplicar: 'estudio:marcas-aplicar',
  fontesDoProjeto: 'estudio:fontes-do-projeto',
  exportarPaginas: 'estudio:exportar-paginas',
  exportarCancelar: 'estudio:exportar-cancelar',
  mostrarArquivo: 'estudio:mostrar-arquivo',
  // pesquisa do projeto (pesquisa/pesquisa.json e pesquisa/fontes/), só leitura na interface
  pesquisa: 'estudio:pesquisa',
  textoFonte: 'estudio:texto-fonte',
  abrirFonte: 'estudio:abrir-fonte',
  // frente Fala: transcrição local e legendas (src/main/transcricao.ts, docs/legendas.md)
  falaEstado: 'estudio:fala-estado',
  falaTranscrever: 'estudio:fala-transcrever',
  falaCancelar: 'estudio:fala-cancelar',
  falaProgresso: 'estudio:fala-progresso',
  falaGravarSaida: 'estudio:fala-gravar-saida',
  falaEscolherLegenda: 'estudio:fala-escolher-legenda',
  falaConferir: 'estudio:fala-conferir', // a transcrição ainda é do áudio como ele está (carimbo do palavras.json)
  // preferências da exportação por projeto, .estudio/exportacao.json (src/main/ipc-exportacao.ts; frente C)
  prefsExportacao: 'estudio:prefs-exportacao',
  gravarPrefsExportacao: 'estudio:gravar-prefs-exportacao',
  // acabamento da imagem (rodada 2, B2): remover fundo com modelo local (src/main/remover-fundo.ts)
  removerFundoModelo: 'estudio:remover-fundo-modelo',
  removerFundoBaixar: 'estudio:remover-fundo-baixar',
  removerFundoLer: 'estudio:remover-fundo-ler',
  removerFundoGravar: 'estudio:remover-fundo-gravar',
  removerFundoProgresso: 'estudio:remover-fundo-progresso',
  removerFundoPedido: 'estudio:remover-fundo-pedido',
  removerFundoResposta: 'estudio:remover-fundo-resposta',
  iaProvedores: 'estudio:ia-provedores', // frente IA
  iaGravarChave: 'estudio:ia-gravar-chave',
  iaApagarChave: 'estudio:ia-apagar-chave',
  iaModelos: 'estudio:ia-modelos',
  iaConfigurar: 'estudio:ia-configurar',
  iaPadrao: 'estudio:ia-padrao',
  iaUsoDoMes: 'estudio:ia-uso-do-mes',
  conversaModelo: 'estudio:conversa-modelo',
} as const;

/** O projeto aberto. `estado` é o último que a pessoa viu (área, documento, seleção), para reabrir onde parou; `git`
 *  diz se há pontos de restauração; `aviso` traz o que a pessoa precisa saber ao abrir (pasta no OneDrive). */
export type InfoProjeto = {raiz: string; manifesto: Manifesto; base_midia: string; claude: boolean; perfil: Perfil; git: boolean; estado?: EstadoEditor | null;
  aviso?: string};

/** O que a tela inicial mostra antes de qualquer projeto: perfil da máquina, Git e Claude instalados, versão do app. */
export type Ambiente = {perfil: Perfil; git: boolean; claude: boolean; versao: string; pasta_padrao: string};

export type Recente = {raiz: string; nome: string; aberto_em: string; existe: boolean; modulos: Modulo[]; miniatura?: string};

export type Preferencias = {pasta_projetos: string; ao_iniciar: 'inicio' | 'ultimo'; formato_video: string; formato_imagem: string; boas_vindas_vista: boolean;
  pasta_trilhas: string; // biblioteca de músicas e efeitos da pessoa (padrão: Estudio/trilhas)
  pasta_marcas: string};

/** `marca` é o id do kit de marca que entra no tema do documento novo (sem ele, o tema neutro). */
export type NovoProjeto = {nome?: string; modelo: IdModelo; formato?: Formato | {largura: number; altura: number}; pasta?: string; formato_id?: string; marca?: string};

/** Kit de marca como a interface o vê: o kit, a pasta dele e o endereço no servidor local (logo e fontes para a prévia). */
export type MarcaInfo = Marca & {pasta: string; url: string};

/** Retângulo da tela (px CSS da janela) que vira a miniatura do projeto na tela inicial. */
export type Retangulo = {x: number; y: number; width: number; height: number};

/** Perfil de desempenho pela RAM da máquina (docs/desempenho.md): leve até 8 GB, padrão até 16 GB, forte acima. */
export type Perfil = {nome: 'leve' | 'padrao' | 'forte'; sessoes_claude: number; escala_previa: number; pixel_ratio: number};

export type Lido<T = unknown> = {doc: T; versao: string};

export type PropsVideo = {props: Record<string, unknown> & {duracao_ms: number}; avisos: string[]} | {erro: string};

export type Mudanca = {arquivo: string; autor?: string};

export type Metricas = {memoria_mb: number; processos: {tipo: string; memoria_mb: number; cpu: number}[]};

/** Andamento da exportação; `arquivo`, `indice` e `total` dizem qual dos arquivos está saindo quando são vários. */
export type Progresso = {tipo: 'status' | 'progresso'; mensagem?: string; etapa?: string; progresso?: number; arquivo?: string; indice?: number; total?: number};

/** Saída da exportação: os arquivos gravados em saidas/ (o primeiro repetido em `arquivo`), a pasta e, se parou antes, por quê. */
export type ResultadoExportacao = {ok: boolean; arquivo?: string; arquivos?: string[]; pasta?: string; mensagem?: string; cancelado?: boolean};

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
  // tokens do turno (entrada inclui a parte que veio do cache); custo_usd quando o próprio provedor informa
  | {tipo: 'uso'; entrada: number; entrada_cache: number; saida: number; custo_usd?: number}
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
    abrir: (o?: {sessao?: string; provedor?: string; modelo?: string}) => Promise<{id: number; sessao: string; provedor: string; rotulo: string}>;
    enviar: (id: number, texto: string) => Promise<void>;
    permitir: (id: number, pedido: string, decisao: 'permitir' | 'negar', sempre?: boolean) => void;
    parar: (id: number) => void;
    hibernar: (id: number) => Promise<string | null>;
    fechar: (id: number) => void;
    aoEvento: (cb: (id: number, e: EventoConversa) => void) => () => void;
  };
  /** Vídeo em saidas/: sem opções, MP4 H.264 no formato do documento; com elas, um arquivo por destino. O andamento sai em aoProgresso. */
  exportarVideo: (documento: string, opcoes?: OpcoesExportarVideo) => Promise<ResultadoExportacao>;
  /** Imagem já desenhada pela interface (data URL); o formato dá a extensão do arquivo. */
  exportarImagem: (documento: string, dados: string, opcoes?: OpcoesExportarImagem) => Promise<{ok: boolean; arquivo?: string; pasta?: string}>;
  aoProgresso: (cb: (p: Progresso) => void) => () => void;
  metricas: () => Promise<Metricas>;
  // som do vídeo de cenas: envelope medido pela interface, biblioteca de trilhas
  audio: {
    /** Grava midia/<arquivo>.envelope.json; devolve o caminho gravado. */
    gravarEnvelope: (arquivo: string, envelope: Envelope) => Promise<string>;
    listarTrilhas: () => Promise<{pasta: string; trilhas: Trilha[]}>;
    /** Copia uma trilha da biblioteca para midia/; devolve o caminho no projeto. */
    importarTrilha: (caminho: string) => Promise<string>;
    /** Limpa a voz de um arquivo do projeto em midia/<arquivo>.limpo.wav (o original fica intacto); uma por vez. */
    limparVoz: (arquivo: string, intensidade: IntensidadeLimpeza) => Promise<ResultadoLimpezaVoz>;
    /** Para a limpeza em andamento (o limparVoz resolve com cancelado: true); false se não havia nenhuma. */
    cancelarLimpeza: () => Promise<boolean>;
    aoProgressoLimpeza: (cb: (p: {arquivo: string; progresso: number}) => void) => () => void;
    /** Loudness da mistura, da narração e de cada faixa do vídeo, como o render vai soar (BS.1770). */
    medirLoudness: (documento: string) => Promise<MedidasLoudness | {erro: string}>;
  };
  // kits de marca (pasta marcas/ das preferências) e as fontes próprias do projeto aberto (pasta fontes/)
  marcas: {
    listar: () => Promise<MarcaInfo[]>;
    gravar: (m: Marca) => Promise<MarcaInfo>;
    criar: (nome: string) => Promise<MarcaInfo>;
    duplicar: (id: string, nome: string) => Promise<MarcaInfo>;
    /** Diálogo de arquivo; null se a pessoa cancelou. */
    importarLogo: (id: string) => Promise<MarcaInfo | null>;
    importarFonte: (id: string) => Promise<MarcaInfo | null>;
    /** Copia logo e fontes para o projeto e troca o tema do documento (vai para o diário). */
    aplicar: (id: string, documento: string) => Promise<{versao: string; marca: string; nome: string; copiados: string[]}>;
    fontesDoProjeto: () => Promise<FonteArquivo[]>;
  };
  /** Carrossel: PNG por página em saidas/<nome>/01.png… e, com `pdf`, saidas/<nome>.pdf (uma página por imagem, sem margem). */
  exportarPaginas: (o: PedidoExportarPaginas) => Promise<ResultadoExportarPaginas>;
  cancelarExportacao: () => void; // para a exportação em andamento; o exportarVideo resolve com cancelado: true
  mostrarArquivo: (caminho: string) => void; // abre a pasta com o arquivo marcado
  // pesquisa (docs/pesquisa.md): a interface só lê; quem lê fontes e registra fatos é o Claude, pelo MCP
  /** pesquisa/pesquisa.json (vazia se a pasta pesquisa/ ainda não existe). */
  pesquisa: () => Promise<Pesquisa>;
  /** Texto limpo da fonte (pesquisa/fontes/<id>.txt), inteiro ou o recorte inicio..fim; falha se o texto não está na pasta. */
  textoFonte: (fonteId: string, inicio?: number, fim?: number) => Promise<string>;
  /** Abre a url da fonte no navegador da pessoa; só http e https (devolve false para o resto). */
  abrirFonte: (url: string) => Promise<boolean>;
  // frente Fala (docs/legendas.md): transcrição local com o whisper.cpp e as legendas do vídeo de cenas
  fala: {
    /** O que está instalado (binário, modelos, ffmpeg) e o que ainda baixa no primeiro uso. */
    estado: (modelo?: string) => Promise<EstadoTranscricao>;
    /** Transcreve um arquivo do projeto e grava <arquivo>.palavras.json; o andamento sai em aoProgresso. */
    transcrever: (p: PedidoTranscricao) => Promise<ResultadoTranscricao>;
    cancelar: () => void;
    aoProgresso: (cb: (p: ProgressoTranscricao & {arquivo: string}) => void) => () => void;
    /** Grava texto em saidas/<nome> (SRT, VTT); devolve o caminho absoluto. */
    gravarSaida: (nome: string, texto: string) => Promise<string>;
    /** Diálogo para escolher um .srt ou .vtt; devolve nome e texto (null se cancelou). */
    escolherLegenda: () => Promise<{nome: string; texto: string} | null>;
    /** Por arquivo de áudio: 'em_dia' (a transcrição é do áudio como ele está), 'velha' (a tomada mudou) ou 'falta'. */
    conferir: (arquivos: string[]) => Promise<Record<string, EstadoDaFala>>;
  };
  // exportação (frente C): a escolha de marca d'água por destino, lembrada no projeto
  prefsExportacao: () => Promise<PrefsExportacao>;
  /** Junta por destino ao que já estava e devolve o arquivo inteiro. */
  gravarPrefsExportacao: (p: PrefsExportacao) => Promise<PrefsExportacao>;
  // acabamento da imagem (rodada 2, B2): o modelo baixa no primeiro uso; a interface roda o ONNX e o main grava o PNG
  removerFundo: {
    modelo: () => Promise<EstadoModeloFundo>;
    /** Baixa o modelo se faltar (o andamento sai em aoProgresso). */
    baixar: () => Promise<EstadoModeloFundo>;
    /** Os bytes do modelo, com o SHA-256 conferido. */
    ler: () => Promise<Uint8Array>;
    /** Grava o PNG (data URL) em midia/<arquivo>.<código>.sem-fundo.png; devolve o caminho no projeto. */
    gravar: (src: string, png: string) => Promise<string>;
    aoProgresso: (cb: (p: {recebidos: number; total: number}) => void) => () => void;
    /** Pedido da ferramenta remover_fundo do MCP: a interface calcula e devolve por responder. */
    aoPedido: (cb: (id: string, src: string) => void) => () => void;
    responder: (id: string, r: RespostaFundo) => void;
  };
  // frente IA: o catálogo de provedores com o que falta para usar cada um
  ia: {
    provedores: () => Promise<EstadoProvedor[]>;
    gravarChave: (provedor: string, chave: string) => Promise<ResultadoChave>;
    apagarChave: (provedor: string) => Promise<void>;
    modelos: (provedor: string) => Promise<ResultadoModelos>;
    configurar: (provedor: string, c: {modelo?: string; base?: string}) => Promise<{modelo?: string; base?: string}>;
    padrao: (provedor: string) => Promise<void>;
    usoDoMes: () => Promise<UsoDoMes>;
    /** Seletor de modelo da conversa aberta: vale na próxima mensagem. */
    modeloDaConversa: (id: number, modelo?: string) => Promise<void>;
  };
};

// ---------- frente Fala ----------
/** Pedido de transcrição: um arquivo do projeto (normalmente midia/…), o trecho opcional e o modelo. */
export type PedidoTranscricao = {arquivo: string; de_ms?: number; dur_ms?: number; modelo?: 'base' | 'small'; idioma?: string; destino?: string;
  vocabulario?: string}; // vocabulario: o começo de conversa do whisper (padrão: termos do direito do trabalho)
export type ProgressoTranscricao = {etapa: 'baixando' | 'audio' | 'transcrevendo' | 'pronto' | 'cancelado'; mensagem: string; progresso?: number};
export type ResultadoTranscricao = {ok: boolean; arquivo: string; palavras?: string; n?: number; modelo?: string; duracao_s?: number; texto?: string; cancelado?: boolean; mensagem?: string};
export type EstadoTranscricao = {pasta: string; modelo: string; modelos: {id: string; nome: string; mb: number; instalado: boolean}[]; pronto: boolean; falta: string[];
  ffmpeg: boolean; ocupado?: string; plataforma: boolean};

/** Um arquivo da pasta de trilhas: nome sem extensão, caminho absoluto, subpasta e tamanho. */
export type Trilha = {nome: string; caminho: string; pasta: string; tamanho_kb: number};

/** Voz limpa: o arquivo gravado (caminho no projeto), o que foi medido antes e depois e a duração; ou a pessoa cancelou. */
export type ResultadoLimpezaVoz = {arquivo: string; medidas: LimpezaClipe; duracao_ms: number} | {cancelado: true};

/** Páginas já desenhadas pela interface (PNG em data URL) com o número que aparece no nome do arquivo (1 = 01.png). */
export type PedidoExportarPaginas = {documento: string; paginas: {png: string; numero: number}[]; pdf: boolean};
export type ResultadoExportarPaginas = {ok: boolean; pasta?: string; pdf?: string; arquivos?: string[]; mostrar?: string; mensagem?: string};

/** O PNG sem fundo (data URL) que a interface devolve a um pedido do MCP, com o tempo do modelo. */
export type RespostaFundo = {ok: boolean; png?: string; ms?: number; mensagem?: string};

// ---------- frente IA ----------
/** Um provedor do catálogo e o que falta para usar (a chave nunca vem: só a origem e os 4 últimos caracteres). */
export type EstadoProvedor = {id: string; nome: string; via: 'claude-cli' | 'openai' | 'acp'; servidor: string; experimental?: boolean; modelo?: string;
  base?: string; paginaChave?: string; chave: 'exigida' | 'opcional' | 'nenhuma'; pronto: boolean; falta?: string;
  chave_origem?: 'cofre' | 'ambiente' | 'nenhuma'; chave_final?: string; chave_variavel?: string; local?: boolean; padrao?: boolean;
  cofre_persistente?: boolean};
/** Resultado de gravar uma chave: testada na lista de modelos do provedor (não gasta token). */
export type ResultadoChave = {ok: boolean; mensagem: string; persistente?: boolean; modelos?: string[]};
export type ResultadoModelos = {ok: true; modelos: string[]} | {ok: false; status?: number; rede?: boolean; mensagem: string};
/** Soma do mês por provedor, no PC: tokens e custo estimado pela tabela de preços. */
export type UsoDoMes = Record<string, {entrada: number; cache: number; saida: number; custo_usd: number; turnos: number}>;

declare global {
  interface Window {
    estudio: ApiEstudio;
  }
}
