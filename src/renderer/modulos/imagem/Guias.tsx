// Guias do monitor da imagem (rodada 3, B2): réguas no topo e à esquerda da peça, grade, margem segura (as áreas que a
// interface da rede cobre e o contorno a respeitar), e, no arrasto, as guias do encaixe e a distância até o vizinho de
// cada lado. As escolhas (réguas, grade, margem, encaixe) valem por pessoa, no navegador (localStorage); nada disso sai
// no PNG. As contas são as de src/nucleo/encaixe-imagem.ts.
import React, {useState} from 'react';
import type {AreaSegura, Distancia, Guia} from '../../../nucleo/encaixe-imagem';
import {passoDaRegua} from '../../../nucleo/encaixe-imagem';

export type OpcoesGuias = {reguas: boolean; grade: boolean; margem: boolean; encaixe: boolean};
const PADRAO: OpcoesGuias = {reguas: false, grade: false, margem: false, encaixe: true};
const CHAVE = 'estudio.imagem.guias';

const ler = (): OpcoesGuias => {
  try {
    return {...PADRAO, ...(JSON.parse(localStorage.getItem(CHAVE) ?? '{}') as Partial<OpcoesGuias>)};
  } catch {
    return PADRAO;
  }
};

export const usarOpcoesGuias = () => {
  const [opcoes, setOpcoes] = useState<OpcoesGuias>(ler);
  const alternar = (k: keyof OpcoesGuias) => setOpcoes((o) => {
    const novo = {...o, [k]: !o[k]};
    try {
      localStorage.setItem(CHAVE, JSON.stringify(novo));
    } catch {
      /* sem armazenamento: vale até fechar */
    }
    return novo;
  });
  return [opcoes, alternar] as const;
};

export const ROTULOS_GUIAS: [keyof OpcoesGuias, string][] = [['encaixe', 'Encaixe (Alt solta no arrasto)'], ['reguas', 'Réguas'], ['grade', 'Grade'], ['margem', 'Margem segura']];

const COR_GUIA = 'var(--guia)'; // as cores das guias vêm dos tokens (estilo/tokens.ts)
const BANDA = 16; // px de tela das réguas

/** Réguas por dentro das bordas de cima e da esquerda da peça, em px do documento. */
export const Reguas: React.FC<{escala: number; largura: number; altura: number}> = ({escala, largura, altura}) => {
  const passo = passoDaRegua(escala);
  const W = largura * escala;
  const H = altura * escala;
  const marcas = (fim: number) => Array.from({length: Math.floor(fim / passo) + 1}, (_, k) => k * passo);
  return (
    <svg className="reguas" width={W} height={H} style={{position: 'absolute', left: 0, top: 0, pointerEvents: 'none', overflow: 'visible'}}>
      <rect x={0} y={0} width={W} height={BANDA} style={{fill: 'var(--vidro)'}} />
      <rect x={0} y={0} width={BANDA} height={H} style={{fill: 'var(--vidro)'}} />
      {marcas(largura).map((v) => (
        <g key={`x${v}`}>
          <line x1={v * escala} x2={v * escala} y1={BANDA - 6} y2={BANDA} style={{stroke: 'var(--texto-2)'}} strokeWidth={1} />
          {v > 0 && <text x={v * escala + 2} y={10} style={{fill: 'var(--texto-2)'}} fontSize={11} fontFamily="var(--fonte-mono)">{v}</text>}
        </g>
      ))}
      {marcas(altura).map((v) => (
        <g key={`y${v}`}>
          <line y1={v * escala} y2={v * escala} x1={BANDA - 6} x2={BANDA} style={{stroke: 'var(--texto-2)'}} strokeWidth={1} />
          {v > 0 && <text x={2} y={v * escala - 2} style={{fill: 'var(--texto-2)'}} fontSize={11} fontFamily="var(--fonte-mono)" transform={`rotate(-90 2 ${v * escala - 2})`}>{v}</text>}
        </g>
      ))}
    </svg>
  );
};

