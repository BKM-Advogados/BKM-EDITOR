// Configurações › IA (frente IA, rodada 3): a lista de provedores no "padrão Cline". Para cada um: o que falta, onde
// fica o servidor, a chave (só os 4 últimos caracteres aparecem; ela é testada na lista de modelos antes de gravar),
// o modelo (da lista do próprio endereço), o endereço (no compatível e nos locais) e o provedor padrão. Embaixo, o
// uso do mês com a composição: tokens de entrada (parte do cache), de saída e o custo estimado pela tabela.
import React, {useEffect, useState, useSyncExternalStore} from 'react';
import {CircleAlert, CircleCheck, ExternalLink, KeyRound, RefreshCw, X} from 'lucide-react';
import type {EstadoProvedor, UsoDoMes} from '../../compartilhado/api';
import {avisar} from '../estado/loja';
import {estadoConversas, fecharConfigIA, lerProvedores} from './conversas';
import './config-ia.css';

const mil = (n: number) => (n >= 1000 ? `${(n / 1000).toLocaleString('pt-BR', {maximumFractionDigits: 1})} mil` : String(n));
const usd = (n: number) => `US$ ${n.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 4 : 2})}`;

const LinhaProvedor: React.FC<{p: EstadoProvedor; aberto: boolean; abrir: () => void}> = ({p, aberto, abrir}) => {
  const [chave, setChave] = useState('');
  const [msg, setMsg] = useState<{ok: boolean; texto: string} | null>(null);
  const [modelos, setModelos] = useState<string[]>([]);
  const [modelo, setModelo] = useState(p.modelo ?? '');
  const [base, setBase] = useState(p.base ?? '');
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    setModelo(p.modelo ?? '');
    setBase(p.base ?? '');
  }, [p.modelo, p.base]);

  const gravarChave = async () => {
    setOcupado(true);
    try {
      const r = await window.estudio.ia.gravarChave(p.id, chave);
      setMsg({ok: r.ok, texto: r.mensagem});
      if (r.ok) {
        setChave('');
        if (r.modelos?.length) setModelos(r.modelos);
      }
      await lerProvedores();
    } finally {
      setOcupado(false);
    }
  };
  const buscarModelos = async () => {
    setOcupado(true);
    try {
      const r = await window.estudio.ia.modelos(p.id);
      if (r.ok) setModelos(r.modelos);
      setMsg(r.ok ? {ok: true, texto: `${r.modelos.length} modelos neste endereço`} : {ok: false, texto: r.mensagem});
    } finally {
      setOcupado(false);
    }
  };
  const configurar = async (c: {modelo?: string; base?: string}) => {
    try {
      await window.estudio.ia.configurar(p.id, c);
      await lerProvedores();
    } catch (e) {
      setMsg({ok: false, texto: String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')});
    }
  };

  const estado = p.pronto ? <span className="ia-estado pronto"><CircleCheck size={12} />pronto</span>
    : <span className="ia-estado falta"><CircleAlert size={12} />falta {p.falta ?? 'configurar'}</span>;
  return (
    <div className={`ia-provedor${aberto ? ' aberto' : ''}`}>
      <button className="ia-cabeca" onClick={abrir} aria-expanded={aberto}>
        <span className="ia-nome">{p.nome}</span>
        {p.experimental && <span className="ia-selo">experimental</span>}
        {p.padrao && <span className="ia-selo padrao">padrão</span>}
        <span className="espaco" />
        {estado}
      </button>
      {aberto && (
        <div className="ia-corpo">
          <div className="ia-info">Servidor: {p.servidor}{p.via === 'acp' ? ' · agente instalado neste PC, com a configuração e o login dele' : ''}</div>
          {p.via === 'claude-cli' && <div className="ia-info">O login é o da Anthropic: abra um terminal do Claude e digite /login. O app não vê a sua senha.</div>}
          {p.via === 'openai' && p.chave !== 'nenhuma' && (
            <div className="ia-linha">
              <KeyRound size={13} />
              {p.chave_final ? <span>chave …{p.chave_final} {p.chave_origem === 'ambiente' ? `(da variável ${p.chave_variavel ?? 'do Windows'})` : '(neste PC)'}</span>
                : <span className="fraco">sem chave</span>}
              <input className="campo" type="password" placeholder={p.chave_final ? 'trocar a chave' : 'cole a chave aqui'} value={chave} autoComplete="off"
                onChange={(e) => setChave(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && chave.trim() && void gravarChave()} />
              <button className="bt mini principal" disabled={!chave.trim() || ocupado} onClick={() => void gravarChave()}>Testar e gravar</button>
              {p.chave_origem === 'cofre' && <button className="bt mini fantasma" onClick={() => void window.estudio.ia.apagarChave(p.id).then(lerProvedores)}>Apagar</button>}
              {p.paginaChave && <button className="bt mini fantasma" onClick={() => void window.estudio.abrirFonte(p.paginaChave!)}><ExternalLink size={12} />Onde pego a chave?</button>}
            </div>
          )}
          {p.via === 'openai' && (p.id === 'compativel' || p.local) && (
            <div className="ia-linha">
              <span className="rot">Endereço</span>
              <input className="campo" placeholder="http://127.0.0.1:11434/v1" value={base} onChange={(e) => setBase(e.target.value)} />
              <button className="bt mini" disabled={base === (p.base ?? '')} onClick={() => void configurar({base})}>Gravar</button>
            </div>
          )}
          {p.via === 'openai' && (
            <div className="ia-linha">
              <span className="rot">Modelo</span>
              {modelos.length ? (
                <select className="campo" value={modelo} onChange={(e) => (setModelo(e.target.value), void configurar({modelo: e.target.value}))}>
                  {!modelos.includes(modelo) && <option value={modelo}>{modelo || 'escolha'}</option>}
                  {modelos.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <input className="campo" placeholder="nome do modelo" value={modelo} onChange={(e) => setModelo(e.target.value)}
                  onBlur={() => modelo !== (p.modelo ?? '') && void configurar({modelo})} />
              )}
              <button className="bt mini fantasma" disabled={ocupado || (p.chave === 'exigida' && !p.chave_final)} onClick={() => void buscarModelos()}
                title="Ler a lista de modelos do próprio endereço"><RefreshCw size={12} />Lista</button>
            </div>
          )}
          {msg && <div className={`ia-msg${msg.ok ? '' : ' erro'}`}>{msg.texto}</div>}
          {p.pronto && !p.padrao && (
            <button className="bt mini fantasma" onClick={() => void window.estudio.ia.padrao(p.id).then(lerProvedores).then(() => avisar(`${p.nome} é o padrão das conversas novas`))}>
              Usar como padrão das conversas novas
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export const ConfigIA: React.FC = () => {
  const cfg = useSyncExternalStore(estadoConversas.assinar, estadoConversas.configIA);
  const provedores = useSyncExternalStore(estadoConversas.assinar, estadoConversas.provedores);
  const [aberto, setAberto] = useState<string | undefined>(undefined);
  const [uso, setUso] = useState<UsoDoMes>({});
  useEffect(() => {
    if (!cfg) return;
    setAberto(cfg.foco);
    void window.estudio.ia.usoDoMes().then(setUso).catch(() => setUso({}));
  }, [cfg]);
  if (!cfg) return null;
  const persistente = provedores.some((p) => p.cofre_persistente);
  const linhasUso = Object.entries(uso);
  return (
    <div className="dialogo-fundo" onPointerDown={(e) => e.target === e.currentTarget && fecharConfigIA()} onKeyDown={(e) => e.key === 'Escape' && fecharConfigIA()}>
      <div className="dialogo config-ia" role="dialog" aria-modal="true" aria-label="Configurações da IA">
        <div className="dialogo-titulo">IA: provedores e chaves<button className="bti fechar" onClick={fecharConfigIA} title="Fechar"><X size={14} /></button></div>
        <div className="dialogo-texto">
          Escolha com qual IA conversar. Todas editam pelo mesmo MCP do Estúdio, com o mesmo histórico e o mesmo Reverter.
          {persistente ? ' A chave fica cifrada neste PC, na sua conta do Windows, fora do projeto e do OneDrive.'
            : ' Neste PC a chave vale só enquanto o app estiver aberto.'}
        </div>
        <div className="ia-lista">
          {provedores.map((p) => <LinhaProvedor key={p.id} p={p} aberto={aberto === p.id} abrir={() => setAberto((a) => (a === p.id ? undefined : p.id))} />)}
        </div>
        <div className="ia-uso">
          <div className="ia-uso-titulo">Uso deste mês neste PC</div>
          {linhasUso.length ? (
            <table>
              <tbody>
                {linhasUso.map(([id, u]) => (
                  <tr key={id}>
                    <td>{provedores.find((p) => p.id === id)?.nome ?? id}</td>
                    <td>{u.turnos} respostas</td>
                    <td>{mil(u.entrada)} tokens de entrada ({mil(u.cache)} do cache) · {mil(u.saida)} de saída</td>
                    <td className="num">{u.custo_usd ? `≈ ${usd(u.custo_usd)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="fraco">Nenhuma conversa por chave neste mês.</div>}
          <div className="fraco">Custo estimado pela tabela de preços do app (08/11/2026); o valor cobrado é o da fatura do provedor. Conversas pela conta do Claude não entram aqui.</div>
        </div>
      </div>
    </div>
  );
};
