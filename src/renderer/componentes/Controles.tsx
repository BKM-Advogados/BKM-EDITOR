// Controles de formulário da casa (ux/pesquisa-ux-visual.md, item 13), no lugar dos nativos: no Linux o <select> aberto
// e a caixa de marcar saíam no visual do sistema, e cada diálogo misturava três estilos. Todos com os tokens, alvo de
// 24 px ou mais, teclado e leitor de tela:
// - Caixa: caixa de marcar (role checkbox; Espaço alterna).
// - Segmentado: poucas opções lado a lado (role radiogroup; setas andam).
// - Escolha: lista que abre (role listbox; setas, Home/End, Enter, Esc e a primeira letra).
// - Interruptor: liga e desliga (role switch).
import React, {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Check, ChevronDown} from 'lucide-react';

export const Caixa: React.FC<{marcado: boolean; aoMudar: (v: boolean) => void; children?: React.ReactNode; desligado?: boolean; dica?: string; className?: string;
  rotulo?: string}> = ({marcado, aoMudar, children, desligado, dica, className, rotulo}) => (
  <button type="button" role="checkbox" aria-checked={marcado} aria-label={rotulo} disabled={desligado} title={dica}
    className={`caixa-marcar${marcado ? ' marcada' : ''}${className ? ` ${className}` : ''}`}
    onClick={(e) => {
      e.stopPropagation();
      aoMudar(!marcado);
    }}>
    <span className="caixa-quadro" aria-hidden="true">{marcado && <Check />}</span>
    {children !== undefined && <span className="caixa-texto">{children}</span>}
  </button>
);

export const Interruptor: React.FC<{ligado: boolean; aoMudar: (v: boolean) => void; rotulo: string; desligado?: boolean; children?: React.ReactNode}> = ({ligado, aoMudar, rotulo, desligado, children}) => (
  <button type="button" role="switch" aria-checked={ligado} aria-label={rotulo} disabled={desligado} className="interruptor-casa" onClick={() => aoMudar(!ligado)}>
    <span className={`chave${ligado ? ' ligada' : ''}`} aria-hidden="true" />
    {children !== undefined && <span className="caixa-texto">{children}</span>}
  </button>
);

export type OpcaoControle<T> = [T, React.ReactNode] | {valor: T; rotulo: React.ReactNode; dica?: string; desligado?: boolean; texto?: string};
const lerOpcao = <T,>(o: OpcaoControle<T>) => (Array.isArray(o) ? {valor: o[0], rotulo: o[1], dica: undefined, desligado: false, texto: typeof o[1] === 'string' ? o[1] : String(o[0])}
  : {...o, texto: o.texto ?? (typeof o.rotulo === 'string' ? o.rotulo : String(o.valor))});

export const Segmentado = <T extends string | number>({valor, opcoes, aoMudar, rotulo, desligado, className}: {valor: T; opcoes: OpcaoControle<T>[]; aoMudar: (v: T) => void;
  rotulo: string; desligado?: boolean; className?: string}) => {
  const lidas = opcoes.map(lerOpcao);
  const andar = (de: number, passo: number) => {
    for (let k = 1; k <= lidas.length; k++) {
      const o = lidas[(de + passo * k + lidas.length * k) % lidas.length];
      if (!o.desligado) return o;
    }
    return undefined;
  };
  return (
    <div className={`segmentos${className ? ` ${className}` : ''}`} role="radiogroup" aria-label={rotulo}>
      {lidas.map((o, i) => (
        <button key={String(o.valor)} type="button" role="radio" aria-checked={o.valor === valor} tabIndex={o.valor === valor ? 0 : -1} title={o.dica}
          disabled={desligado || o.desligado} className={o.valor === valor ? 'ativo' : ''} onClick={() => o.valor !== valor && aoMudar(o.valor)}
          onKeyDown={(e) => {
            const passo = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
            if (!passo) return;
            e.preventDefault();
            const prox = andar(i, passo);
            if (prox) {
              aoMudar(prox.valor);
              ((e.currentTarget.parentElement?.children[lidas.indexOf(prox)]) as HTMLElement | undefined)?.focus();
            }
          }}>
          {o.rotulo}
        </button>
      ))}
    </div>
  );
};

/** Zoom do CSS na raiz (Preferências › Aparência › Tamanho): as medidas da tela vêm com ele e o fixed não. */
const zoomDaRaiz = () => Number(getComputedStyle(document.documentElement).zoom) || 1;

