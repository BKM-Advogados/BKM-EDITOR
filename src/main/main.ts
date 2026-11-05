// Processo principal do Estúdio: uma janela, o projeto aberto, os terminais, o servidor de mídia e a exportação.
import {app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent} from 'electron';
import {cpSync, existsSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {CANAL, type InfoProjeto, type Metricas, type Perfil, type Progresso} from '../compartilhado/api';
import type {Comentario, EstadoEditor, OperacaoPatch} from '../nucleo/documentos';
import {ErroProjeto} from '../nucleo/projeto';
import {exportarVideo} from './exportar';
import {McpHttp} from './mcp-http';
import {ServidorMidia} from './servidor-midia';
import {SessaoProjeto} from './sessao-projeto';
import {Terminais} from './terminais';

// teste de ponta a ponta: o script de e2e se conecta à janela pelo protocolo de depuração do Chromium
if (process.env.ESTUDIO_DEPURAR_PORTA) app.commandLine.appendSwitch('remote-debugging-port', process.env.ESTUDIO_DEPURAR_PORTA);

const GB = os.totalmem() / 1024 ** 3;
const PERFIL: Perfil = GB <= 8.5
  ? {nome: 'leve', sessoes_claude: 2, escala_previa: 0.5, pixel_ratio: 1}
  : GB <= 16.5 ? {nome: 'padrao', sessoes_claude: 4, escala_previa: 0.75, pixel_ratio: 1.5} : {nome: 'forte', sessoes_claude: 8, escala_previa: 1, pixel_ratio: 2};

let janela: BrowserWindow | null = null;
let sessao: SessaoProjeto | null = null;
let claude = false;
const desfeitos = new Set<number>();
const midia = new ServidorMidia();
let mcpHttp: McpHttp | null = null;
let abasClaude = 0;
const enviar = (canal: string, ...a: unknown[]) => janela?.webContents.send(canal, ...a);
const terminais = new Terminais({dados: (id, d) => enviar(CANAL.terminalDados, id, d), saiu: (id, c) => enviar(CANAL.terminalSaiu, id, c)});

const recursos = (rel: string) => (app.isPackaged ? path.join(process.resourcesPath, rel) : path.join(app.getAppPath(), rel));

const confiavel = (e: IpcMainInvokeEvent | Electron.IpcMainEvent) => {
  if (!janela || e.sender.id !== janela.webContents.id) throw new Error('chamada de IPC de origem desconhecida');
};
const exigirProjeto = () => {
  if (!sessao) throw new ErroProjeto('nenhum projeto aberto', 'nao_achado');
  return sessao.projeto;
};

const info = (): InfoProjeto | null =>
  sessao ? {raiz: sessao.projeto.raiz, manifesto: sessao.projeto.manifesto(), base_midia: midia.base, claude, perfil: PERFIL} : null;

const abrirProjeto = async (raiz: string) => {
  if (!existsSync(path.join(raiz, 'estudio.json'))) throw new Error(`não é um projeto do Estúdio (falta estudio.json): ${raiz}`);
  terminais.fecharTodos();
  await sessao?.fechar();
  desfeitos.clear();
  sessao = new SessaoProjeto(raiz, (arquivo) => enviar(CANAL.mudou, {arquivo}));
  midia.servir(raiz);
  await sessao.abrir();
  return info()!;
};

const criarJanela = () => {
  janela = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1100,
    minHeight: 640,
    show: false,
    backgroundColor: '#17191b',
    title: 'Estúdio',
    autoHideMenuBar: true,
    webPreferences: {contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.js')},
  });
  janela.webContents.setWindowOpenHandler(({url}) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return {action: 'deny'};
  });
  janela.once('ready-to-show', () => janela?.show());
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) void janela.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else void janela.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
};

const lidar = <A extends unknown[], R>(canal: string, f: (...a: A) => R | Promise<R>) =>
  ipcMain.handle(canal, async (e, ...a) => {
    confiavel(e);
    return f(...(a as A));
  });

