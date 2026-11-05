// Popover simples: abre junto ao botão, fecha com clique fora ou Esc. Usado no menu ⋯ do inspector, no zoom da
// imagem e no "inserir imagem" do trilho.
import React, {useEffect, useRef} from 'react';

export const usarFora = (aberto: boolean, fechar: () => void) => {
  const caixa = useRef<HTMLDivElement>(null);
  const ultimo = useRef(fechar);
  ultimo.current = fechar;
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => !caixa.current?.contains(e.target as Node) && ultimo.current();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && ultimo.current();
    window.addEventListener('pointerdown', fora, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', fora, true);
      window.removeEventListener('keydown', esc);
    };
  }, [aberto]);
  return caixa;
};

export type ItemMenu = {rotulo: string; icone?: React.ReactNode; tecla?: string; acao: () => void} | 'sep';

/** Botão que abre um menu de ações. */
export const BotaoMenu: React.FC<{titulo: string; icone: React.ReactNode; itens: ItemMenu[]; className?: string; lado?: 'esquerda' | 'direita'; acima?: boolean; rotulo?: React.ReactNode}> = ({titulo, icone, itens, className = 'bti', lado = 'direita', acima, rotulo}) => {
  const [aberto, setAberto] = React.useState(false);
  const caixa = usarFora(aberto, () => setAberto(false));
  return (
    <div ref={caixa} style={{position: 'relative', display: 'inline-flex'}}>
      <button className={`${className}${aberto ? ' ligado' : ''}`} title={titulo} aria-haspopup="menu" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
        {icone}{rotulo}
      </button>
      {aberto && (
        <div className="flutuante menu" role="menu" style={{[lado === 'direita' ? 'right' : 'left']: 0, ...(acima ? {bottom: 'calc(100% + 4px)'} : {top: 'calc(100% + 4px)'})}}>
          {itens.map((it, i) => it === 'sep' ? <hr key={i} /> : (
            <button key={i} role="menuitem" onClick={() => {
              setAberto(false);
              it.acao();
            }}>
              {it.icone}{it.rotulo}{it.tecla && <span className="tecla">{it.tecla}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
