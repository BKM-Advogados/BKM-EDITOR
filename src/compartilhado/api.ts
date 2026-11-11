// Contrato entre a interface (renderer) e o processo principal. O preload expõe só isto em window.estudio; a interface
// não tem acesso a Node nem ao disco.
import type {Comentario, EntradaDiario, EntradaDocumento, EstadoEditor, Manifesto, Modulo, OperacaoPatch} from '../nucleo/documentos';
import type {IdModelo} from '../nucleo/modelos';
import type {Formato} from '../nucleo/formatos';
import type {Envelope, IntensidadeLimpeza, LimpezaClipe} from '../nucleo/audio';
import type {FichaFaixa} from '../nucleo/biblioteca-musicas';
import type {MedidasLoudness} from '../nucleo/loudness';
import type {FonteArquivo, Marca} from '../nucleo/marca';
import type {OpcoesExportarImagem, OpcoesExportarVideo, PrefsExportacao} from '../nucleo/exportacao';
import type {PedidoContrasteDestino, ResultadoContraste} from '../nucleo/contraste'; // só os tipos (frente C)
import type {Pesquisa} from '../nucleo/pesquisa';
import type {EstadoDaTomada, IndiceDaMidia, MarcaDeMidia} from '../nucleo/midia'; // frente Casca
import type {EstadoModeloFundo} from '../nucleo/remover-fundo';
import type {EstadoDaFala} from '../nucleo/legendas'; // frente Fala
import type {PedidoLevar, ResultadoConcluir, ResultadoLevar, ResultadoVolta} from '../nucleo/transicoes'; // frente Música
import type {PedidoExportarMusica, ResultadoExportarMusica} from '../nucleo/musica-projeto'; // frente Música