lidar(CANAL.abrirPasta, async () => {
  const r = await dialog.showOpenDialog(janela!, {properties: ['openDirectory'], title: 'Abrir projeto do Estúdio'});
  return r.canceled || !r.filePaths[0] ? null : abrirProjeto(r.filePaths[0]);
});
lidar(CANAL.abrirExemplo, async () => {
  const destino = path.join(app.getPath('documents'), 'Estudio', 'exemplo');
  if (!existsSync(path.join(destino, 'estudio.json'))) cpSync(recursos(path.join('exemplos', 'exemplo')), destino, {recursive: true});
  return abrirProjeto(destino);
});
lidar(CANAL.projetoAtual, () => info());
lidar(CANAL.lerDocumento, (documento: string) => {
  const p = exigirProjeto();
  return p.lerJson(p.arquivoDoDocumento(documento));
});
lidar(CANAL.lerJson, (caminho: string) => exigirProjeto().lerJson(caminho).doc);
lidar(CANAL.aplicarPatch, (o: {documento: string; versao_base?: string; patch: OperacaoPatch[]; rotulo?: string}) => {
  const r = exigirProjeto().aplicarPatch({...o, autor: 'pessoa', origem: 'interface'});
  return {versao: r.versao, seq: r.entrada.seq};
});
lidar(CANAL.desfazer, () => {
  const p = exigirProjeto();
  const minhas = p.diario().filter((e) => e.autor === 'pessoa' && e.origem === 'interface' && !desfeitos.has(e.seq));
  const ultima = minhas[minhas.length - 1];
  if (!ultima) return {ok: false, mensagem: 'nada seu para desfazer'};
  try {
    p.aplicarPatch({documento: ultima.documento, versao_base: ultima.versao_depois, patch: ultima.inverso, autor: 'pessoa', origem: 'desfazer', rotulo: `desfazer: ${ultima.rotulo}`});
    desfeitos.add(ultima.seq);
    return {ok: true, mensagem: `desfeito: ${ultima.rotulo}`};
  } catch {
    return {ok: false, mensagem: 'o documento mudou depois (talvez pelo agente); desfaça pelo histórico'};
  }
});
lidar(CANAL.propsVideo, (documento: string) => {
  exigirProjeto();
  return sessao!.propsVideo(documento, midia.base);
});
lidar(CANAL.comentarios, () => exigirProjeto().comentarios());
lidar(CANAL.novoComentario, (c: Pick<Comentario, 'documento' | 'texto' | 'alvo'>) => exigirProjeto().novoComentario({...c, autor: 'pessoa'}));
lidar(CANAL.responder, (id: string, texto: string) => exigirProjeto().responder(id, 'pessoa', texto));
lidar(CANAL.resolverComentario, (id: string) => exigirProjeto().resolver(id, 'pessoa'));
lidar(CANAL.reabrir, (id: string) => exigirProjeto().reabrir(id));
lidar(CANAL.diario, (desde?: number) => exigirProjeto().diario(desde ?? 0).slice(-200));
lidar(CANAL.terminalCriar, (o: {tipo: 'claude' | 'shell'; colunas: number; linhas: number; sessao?: string}) =>
  terminais.criar({...o, cwd: exigirProjeto().raiz, limiteClaude: PERFIL.sessoes_claude,
    arquivoMcp: o.tipo === 'claude' ? mcpHttp!.novaAba(midia.origem, `Claude ${++abasClaude}`) : undefined}));
lidar(CANAL.exportar, async (documento: string) => {
  const p = exigirProjeto();
  const montado = sessao!.propsVideo(documento, midia.base);
  if ('erro' in montado) return {ok: false, mensagem: montado.erro};
  const r = await dialog.showSaveDialog(janela!, {defaultPath: path.join(p.raiz, `${documento}.mp4`), filters: [{name: 'Vídeo MP4', extensions: ['mp4']}]});
  if (r.canceled || !r.filePath) return {ok: false, mensagem: 'cancelado'};
  const aviso = (x: Progresso) => {
    enviar(CANAL.progresso, x);
    if (x.tipo === 'progresso' && x.progresso !== undefined) janela?.setProgressBar(x.progresso / 100);
  };
  try {
    const arquivo = await exportarVideo({raizApp: app.getAppPath(), empacotado: app.isPackaged, props: montado.props, arquivo: r.filePath, aviso});
    shell.showItemInFolder(arquivo);
    aviso({tipo: 'status', mensagem: `Exportado: ${arquivo}`});
    return {ok: true, arquivo};
  } catch (e) {
    aviso({tipo: 'status', mensagem: `Falhou: ${(e as Error).message}`});
    return {ok: false, mensagem: (e as Error).message};
  } finally {
    janela?.setProgressBar(-1);
  }
});
lidar(CANAL.exportarImagem, async (documento: string, png: string) => {
  const p = exigirProjeto();
  const r = await dialog.showSaveDialog(janela!, {defaultPath: path.join(p.raiz, `${documento}.png`), filters: [{name: 'Imagem PNG', extensions: ['png']}]});
  if (r.canceled || !r.filePath) return {ok: false};
  writeFileSync(r.filePath, Buffer.from(png.replace(/^data:image\/png;base64,/, ''), 'base64'));
  shell.showItemInFolder(r.filePath);
  return {ok: true, arquivo: r.filePath};
});
lidar(CANAL.metricas, (): Metricas => {
  const processos = app.getAppMetrics().map((m) => ({tipo: m.type, memoria_mb: Math.round(m.memory.workingSetSize / 1024), cpu: Math.round(m.cpu.percentCPUUsage)}));
  return {memoria_mb: processos.reduce((s, x) => s + x.memoria_mb, 0), processos};
});

ipcMain.on(CANAL.gravarEstado, (e, estado: Omit<EstadoEditor, 'atualizado_em'>) => {
  confiavel(e);
  try {
    sessao?.projeto.gravarEstado({...estado, atualizado_em: new Date().toISOString()});
  } catch {
    /* estado é só conveniência para o agente */
  }
});
ipcMain.on(CANAL.terminalEscrever, (e, id: number, d: string) => (confiavel(e), terminais.escrever(id, d)));
ipcMain.on(CANAL.terminalTamanho, (e, id: number, c: number, l: number) => (confiavel(e), terminais.tamanho(id, c, l)));
ipcMain.on(CANAL.terminalFechar, (e, id: number) => (confiavel(e), terminais.fechar(id)));

app.on('ready', async () => {
  await midia.iniciar();
  mcpHttp = new McpHttp(path.join(app.getPath('userData'), 'mcp'), () => sessao?.projeto ?? null);
  midia.rota((req, res) => mcpHttp!.atender(req, res));
  claude = await terminais.preparar();
  criarJanela();
  const inicial = process.env.ESTUDIO_PROJETO;
  if (inicial) await abrirProjeto(path.resolve(inicial)).catch(() => undefined);
});

app.on('window-all-closed', () => {
  terminais.fecharTodos();
  mcpHttp?.esquecerTudo();
  void sessao?.fechar();
  midia.parar();
  app.quit();
});

