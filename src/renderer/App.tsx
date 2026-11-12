// Tela inicial ou editor. A casca (dockview, Remotion, Player) só carrega quando um projeto abre: a tela inicial parada
// fica leve. O processo principal abre sozinho o projeto da linha de comando ou, se a pessoa preferir, o último.
import React, {Suspense, useEffect, useRef} from 'react';
import type {DocImagem} from '../nucleo/documentos';
import {caminhoPagina, paginasDe} from '../nucleo/carrossel';
import {abrirProjeto, caminhosDaSelecao, loja, observarProjeto, useLoja} from './estado/loja';
import {estadoDaMusica, musica} from './modulos/musica/estado'; // frente Música
import {ligarPonteDaJanela} from './ponte-janela';
import {ligarPreviasDaJanela} from './previas-janela'; // frente 3 do MCP: ver_imagem e ver_cena_3d
import {Inicio} from './inicio/Inicio';
import {RaizDialogo} from './componentes/Dialogo';
import {ConfigIA} from './paineis/ConfigIA'; // frente IA: Configurações › IA
import {registrarFontesDoProjeto} from './casca/fontes-do-projeto';
import {AvisoAtualizacao} from './componentes/AvisoAtualizacao'; // atualização do app (docs/atualizacao.md)

const Casca = React.lazy(() => import('./casca/Casca').then((m) => ({default: m.Casca})));

// a miniatura do projeto na tela inicial é o que está no monitor (a peça, sem a moldura cinza em volta)
const retanguloDaMiniatura = () => {
  const el = document.querySelector<HTMLElement>('.monitor .palco, .monitor canvas, .monitor');
  const r = el?.getBoundingClientRect();
  return r && r.width > 16 && r.height > 16 ? {x: r.left, y: r.top, width: r.width, height: r.height} : null;
};

export const App: React.FC = () => {
  const info = useLoja((e) => e.info);
  const ultimoEstado = useRef('');
  // as fontes próprias do projeto (fontes/) ficam registradas antes de qualquer texto ser desenhado na imagem ou no PNG
  useEffect(() => {
    registrarFontesDoProjeto(info?.raiz, info?.base_midia);
  }, [info?.raiz, info?.base_midia]);

  useEffect(() => {
    void window.estudio.projetoAtual().then((i) => i && abrirProjeto(i));
    const largar = window.estudio.aoPedirMiniatura(retanguloDaMiniatura);
    const parar = observarProjeto();
    return () => {
      largar();
      parar();
    };
  }, []);

  useEffect(() => ligarPonteDaJanela(), []); // ponte com a janela (05 §0.1): pedidos do processo principal
  useEffect(() => ligarPreviasDaJanela(), []); // a janela desenha as prévias da imagem e da cena 3D que o MCP pede

  // o que a pessoa está vendo vai para .estudio/estado.json: o agente lê com estado_do_editor e o projeto reabre ali
  useEffect(() => {
    const gravar = () => {
    const e = loja.get();
    if (!e.info) return;
    const documento = e.area === 'efeitos' ? e.alvoEfeitos : e.area === '3d' ? e.ativo['3d'] : e.ativo[e.area];
    // imagem com várias páginas: o caminho da página ativa ("/paginas/2"), para o agente saber onde a pessoa está
    const doc = documento ? (e.docs[documento]?.doc as DocImagem | undefined) : undefined;
    const pagina = doc && Array.isArray(doc.paginas) ? caminhoPagina(doc, Math.max(0, paginasDe(doc).findIndex((p) => p.id === e.paginaAtiva[documento!]))) : undefined;
    // frente Música: na Música, a seleção e a cabeça são as dela (parada; tocando, não grava a cada quadro)
    const naMusica = e.area === 'musica' ? estadoDaMusica() : null;
    const estado = {area: e.area, documento, selecao: naMusica ? naMusica.selecao : e.selecao?.caminho,
      tempo_ms: naMusica ? naMusica.tempo_ms : e.area === 'video' || e.area === 'efeitos' || e.area === 'animacao' ? e.tempo_ms : undefined, pagina,
      selecao_varias: e.selecao?.outros?.length ? caminhosDaSelecao(e.selecao) : undefined}; // seleção múltipla da imagem (B2, rodada 3)
    const chave = JSON.stringify(estado);
    if (chave !== ultimoEstado.current) {
      ultimoEstado.current = chave;
      window.estudio.gravarEstado(estado);
    }
    };
    const largar = [loja.assinar(gravar), musica.assinar(gravar)];
    return () => largar.forEach((f) => f());
  }, []);

  return (
    <>
      {info ? <Suspense fallback={<div className="vazio" style={{paddingTop: 80}}>abrindo o projeto…</div>}><Casca /></Suspense> : <Inicio />}
      <RaizDialogo />
      <ConfigIA />
      <AvisoAtualizacao />
    </>
  );
};
