import {contextBridge, ipcRenderer, type IpcRendererEvent} from 'electron';
import {CANAL, type ApiEstudio, type EventoConversa, type Mudanca, type PedidoPortaoTela, type Progresso, type ProgressoTranscricao, type Retangulo} from '../compartilhado/api';
import type {AndamentoNarracao} from '../nucleo/narracao-servico';
import type {EstadoAtualizacao} from '../compartilhado/atualizacao';

const ouvir = <A extends unknown[]>(canal: string, cb: (...a: A) => void) => {
  const h = (_e: IpcRendererEvent, ...a: A) => cb(...a);
  ipcRenderer.on(canal, h as never);
  return () => {
    ipcRenderer.removeListener(canal, h as never);
  };
};

const api: ApiEstudio = {
  abrirPasta: () => ipcRenderer.invoke(CANAL.abrirPasta),
  abrirExemplo: () => ipcRenderer.invoke(CANAL.abrirExemplo),
  temExemplo: () => ipcRenderer.invoke(CANAL.temExemplo),
  abrirProjeto: (raiz) => ipcRenderer.invoke(CANAL.abrirProjeto, raiz),
  projetoAtual: () => ipcRenderer.invoke(CANAL.projetoAtual),
  criarProjeto: (o) => ipcRenderer.invoke(CANAL.criarProjeto, o),
  fecharProjeto: () => ipcRenderer.invoke(CANAL.fecharProjeto),
  duplicarProjeto: (o) => ipcRenderer.invoke(CANAL.duplicarProjeto, o),
  renomearProjeto: (nome) => ipcRenderer.invoke(CANAL.renomearProjeto, nome),
  criarDocumento: (o) => ipcRenderer.invoke(CANAL.criarDocumento, o),
  renomearDocumento: (id, titulo) => ipcRenderer.invoke(CANAL.renomearDocumento, id, titulo),
  ambiente: () => ipcRenderer.invoke(CANAL.ambiente),
  recentes: () => ipcRenderer.invoke(CANAL.recentes),
  esquecerRecente: (raiz) => ipcRenderer.invoke(CANAL.esquecerRecente, raiz),
  preferencias: () => ipcRenderer.invoke(CANAL.preferencias),
  gravarPreferencias: (p) => ipcRenderer.invoke(CANAL.gravarPreferencias, p),
  escolherPasta: (titulo) => ipcRenderer.invoke(CANAL.escolherPasta, titulo),
  mostrarNaPasta: (caminho) => ipcRenderer.send(CANAL.mostrarNaPasta, caminho),
  marcarVersao: () => ipcRenderer.invoke(CANAL.marcarVersao),
  escolherMidia: (tipo) => ipcRenderer.invoke(CANAL.escolherMidia, tipo),
  // pedido e resposta: o processo principal manda um número e espera o retângulo de volta com o mesmo número
  aoPedirMiniatura: (cb) => ouvir<[number]>(CANAL.pedirMiniatura, (n) => {
    let r: Retangulo | null = null;
    try {
      r = cb();
    } catch {
      r = null;
    }
    ipcRenderer.send(CANAL.miniatura, n, r);
  }),
  lerDocumento: (documento) => ipcRenderer.invoke(CANAL.lerDocumento, documento),
  lerJson: (caminho) => ipcRenderer.invoke(CANAL.lerJson, caminho),
  lerJsonOpcional: (caminho) => ipcRenderer.invoke(CANAL.lerJson, caminho, {opcional: true}),
  aplicarPatch: (p) => ipcRenderer.invoke(CANAL.aplicarPatch, p),
  desfazer: () => ipcRenderer.invoke(CANAL.desfazer),
  propsVideo: (documento) => ipcRenderer.invoke(CANAL.propsVideo, documento),
  comentarios: () => ipcRenderer.invoke(CANAL.comentarios),
  novoComentario: (c) => ipcRenderer.invoke(CANAL.novoComentario, c),
  responder: (id, texto) => ipcRenderer.invoke(CANAL.responder, id, texto),
  resolverComentario: (id) => ipcRenderer.invoke(CANAL.resolverComentario, id),
  reabrir: (id) => ipcRenderer.invoke(CANAL.reabrir, id),
  diario: (desde) => ipcRenderer.invoke(CANAL.diario, desde),
  gravarEstado: (e) => ipcRenderer.send(CANAL.gravarEstado, e),
  aoMudar: (cb) => ouvir<[Mudanca]>(CANAL.mudou, cb),
  terminal: {
    criar: (o) => ipcRenderer.invoke(CANAL.terminalCriar, o),
    escrever: (id, dados) => ipcRenderer.send(CANAL.terminalEscrever, id, dados),
    tamanho: (id, c, l) => ipcRenderer.send(CANAL.terminalTamanho, id, c, l),
    fechar: (id) => ipcRenderer.send(CANAL.terminalFechar, id),
    aoReceber: (cb) => ouvir<[number, string]>(CANAL.terminalDados, cb),
    aoSair: (cb) => ouvir<[number, number]>(CANAL.terminalSaiu, cb),
  },
  conversa: {
    conta: () => ipcRenderer.invoke(CANAL.conversaConta),
    abrir: (o) => ipcRenderer.invoke(CANAL.conversaAbrir, o ?? {}),
    enviar: (id, texto) => ipcRenderer.invoke(CANAL.conversaEnviar, id, texto),
    permitir: (id, pedido, decisao, sempre) => ipcRenderer.send(CANAL.conversaPermitir, id, pedido, decisao, sempre),
    parar: (id) => ipcRenderer.send(CANAL.conversaParar, id),
    hibernar: (id) => ipcRenderer.invoke(CANAL.conversaHibernar, id),
    fechar: (id) => ipcRenderer.send(CANAL.conversaFechar, id),
    aoEvento: (cb) => ouvir<[number, EventoConversa]>(CANAL.conversaEvento, cb),
  },
  exportarVideo: (documento, opcoes) => ipcRenderer.invoke(CANAL.exportar, documento, opcoes),
  exportarImagem: (documento, dados, opcoes) => ipcRenderer.invoke(CANAL.exportarImagem, documento, dados, opcoes),
  aoProgresso: (cb) => ouvir<[Progresso]>(CANAL.progresso, cb),
  metricas: () => ipcRenderer.invoke(CANAL.metricas),
  atualizacao: {
    estado: () => ipcRenderer.invoke(CANAL.atualizacaoEstado),
    procurar: () => ipcRenderer.invoke(CANAL.atualizacaoProcurar),
    acao: (a) => ipcRenderer.invoke(CANAL.atualizacaoAcao, a),
    aoMudar: (cb) => ouvir<[EstadoAtualizacao]>(CANAL.atualizacaoMudou, cb),
    ocupado: (o) => ipcRenderer.send(CANAL.atualizacaoOcupado, o),
  },
  audio: {
    gravarEnvelope: (arquivo, envelope) => ipcRenderer.invoke(CANAL.audioGravarEnvelope, arquivo, envelope),
    listarTrilhas: () => ipcRenderer.invoke(CANAL.audioListarTrilhas),
    importarTrilha: (caminho) => ipcRenderer.invoke(CANAL.audioImportarTrilha, caminho),
    limparVoz: (arquivo, intensidade) => ipcRenderer.invoke(CANAL.audioLimparVoz, arquivo, intensidade),
    cancelarLimpeza: () => ipcRenderer.invoke(CANAL.audioLimpezaCancelar),
    aoProgressoLimpeza: (cb) => ouvir<[{arquivo: string; progresso: number}]>(CANAL.audioLimpezaProgresso, cb),
    medirLoudness: (documento) => ipcRenderer.invoke(CANAL.audioMedirLoudness, documento),
    medirEnvelope: (arquivo) => ipcRenderer.invoke(CANAL.audioMedirEnvelope, arquivo),
    salvarTomada: (wav) => ipcRenderer.invoke(CANAL.audioSalvarTomada, wav),
  },
  marcas: {
    listar: () => ipcRenderer.invoke(CANAL.marcasListar),
    gravar: (m) => ipcRenderer.invoke(CANAL.marcasGravar, m),
    criar: (nome) => ipcRenderer.invoke(CANAL.marcasCriar, nome),
    duplicar: (id, nome) => ipcRenderer.invoke(CANAL.marcasDuplicar, id, nome),
    importarLogo: (id) => ipcRenderer.invoke(CANAL.marcasImportarLogo, id),
    importarFonte: (id) => ipcRenderer.invoke(CANAL.marcasImportarFonte, id),
    aplicar: (id, documento) => ipcRenderer.invoke(CANAL.marcasAplicar, id, documento),
    fontesDoProjeto: () => ipcRenderer.invoke(CANAL.fontesDoProjeto),
  },
  modelos: {
    listar: () => ipcRenderer.invoke(CANAL.modelosListar),
    salvar: (o) => ipcRenderer.invoke(CANAL.modelosSalvar, o),
    renomear: (id, nome) => ipcRenderer.invoke(CANAL.modelosRenomear, id, nome),
    remover: (id) => ipcRenderer.invoke(CANAL.modelosRemover, id),
    criarProjeto: (o) => ipcRenderer.invoke(CANAL.modelosCriarProjeto, o),
  },
  exportarPaginas: (o) => ipcRenderer.invoke(CANAL.exportarPaginas, o),
  cancelarExportacao: () => ipcRenderer.send(CANAL.exportarCancelar),
  mostrarArquivo: (caminho) => ipcRenderer.send(CANAL.mostrarArquivo, caminho),
  pesquisa: () => ipcRenderer.invoke(CANAL.pesquisa),
  textoFonte: (fonteId, inicio, fim) => ipcRenderer.invoke(CANAL.textoFonte, fonteId, inicio, fim),
  abrirFonte: (url) => ipcRenderer.invoke(CANAL.abrirFonte, url),
  // frente Fala: transcrição local e legendas (src/main/transcricao.ts)
  fala: {
    estado: (modelo) => ipcRenderer.invoke(CANAL.falaEstado, modelo),
    transcrever: (p) => ipcRenderer.invoke(CANAL.falaTranscrever, p),
    cancelar: () => ipcRenderer.send(CANAL.falaCancelar),
    aoProgresso: (cb) => ouvir<[ProgressoTranscricao & {arquivo: string}]>(CANAL.falaProgresso, cb),
    gravarSaida: (nome, texto) => ipcRenderer.invoke(CANAL.falaGravarSaida, nome, texto),
    escolherLegenda: () => ipcRenderer.invoke(CANAL.falaEscolherLegenda),
    conferir: (arquivos) => ipcRenderer.invoke(CANAL.falaConferir, arquivos),
    emendar: (p) => ipcRenderer.invoke(CANAL.falaEmendar, p),
  },
  // exportação (frente C)
  prefsExportacao: () => ipcRenderer.invoke(CANAL.prefsExportacao),
  gravarPrefsExportacao: (p) => ipcRenderer.invoke(CANAL.gravarPrefsExportacao, p),
  medirContrasteMarca: (documento, pedido) => ipcRenderer.invoke(CANAL.medirContrasteMarca, documento, pedido),
  // acabamento da imagem (rodada 2, B2)
  removerFundo: {
    modelo: () => ipcRenderer.invoke(CANAL.removerFundoModelo),
    baixar: () => ipcRenderer.invoke(CANAL.removerFundoBaixar),
    ler: () => ipcRenderer.invoke(CANAL.removerFundoLer),
    gravar: (src, png) => ipcRenderer.invoke(CANAL.removerFundoGravar, src, png),
    aoProgresso: (cb) => ouvir<[{recebidos: number; total: number}]>(CANAL.removerFundoProgresso, cb),
    aoPedido: (cb) => ouvir<[string, string]>(CANAL.removerFundoPedido, cb),
    responder: (id, r) => ipcRenderer.send(CANAL.removerFundoResposta, id, r),
  },
  // frente Casca (rodada 3): painel de mídia
  midia: {
    indice: () => ipcRenderer.invoke(CANAL.midia),
    marcar: (caminho, mudanca) => ipcRenderer.invoke(CANAL.midiaMarcar, caminho, mudanca),
  },
  // frente IA
  ia: {
    provedores: () => ipcRenderer.invoke(CANAL.iaProvedores),
    gravarChave: (p, c) => ipcRenderer.invoke(CANAL.iaGravarChave, p, c),
    apagarChave: (p) => ipcRenderer.invoke(CANAL.iaApagarChave, p),
    modelos: (p) => ipcRenderer.invoke(CANAL.iaModelos, p),
    configurar: (p, c) => ipcRenderer.invoke(CANAL.iaConfigurar, p, c),
    padrao: (p) => ipcRenderer.invoke(CANAL.iaPadrao, p),
    usoDoMes: () => ipcRenderer.invoke(CANAL.iaUsoDoMes),
    modeloDaConversa: (id, m) => ipcRenderer.invoke(CANAL.conversaModelo, id, m),
    aoPedidoPortao: (cb) => ouvir<[PedidoPortaoTela]>(CANAL.iaPortaoPedido, cb),
    aoPortaoCancelado: (cb) => ouvir<[string]>(CANAL.iaPortaoCancelado, cb),
    responderPortao: (id, permitir, sempre) => ipcRenderer.send(CANAL.iaPortaoResposta, id, permitir, sempre),
    reverter: (seq, forcar) => ipcRenderer.invoke(CANAL.iaReverter, seq, forcar),
    apps: () => ipcRenderer.invoke(CANAL.iaApps),
    appsLigar: (l, p) => ipcRenderer.invoke(CANAL.iaAppsLigar, l, p),
    appsNovo: (n) => ipcRenderer.invoke(CANAL.iaAppsNovo, n),
    appsConfigs: (id) => ipcRenderer.invoke(CANAL.iaAppsConfigs, id),
    appsRevogar: (id) => ipcRenderer.invoke(CANAL.iaAppsRevogar, id),
    claudeDesktop: () => ipcRenderer.invoke(CANAL.iaClaudeDesktop),
    claudeDesktopConectar: () => ipcRenderer.invoke(CANAL.iaClaudeDesktopConectar),
    claudeDesktopDesconectar: () => ipcRenderer.invoke(CANAL.iaClaudeDesktopDesconectar),
    guardar: (id, c) => ipcRenderer.invoke(CANAL.iaGuardar, id, c),
    guardadas: () => ipcRenderer.invoke(CANAL.iaGuardadas),
    apagarGuardada: (s) => ipcRenderer.invoke(CANAL.iaApagarGuardada, s),
  },
  // narração por IA (docs/narracao.md)
  narracao: {
    estado: () => ipcRenderer.invoke(CANAL.narracaoEstado),
    gravarChave: (c) => ipcRenderer.invoke(CANAL.narracaoGravarChave, c),
    apagarChave: () => ipcRenderer.invoke(CANAL.narracaoApagarChave),
    vozes: (p, atualizar) => ipcRenderer.invoke(CANAL.narracaoVozes, p, atualizar),
    previa: (documento, o) => ipcRenderer.invoke(CANAL.narracaoPrevia, documento, o),
    gerar: (documento, o) => ipcRenderer.invoke(CANAL.narracaoGerar, documento, o),
    cancelar: () => ipcRenderer.send(CANAL.narracaoCancelar),
    aoAndamento: (cb) => ouvir<[AndamentoNarracao]>(CANAL.narracaoAndamento, cb),
    amostra: (config) => ipcRenderer.invoke(CANAL.narracaoAmostra, config),
  },
  ide: {
    estado: () => ipcRenderer.invoke(CANAL.ideEstado),
    abrirNoT3: () => ipcRenderer.invoke(CANAL.ideAbrirNoT3),
  },
  // carrossel em partes (rodada 3, B2)
  exportarPaginasEmPartes: {
    abrir: (o) => ipcRenderer.invoke(CANAL.exportarPaginasAbrir, o),
    parte: (sessao, pagina) => ipcRenderer.invoke(CANAL.exportarPaginasParte, sessao, pagina),
    fechar: (sessao) => ipcRenderer.invoke(CANAL.exportarPaginasFechar, sessao),
  },
  // frente Música
  musica: {
    levar: (p) => ipcRenderer.invoke(CANAL.musicaLevar, p),
    concluir: (t) => ipcRenderer.invoke(CANAL.musicaConcluir, t),
    cancelar: (t, descartar) => ipcRenderer.invoke(CANAL.musicaCancelar, t, descartar),
    depoisDeMudar: (documento) => ipcRenderer.invoke(CANAL.musicaDepoisDeMudar, documento),
    porNoVideo: (o) => ipcRenderer.invoke(CANAL.musicaPorNoVideo, o),
    exportar: (documento, pedido) => ipcRenderer.invoke(CANAL.musicaExportar, documento, pedido),
  },
  // ponte com a janela (05 §0.1)
  janela: {
    aoPedido: (cb) => ouvir<[string, string, unknown]>(CANAL.mcpPedido, cb),
    responder: (id, r) => ipcRenderer.send(CANAL.mcpResposta, id, r),
  },
};

contextBridge.exposeInMainWorld('estudio', api);
