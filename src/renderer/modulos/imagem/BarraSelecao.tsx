// Barra da seleção no monitor da imagem: alinhar (6) e distribuir (2). Com uma camada, o alvo é a prancheta; com
// várias, a caixa delas. Passar o mouse num botão mostra o alvo (tracejado do acento) e onde cada camada vai cair
// (fantasmas), antes do clique; o clique é um patch só (a foto recortada vai com a máscara). As contas são as de
// src/nucleo/layout-imagem.ts, as mesmas das ferramentas alinhar_camadas e distribuir_camadas do MCP.
import React from 'react';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal,
  AlignStartVertical, AlignVerticalDistributeCenter,
} from 'lucide-react';
import type {CamadaImagem} from '../../../nucleo/documentos';
import {alinhar, alvoDoAlinhamento, caixaDe, distribuir, patchMover, type Alinhamento, type Caixa, type Deslocamento, type Distribuicao} from '../../../nucleo/layout-imagem';
import {aplicar} from '../../estado/loja';
import './selecao.css';

export type VistaAlvo = {alvo: Caixa | null; fantasmas: Caixa[]} | null;

const BOTOES_ALINHAR: {como: Alinhamento; nome: string; icone: React.ReactNode}[] = [
  {como: 'esquerda', nome: 'Alinhar à esquerda', icone: <AlignStartVertical />},
  {como: 'centro', nome: 'Centralizar na horizontal', icone: <AlignCenterVertical />},
  {como: 'direita', nome: 'Alinhar à direita', icone: <AlignEndVertical />},
  {como: 'topo', nome: 'Alinhar em cima', icone: <AlignStartHorizontal />},
  {como: 'meio', nome: 'Centralizar na vertical', icone: <AlignCenterHorizontal />},
  {como: 'base', nome: 'Alinhar embaixo', icone: <AlignEndHorizontal />},
];
const BOTOES_DISTRIBUIR: {eixo: Distribuicao; nome: string; icone: React.ReactNode}[] = [
  {eixo: 'horizontal', nome: 'Distribuir na horizontal (mesmo espaço entre elas)', icone: <AlignHorizontalDistributeCenter />},
  {eixo: 'vertical', nome: 'Distribuir na vertical (mesmo espaço entre elas)', icone: <AlignVerticalDistributeCenter />},
];

const fantasmasDe = (cs: CamadaImagem[], desl: Deslocamento[]) => cs.map((c, k) => {
  const r = caixaDe(c);
  return {x: r.x + desl[k].dx, y: r.y + desl[k].dy, w: r.w, h: r.h};
});

export const BarraSelecao: React.FC<{documento: string; base: string; camadas: CamadaImagem[]; indices: number[]; prancheta: {largura: number; altura: number};
  aoVer: (v: VistaAlvo) => void}> = ({documento, base, camadas, indices, prancheta, aoVer}) => {
  const cs = indices.map((i) => camadas[i]).filter(Boolean);
  if (!cs.length) return null;
  const alvo = alvoDoAlinhamento(cs, prancheta);
  const quem = cs.length > 1 ? `${cs.length} camadas` : cs[0].nome || cs[0].id;
  const fazer = (desl: Deslocamento[], rotulo: string) => {
    aoVer(null);
    void aplicar(documento, patchMover(camadas, base, indices, desl), rotulo);
  };
  return (
    <div className="barra-selecao" onPointerDown={(e) => e.stopPropagation()} onMouseLeave={() => aoVer(null)}>
      <span className="quem" title={cs.length > 1 ? 'Alinha à caixa das camadas selecionadas' : 'Uma camada: alinha à prancheta'}>{quem}</span>
      {BOTOES_ALINHAR.map((b) => (
        <button key={b.como} type="button" className="bti" title={`${b.nome}${cs.length > 1 ? '' : ' da prancheta'}`}
          onMouseEnter={() => aoVer({alvo, fantasmas: fantasmasDe(cs, alinhar(cs, b.como, alvo))})} onFocus={() => aoVer({alvo, fantasmas: fantasmasDe(cs, alinhar(cs, b.como, alvo))})}
          onClick={() => fazer(alinhar(cs, b.como, alvo), `${b.nome.toLowerCase()} (${quem})`)}>
          {b.icone}
        </button>
      ))}
      <span className="sep" />
      {BOTOES_DISTRIBUIR.map((b) => (
        <button key={b.eixo} type="button" className="bti" disabled={cs.length < 3} title={cs.length < 3 ? `${b.nome}: escolha três camadas ou mais` : b.nome}
          onMouseEnter={() => aoVer({alvo: null, fantasmas: fantasmasDe(cs, distribuir(cs, b.eixo))})} onFocus={() => aoVer({alvo: null, fantasmas: fantasmasDe(cs, distribuir(cs, b.eixo))})}
          onClick={() => fazer(distribuir(cs, b.eixo), `distribuir na ${b.eixo} (${quem})`)}>
          {b.icone}
        </button>
      ))}
    </div>
  );
};
