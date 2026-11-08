// Histórico: o diário de mudanças do projeto, com quem mudou (pessoa, agente) e o quê. É o mesmo que o agente lê com
// listar_mudancas; o Ctrl+Z desfaz só as edições da própria pessoa. Frente IA (rodada 3): cada entrada tem Reverter,
// de qualquer autor e de qualquer provedor; se o valor mudou depois, pergunta antes de passar por cima.
import React, {useMemo} from 'react';
import {Undo2} from 'lucide-react';
import {avisar, carregarDiario, desfazer, useLoja} from '../estado/loja';
import {confirmar} from '../componentes/Dialogo';

const reverterEntrada = async (seq: number, rotulo: string) => {
  let r = await window.estudio.ia.reverter(seq);
  if (!r.ok && r.mudou_depois && await confirmar({titulo: `Reverter #${seq} mesmo assim?`, texto: `${r.mensagem}. Reverter agora passa por cima do que veio depois nesse ponto.`, botao: 'Reverter', perigo: true})) {
    r = await window.estudio.ia.reverter(seq, true);
  }
  if (r.ok) avisar(`revertido: ${rotulo}`, 'ok');
  else if (!r.mudou_depois) avisar(r.mensagem, 'erro');
  void carregarDiario();
};

export const Historico: React.FC = () => {
  const diario = useLoja((e) => e.diario);
  const lista = diario.slice().reverse();
  const revertidas = useMemo(() => new Set(diario.filter((e) => e.desfaz !== undefined).map((e) => e.desfaz!)), [diario]);
  return (
    <div className="painel">
      <div className="painel-topo">
        <span className="esp" />
        <button className="bt mini" onClick={() => void desfazer()} title="Desfaz a sua última edição (Ctrl+Z)"><Undo2 size={13} />Desfazer</button>
      </div>
      <div className="painel-corpo">
        {lista.length === 0 && <div className="vazio">Nenhuma mudança ainda.</div>}
        <ul className="lista">
          {lista.map((e) => (
            <li key={e.seq} title={JSON.stringify(e.patch, null, 1)} style={{alignItems: 'flex-start', cursor: 'default'}}>
              <span className={`etiqueta ${e.autor}`}>{e.autor}</span>
              <span style={{flex: 1, minWidth: 0}}>
                <span style={{display: 'block', color: 'var(--texto)'}}>{e.rotulo}</span>
                <span className="rotulo" style={{textTransform: 'none'}}>
                  #{e.seq} · {e.documento} · {new Date(e.em).toLocaleTimeString('pt-BR')}{e.origem !== 'interface' ? ` · ${e.origem}` : ''}
                  {revertidas.has(e.seq) ? ' · revertida' : ''}
                </span>
              </span>
              {e.desfaz === undefined && !revertidas.has(e.seq) && e.inverso?.length > 0 && (
                <button className="bt mini fantasma" onClick={() => void reverterEntrada(e.seq, e.rotulo)} title="Aplica o inverso desta mudança">Reverter</button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
