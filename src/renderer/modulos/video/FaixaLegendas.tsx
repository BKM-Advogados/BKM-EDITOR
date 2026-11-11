// Faixa de legendas da linha do tempo do vídeo de cenas, abaixo das faixas de áudio (docs/legendas.md): o nome e o
// "mostrar no vídeo" presos à esquerda; cada legenda é uma barra com o texto. Clicar seleciona e leva a cabeça ao
// começo (o inspector vira a lista das legendas); arrastar move no tempo, com as palavras junto; as alças da legenda
// selecionada aparam o começo e o fim. Delete exclui a legenda selecionada (ouvido na captura, antes do monitor, que só
// conhece cenas e blocos). Sem legendas, a faixa convida a transcrever ou importar.
import React, {useEffect, useRef, useState} from 'react';
import {Captions, Eye, EyeOff} from 'lucide-react';
import {passoDeQuadro, type LegendasP, type SegmentoLegendaP} from '../../../nucleo/legendas';
import {loja, selecionar, trocar, useLoja} from '../../estado/loja';
import {excluirSegmento, moverSegmento} from './acoes-legendas';
import {irPara} from './tocador';
import './legendas.css';

type Arrasto = {id: string; modo: 'mover' | 'ini' | 'fim'; x0: number; dms: number};
const SEL = /^\/legendas\/segmentos\/(\d+)$/;

export const FaixaLegendas: React.FC<{documento: string; legendas?: LegendasP; x: (ms: number) => number; pxs: number; aoBuscar: (e: React.MouseEvent) => void}> =
  ({documento, legendas, x, pxs, aoBuscar}) => {
    const selecao = useLoja((e) => (e.selecao?.documento === documento ? e.selecao.caminho : null));
    const temNoDoc = useLoja((e) => Boolean((e.docs[documento]?.doc as {legendas?: unknown} | undefined)?.legendas));
    const [arrasto, setArrasto] = useState<Arrasto | null>(null);

    // as legendas da tela, para o teclado andar de quadro em quadro a partir do tempo que se vê
    const naTela = useRef(legendas);
    naTela.current = legendas;
    // Delete na legenda selecionada (na captura: o monitor ouve a mesma tecla para cenas e blocos); [ e ] mudam o
    // começo e { e } o fim, um quadro por vez
    useEffect(() => {
      const tecla = (e: KeyboardEvent) => {
        const ponta = ({'[': ['ini', -1], ']': ['ini', 1], '{': ['fim', -1], '}': ['fim', 1]} as Record<string, ['ini' | 'fim', -1 | 1]>)[e.key];
        if ((e.key !== 'Delete' && !ponta) || e.ctrlKey || e.altKey || loja.get().area !== 'video') return;
        const sel = loja.get().selecao;
        const m = sel?.documento === documento ? SEL.exec(sel.caminho) : null;
        const id = m ? (loja.get().docs[documento]?.doc as {legendas?: {segmentos?: {id: string}[]}})?.legendas?.segmentos?.[Number(m[1])]?.id : undefined;
        const alvo = e.target as HTMLElement;
        if (!id || /INPUT|TEXTAREA|SELECT/.test(alvo.tagName) || alvo.isContentEditable || alvo.closest?.('.xterm')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!ponta) return void excluirSegmento(documento, id);
        const tela = naTela.current?.segmentos.find((s) => s.id === id);
        const fps = (loja.get().docs[documento]?.doc as {formato?: {fps?: number}} | undefined)?.formato?.fps ?? 30;
        if (tela) void moverSegmento(documento, id, ponta[0], passoDeQuadro(ponta[0] === 'ini' ? tela.em : tela.sai, fps, ponta[1]), {exato: true});
      };
      window.addEventListener('keydown', tecla, true);
      return () => window.removeEventListener('keydown', tecla, true);
    }, [documento]);

    const pegar = (e: React.PointerEvent, s: SegmentoLegendaP, modo: Arrasto['modo']) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      selecionar({documento, caminho: s.origem});
      setArrasto({id: s.id, modo, x0: e.clientX, dms: 0});
    };
    const mover = (e: React.PointerEvent) => {
      if (arrasto) setArrasto({...arrasto, dms: ((e.clientX - arrasto.x0) / pxs) * 1000});
    };
    const soltar = (s: SegmentoLegendaP) => {
      const a = arrasto;
      setArrasto(null);
      if (!a) return;
      if (Math.abs(a.dms) < 20) {
        if (a.modo === 'mover') irPara(s.em);
        return;
      }
      void moverSegmento(documento, a.id, a.modo, a.dms);
    };

    const oculto = legendas?.oculto ?? false;
    const segs = legendas?.segmentos ?? [];
    return (
      <div className={`trilha legendas${selecao === '/legendas' ? ' sel' : ''}${oculto ? ' oculta' : ''}`} onClick={aoBuscar}>
        <div className="rotulo-faixa" title="Legendas: clique para a lista, o estilo e a transcrição"
          onClick={(e) => {
            e.stopPropagation();
            selecionar({documento, caminho: '/legendas'});
          }}>
          <Captions />
          <span className="nome">Legendas</span>
          {temNoDoc && (
            <button aria-label={oculto ? 'Legendas escondidas: clique para mostrar no vídeo' : 'Esconder do vídeo (a lista e o SRT continuam)'} className={`bti${oculto ? ' ligado' : ''}`} title={oculto ? 'Legendas escondidas: clique para mostrar no vídeo' : 'Esconder do vídeo (a lista e o SRT continuam)'}
              onClick={(e) => {
                e.stopPropagation();
                void trocar(documento, '/legendas/oculto', oculto ? undefined : true, oculto ? 'mostrar legendas' : 'esconder legendas');
              }}>
              {oculto ? <EyeOff /> : <Eye />}
            </button>
          )}
        </div>
        {!segs.length && (
          <span className="convite-legendas" onClick={(e) => {
            e.stopPropagation();
            selecionar({documento, caminho: '/legendas'});
          }}>Transcreva a narração ou importe um SRT para ver as legendas aqui</span>
        )}
        {segs.map((s) => {
          const a = arrasto?.id === s.id ? arrasto : null;
          const d = a ? (a.dms / 1000) * pxs : 0;
          const l = x(s.em) + (a && a.modo !== 'fim' ? d : 0);
          const w = Math.max(4, x(s.sai) - x(s.em) - 1 + (a?.modo === 'ini' ? -d : a?.modo === 'fim' ? d : 0));
          const sel = selecao === s.origem;
          return (
            <div key={s.id} className={`legenda${sel ? ' sel' : ''}`} style={{left: l, width: w}} title={`${s.falante ? `${s.falante}: ` : ''}${s.texto}`}
              onClick={(e) => e.stopPropagation()} onPointerDown={(e) => pegar(e, s, 'mover')} onPointerMove={mover} onPointerUp={() => soltar(s)}
              onPointerCancel={() => setArrasto(null)} data-legenda={s.origem}>
              {w > 18 && <span className="txt">{s.texto.replace(/\n/g, ' ')}</span>}
              {sel && w >= 24 && (
                <>
                  <span className="alc ini" title="Arraste para mudar onde entra" onPointerDown={(e) => pegar(e, s, 'ini')} />
                  <span className="alc fim" title="Arraste para mudar onde sai" onPointerDown={(e) => pegar(e, s, 'fim')} />
                </>
              )}
            </div>
          );
        })}
      </div>
    );
  };
