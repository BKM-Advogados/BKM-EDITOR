// Arranjo da Música, na faixa de baixo (onde o vídeo tem a linha do tempo): uma linha por canal, régua em compassos,
// os cortes das cenas do vídeo como marcadores (saem do vídeo na hora, não ficam gravados), a cabeça e o trecho do loop.
// Arrastar um clipe move (encaixa em semicolcheia; com Alt, livre), as alças aparam (o começo anda o corte do áudio ou o
// "inicio" do padrão, então o que toca fica no lugar), clicar seleciona, clicar na régua leva a cabeça. Teclas na área
// Música: Espaço toca, S divide o clipe na cabeça, Delete apaga, L repete o clipe, Home volta ao começo.
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Volume2, VolumeX} from 'lucide-react';
import {iconeDoCanal} from './Inspector';
import {acordeDe} from '../../../nucleo/musica-teoria';
import {posicaoEmCompasso, resolverMusica, type ClipeMusicaP, type DocMusica} from '../../../nucleo/musica';
import {notasDoClipe} from '../../../nucleo/musica-som';
import {cortesDoVideo} from '../../../nucleo/musica-video';
import type {DocCenas} from '../../../nucleo/cenas';
import {loja, useLoja} from '../../estado/loja';
import {musica, selecionarMusica, useMusica} from './estado';
import {arranjar, apagarSelecionado, campo, dividirNaCabeca} from './acoes';
import {alternarLoop, parar, tocarOuPausar, useDocMusica} from './Monitor';
import {motor} from './motor';

type Arrasto = {id: string; modo: 'mover' | 'ini' | 'fim'; x0: number; db: number; livre: boolean};
const passo = (b: number, livre: boolean) => (livre ? Math.round(b * 960) / 960 : Math.round(b * 4) / 4);

const comArrasto = (c: ClipeMusicaP, a: Arrasto | null) => {
  if (!a || a.id !== c.id) return {em: c.em, dur: c.dur};
  const d = passo(a.db, a.livre);
  if (a.modo === 'mover') return {em: Math.max(0, c.em + d), dur: c.dur};
  if (a.modo === 'ini') {
    const dd = Math.min(Math.max(d, -c.em), c.dur - 0.25);
    return {em: c.em + dd, dur: c.dur - dd};
  }
  return {em: c.em, dur: Math.max(0.25, c.dur + d)};
};

const Clipe: React.FC<{c: ClipeMusicaP; m: ReturnType<typeof resolverMusica>['musica']; px: number; sel: boolean; arrasto: Arrasto | null; titulo: string;
  aoPegar: (e: React.PointerEvent, c: ClipeMusicaP, modo: Arrasto['modo']) => void; aoMover: (e: React.PointerEvent) => void; aoSoltar: () => void; veio?: boolean}> =
  ({c, m, px, sel, arrasto, titulo, aoPegar, aoMover, aoSoltar, veio}) => {
    const {em, dur} = comArrasto(c, arrasto);
    const largura = Math.max(6, dur * px - 1);
    const notas = useMemo(() => (c.padrao ? notasDoClipe(m, c) : []), [c, m]);
    return (
      <div className={`mclipe${c.audio ? ' audio' : ''}${sel ? ' sel' : ''}${c.mudo ? ' mudo' : ''}`} style={{left: em * px, width: largura}} title={titulo}
        onPointerDown={(e) => aoPegar(e, c, 'mover')} onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerCancel={aoSoltar} onClick={(e) => e.stopPropagation()}>
        {largura > 30 && <span className="txt">{titulo}</span>}
        {notas.slice(0, 600).map((n, i) => {
          const x = (n.s / m.seg_por_batida - c.em) * px;
          const h = 4 + Math.round(((n.nota.forca ?? 100) / 127) * 12);
          return <span key={i} className="nota" style={{left: x, height: h, top: 30 - h}} />;
        })}
        {veio && <span className="veio">do vídeo</span>}
        {sel && largura > 24 && (
          <>
            <span className="alc ini" title="Aparar o começo" onPointerDown={(e) => aoPegar(e, c, 'ini')} />
            <span className="alc fim" title="Aparar o fim" onPointerDown={(e) => aoPegar(e, c, 'fim')} />
          </>
        )}
      </div>
    );
  };

