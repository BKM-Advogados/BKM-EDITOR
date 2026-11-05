// Campos do inspector. Texto e número só gravam ao sair do campo ou com Enter (um patch por edição, não por tecla);
// controles deslizantes mostram o valor ao vivo e gravam ao soltar.
import React, {useEffect, useRef, useState} from 'react';

export const CampoTexto: React.FC<{rotulo: string; valor: string; aoMudar: (v: string) => void; multilinha?: boolean; dica?: string; invalido?: (v: string) => string | null}> = ({rotulo, valor, aoMudar, multilinha, dica, invalido}) => {
  const [v, setV] = useState(valor);
  useEffect(() => setV(valor), [valor]);
  const erro = invalido?.(v) ?? null;
  const gravar = () => {
    if (v !== valor && !erro) aoMudar(v);
  };
  return (
    <label className="linha-campo" style={multilinha ? {alignItems: 'start'} : undefined} title={dica}>
      <span>{rotulo}</span>
      <div>
        {multilinha ? (
          <textarea className="campo" value={v} onChange={(e) => setV(e.target.value)} onBlur={gravar}
            onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && gravar()} />
        ) : (
          <input className="campo" value={v} onChange={(e) => setV(e.target.value)} onBlur={gravar} onKeyDown={(e) => e.key === 'Enter' && gravar()}
            style={erro ? {borderColor: 'var(--erro)'} : undefined} />
        )}
        {erro && <div style={{color: 'var(--erro)', fontSize: 11, marginTop: 2}}>{erro}</div>}
      </div>
    </label>
  );
};

export const CampoNumero: React.FC<{rotulo: string; valor: number | undefined; aoMudar: (v: number) => void; passo?: number; padrao?: number}> = ({rotulo, valor, aoMudar, passo = 1, padrao}) => {
  const [v, setV] = useState(valor === undefined ? '' : String(valor));
  useEffect(() => setV(valor === undefined ? '' : String(valor)), [valor]);
  const gravar = () => {
    const n = Number(v.replace(',', '.'));
    if (v.trim() !== '' && Number.isFinite(n) && n !== valor) aoMudar(n);
  };
  return (
    <label className="linha-campo">
      <span>{rotulo}</span>
      <input className="campo" type="number" step={passo} value={v} placeholder={padrao !== undefined ? String(padrao) : ''} onChange={(e) => setV(e.target.value)}
        onBlur={gravar} onKeyDown={(e) => e.key === 'Enter' && gravar()} />
    </label>
  );
};

export const CampoDeslizante: React.FC<{rotulo: string; valor: number; min: number; max: number; passo: number; unidade?: string; aoMudar: (v: number) => void; aoVer?: (v: number) => void}> = ({rotulo, valor, min, max, passo, unidade, aoMudar, aoVer}) => {
  const [v, setV] = useState(valor);
  useEffect(() => setV(valor), [valor]);
  return (
    <label className="linha-campo">
      <span>{rotulo}</span>
      <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
        <input type="range" min={min} max={max} step={passo} value={v}
          onChange={(e) => {
            setV(Number(e.target.value));
            aoVer?.(Number(e.target.value));
          }}
          onPointerUp={() => v !== valor && aoMudar(v)} onKeyUp={() => v !== valor && aoMudar(v)} />
        <span style={{width: 52, textAlign: 'right', fontFamily: 'var(--fonte-mono)', fontSize: 11, color: 'var(--texto-2)'}}>{Number(v.toFixed(2))}{unidade}</span>
      </div>
    </label>
  );
};

// o seletor de cor dispara "input" a cada movimento; o patch sai só no "change" nativo, quando a pessoa fecha o seletor
export const CampoCor: React.FC<{rotulo: string; valor: string; aoMudar: (v: string) => void}> = ({rotulo, valor, aoMudar}) => {
  const ref = useRef<HTMLInputElement>(null);
  const [v, setV] = useState(valor);
  useEffect(() => setV(valor), [valor]);
  const ultimo = useRef(aoMudar);
  ultimo.current = aoMudar;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fim = () => el.value !== valor && ultimo.current(el.value);
    el.addEventListener('change', fim);
    return () => el.removeEventListener('change', fim);
  }, [valor]);
  return (
    <label className="linha-campo">
      <span>{rotulo}</span>
      <input ref={ref} type="color" value={/^#[0-9a-f]{6}$/i.test(v) ? v : '#000000'} onChange={(e) => setV(e.target.value)} />
    </label>
  );
};

export const Secao: React.FC<{titulo: string; children: React.ReactNode; acao?: React.ReactNode}> = ({titulo, children, acao}) => (
  <section style={{marginBottom: 14}}>
    <div style={{display: 'flex', alignItems: 'center', marginBottom: 8}}>
      <div className="rotulo" style={{flex: 1}}>{titulo}</div>
      {acao}
    </div>
    {children}
  </section>
);
