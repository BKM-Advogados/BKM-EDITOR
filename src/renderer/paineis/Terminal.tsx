// Painel do Claude: conversas (o Claude como conversa, o padrão) e terminais (o mesmo Claude em modo texto e o
// PowerShell), várias abas em paralelo. "Ver no terminal" hiberna a conversa e abre a mesma sessão no modo texto
// (claude --resume); ao voltar, a conversa fecha o terminal daquela sessão antes de mandar, para as duas não
// escreverem juntas no mesmo histórico. Carregado sob demanda.
import React, {useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import type {EstadoProvedor} from '../../compartilhado/api';
import {BotaoMenu, type ItemMenu} from '../componentes/Menu';
import {Moon, Play, Plus, Sparkle, SquareTerminal, Terminal as IconeTerminal, X} from 'lucide-react';
import {avisar, loja, quandoTrocarProjeto, useLoja} from '../estado/loja';
import {abrirAba, abrirClaudeNaSessao, ajustar, ativar, fecharAba, fecharClaudeDaSessao, hibernar, retomar, terminais} from './terminais';
import {ativarConversa, avisarNaConversa, conversarCom, estadoConversas, fecharConversa, focarTerminal, hibernarConversa, novaConversa} from './conversas';
import {Conversa} from './Conversa';

let primeiraVez = true;
// projeto novo, painel novo: a primeira montagem volta a abrir uma conversa (ou um terminal, sem o Claude)
quandoTrocarProjeto(() => (primeiraVez = true));

const ESTADO: Record<string, string> = {nova: '', pronta: '', trabalhando: 'trabalhando', precisa: 'precisa de você', hibernada: 'hibernada'};

export const Terminal: React.FC = () => {
  const abas = useSyncExternalStore(terminais.assinar, terminais.abas);
  const ativaPty = useSyncExternalStore(terminais.assinar, terminais.ativa);
  const conversas = useSyncExternalStore(estadoConversas.assinar, estadoConversas.lista);
  const ativaConversa = useSyncExternalStore(estadoConversas.assinar, estadoConversas.ativa);
  const foco = useSyncExternalStore(estadoConversas.assinar, estadoConversas.foco);
  const temClaude = useLoja((e) => e.info?.claude ?? false);
  const corpo = useRef<HTMLDivElement>(null);

  const conversa = foco === 'conversa' ? conversas.find((c) => c.id === ativaConversa) : undefined;
  const pty = conversa ? undefined : abas.find((a) => a.id === ativaPty) ?? abas[abas.length - 1];

  useEffect(() => {
    if (primeiraVez && abas.length === 0 && conversas.length === 0) {
      primeiraVez = false;
      // projeto criado pelo campo "Descreva para o Claude" da tela inicial: a primeira conversa já leva o pedido
      const pedido = loja.get().pedidoClaude;
      if (pedido && temClaude) {
        loja.definir({pedidoClaude: undefined});
        void conversarCom(pedido.texto, [{chave: 'projeto-novo', tipo: 'projeto', rotulo: pedido.rotulo, contexto: pedido.contexto}]);
      } else if (temClaude) void novaConversa();
      else void abrirAba('shell');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // pendura o xterm da aba de terminal ativa e solta os outros (que continuam vivos)
  useLayoutEffect(() => {
    const c = corpo.current;
    if (!c) return;
    for (const filho of [...c.children]) if (filho !== pty?.el) c.removeChild(filho);
    if (pty && pty.el.parentElement !== c) c.appendChild(pty.el);
    requestAnimationFrame(() => {
      ajustar();
      pty?.term.focus();
    });
  }, [pty]);

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
  }, [conversa]);

  const verNoTerminal = async () => {
    if (!conversa) return;
    const sessao = await hibernarConversa(conversa.id);
    if (!sessao) return;
    focarTerminal();
    const a = await abrirClaudeNaSessao(sessao, `${conversa.titulo.split(' · ')[0]} · terminal`);
    if (a) avisarNaConversa(conversa.id, 'Esta conversa continuou no terminal. Ao mandar a próxima mensagem aqui, o terminal dela fecha e a conversa segue deste ponto.');
  };

  // frente IA: o menu "+ Conversa" lista os provedores do catálogo; o que falta (chave, modelo) aparece no rótulo
  const [provedores, setProvedores] = useState<EstadoProvedor[]>([]);
  useEffect(() => {
    void window.estudio.ia?.provedores().then(setProvedores).catch(() => setProvedores([]));
  }, [conversas.length]);
  const itensProvedores: ItemMenu[] = provedores.length
    ? provedores.map((p) => ({
        rotulo: `${p.nome}${p.pronto ? '' : ` · falta ${p.falta ?? 'configurar'}`}${p.experimental ? ' · experimental' : ''}`,
        acao: () => (p.pronto ? void novaConversa(undefined, p.id)
          : avisar(`${p.nome}: falta ${p.falta ?? 'configurar'}. Configure em Configurações › IA.`, 'erro')),
      }))
    : [{rotulo: temClaude ? 'Claude (sua conta)' : 'Claude Code não instalado', acao: () => temClaude && void novaConversa()}];
  const entrar = () => {
    focarTerminal();
    void abrirAba('claude');
  };

  return (
    <div className="painel claude-painel">
      <div className="claude-abas">
        {conversas.map((c) => (
          <div key={`c${c.id}`} className={`aba conversa-aba${conversa?.id === c.id ? ' ativa' : ''}`} onClick={() => ativarConversa(c.id)} title={ESTADO[c.estado] || c.titulo}>
            <span className={`estado-ponto ${c.estado}`} />
            <Sparkle size={13} className="icone-agente" />
            <span className="nome">{c.titulo}</span>
            <span className="x" onClick={(e) => (e.stopPropagation(), fecharConversa(c.id))} title="Fechar conversa"><X size={12} /></span>
          </div>
        ))}
        {abas.map((a) => (
          <div key={`t${a.id}`} className={`aba${pty?.id === a.id ? ' ativa terminal-ativa' : ''}`} onClick={() => (focarTerminal(), ativar(a.id))} title={a.sessao ? `sessão ${a.sessao}` : undefined}>
            {a.tipo === 'claude' ? <IconeTerminal size={13} className="icone-agente" /> : <SquareTerminal size={13} />}
            <span className="nome" style={{opacity: a.estado === 'viva' ? 1 : 0.6}}>{a.titulo}{a.estado === 'hibernada' ? ' · hibernada' : a.estado === 'saiu' ? ' · encerrada' : ''}</span>
            <span className="x" onClick={(e) => (e.stopPropagation(), fecharAba(a.id))} title="Fechar"><X size={12} /></span>
          </div>
        ))}
        <span className="espaco" />
        <BotaoMenu titulo="Nova conversa com uma IA" className="bt fantasma mini" icone={<Plus size={13} />} rotulo={<span className="rot">Conversa</span>} itens={itensProvedores} />
        <button className="bt fantasma mini" onClick={() => (focarTerminal(), void abrirAba('shell'))} title="Novo terminal (PowerShell)"><SquareTerminal size={13} /><span className="rot">Terminal</span></button>
        {conversa?.provedor === 'claude' && <button className="bt fantasma mini" onClick={() => void verNoTerminal()} title="Ver esta conversa no terminal (o mesmo Claude, em modo texto)"><IconeTerminal size={13} /></button>}
        {conversa && conversa.estado !== 'hibernada' && conversa.estado !== 'nova' && (
          <button className="bt fantasma mini" onClick={() => void hibernarConversa(conversa.id)} title="Hibernar: encerra o processo e libera a memória; a próxima mensagem volta à conversa"><Moon size={13} /></button>
        )}
        {pty?.tipo === 'claude' && pty.estado === 'viva' && (
          <button className="bt fantasma mini" onClick={() => hibernar(pty.id)} title="Encerra o processo e libera a memória; a conversa volta com Retomar"><Moon size={13} /></button>
        )}
        {pty?.tipo === 'claude' && pty.estado !== 'viva' && <button className="bt mini" onClick={() => void retomar(pty.id)}><Play size={13} />Retomar</button>}
      </div>
      {conversa ? (
        <Conversa key={conversa.id} c={conversa} abrirTerminal={entrar} liberarSessao={fecharClaudeDaSessao} />
      ) : (
        <div className="terminal-corpo" ref={corpo} onClick={() => pty?.term.focus()} />
      )}
      {!conversa && !pty && <div className="vazio">Abra uma conversa com o Claude ou um terminal.</div>}
    </div>
  );
};
