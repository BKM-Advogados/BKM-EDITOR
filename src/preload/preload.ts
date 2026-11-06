import {contextBridge, ipcRenderer, type IpcRendererEvent} from 'electron';
import {CANAL, type ApiEstudio, type EventoConversa, type Mudanca, type Progresso, type Retangulo} from '../compartilhado/api';

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
  audio: {
    gravarEnvelope: (arquivo, envelope) => ipcRenderer.invoke(CANAL.audioGravarEnvelope, arquivo, envelope),
    listarTrilhas: () => ipcRenderer.invoke(CANAL.audioListarTrilhas),
    importarTrilha: (caminho) => ipcRenderer.invoke(CANAL.audioImportarTrilha, caminho),
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
  exportarPaginas: (o) => ipcRenderer.invoke(CANAL.exportarPaginas, o),
  cancelarExportacao: () => ipcRenderer.send(CANAL.exportarCancelar),
  mostrarArquivo: (caminho) => ipcRenderer.send(CANAL.mostrarArquivo, caminho),
};

contextBridge.exposeInMainWorld('estudio', api);
