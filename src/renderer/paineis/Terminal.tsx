// Painel de terminais: abas do Claude (a conta da própria pessoa) e de shell, várias em paralelo. Carregado sob demanda.
import React, {useEffect, useLayoutEffect, useRef, useSyncExternalStore} from 'react';
import {Moon, Plus, Play, SquareTerminal, Sparkles, X} from 'lucide-react';
import {useLoja} from '../estado/loja';
import {abrirAba, ajustar, ativar, fecharAba, hibernar, retomar, terminais} from './terminais';

let primeiraVez = true;

export const Terminal: React.FC = () => {
  const abas = useSyncExternalStore(terminais.assinar, terminais.abas);
  const ativa = useSyncExternalStore(terminais.assinar, terminais.ativa);
  const temClaude = useLoja((e) => e.info?.claude ?? false);
  const corpo = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (primeiraVez && abas.length === 0) {
      primeiraVez = false;
      void abrirAba(temClaude ? 'claude' : 'shell');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // pendura o xterm da aba ativa e solta os outros (que continuam vivos)
  useLayoutEffect(() => {
    const c = corpo.current;
    if (!c) return;
    const a = abas.find((x) => x.id === ativa);
    for (const filho of [...c.children]) if (filho !== a?.el) c.removeChild(filho);
    if (a && a.el.parentElement !== c) c.appendChild(a.el);
    requestAnimationFrame(() => {
      ajustar();
      a?.term.focus();
    });
  }, [abas, ativa]);

  useLayoutEffect(() => {
    const c = corpo.current;
    if (!c) return;
    let t: number | undefined;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t);
      t = window.setTimeout(ajustar, 60);
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  const atual = abas.find((x) => x.id === ativa);
  return (
    <div className="painel">
      <div className="terminal-abas">
        {abas.map((a) => (
          <div key={a.id} className={`aba${a.id === ativa ? ' ativa' : ''}`} onClick={() => ativar(a.id)} title={a.sessao ? `sessão ${a.sessao}` : undefined}>
            {a.tipo === 'claude' ? <Sparkles size={13} color="var(--agente)" /> : <SquareTerminal size={13} />}
            <span style={{opacity: a.estado === 'viva' ? 1 : 0.55}}>{a.titulo}{a.estado === 'hibernada' ? ' · hibernada' : a.estado === 'saiu' ? ' · encerrada' : ''}</span>
            <span className="x" onClick={(e) => (e.stopPropagation(), fecharAba(a.id))}><X size={12} /></span>
          </div>
        ))}
        <button className="bt fantasma mini" onClick={() => void abrirAba('claude')} disabled={!temClaude} title={temClaude ? 'Nova aba do Claude' : 'Claude Code não instalado'}>
          <Plus size={13} />Claude
        </button>
        <button className="bt fantasma mini" onClick={() => void abrirAba('shell')} title="Novo terminal"><Plus size={13} />Terminal</button>
        <span style={{flex: 1}} />
        {atual?.tipo === 'claude' && atual.estado === 'viva' && (
          <button className="bt fantasma mini" onClick={() => hibernar(atual.id)} title="Encerra o processo e libera a memória; a conversa volta com Retomar"><Moon size={13} />Hibernar</button>
        )}
        {atual?.tipo === 'claude' && atual.estado !== 'viva' && (
          <button className="bt mini" onClick={() => void retomar(atual.id)}><Play size={13} />Retomar</button>
        )}
      </div>
      <div className="terminal-corpo" ref={corpo} onClick={() => atual?.term.focus()} />
      {abas.length === 0 && <div className="vazio">Abra uma aba do Claude ou um terminal.</div>}
    </div>
  );
};
