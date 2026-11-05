// Comentários do projeto: os da pessoa e as respostas do agente. Clicar leva ao objeto e ao tempo; "Pedir ao Claude"
// manda o pedido para a aba ativa do terminal.
import React, {useEffect, useState} from 'react';
import {Check, RotateCcw, Send, Sparkles} from 'lucide-react';
import {avisar, carregarComentarios, loja, selecionar, useLoja} from '../estado/loja';
import type {Comentario} from '../../nucleo/documentos';

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'});
const segundos = (ms?: number) => (ms === undefined ? '' : `${(ms / 1000).toFixed(1)} s`);

const pedirAoClaude = async (c: Comentario) => {
  const {enviarParaAtiva} = await import('./terminais');
  const ok = enviarParaAtiva(`Resolva o comentário ${c.id} do projeto (use as ferramentas do MCP estudio: ler_comentario, ler_documento, aplicar_patch, responder_comentario e resolver_comentario).`);
  avisar(ok ? `Pedido do ${c.id} enviado ao Claude; confirme com Enter no terminal.` : 'Abra uma aba do Claude no terminal primeiro.', ok ? 'ok' : 'erro');
};

const Cartao: React.FC<{c: Comentario; aberto: boolean}> = ({c, aberto}) => {
  const titulo = useLoja((e) => e.info?.manifesto.documentos.find((d) => d.id === c.documento)?.titulo ?? c.documento);
  const [resposta, setResposta] = useState('');
  const ir = async () => {
    loja.definir({comentarioAberto: c.id});
    const doc = loja.get().info?.manifesto.documentos.find((d) => d.id === c.documento);
    if (doc) loja.definir((e) => ({area: doc.modulo, ativo: {...e.ativo, [doc.modulo]: doc.id}}));
    if (c.alvo.objeto) selecionar({documento: c.documento, caminho: c.alvo.objeto});
    if (c.alvo.tempo_ms !== undefined) {
      const {irPara} = await import('../modulos/video/tocador');
      setTimeout(() => irPara(c.alvo.tempo_ms!), 50);
    }
  };
  const responder = async () => {
    if (!resposta.trim()) return;
    await window.estudio.responder(c.id, resposta.trim());
    setResposta('');
    await carregarComentarios();
  };
  return (
    <div onClick={() => void ir()} style={{border: `1px solid ${aberto ? 'var(--acento)' : 'var(--borda)'}`, borderRadius: 6, padding: 8, marginBottom: 8,
      background: 'var(--fundo-2)', opacity: c.estado === 'resolvido' ? 0.65 : 1, cursor: 'pointer'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4}}>
        <span style={{width: 8, height: 8, borderRadius: 4, background: c.estado === 'aberto' ? 'var(--comentario)' : 'var(--ok)'}} />
        <b style={{fontSize: 12}}>{c.id}</b>
        <span className="rotulo" style={{textTransform: 'none'}}>{titulo}{c.alvo.tempo_ms !== undefined ? ` · ${segundos(c.alvo.tempo_ms)}` : ''}</span>
        <span style={{flex: 1}} />
        <span className="rotulo" style={{textTransform: 'none'}}>{quando(c.criado_em)}</span>
      </div>
      <div style={{whiteSpace: 'pre-wrap'}}>{c.texto}</div>
      {c.alvo.objeto && <div className="rotulo" style={{textTransform: 'none', fontFamily: 'var(--fonte-mono)', marginTop: 4}}>{c.alvo.objeto}</div>}
      {c.respostas.map((r, i) => (
        <div key={i} style={{marginTop: 6, paddingLeft: 8, borderLeft: `2px solid ${r.autor === 'agente' ? 'var(--agente)' : 'var(--pessoa)'}`}}>
          <span className={`etiqueta ${r.autor === 'agente' ? 'agente' : 'pessoa'}`}>{r.autor}</span> <span style={{whiteSpace: 'pre-wrap'}}>{r.texto}</span>
        </div>
      ))}
      {c.resolucao && <div className="rotulo" style={{textTransform: 'none', marginTop: 6}}>resolvido por {c.resolucao.por}{c.resolucao.nota ? `: ${c.resolucao.nota}` : ''}</div>}
      {aberto && (
        <div onClick={(e) => e.stopPropagation()} style={{marginTop: 8}}>
          <div style={{display: 'flex', gap: 6}}>
            <input className="campo" value={resposta} onChange={(e) => setResposta(e.target.value)} placeholder="Responder…" onKeyDown={(e) => e.key === 'Enter' && void responder()} />
            <button className="bt mini" onClick={() => void responder()} title="Responder"><Send size={13} /></button>
          </div>
          <div style={{display: 'flex', gap: 6, marginTop: 6}}>
            {c.estado === 'aberto' ? (
              <>
                <button className="bt mini" onClick={() => void pedirAoClaude(c)}><Sparkles size={13} color="var(--agente)" />Pedir ao Claude</button>
                <button className="bt fantasma mini" onClick={() => void window.estudio.resolverComentario(c.id).then(carregarComentarios)}><Check size={13} />Resolver</button>
              </>
            ) : (
              <button className="bt fantasma mini" onClick={() => void window.estudio.reabrir(c.id).then(carregarComentarios)}><RotateCcw size={13} />Reabrir</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const Comentarios: React.FC = () => {
  const comentarios = useLoja((e) => e.comentarios);
  const aberto = useLoja((e) => e.comentarioAberto);
  const [filtro, setFiltro] = useState<'aberto' | 'todos'>('aberto');
  useEffect(() => {
    if (aberto) document.getElementById(`cmt-${aberto}`)?.scrollIntoView({block: 'nearest'});
  }, [aberto]);
  const lista = comentarios.filter((c) => filtro === 'todos' || c.estado === 'aberto').slice().reverse();
  return (
    <div className="painel">
      <div className="painel-topo">
        <span className="titulo">Comentários</span>
        <span className="esp" />
        <button className={`bt mini${filtro === 'aberto' ? ' ligado' : ''}`} onClick={() => setFiltro('aberto')}>Abertos</button>
        <button className={`bt mini${filtro === 'todos' ? ' ligado' : ''}`} onClick={() => setFiltro('todos')}>Todos</button>
      </div>
      <div className="painel-corpo">
        {lista.length === 0 && <div className="vazio">Nenhum comentário{filtro === 'aberto' ? ' aberto' : ''}. Use Comentar (C) e clique na tela.</div>}
        {lista.map((c) => <div key={c.id} id={`cmt-${c.id}`}><Cartao c={c} aberto={c.id === aberto} /></div>)}
      </div>
    </div>
  );
};
