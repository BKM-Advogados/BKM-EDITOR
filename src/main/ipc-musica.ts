// IPC da música: a tela chama as mesmas funções das ferramentas MCP (levar_para, concluir_transicao, cancelar_transicao,
// por_no_video), com autor "pessoa" e origem "interface", então o Ctrl+Z da pessoa desfaz o "Concluir e voltar". O
// render da música para o vídeo (src/main/musica-render.ts) fica registrado aqui também para o MCP por HTTP do app. Na
// abertura do projeto, os renders que faltam no disco são gravados e as sobras saem. Registrado no main.ts com uma linha.
import {CANAL} from '../compartilhado/api';
import {baseDoProjeto, definirServicoMusica, depoisDeMudarMusica, porNoVideo, servicoMusica} from '../nucleo/musica-projeto';
import type {Projeto} from '../nucleo/projeto';
import {cancelarTransicao, concluirTransicao, levarPara, type PedidoLevar} from '../nucleo/transicoes';
import {acertarRenders, servicoDeRender} from './musica-render';

type Lidar = <A extends unknown[], R>(canal: string, f: (...a: A) => R | Promise<R>) => void;

const servico = () => servicoMusica() ?? (definirServicoMusica(servicoDeRender()), servicoMusica()!);

/** Depois de abrir o projeto, em segundo plano: nunca atrasa nem impede a abertura. */
export const aoAbrirMusica = (p: Projeto) => {
  setTimeout(() => void acertarRenders(p, servico()).catch(() => undefined), 1500);
};

export const registrarIpcMusica = (lidar: Lidar, projeto: () => Projeto) => {
  servico();
  const base = () => baseDoProjeto(projeto(), 'pessoa', 'interface');
  const levarAoVideo = async (id: string) => {
    const r = await depoisDeMudarMusica(projeto(), id);
    return {trocados: r.trocados.map(({video, clipe}) => ({video, clipe})), renderizado: r.renderizado, ...('aviso' in r && r.aviso ? {aviso: r.aviso} : {})};
  };
  lidar(CANAL.musicaLevar, (p: PedidoLevar) => levarPara(base(), p));
  lidar(CANAL.musicaConcluir, async (transicao: string) => {
    const r = concluirTransicao(base(), {transicao});
    if (r.musica) {
      const d = await levarAoVideo(r.musica);
      if (d.aviso) r.avisos.push(d.aviso);
    }
    return r;
  });
  lidar(CANAL.musicaCancelar, (transicao: string, descartar?: boolean) => cancelarTransicao(base(), {transicao, descartar}));
  lidar(CANAL.musicaDepoisDeMudar, (documento: string) => levarAoVideo(documento));
  lidar(CANAL.musicaPorNoVideo, async (o: {musica: string; video?: string; faixa?: string; em_ms?: number; substituir?: string}) => {
    const r = porNoVideo(projeto(), o, {autor: 'pessoa', origem: 'interface'});
    await levarAoVideo(r.musica);
    return {documento: r.documento, caminho: r.caminho};
  });
};
