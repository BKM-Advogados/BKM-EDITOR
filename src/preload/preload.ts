import {contextBridge, ipcRenderer, type IpcRendererEvent} from 'electron';
import {CANAL, type ApiEstudio, type Mudanca, type Progresso} from '../compartilhado/api';

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
  projetoAtual: () => ipcRenderer.invoke(CANAL.projetoAtual),
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
  exportarVideo: (documento) => ipcRenderer.invoke(CANAL.exportar, documento),
  exportarImagem: (documento, png) => ipcRenderer.invoke(CANAL.exportarImagem, documento, png),
  aoProgresso: (cb) => ouvir<[Progresso]>(CANAL.progresso, cb),
  metricas: () => ipcRenderer.invoke(CANAL.metricas),
};

contextBridge.exposeInMainWorld('estudio', api);
