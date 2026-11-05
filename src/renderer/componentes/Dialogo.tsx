// Diálogo pequeno que pede um texto (nome da cópia, nome do documento) ou uma confirmação. Fica fora do React de quem
// chama: `pedirTexto(...)` devolve uma promessa e <RaizDialogo/>, montada uma vez no App, desenha.
import React, {useEffect, useRef, useState, useSyncExternalStore} from 'react';

type Pedido = {titulo: string; texto?: string; rotulo?: string; valor?: string; botao: string; perigo?: boolean; comCampo: boolean; responder: (v: string | null) => void};

let atual: Pedido | null = null;
const ouvintes = new Set<() => void>();
const mudar = (p: Pedido | null) => {
  atual = p;
  ouvintes.forEach((f) => f());
};
const assinar = (f: () => void) => {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
};

export const pedirTexto = (o: {titulo: string; rotulo?: string; valor?: string; botao?: string; texto?: string}) =>
  new Promise<string | null>((ok) => {
    atual?.responder(null);
    mudar({...o, botao: o.botao ?? 'OK', comCampo: true, responder: ok});
  });

export const confirmar = (o: {titulo: string; texto?: string; botao?: string; perigo?: boolean}) =>
  new Promise<boolean>((ok) => {
    atual?.responder(null);
    mudar({...o, botao: o.botao ?? 'OK', comCampo: false, responder: (v) => ok(v !== null)});
  });

export const RaizDialogo: React.FC = () => {
  const p = useSyncExternalStore(assinar, () => atual);
  const [valor, setValor] = useState('');
  const campo = useRef<HTMLInputElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!p) return;
    setValor(p.valor ?? '');
    requestAnimationFrame(() => {
      if (p.comCampo) {
        campo.current?.focus();
        campo.current?.select();
      } else botao.current?.focus();
    });
  }, [p]);
  if (!p) return null;
  const fechar = (v: string | null) => {
    mudar(null);
    p.responder(v);
  };
  const ok = () => (p.comCampo ? valor.trim() && fechar(valor.trim()) : fechar(''));
  return (
    <div className="dialogo-fundo" onPointerDown={(e) => e.target === e.currentTarget && fechar(null)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') fechar(null);
        if (e.key === 'Enter') {
          e.preventDefault();
          ok();
        }
      }}>
      <div className="dialogo" role="dialog" aria-modal="true" aria-label={p.titulo}>
        <div className="dialogo-titulo">{p.titulo}</div>
        {p.texto && <div className="dialogo-texto">{p.texto}</div>}
        {p.comCampo && (
          <label className="dialogo-campo">
            {p.rotulo && <span>{p.rotulo}</span>}
            <input ref={campo} className="campo" value={valor} onChange={(e) => setValor(e.target.value)} />
          </label>
        )}
        <div className="dialogo-botoes">
          <button className="bt fantasma" onClick={() => fechar(null)}>Cancelar</button>
          <button ref={botao} className={`bt principal${p.perigo ? ' perigo' : ''}`} disabled={p.comCampo && !valor.trim()} onClick={ok}>{p.botao}</button>
        </div>
      </div>
    </div>
  );
};