/** Linhas da grade a cada `passo` px do documento. */
export const Grade: React.FC<{escala: number; largura: number; altura: number; passo: number}> = ({escala, largura, altura, passo}) => {
  const xs = Array.from({length: Math.floor(largura / passo)}, (_, k) => (k + 1) * passo).filter((v) => v < largura);
  const ys = Array.from({length: Math.floor(altura / passo)}, (_, k) => (k + 1) * passo).filter((v) => v < altura);
  return (
    <svg width={largura * escala} height={altura * escala} style={{position: 'absolute', left: 0, top: 0, pointerEvents: 'none'}}>
      {xs.map((v) => <line key={`x${v}`} x1={v * escala} x2={v * escala} y1={0} y2={altura * escala} style={{stroke: 'var(--acento-selecao)'}} strokeWidth={1} />)}
      {ys.map((v) => <line key={`y${v}`} y1={v * escala} y2={v * escala} x1={0} x2={largura * escala} style={{stroke: 'var(--acento-selecao)'}} strokeWidth={1} />)}
    </svg>
  );
};

/** Margem segura: o que a interface da rede cobre (vermelho translúcido) e o contorno a respeitar (tracejado). */
export const Margem: React.FC<{escala: number; areas: AreaSegura[]}> = ({escala, areas}) => (
  <>
    {areas.map((a, k) => (
      <div key={k} title={a.rotulo} style={{position: 'absolute', left: a.x * escala, top: a.y * escala, width: a.w * escala, height: a.h * escala, pointerEvents: 'none',
        ...(a.tipo === 'coberta' ? {background: 'color-mix(in srgb, var(--cabeca) 16%, transparent)', outline: '1px solid color-mix(in srgb, var(--cabeca) 45%, transparent)'} : {border: `1px dashed ${a.miolo ? 'var(--ok)' : 'var(--aviso)'}`})}} />
    ))}
  </>
);

/** No arrasto: as guias acesas (linha inteira) e a distância até o vizinho de cada lado, com o número em px. */
export const AjudaDoArrasto: React.FC<{escala: number; largura: number; altura: number; guias: Guia[]; distancias: Distancia[]}> = ({escala, largura, altura, guias, distancias}) => (
  <svg width={largura * escala} height={altura * escala} style={{position: 'absolute', left: 0, top: 0, pointerEvents: 'none', overflow: 'visible'}}>
    {guias.map((g, k) => (g.eixo === 'x'
      ? <line key={k} x1={g.valor * escala} x2={g.valor * escala} y1={0} y2={altura * escala} style={{stroke: COR_GUIA}} strokeWidth={1} strokeDasharray={g.tipo === 'grade' ? '3 3' : undefined} />
      : <line key={k} y1={g.valor * escala} y2={g.valor * escala} x1={0} x2={largura * escala} style={{stroke: COR_GUIA}} strokeWidth={1} strokeDasharray={g.tipo === 'grade' ? '3 3' : undefined} />))}
    {distancias.map((d, k) => {
      const [x1, y1, x2, y2] = d.eixo === 'x' ? [d.de, d.em, d.ate, d.em] : [d.em, d.de, d.em, d.ate];
      const mx = ((x1 + x2) / 2) * escala;
      const my = ((y1 + y2) / 2) * escala;
      return (
        <g key={`d${k}`}>
          <line x1={x1 * escala} y1={y1 * escala} x2={x2 * escala} y2={y2 * escala} style={{stroke: COR_GUIA}} strokeWidth={1} />
          <rect x={mx - 15} y={my - 8} width={30} height={16} rx={3} style={{fill: COR_GUIA}} />
          <text x={mx} y={my + 4} style={{fill: 'var(--sobre-acento)'}} fontSize={11} textAnchor="middle" fontFamily="var(--fonte-mono)">{d.valor}</text>
        </g>
      );
    })}
  </svg>
);