export const CANAL = {
  abrirPasta: 'estudio:abrir-pasta',
  abrirExemplo: 'estudio:abrir-exemplo',
  temExemplo: 'estudio:tem-exemplo',
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
  audioMedirEnvelope: 'estudio:audio-medir-envelope', // frente Som (rodada 3): arquivo grande medido no processo principal, em pedaços
  audioSalvarTomada: 'estudio:audio-salvar-tomada', // frente Som (rodada 3): a narração gravada na interface
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
  falaEmendar: 'estudio:fala-emendar', // cortes pela fala: grava a narração emendada (src/main/cortes-fala.ts)
  // preferências da exportação por projeto, .estudio/exportacao.json (src/main/ipc-exportacao.ts; frente C)
  prefsExportacao: 'estudio:prefs-exportacao',
  gravarPrefsExportacao: 'estudio:gravar-prefs-exportacao',
  medirContrasteMarca: 'estudio:medir-contraste-marca', // contraste da marca d'água com o fundo, num quadro de verdade (src/main/contraste-marca.ts)
  // acabamento da imagem (rodada 2, B2): remover fundo com modelo local (src/main/remover-fundo.ts)
  removerFundoModelo: 'estudio:remover-fundo-modelo',
  removerFundoBaixar: 'estudio:remover-fundo-baixar',
  removerFundoLer: 'estudio:remover-fundo-ler',
  removerFundoGravar: 'estudio:remover-fundo-gravar',
  removerFundoProgresso: 'estudio:remover-fundo-progresso',
  removerFundoPedido: 'estudio:remover-fundo-pedido',
  removerFundoResposta: 'estudio:remover-fundo-resposta',
  // frente Casca (rodada 3): painel de mídia (src/main/ipc-midia.ts, docs/casca.md)
  midia: 'estudio:midia',
  midiaMarcar: 'estudio:midia-marcar',
  iaProvedores: 'estudio:ia-provedores', // frente IA
  iaGravarChave: 'estudio:ia-gravar-chave',
  iaApagarChave: 'estudio:ia-apagar-chave',
  iaModelos: 'estudio:ia-modelos',
  iaConfigurar: 'estudio:ia-configurar',
  iaPadrao: 'estudio:ia-padrao',
  iaUsoDoMes: 'estudio:ia-uso-do-mes',
  conversaModelo: 'estudio:conversa-modelo',
  iaPortaoPedido: 'estudio:ia-portao-pedido',
  iaPortaoResposta: 'estudio:ia-portao-resposta',
  iaPortaoCancelado: 'estudio:ia-portao-cancelado',
  iaReverter: 'estudio:ia-reverter',
  iaApps: 'estudio:ia-apps',
  iaAppsLigar: 'estudio:ia-apps-ligar',
  iaAppsNovo: 'estudio:ia-apps-novo',
  iaAppsConfigs: 'estudio:ia-apps-configs',
  iaAppsRevogar: 'estudio:ia-apps-revogar',
  iaGuardar: 'estudio:ia-guardar',
  iaGuardadas: 'estudio:ia-guardadas',
  iaApagarGuardada: 'estudio:ia-apagar-guardada',
  // carrossel exportado em partes (rodada 3, B2, imagem-D19): src/main/exportar-paginas.ts
  exportarPaginasAbrir: 'estudio:exportar-paginas-abrir',
  exportarPaginasParte: 'estudio:exportar-paginas-parte',
  exportarPaginasFechar: 'estudio:exportar-paginas-fechar',
  // frente Música: ida e volta com o vídeo e o render ligado (src/main/ipc-musica.ts, docs/musica.md)
  musicaLevar: 'estudio:musica-levar',
  musicaConcluir: 'estudio:musica-concluir',
  musicaCancelar: 'estudio:musica-cancelar',
  musicaDepoisDeMudar: 'estudio:musica-depois-de-mudar',
  musicaPorNoVideo: 'estudio:musica-por-no-video',
  musicaExportar: 'estudio:musica-exportar', // frente Música: a música em arquivo (item 23)
  // ponte com a janela (05 §0.1, src/main/ponte-janela.ts): o processo principal pede uma ação à janela e espera
  mcpPedido: 'estudio:mcp-pedido',
  mcpResposta: 'estudio:mcp-resposta',
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
  /** Se esta instalação traz o projeto de exemplo (src/nucleo/exemplo.ts); sem ele, a interface não mostra "Ver um pronto". */
  temExemplo: () => Promise<boolean>;
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
  /** O mesmo, para arquivo que pode não existir (transições, seleção pedida pela IA): ausente ou sem projeto, null. */
  lerJsonOpcional: <T = unknown>(caminho: string) => Promise<T | null>;
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
    /** Mede o envelope de um arquivo grande no processo principal, sem decodificá-lo inteiro, e o grava ao lado (carimbado); devolve-o. */
    medirEnvelope: (arquivo: string) => Promise<Envelope>;
    /** Grava a tomada que a interface capturou (WAV PCM 48 kHz) em midia/; devolve o caminho no projeto. */
    salvarTomada: (wav: ArrayBuffer) => Promise<string>;
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
    aplicar: (id: string, documento: string) => Promise<{versao: string; marca: string; nome: string; copiados: string[]; atualizados: string[]}>;
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
    escolherLegenda: () => Promise<{nome: string; texto: string; codificacao?: string} | null>;
    /** Por arquivo de áudio: 'em_dia' (a transcrição é do áudio como ele está), 'velha' (a tomada mudou) ou 'falta'. */
    conferir: (arquivos: string[]) => Promise<Record<string, EstadoDaFala>>;
    /** Cortes pela fala: grava o WAV emendado e o palavras.json dele; o patch do documento é da interface. */
    emendar: (p: PedidoEmenda) => Promise<ResultadoEmenda>;
  };
  // exportação (frente C): a escolha de marca d'água por destino, lembrada no projeto
  prefsExportacao: () => Promise<PrefsExportacao>;
  /** Junta por destino ao que já estava e devolve o arquivo inteiro. */
  gravarPrefsExportacao: (p: PrefsExportacao) => Promise<PrefsExportacao>;
  /** Renderiza três quadros do destino sem a marca e com ela e mede o contraste (mínimo 3:1); leva alguns segundos. */
  medirContrasteMarca: (documento: string, pedido: PedidoContrasteDestino) => Promise<ResultadoContraste>;
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
  // frente Casca (rodada 3): painel de mídia (docs/casca.md)
  midia: {
    /** A lista de midia/ com os derivados sob o original, as pastas e as marcas das tomadas. */
    indice: () => Promise<IndiceDaMidia>;
    /** Marca a tomada (boa, descartada, ou null para tirar a marca) e/ou a nota; grava midia/marcas.json e entra no diário como da pessoa. */
    marcar: (caminho: string, mudanca: {estado?: EstadoDaTomada | null; nota?: string}) =>
      Promise<{seq: number; documento: string; caminho: string; marca: MarcaDeMidia | null}>;
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
    /** Portão de permissão: pedidos de qualquer IA (conversa, terminal, app de fora) e a resposta da pessoa. */
    aoPedidoPortao: (cb: (p: PedidoPortaoTela) => void) => () => void;
    aoPortaoCancelado: (cb: (id: string) => void) => () => void;
    responderPortao: (id: string, permitir: boolean, sempre?: boolean) => void;
    /** Reverte uma entrada do diário pelo seq; forcar passa por cima de mudança feita depois. */
    reverter: (seq: number, forcar?: boolean) => Promise<ResultadoReverter>;
    /** Apps de IA de fora: ligar a porta, criar um app (devolve a configuração com o token), rever e revogar. */
    apps: () => Promise<EstadoAppsDeFora>;
    appsLigar: (ligado: boolean, porta?: number) => Promise<EstadoAppsDeFora>;
    appsNovo: (nome: string) => Promise<{id: string; configs: ConfigsDoApp}>;
    appsConfigs: (id: string) => Promise<ConfigsDoApp>;
    appsRevogar: (id: string) => Promise<EstadoAppsDeFora>;
    /** Conversas guardadas por projeto (F6): gravar a conversa aberta, listar as guardadas e apagar uma. */
    guardar: (id: number, c: {titulo: string; itens: unknown[]; uso?: unknown}) => Promise<string | null>;
    guardadas: () => Promise<ConversaGuardadaTela[]>;
    apagarGuardada: (sessao: string) => Promise<void>;
  };
  // carrossel em partes (rodada 3, B2, imagem-D19): uma página por vez, cada PNG vai ao disco ao chegar e o PDF sai no fechar
  exportarPaginasEmPartes: {
    abrir: (o: {documento: string; pdf: boolean}) => Promise<{sessao: string}>;
    parte: (sessao: string, pagina: {png: string; numero: number}) => Promise<boolean>;
    fechar: (sessao: string) => Promise<ResultadoExportarPaginas>;
  };
  // frente Música (docs/musica.md): as mesmas funções das ferramentas levar_para, concluir_transicao, cancelar_transicao
  // e por_no_video, com autor "pessoa"; depoisDeMudar leva o render aos clipes do vídeo ligados à música
  musica: {
    levar: (p: PedidoLevar) => Promise<ResultadoLevar>;
    concluir: (transicao: string) => Promise<ResultadoConcluir>;
    cancelar: (transicao: string, descartar?: boolean) => Promise<{transicao: string; revertidas: number; volta: ResultadoVolta; avisos: string[]}>;
    depoisDeMudar: (documento: string) => Promise<{trocados: {video: string; clipe: string}[]; renderizado: boolean; aviso?: string}>;
    porNoVideo: (o: {musica: string; video?: string; faixa?: string; em_ms?: number; substituir?: string}) => Promise<{documento: string; caminho: string}>;
    /** A mesma conta de exportar_musica: grava em saidas/ (WAV, M4A, Opus ou MIDI, stems em WAV). */
    exportar: (documento: string, pedido: PedidoExportarMusica) => Promise<ResultadoExportarMusica>;
  };
  // ponte com a janela (05 §0.1): pedidos do processo principal ({id, acao, dados}); a janela responde pelo id
  janela: {
    aoPedido: (cb: (id: string, acao: string, dados: unknown) => void) => () => void;
    responder: (id: string, r: RespostaJanela) => void;
  };
};

