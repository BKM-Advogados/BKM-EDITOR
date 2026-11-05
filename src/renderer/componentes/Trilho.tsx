// Trilho de ferramentas à esquerda do monitor (Photoshop, Affinity, Krita; tela.md §3). Cada área passa as suas; as
// teclas ficam no monitor de cada área, porque a mesma letra muda de sentido entre áreas.
import React from 'react';

export type Ferramenta = {id: string; nome: string; tecla?: string; icone: React.ReactNode; ativa?: boolean; aoClicar: () => void; fim?: boolean};

export const Trilho: React.FC<{grupos: Ferramenta[][]; flutuante?: boolean; children?: React.ReactNode}> = ({grupos, flutuante, children}) => (
  <div className={`trilho${flutuante ? ' flutuante-3d' : ''}`} role="toolbar" aria-orientation="vertical">
    {grupos.map((g, i) => (
      <React.Fragment key={i}>
        {i > 0 && !g[0]?.fim && <hr />}
        {g.map((f) => (
          <button key={f.id} className={`${f.ativa ? 'ativa' : ''}${f.fim ? ' fim' : ''}`} title={f.tecla ? `${f.nome}  ${f.tecla}` : f.nome}
            aria-pressed={f.ativa} onClick={f.aoClicar}>
            {f.icone}
          </button>
        ))}
      </React.Fragment>
    ))}
    {children}
  </div>
);

/** Tecla de ferramenta: ignora campos de texto, o terminal e combinações com Ctrl/Alt. */
export const teclaLivre = (e: KeyboardEvent, alvoDe?: EventTarget | null) => {
  const alvo = (alvoDe ?? e.target) as HTMLElement;
  return !(e.ctrlKey || e.altKey || e.metaKey || /INPUT|TEXTAREA|SELECT/.test(alvo.tagName) || alvo.isContentEditable || alvo.closest?.('.xterm'));
};
