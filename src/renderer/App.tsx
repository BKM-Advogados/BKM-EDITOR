// Tela inicial ou editor. A casca (dockview, Remotion, Player) só carrega quando um projeto abre: a tela inicial parada
// fica leve. O processo principal abre sozinho o projeto da linha de comando ou, se a pessoa preferir, o último.
import React, {Suspense, useEffect, useRef} from 'react';
import {abrirProjeto, loja, observarProjeto, useLoja} from './estado/loja';
import {Inicio} from './inicio/Inicio';
import {RaizDialogo} from './componentes/Dialogo';
import {registrarFontesDoProjeto} from './casca/fontes-do-projeto';

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

  // o que a pessoa está vendo vai para .estudio/estado.json: o agente lê com estado_do_editor e o projeto reabre ali
  useEffect(() => loja.assinar(() => {
    const e = loja.get();
    if (!e.info) return;
    const documento = e.area === 'efeitos' ? e.alvoEfeitos : e.area === '3d' ? e.ativo['3d'] : e.ativo[e.area];
    const estado = {area: e.area, documento, selecao: e.selecao?.caminho, tempo_ms: e.area === 'video' || e.area === 'efeitos' ? e.tempo_ms : undefined};
    const chave = JSON.stringify(estado);
    if (chave !== ultimoEstado.current) {
      ultimoEstado.current = chave;
      window.estudio.gravarEstado(estado);
    }
  }), []);

  return (
    <>
      {info ? <Suspense fallback={<div className="vazio" style={{paddingTop: 80}}>abrindo o projeto…</div>}><Casca /></Suspense> : <Inicio />}
      <RaizDialogo />
    </>
  );
};