/** Resposta da janela a um pedido do processo principal (ponte com a janela). */
export type RespostaJanela = {ok: boolean; dados?: unknown; mensagem?: string};

// ---------- frente Fala ----------
/** Pedido de transcrição: um arquivo do projeto (normalmente midia/…), o trecho opcional e o modelo. */
export type PedidoTranscricao = {arquivo: string; de_ms?: number; dur_ms?: number; modelo?: 'base' | 'small'; idioma?: string; destino?: string;
  vocabulario?: string; // vocabulario: o começo de conversa do whisper (padrão: termos do direito do trabalho)
  pela_ia?: boolean; // pedido pelo MCP: o andamento na tela diz que foi a IA
  termos?: string[]}; // o dicionário do vídeo, acrescentado ao vocabulário
export type ProgressoTranscricao = {etapa: 'baixando' | 'audio' | 'transcrevendo' | 'pronto' | 'cancelado'; mensagem: string; progresso?: number; pela_ia?: boolean};
export type ResultadoTranscricao = {ok: boolean; arquivo: string; palavras?: string; n?: number; modelo?: string; duracao_s?: number; texto?: string; cancelado?: boolean; mensagem?: string};
/** Cortes pela fala: a fonte (caminho no projeto), os cortes em ms do arquivo e as palavras dela (ms do arquivo). */
export type PedidoEmenda = {fonte: string; cortes: {de_ms: number; ate_ms: number}[]; palavras: {w: string; s: number; e: number}[]};
export type ResultadoEmenda = {arquivo: string; palavras: string; sha256?: string; duracao_ms: number; antes_ms: number; removidas: string[]};
export type EstadoTranscricao = {pasta: string; modelo: string; modelos: {id: string; nome: string; mb: number; instalado: boolean}[]; pronto: boolean; falta: string[];
  ffmpeg: boolean; ocupado?: string;
  /** dá para transcrever neste sistema: o Windows x64 baixa o whisper-cli; os outros precisam de um já compilado */
  plataforma: boolean;
  /** sem plataforma: o que falta e como instalar */
  aviso?: string};