/** Lista que abre por cima de tudo (portal), com o teclado de um <select>. */
export const Escolha = <T extends string | number>({valor, opcoes, aoMudar, rotulo, dica, desligado, className = 'campo', vazio = 'Escolha…', aoAbrir}: {
  valor: T | undefined; opcoes: OpcaoControle<T>[]; aoMudar: (v: T) => void; rotulo: string; dica?: string; desligado?: boolean; className?: string; vazio?: string;
  aoAbrir?: () => void}) => {
  const lidas = opcoes.map(lerOpcao);
  const [aberta, setAberta] = useState(false);
  const [foco, setFoco] = useState(0);
  const [pos, setPos] = useState<{left: number; top: number; minWidth: number; maxHeight: number; acima: boolean} | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const busca = useRef({texto: '', em: 0});
  const id = useId();
  const atual = lidas.find((o) => o.valor === valor);

  const abrir = () => {
    if (desligado) return;
    aoAbrir?.();
    const i = lidas.findIndex((o) => o.valor === valor);
    setFoco(i >= 0 ? i : lidas.findIndex((o) => !o.desligado));
    setAberta(true);
  };
  const fechar = (devolverFoco = true) => {
    setAberta(false);
    if (devolverFoco) botao.current?.focus();
  };
  const escolher = (i: number) => {
    const o = lidas[i];
    if (!o || o.desligado) return;
    fechar();
    if (o.valor !== valor) aoMudar(o.valor);
  };

  useLayoutEffect(() => {
    if (!aberta || !botao.current) return;
    const z = zoomDaRaiz();
    const r = botao.current.getBoundingClientRect();
    const alto = window.innerHeight;
    const embaixo = alto - r.bottom;
    const acima = embaixo < 200 && r.top > embaixo;
    setPos({left: r.left / z, top: (acima ? r.top : r.bottom) / z, minWidth: r.width / z, maxHeight: Math.max(120, (acima ? r.top : embaixo) - 12) / z, acima});
  }, [aberta]);
  useEffect(() => {
    if (!aberta) return;
    const fora = (e: PointerEvent) => !lista.current?.contains(e.target as Node) && !botao.current?.contains(e.target as Node) && fechar(false);
    const rolou = (e: Event) => !lista.current?.contains(e.target as Node) && fechar(false);
    window.addEventListener('pointerdown', fora, true);
    window.addEventListener('scroll', rolou, true);
    window.addEventListener('resize', rolou);
    return () => {
      window.removeEventListener('pointerdown', fora, true);
      window.removeEventListener('scroll', rolou, true);
      window.removeEventListener('resize', rolou);
    };
  }, [aberta]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (aberta) lista.current?.querySelector<HTMLElement>(`[data-i="${foco}"]`)?.scrollIntoView({block: 'nearest'});
  }, [aberta, foco]);

  const mover = (de: number, passo: number) => {
    for (let k = 1; k <= lidas.length; k++) {
      const i = de + passo * k;
      if (i < 0 || i >= lidas.length) break;
      if (!lidas[i].desligado) return i;
    }
    return de;
  };
  const tecla = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') return aberta && fechar(false);
    if (!aberta) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        abrir();
      }
      return;
    }
    e.stopPropagation();
    if (e.key === 'Escape') return (e.preventDefault(), fechar());
    if (e.key === 'ArrowDown') return (e.preventDefault(), setFoco((f) => mover(f, 1)));
    if (e.key === 'ArrowUp') return (e.preventDefault(), setFoco((f) => mover(f, -1)));
    if (e.key === 'Home') return (e.preventDefault(), setFoco(mover(-1, 1)));
    if (e.key === 'End') return (e.preventDefault(), setFoco(mover(lidas.length, -1)));
    if (e.key === 'Enter' || e.key === ' ') return (e.preventDefault(), escolher(foco));
    if (e.key.length === 1 && /\S/.test(e.key)) {
      // a primeira letra (ou o começo digitado em sequência) leva à opção
      const agora = Date.now();
      busca.current = {texto: (agora - busca.current.em < 700 ? busca.current.texto : '') + e.key.toLowerCase(), em: agora};
      const i = lidas.findIndex((o) => !o.desligado && o.texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').startsWith(busca.current.texto.normalize('NFD').replace(/[̀-ͯ]/g, '')));
      if (i >= 0) setFoco(i);
    }
  };

  return (
    <>
      <button ref={botao} type="button" role="combobox" className={`escolha ${className}`} disabled={desligado} title={dica ?? rotulo} aria-label={rotulo} aria-haspopup="listbox"
        aria-expanded={aberta} aria-controls={aberta ? id : undefined} aria-activedescendant={aberta ? `${id}-${foco}` : undefined} onClick={() => (aberta ? fechar() : abrir())} onKeyDown={tecla}>
        <span className="escolha-valor">{atual ? atual.rotulo : <span className="escolha-vazia">{vazio}</span>}</span>
        <ChevronDown className="escolha-seta" />
      </button>
      {aberta && pos && createPortal(
        <div ref={lista} id={id} role="listbox" aria-label={rotulo} className={`lista-escolha${pos.acima ? ' acima' : ''}`} tabIndex={-1}
          style={{left: pos.left, ...(pos.acima ? {bottom: window.innerHeight / zoomDaRaiz() - pos.top + 4} : {top: pos.top + 4}), minWidth: pos.minWidth, maxHeight: pos.maxHeight}}
          onKeyDown={tecla}>
          {lidas.map((o, i) => (
            <div key={String(o.valor)} id={`${id}-${i}`} data-i={i} role="option" aria-selected={o.valor === valor} aria-disabled={o.desligado || undefined} title={o.dica}
              className={`opcao${i === foco ? ' foco' : ''}${o.valor === valor ? ' escolhida' : ''}${o.desligado ? ' desligada' : ''}`}
              onPointerEnter={() => !o.desligado && setFoco(i)} onPointerDown={(e) => e.preventDefault()} onClick={() => escolher(i)}>
              <span className="opcao-marca" aria-hidden="true">{o.valor === valor && <Check />}</span>
              <span className="opcao-rotulo">{o.rotulo}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
};