export const ArranjoMusica: React.FC = () => {
  const {doc} = useDocMusica();
  if (!doc) return <div className="vazio">sem música aberta</div>;
  return <Arranjo doc={doc} />;
};

const Arranjo: React.FC<{doc: DocMusica}> = ({doc}) => {
  const {musica: m, avisos} = useMemo(() => resolverMusica(doc), [doc]);
  const px = useMusica((e) => e.pxPorBatida);
  const selecao = useMusica((e) => e.selecao);
  const cabeca = useMusica((e) => e.cabeca_s);
  const loop = useMusica((e) => (e.loop ? {de: e.loopDe ?? 0, ate: e.loopAte} : null));
  const video = useLoja((e) => (doc.video ? (e.docs[doc.video.documento]?.doc as DocCenas | undefined) : undefined));
  const [arrasto, setArrasto] = useState<Arrasto | null>(null);
  const rolo = useRef<HTMLDivElement>(null);
  const bpc = m.batidas_por_compasso;
  const total = Math.max(16 * bpc, Math.ceil((m.duracao_batidas + 4 * bpc) / bpc) * bpc);
  const cortes = useMemo(() => (video ? cortesDoVideo(video).map((ms) => ({ms, b: (ms - (doc.video?.em_ms ?? 0)) / 1000 / m.seg_por_batida})).filter((x) => x.b > 0) : []),
    [video, doc.video?.em_ms, m.seg_por_batida]);

  // teclas da área Música (na captura, como as faixas de áudio do vídeo)
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (loja.get().area !== 'musica' || e.ctrlKey || e.altKey || e.metaKey) return;
      const alvo = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(alvo.tagName) || alvo.isContentEditable || alvo.closest?.('.xterm') || document.querySelector('.dialogo-fundo')) return;
      const k = e.key.toLowerCase();
      const feito = () => (e.preventDefault(), e.stopPropagation());
      if (e.key === ' ') (feito(), tocarOuPausar());
      else if (k === 's') (feito(), void dividirNaCabeca());
      else if (e.key === 'Delete' || e.key === 'Backspace') (feito(), void apagarSelecionado());
      else if (k === 'l') (feito(), alternarLoop());
      else if (e.key === 'Home') (feito(), parar());
    };
    window.addEventListener('keydown', tecla, true);
    return () => window.removeEventListener('keydown', tecla, true);
  }, []);

  const pegar = (e: React.PointerEvent, c: ClipeMusicaP, modo: Arrasto['modo']) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    selecionarMusica({tipo: 'clipe', id: c.id});
    if (c.padrao) musica.definir({aba: 'passos'});
    setArrasto({id: c.id, modo, x0: e.clientX, db: 0, livre: e.altKey});
  };
  const mover = (e: React.PointerEvent) => {
    if (arrasto) setArrasto({...arrasto, db: (e.clientX - arrasto.x0) / px, livre: e.altKey});
  };
  const soltar = () => {
    const a = arrasto;
    setArrasto(null);
    if (!a) return;
    const c = m.clipes.find((x) => x.id === a.id);
    if (!c) return;
    const novo = comArrasto(c, a);
    if (Math.abs(novo.em - c.em) < 1e-6 && Math.abs(novo.dur - c.dur) < 1e-6) return;
    void (a.modo === 'mover' ? arranjar({acao: 'mover', clipe: c.id, em: novo.em}) : arranjar({acao: 'aparar', clipe: c.id, em: novo.em, dur: novo.dur}));
  };
  const irPara = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const b = Math.max(0, Math.round(((e.clientX - r.left) / px) * 4) / 4);
    const s = b * m.seg_por_batida;
    musica.definir({cabeca_s: s});
    if (motor.estaTocando()) (motor.parar(), tocarOuPausar());
  };
  const zoom = (e: React.WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    musica.definir((s) => ({pxPorBatida: Math.min(160, Math.max(6, s.pxPorBatida * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))}));
  };
  const nomeDoClipe = (c: ClipeMusicaP) => {
    if (c.audio) return `${c.audio.split('/').pop()}${c.corte_s ? ` · desde ${c.corte_s.toFixed(1)} s` : ''}`;
    const p = c.padrao ? doc.padroes.find((x) => x.id === c.padrao) : undefined;
    return p?.nome ?? c.padrao ?? c.id;
  };

  return (
    <div className="arranjo">
      <div className="cabecas">
        <div className="cab-regua">{m.bpm} BPM · {m.compasso[0]}/{m.compasso[1]}</div>
        {doc.acordes?.length ? <div className="cab-acordes">Acordes · {doc.tom ?? 'C'} {doc.escala ?? 'maior'}</div> : null}
        {m.canais.map((c, i) => (
          <div key={c.id} className={`cab-canal${selecao?.tipo === 'canal' && selecao.id === c.id ? ' sel' : ''}`} onClick={() => selecionarMusica({tipo: 'canal', id: c.id})}>
            {iconeDoCanal(c, 14)}
            <span className="nome" title={c.id}>{c.nome}</span>
            <button className={`bti${c.mudo ? ' ligado' : ''}`} title="Mudo" onClick={(e) => (e.stopPropagation(), void campo(`/canais/${i}/mudo`, c.mudo ? undefined : true, `mudo em ${c.nome}`))}>
              {c.mudo ? <VolumeX size={12} /> : <Volume2 size={12} />}
            </button>
            <button className={`bti${c.solo ? ' ligado' : ''}`} title="Solo" onClick={(e) => (e.stopPropagation(), void campo(`/canais/${i}/solo`, c.solo ? undefined : true, `solo em ${c.nome}`))}>S</button>
          </div>
        ))}
      </div>
      <div className="rolo" ref={rolo} onWheel={zoom} onClick={() => selecionarMusica(null)}>
        <div className="tela" style={{width: total * px + 40}}>
          <div className="regua" onClick={(e) => (e.stopPropagation(), irPara(e))} title="Clique para levar a cabeça; Ctrl + roda do mouse muda o zoom">
            {Array.from({length: Math.ceil(total / bpc)}, (_, k) => <span key={k} className="compasso" style={{left: k * bpc * px, width: bpc * px}}>{k + 1}</span>)}
            {loop && <span className="loop" style={{left: loop.de * px, width: ((loop.ate ?? m.duracao_batidas) - loop.de) * px}} />}
          </div>
          {doc.acordes?.length ? (
            <div className="faixa-acordes" style={{position: 'relative', top: 0, height: 18, borderBottom: '1px solid var(--borda)'}}>
              {doc.acordes.map((a, k) => (
                <span key={k} className="acorde" style={{left: a.em * px, width: Math.max(8, a.dur * px - 2)}} title={`${a.acorde} · ${posicaoEmCompasso(a.em, m.compasso)}`}>
                  {acordeDe(a.acorde, doc.tom, doc.escala)?.nome ?? a.acorde}
                </span>
              ))}
            </div>
          ) : null}
          {Array.from({length: Math.ceil(total / bpc) + 1}, (_, k) => <span key={`g${k}`} className="grade compasso" style={{left: k * bpc * px}} />)}
          {px >= 14 && Array.from({length: total}, (_, b) => (b % bpc ? <span key={`b${b}`} className="grade" style={{left: b * px}} /> : null))}
          {cortes.map((c) => <span key={c.ms} className="corte" style={{left: c.b * px}}><span>corte {(c.ms / 1000).toFixed(1)} s</span></span>)}
          {m.canais.map((canal) => (
            <div key={canal.id} className="linha-canal">
              {m.clipes.filter((c) => c.canal === canal.id).map((c) => (
                <Clipe key={c.id} c={c} m={m} px={px} sel={selecao?.tipo === 'clipe' && selecao.id === c.id} arrasto={arrasto} titulo={nomeDoClipe(c)}
                  aoPegar={pegar} aoMover={mover} aoSoltar={soltar} veio={Boolean(doc.arranjo.clipes[c.indice]?.origem)} />
              ))}
            </div>
          ))}
          <span className="cabeca" style={{left: (cabeca / m.seg_por_batida) * px, top: 0}} />
        </div>
        {avisos.length > 0 && <div className="vazio" style={{position: 'sticky', left: 0}}>{avisos.slice(0, 3).join(' · ')}</div>}
      </div>
    </div>
  );
};
