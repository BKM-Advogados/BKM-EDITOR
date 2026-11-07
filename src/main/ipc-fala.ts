// IPC da frente Fala (docs/legendas.md): a transcrição local (transcricao.ts, que não depende do Electron e serve também
// ao MCP), gravar o SRT e o VTT em saidas/ e o diálogo para importar uma legenda. Registrado no main.ts com uma linha;
// entrega o transcritor ao MCP por HTTP, que o usa na ferramenta `transcrever`.
import {dialog, ipcMain, type BrowserWindow, type IpcMainEvent} from 'electron';
import {readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {CANAL} from '../compartilhado/api';
import {ErroProjeto, type Projeto} from '../nucleo/projeto';
import {definirTranscritorMcp} from './mcp-http';
import {registrarIpcTranscricao, type Buscar} from './transcricao';

type Lidar = <A extends unknown[], R>(canal: string, f: (...a: A) => R | Promise<R>) => void;
const LIMITE_LEGENDA = 5 * 1024 * 1024;

export const registrarIpcFala = (o: {lidar: Lidar; confiavel: (e: IpcMainEvent) => void; janela: () => BrowserWindow | null; projeto: () => Projeto;
  enviar: (canal: string, ...a: unknown[]) => void; raizApp: string; empacotado: boolean; buscar?: Buscar}) => {
  const transcritor = registrarIpcTranscricao(o.lidar, {
    projeto: o.projeto, enviar: o.enviar, raizApp: o.raizApp, empacotado: o.empacotado, buscar: o.buscar,
    aoCancelar: (f) => ipcMain.on(CANAL.falaCancelar, (e) => {
      o.confiavel(e);
      f();
    }),
  });
  // só o nome do arquivo: a legenda sempre cai em saidas/ do projeto, com o nome que a interface montou
  o.lidar(CANAL.falaGravarSaida, (nome: string, texto: string) => {
    const base = path.basename(String(nome ?? ''));
    if (!/\.(srt|vtt)$/i.test(base) || typeof texto !== 'string') throw new ErroProjeto('só grava .srt ou .vtt em saidas/', 'caminho');
    const p = o.projeto();
    p.gravarTexto(`saidas/${base}`, texto);
    return p.caminho(`saidas/${base}`);
  });
  o.lidar(CANAL.falaEscolherLegenda, async () => {
    const j = o.janela();
    const opcoes = {title: 'Importar legendas', properties: ['openFile' as const], filters: [{name: 'Legendas', extensions: ['srt', 'vtt']}]};
    const r = j ? await dialog.showOpenDialog(j, opcoes) : await dialog.showOpenDialog(opcoes);
    const arquivo = r.filePaths[0];
    if (r.canceled || !arquivo) return null;
    if (statSync(arquivo).size > LIMITE_LEGENDA) throw new ErroProjeto('o arquivo de legenda passa de 5 MB', 'caminho');
    return {nome: path.basename(arquivo), texto: readFileSync(arquivo, 'utf-8')};
  });
  definirTranscritorMcp(transcritor);
  return transcritor;
};