/** Um arquivo da pasta de trilhas: nome sem extensão, caminho absoluto, subpasta e tamanho. */
/** `ficha`: a licença conferida da faixa (biblioteca-musicas.ts); `recusa`: a ficha existe mas não serve (NC, ND, sem crédito…). */
export type Trilha = {nome: string; caminho: string; pasta: string; tamanho_kb: number; ficha?: FichaFaixa; recusa?: string};

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
  cofre_persistente?: boolean; cofre_texto?: string}; // cofre_texto: onde a chave fica (ou por que só vale na sessão) neste sistema
/** Resultado de gravar uma chave: testada na lista de modelos do provedor (não gasta token). */
export type ResultadoChave = {ok: boolean; mensagem: string; persistente?: boolean; modelos?: string[]};
export type ResultadoModelos = {ok: true; modelos: string[]} | {ok: false; status?: number; rede?: boolean; mensagem: string};
/** Pedido do portão de permissão do MCP (src/nucleo/portao.ts) para a tela: de qual aba, qual ferramenta e por quê. */
export type PedidoPortaoTela = {id: string; origem: string; ferramenta: string; motivo: string; entrada: Record<string, unknown>};
export type ResultadoReverter = {ok: true; seq: number; rotulo: string} | {ok: false; mensagem: string; mudou_depois?: boolean};
/** Apps de IA de fora (padrão Screenpipe): a porta fixa só em 127.0.0.1 e os apps com token próprio. */
export type EstadoAppsDeFora = {ligado: boolean; porta: number; ouvindo: boolean; erro?: string; apps: {id: string; nome: string; criado_em: string}[]};
/** A configuração pronta para colar no app de fora, por HTTP e por stdio (com a ponte do próprio Estúdio). */
export type ConfigsDoApp = {http: string; stdio: string};
/** Conversa guardada no projeto (.estudio/conversas/): o que a tela desenha e de quem é. */
export type ConversaGuardadaTela = {sessao: string; provedor: string; titulo: string; modelo?: string; criada_em: string; atualizada_em: string;
  itens: unknown[]; uso?: unknown};
/** Soma do mês por provedor, no PC: tokens e custo estimado pela tabela de preços. */
export type UsoDoMes = Record<string, {entrada: number; cache: number; saida: number; custo_usd: number; turnos: number}>;

declare global {
  interface Window {
    estudio: ApiEstudio;
  }
}
