// IPC dos kits de marca: a pasta marcas/ das preferências (listar, gravar, criar, duplicar, importar logo e fonte,
// aplicar ao documento) e as fontes próprias do projeto aberto. main.ts registra com uma linha; os handlers passam pelo
// mesmo `lidar` (origem confiável) dos outros canais. Também aponta o servidor de mídia e o MCP para a pasta certa e
// cria os kits de fábrica na primeira abertura.
import {dialog, type BrowserWindow} from 'electron';
import {CANAL, type MarcaInfo} from '../compartilhado/api';
import {EXTENSOES_FONTE, EXTENSOES_LOGO, type Marca} from '../nucleo/marca';
import {definirPastaMarcas, fontesDoProjeto, PastaMarcas, type MarcaLida} from '../nucleo/pasta-marcas';
import type {Projeto} from '../nucleo/projeto';
import type {Memoria} from './memoria';
import type {ServidorMidia} from './servidor-midia';

type Lidar = <A extends unknown[], R>(canal: string, f: (...a: A) => R | Promise<R>) => void;

export const registrarIpcMarcas = (o: {lidar: Lidar; janela: () => BrowserWindow | null; memoria: Memoria; midia: ServidorMidia; exigirProjeto: () => Projeto}) => {
  const pasta = () => o.memoria.prefs().pasta_marcas;
  const marcas = new PastaMarcas({pasta});
  definirPastaMarcas(pasta);
  o.midia.servirMarcas(pasta);
  try {
    marcas.garantir();
  } catch {
    /* disco indisponível agora: a lista tenta de novo quando a pessoa abrir o painel */
  }
  const info = (m: MarcaLida): MarcaInfo => ({...m, url: o.midia.urlMarca(m.id)});
  const escolher = async (titulo: string, filtro: {name: string; extensions: string[]}, varios = false) => {
    const r = await dialog.showOpenDialog(o.janela()!, {properties: varios ? ['openFile', 'multiSelections'] : ['openFile'], title: titulo, filters: [filtro]});
    return r.canceled ? [] : r.filePaths;
  };
  const semPonto = (exts: string[]) => exts.map((e) => e.slice(1));

  o.lidar(CANAL.marcasListar, () => {
    marcas.garantir();
    return marcas.listar().map(info);
  });
  o.lidar(CANAL.marcasGravar, (m: Marca) => info(marcas.gravar(m)));
  o.lidar(CANAL.marcasCriar, (nome: string) => info(marcas.criar(nome)));
  o.lidar(CANAL.marcasDuplicar, (id: string, nome: string) => info(marcas.duplicar(id, nome)));
  o.lidar(CANAL.marcasImportarLogo, async (id: string) => {
    const [arq] = await escolher('Logo da marca', {name: 'Imagens', extensions: semPonto(EXTENSOES_LOGO)});
    return arq ? info(marcas.importarLogo(id, arq)) : null;
  });
  o.lidar(CANAL.marcasImportarFonte, async (id: string) => {
    const arquivos = await escolher('Fontes da marca (pode escolher várias)', {name: 'Fontes', extensions: semPonto(EXTENSOES_FONTE)}, true);
    let m: MarcaLida | null = null;
    for (const arq of arquivos) m = marcas.importarFonte(id, arq);
    return m ? info(m) : null;
  });
  o.lidar(CANAL.marcasAplicar, (id: string, documento: string) => marcas.aplicar(o.exigirProjeto(), id, documento, {autor: 'pessoa', origem: 'interface'}));
  o.lidar(CANAL.fontesDoProjeto, () => fontesDoProjeto(o.exigirProjeto().raiz));
  return marcas;
};
