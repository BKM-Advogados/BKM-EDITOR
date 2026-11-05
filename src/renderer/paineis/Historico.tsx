// Histórico: o diário de mudanças do projeto, com quem mudou (pessoa, agente) e o quê. É o mesmo que o agente lê com
// listar_mudancas; o Ctrl+Z desfaz só as edições da própria pessoa.
import React from 'react';
import {Undo2} from 'lucide-react';
import {desfazer, useLoja} from '../estado/loja';

export const Historico: React.FC = () => {
  const diario = useLoja((e) => e.diario);
  const lista = diario.slice().reverse();
  return (
    <div className="painel">
      <div className="painel-topo">
        <span className="titulo">Histórico</span>
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
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
