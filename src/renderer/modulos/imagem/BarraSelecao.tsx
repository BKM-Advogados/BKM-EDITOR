// Barra da seleção no monitor da imagem, em grupos com nome (Alinhar, Distribuir, Grupo, Caber, Travar) em vez de 12
// ícones soltos: alinhar (6), distribuir (2), agrupar, travar e, num texto, caber na caixa. Com uma unidade (camada solta
// ou grupo), o alvo é a prancheta; com várias, a caixa delas. Cada grupo anda inteiro; unidade com camada travada fica.
// Passar o mouse num item mostra o alvo (tracejado do acento) e onde cada camada vai cair (fantasmas), antes do
// clique; o clique é um patch só (a foto recortada vai com a máscara). As contas são as de src/nucleo/layout-imagem.ts,
// as mesmas das ferramentas do MCP (mcp-imagem.ts).
import React from 'react';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal,
  AlignStartVertical, AlignVerticalDistributeCenter, ChevronDown, Group, Lock, LockOpen, ScanText, Ungroup,
} from 'lucide-react';
import {usarFora} from '../../componentes/Menu';
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

/** Um grupo da barra: o botão com nome e, aberto, a lista com ícone e nome; passar o mouse num item mostra onde cai. */
const GrupoBarra: React.FC<{nome: string; icone: React.ReactNode; aberto: boolean; alternar: () => void; desligado?: boolean; dica?: string; children: React.ReactNode}> =
  ({nome, icone, aberto, alternar, desligado, dica, children}) => (
    <span className="grupo-barra">
      <button type="button" className={`bt fantasma mini${aberto ? ' ligado' : ''}`} aria-haspopup="menu" aria-expanded={aberto} disabled={desligado} title={dica ?? nome}
        onClick={alternar}>{icone}{nome}<ChevronDown className="i12" /></button>
      {aberto && <div className="flutuante menu menu-barra" role="menu">{children}</div>}
    </span>
  );

export const BarraSelecao: React.FC<{documento: string; base: string; camadas: CamadaImagem[]; indices: number[]; prancheta: {largura: number; altura: number};
  aoVer: (v: VistaAlvo) => void}> = ({documento, base, camadas, indices, prancheta, aoVer}) => {
  const [aberto, setAberto] = React.useState<'alinhar' | 'distribuir' | 'grupo' | null>(null);
  const caixa = usarFora(aberto !== null, () => (setAberto(null), aoVer(null)));
  const validos = indices.filter((i) => camadas[i]);
  if (!validos.length) return null;
  const unidades = unidadesDe(camadas, validos).length;
  const quem = validos.length > 1 ? `${validos.length} camadas` : camadas[validos[0]].nome || camadas[validos[0]].id;
  const algumGrupo = validos.some((i) => camadas[i].grupo);
  const todasTravadas = validos.every((i) => travada(camadas[i]));
  const fazer = (plano: {indices: number[]; desl: Deslocamento[]}, rotulo: string) => {
    aoVer(null);
    setAberto(null);
    void aplicar(documento, patchMover(camadas, base, plano.indices, plano.desl), rotulo);
  };
  const alternar = (g: 'alinhar' | 'distribuir' | 'grupo') => () => (aoVer(null), setAberto((a) => (a === g ? null : g)));
  return (
    <div className="barra-selecao" ref={caixa} onPointerDown={(e) => e.stopPropagation()} onMouseLeave={() => !aberto && aoVer(null)}>
      <span className="quem" title={unidades > 1 ? 'Alinha à caixa da seleção (cada grupo anda inteiro)' : 'Uma camada ou um grupo: alinha à prancheta'}>{quem}</span>
      <GrupoBarra nome="Alinhar" icone={<AlignCenterVertical className="i14" />} aberto={aberto === 'alinhar'} alternar={alternar('alinhar')}
        dica={unidades > 1 ? 'Alinhar entre si' : 'Alinhar na prancheta'}>
        {BOTOES_ALINHAR.map((b) => {
          const plano = () => planoAlinhar(camadas, validos, b.como, prancheta);
          const ver = () => {
            const p = plano();
            aoVer({alvo: p.alvo, fantasmas: fantasmasDe(camadas, p.indices, p.desl)});
          };
          return (
            <button key={b.como} type="button" role="menuitem" onMouseEnter={ver} onFocus={ver} onClick={() => fazer(plano(), `${b.nome.toLowerCase()} (${quem})`)}>
              {b.icone}{b.nome}{unidades > 1 ? '' : ' da prancheta'}
            </button>
          );
        })}
      </GrupoBarra>
      <GrupoBarra nome="Distribuir" icone={<AlignHorizontalDistributeCenter className="i14" />} aberto={aberto === 'distribuir'} alternar={alternar('distribuir')}
        desligado={unidades < 3} dica={unidades < 3 ? 'Distribuir: escolha três ou mais (cada grupo conta como um)' : 'Mesmo espaço entre elas'}>
        {BOTOES_DISTRIBUIR.map((b) => {
          const plano = () => planoDistribuir(camadas, validos, b.eixo);
          const ver = () => {
            const p = plano();
            aoVer({alvo: null, fantasmas: fantasmasDe(camadas, p.indices, p.desl)});
          };
          return (
            <button key={b.eixo} type="button" role="menuitem" onMouseEnter={ver} onFocus={ver} onClick={() => fazer(plano(), `distribuir na ${b.eixo} (${quem})`)}>
              {b.icone}{b.nome}
            </button>
          );
        })}
      </GrupoBarra>
      <GrupoBarra nome="Grupo" icone={<Group className="i14" />} aberto={aberto === 'grupo'} alternar={alternar('grupo')} desligado={validos.length < 2 && !algumGrupo}
        dica="Agrupar e desagrupar">
        <button type="button" role="menuitem" disabled={validos.length < 2} onClick={() => (setAberto(null), void agruparSelecao())}><Group />Agrupar<span className="tecla">Ctrl+G</span></button>
        <button type="button" role="menuitem" disabled={!algumGrupo} onClick={() => (setAberto(null), void desagruparSelecao())}><Ungroup />Desagrupar<span className="tecla">Ctrl+Shift+G</span></button>
      </GrupoBarra>
      {validos.length === 1 && camadas[validos[0]].tipo === 'texto' && (() => {
        const c = camadas[validos[0]];
        return (
          <button type="button" className={`bt fantasma mini${c.caber ? ' ligado' : ''}`} aria-pressed={Boolean(c.caber)}
            title={c.caber ? 'Caber na caixa: ligado (o tamanho é o maior que cabe; clique para voltar ao tamanho fixo)' : 'Caber na caixa: o maior tamanho que cabe, igual na prévia, no PNG e no PDF'}
            onClick={() => void trocar(documento, `${base}/${validos[0]}/caber`, c.caber ? undefined : true, `${c.id}: ${c.caber ? 'tamanho fixo' : 'caber na caixa'}`)}>
            <ScanText className="i14" />Caber
          </button>
        );
      })()}
      <button type="button" className={`bt fantasma mini${todasTravadas ? ' ligado' : ''}`} aria-pressed={todasTravadas}
        title={todasTravadas ? 'Destravar (Ctrl+Shift+L)' : 'Travar (Ctrl+Shift+L): não anda nem muda de tamanho, e a IA não mexe'} onClick={() => void alternarTravaSelecao()}>
        {todasTravadas ? <Lock className="i14" /> : <LockOpen className="i14" />}{todasTravadas ? 'Travada' : 'Travar'}
      </button>
    </div>
  );
};
