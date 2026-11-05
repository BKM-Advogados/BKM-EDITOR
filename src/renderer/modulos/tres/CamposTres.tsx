// Campos que o inspector 3D precisa além dos comuns: vetor x/y/z lado a lado, escolha numa lista e cor que mostra ao
// vivo e grava só ao fechar o seletor (um patch por gesto, não por movimento).
import React, {useEffect, useRef, useState} from 'react';
import type {Vetor3} from '../../../nucleo/documentos';

const EIXOS = [
  {nome: 'x', cor: '#e5534b'},
  {nome: 'y', cor: '#6bc46d'},
  {nome: 'z', cor: '#4f8cff'},
];

const Eixo: React.FC<{valor: number | undefined; nome: string; cor: string; passo: number; aoMudar: (n: number) => void}> = ({valor, nome, cor, passo, aoMudar}) => {
  const [v, setV] = useState(valor === undefined ? '' : String(valor));
  useEffect(() => setV(valor === undefined ? '' : String(valor)), [valor]);
  const gravar = () => {
    const n = Number(v.replace(',', '.'));
    if (v.trim() !== '' && Number.isFinite(n) && n !== valor) aoMudar(n);
  };
  return (
    <input className="campo" type="number" step={passo} value={v} title={nome} aria-label={nome}
      style={{padding: '0 4px', minWidth: 0, boxShadow: `inset 2px 0 0 ${cor}`}}
      onChange={(e) => setV(e.target.value)} onBlur={gravar} onKeyDown={(e) => e.key === 'Enter' && gravar()} />
  );
};

/** Três números lado a lado; cada eixo grava sozinho ao sair do campo ou com Enter. */
export const CampoVetor: React.FC<{rotulo: string; valor: Vetor3 | undefined; aoMudar: (v: Vetor3) => void; passo?: number; padrao?: Vetor3}> = ({rotulo, valor, aoMudar, passo = 0.1, padrao = [0, 0, 0]}) => (
  <div className="linha-campo">
    <span>{rotulo}</span>
    <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4}}>
      {EIXOS.map((e, i) => (
        <Eixo key={e.nome} nome={e.nome} cor={e.cor} passo={passo} valor={valor?.[i]}
          aoMudar={(n) => aoMudar((valor ?? padrao).map((x, j) => (j === i ? n : x)) as Vetor3)} />
      ))}
    </div>
  </div>
);

export const CampoEscolha = <T extends string>({rotulo, valor, opcoes, aoMudar}: {rotulo: string; valor: T; opcoes: {valor: T; nome: string}[]; aoMudar: (v: T) => void}) => (
  <label className="linha-campo">
    <span>{rotulo}</span>
    <select className="campo" value={valor} onChange={(e) => e.target.value !== valor && aoMudar(e.target.value as T)}>
      {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.nome}</option>)}
    </select>
  </label>
);

const hex = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : '#000000');

/** Cor com prévia ao vivo (aoVer) e gravação só no 'change' nativo, que o seletor dispara ao fechar. */
export const CampoCorAoSoltar: React.FC<{rotulo: string; valor: string; aoMudar: (v: string) => void; aoVer?: (v: string) => void}> = ({rotulo, valor, aoMudar, aoVer}) => {
  const ref = useRef<HTMLInputElement>(null);
  const [v, setV] = useState(hex(valor));
  useEffect(() => setV(hex(valor)), [valor]);
  const gravar = useRef(aoMudar);
  gravar.current = aoMudar;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fechou = () => {
      if (el.value.toLowerCase() !== hex(valor)) gravar.current(el.value.toUpperCase());
    };
    el.addEventListener('change', fechou);
    return () => el.removeEventListener('change', fechou);
  }, [valor]);
  return (
    <label className="linha-campo">
      <span>{rotulo}</span>
      <input ref={ref} type="color" value={v}
        onChange={(e) => {
          setV(e.target.value);
          aoVer?.(e.target.value);
        }} />
    </label>
  );
};
