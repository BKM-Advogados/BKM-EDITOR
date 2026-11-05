// Abre o projeto (o da linha de comando, o último aberto ou o exemplo) e liga a tela ao disco.
import React, {useEffect, useRef} from 'react';
import {BookOpen, FolderOpen} from 'lucide-react';
import {IconeEstudio} from './componentes/Icones';
import {abrirProjeto, avisar, loja, observarProjeto, useLoja} from './estado/loja';
import {Casca} from './casca/Casca';

const BoasVindas: React.FC = () => (
  <div style={{height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16}}>
    <div style={{display: 'flex', alignItems: 'center', gap: 12, fontSize: 26, fontWeight: 600, color: 'var(--texto)'}}><IconeEstudio tamanho={30} />Estúdio</div>
    <div style={{color: 'var(--texto-2)'}}>Vídeo, imagem, 3D e efeitos, editáveis à mão ou conversando com o Claude.</div>
    <div style={{display: 'flex', gap: 8}}>
      <button className="bt principal" onClick={() => void window.estudio.abrirExemplo().then(abrirProjeto)}><BookOpen size={15} />Abrir o exemplo (Cliente · C2)</button>
      <button className="bt" onClick={() => void window.estudio.abrirPasta().then((i) => i && abrirProjeto(i)).catch((e: Error) => avisar(e.message, 'erro'))}>
        <FolderOpen size={15} />Abrir pasta…
      </button>
    </div>
  </div>
);

export const App: React.FC = () => {
  const info = useLoja((e) => e.info);
  const ultimoEstado = useRef('');

  useEffect(() => {
    void window.estudio.projetoAtual().then((i) => i && abrirProjeto(i));
    return observarProjeto();
  }, []);

  // o que a pessoa está vendo vai para .estudio/estado.json, que o agente lê com estado_do_editor
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

  return info ? <Casca /> : <BoasVindas />;
};
