// Barra da seleção no monitor da imagem: alinhar (6), distribuir (2), agrupar, travar e, num texto, caber na caixa. Com uma unidade (camada solta
// ou grupo), o alvo é a prancheta; com várias, a caixa delas. Cada grupo anda inteiro; unidade com camada travada fica.
// Passar o mouse num botão mostra o alvo (tracejado do acento) e onde cada camada vai cair (fantasmas), antes do
// clique; o clique é um patch só (a foto recortada vai com a máscara). As contas são as de src/nucleo/layout-imagem.ts,
// as mesmas das ferramentas do MCP (mcp-imagem.ts).
import React from 'react';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal,
  AlignStartVertical, AlignVerticalDistributeCenter, Group, Lock, LockOpen, ScanText, Ungroup,
} from 'lucide-react';
import type {CamadaImagem} from '../../../nucleo/documentos';
import {caixaDe, patchMover, planoAlinhar, planoDistribuir, travada, unidadesDe, type Alinhamento, type Caixa, type Deslocamento, type Distribuicao} from '../../../nucleo/layout-imagem';
import {aplicar, trocar} from '../../estado/loja';
import {agruparSelecao, alternarTravaSelecao, desagruparSelecao} from './acoesSelecao';
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

const fantasmasDe = (camadas: CamadaImagem[], indices: number[], desl: Deslocamento[]) => indices.map((i, k) => {
  const r = caixaDe(camadas[i]);
  return {x: r.x + desl[k].dx, y: r.y + desl[k].dy, w: r.w, h: r.h};
});

export const BarraSelecao: React.FC<{documento: string; base: string; camadas: CamadaImagem[]; indices: number[]; prancheta: {largura: number; altura: number};
  aoVer: (v: VistaAlvo) => void}> = ({documento, base, camadas, indices, prancheta, aoVer}) => {
  const validos = indices.filter((i) => camadas[i]);
  if (!validos.length) return null;
  const unidades = unidadesDe(camadas, validos).length;
  const quem = validos.length > 1 ? `${validos.length} camadas` : camadas[validos[0]].nome || camadas[validos[0]].id;
  const algumGrupo = validos.some((i) => camadas[i].grupo);
  const todasTravadas = validos.every((i) => travada(camadas[i]));
  const fazer = (plano: {indices: number[]; desl: Deslocamento[]}, rotulo: string) => {
    aoVer(null);
    void aplicar(documento, patchMover(camadas, base, plano.indices, plano.desl), rotulo);
  };
  return (
    <div className="barra-selecao" onPointerDown={(e) => e.stopPropagation()} onMouseLeave={() => aoVer(null)}>
      <span className="quem" title={unidades > 1 ? 'Alinha à caixa da seleção (cada grupo anda inteiro)' : 'Uma camada ou um grupo: alinha à prancheta'}>{quem}</span>
      {BOTOES_ALINHAR.map((b) => {
        const plano = () => planoAlinhar(camadas, validos, b.como, prancheta);
        const ver = () => {
          const p = plano();
          aoVer({alvo: p.alvo, fantasmas: fantasmasDe(camadas, p.indices, p.desl)});
        };
        return (
          <button aria-label={`${b.nome}${unidades > 1 ? '' : ' da prancheta'}`} key={b.como} type="button" className="bti" title={`${b.nome}${unidades > 1 ? '' : ' da prancheta'}`} onMouseEnter={ver} onFocus={ver}
            onClick={() => fazer(plano(), `${b.nome.toLowerCase()} (${quem})`)}>
            {b.icone}
          </button>
        );
      })}
      <span className="sep" />
      {BOTOES_DISTRIBUIR.map((b) => {
        const plano = () => planoDistribuir(camadas, validos, b.eixo);
        const ver = () => {
          const p = plano();
          aoVer({alvo: null, fantasmas: fantasmasDe(camadas, p.indices, p.desl)});
        };
        return (
          <button aria-label={unidades < 3 ? `${b.nome}: escolha três ou mais (cada grupo conta como um)` : b.nome} key={b.eixo} type="button" className="bti" disabled={unidades < 3} title={unidades < 3 ? `${b.nome}: escolha três ou mais (cada grupo conta como um)` : b.nome}
            onMouseEnter={ver} onFocus={ver} onClick={() => fazer(plano(), `distribuir na ${b.eixo} (${quem})`)}>
            {b.icone}
          </button>
        );
      })}
      <span className="sep" />
      <button aria-label="Agrupar (Ctrl+G): escolhidas e movidas juntas" type="button" className="bti" disabled={validos.length < 2} title="Agrupar (Ctrl+G): escolhidas e movidas juntas" onClick={() => void agruparSelecao()}><Group /></button>
      <button aria-label="Desagrupar (Ctrl+Shift+G)" type="button" className="bti" disabled={!algumGrupo} title="Desagrupar (Ctrl+Shift+G)" onClick={() => void desagruparSelecao()}><Ungroup /></button>
      {validos.length === 1 && camadas[validos[0]].tipo === 'texto' && (() => {
        const c = camadas[validos[0]];
        return (
          <button aria-label={c.caber ? 'Caber na caixa: ligado (o tamanho é o maior que cabe; clique para voltar ao tamanho fixo)' : 'Caber na caixa: o maior tamanho que cabe, igual na prévia, no PNG e no PDF'} type="button" className={`bti${c.caber ? ' ligado' : ''}`} title={c.caber ? 'Caber na caixa: ligado (o tamanho é o maior que cabe; clique para voltar ao tamanho fixo)' : 'Caber na caixa: o maior tamanho que cabe, igual na prévia, no PNG e no PDF'}
            onClick={() => void trocar(documento, `${base}/${validos[0]}/caber`, c.caber ? undefined : true, `${c.id}: ${c.caber ? 'tamanho fixo' : 'caber na caixa'}`)}>
            <ScanText />
          </button>
        );
      })()}
      <button aria-label={todasTravadas ? 'Destravar (Ctrl+Shift+L)' : 'Travar (Ctrl+Shift+L): não anda nem muda de tamanho, e a IA não mexe'} type="button" className={`bti${todasTravadas ? ' ligado' : ''}`} title={todasTravadas ? 'Destravar (Ctrl+Shift+L)' : 'Travar (Ctrl+Shift+L): não anda nem muda de tamanho, e a IA não mexe'}
        onClick={() => void alternarTravaSelecao()}>
        {todasTravadas ? <Lock /> : <LockOpen />}
      </button>
    </div>
  );
};
