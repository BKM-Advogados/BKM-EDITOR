// Arranjo da Música, na faixa de baixo (onde o vídeo tem a linha do tempo): uma linha por canal, régua em compassos,
// os cortes das cenas do vídeo como marcadores (saem do vídeo na hora, não ficam gravados), a cabeça e o trecho do loop.
// Arrastar um clipe move (encaixa em semicolcheia; com Alt, livre), as alças aparam (o começo anda o corte do áudio ou o
// "inicio" do padrão, então o que toca fica no lugar), clicar seleciona, clicar na régua leva a cabeça. Teclas na área
// Música: Espaço toca, S divide o clipe na cabeça, Delete apaga, L repete o clipe, Home volta ao começo.
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Volume2, VolumeX, ZoomIn, ZoomOut} from 'lucide-react';
import {iconeDoCanal} from './Inspector';
import {acordeDe} from '../../../nucleo/musica-teoria';
import {posicaoEmCompasso, resolverMusica, type ClipeMusicaP, type DocMusica} from '../../../nucleo/musica';
import {notasDoClipe} from '../../../nucleo/musica-som';
import {cortesDoVideo} from '../../../nucleo/musica-video';
import type {DocCenas} from '../../../nucleo/cenas';
import {avisar, loja, useLoja} from '../../estado/loja';
import {musica, selecionarMusica, useMusica} from './estado';
import {arranjar, apagarSelecionado, campo, dividirNaCabeca} from './acoes';
import {alternarLoop, parar, tocarOuPausar, useDocMusica} from './Monitor';
import {motor, urlDaMidia} from './motor';
import {CabecaAutomacao, LinhaAutomacao} from './AutomacaoArranjo';
import type {Envelope} from '../../../nucleo/audio';

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

/** Envelopes medidos (midia/x.wav.envelope.json) dos áudios do arranjo; um fetch por arquivo, guardado na sessão. */
const envelopes = new Map<string, Promise<Envelope | null>>();
const envelopeDe = (arquivo: string) => {
  let p = envelopes.get(arquivo);
  if (!p) {
    p = fetch(urlDaMidia(`${arquivo}.envelope.json`)).then((r) => (r.ok ? (r.json() as Promise<Envelope>) : null)).catch(() => null);
    envelopes.set(arquivo, p);
  }
  return p;
};

/** Forma de onda do clipe de áudio (do envelope do arquivo, do corte até o fim do clipe), a mesma escala do vídeo. */
const Onda: React.FC<{arquivo: string; corte_s: number; dur_s: number; largura: number}> = ({arquivo, corte_s, dur_s, largura}) => {
  const [env, setEnv] = useState<Envelope | null>(null);
  useEffect(() => {
    let vivo = true;
    void envelopeDe(arquivo).then((e) => vivo && setEnv(e));
    return () => { vivo = false; };
  }, [arquivo]);
  const d = useMemo(() => {
    if (!env || largura < 8) return '';
    const n = Math.max(2, Math.min(Math.floor(largura / 2), Math.ceil((dur_s * 1000) / env.janela_ms)));
    const topo: string[] = [];
    const base: string[] = [];
    for (let j = 0; j < n; j++) {
      const i0 = Math.floor(((corte_s + (j / n) * dur_s) * 1000) / env.janela_ms);
      const i1 = Math.max(i0 + 1, Math.ceil(((corte_s + ((j + 1) / n) * dur_s) * 1000) / env.janela_ms));
      let db = -100;
      for (let i = i0; i < i1 && i < env.db.length; i++) if (env.db[i] > db) db = env.db[i];
      const h = db <= -100 ? 0 : Math.max(0, Math.min(1, (db + 48) / 48)) * 8; // −48 a 0 dB em 8 px para cada lado do eixo
      const x = ((j + 0.5) / n) * largura;
      topo.push(`${x.toFixed(1)},${(9 - h).toFixed(1)}`);
      base.unshift(`${x.toFixed(1)},${(9 + h).toFixed(1)}`);
    }
    return `M${topo.join('L')}L${base.join('L')}Z`;
  }, [env, corte_s, dur_s, largura]);
  if (!d) return null;
  return <svg className="onda" viewBox={`0 0 ${largura} 18`} preserveAspectRatio="none"><path d={d} /></svg>;
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
        {c.audio && <Onda arquivo={c.audio} corte_s={c.corte_s ?? 0} dur_s={dur * m.seg_por_batida} largura={largura} />}
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
  const [secaoArrastada, setSecaoArrastada] = useState<{id: string; x0: number; db: number} | null>(null);
  const rolo = useRef<HTMLDivElement>(null);
  const cabecas = useRef<HTMLDivElement>(null);
  // "pintar": arrastar no vazio de um canal de bateria ou de sintetizador põe um clipe do padrão em compassos inteiros
  const [pintura, setPintura] = useState<{canal: string; x0: number; a: number; b: number; max: number} | null>(null);
  const pintou = useRef(false);
  const padraoParaPintar = (canalId: string) => {
    const s = selecao;
    const clipe = s?.tipo === 'clipe' ? doc.arranjo.clipes.find((c) => c.id === s.id) : undefined;
    if (clipe?.padrao && clipe.canal === canalId) return clipe.padrao;
    const sp = s?.tipo === 'padrao' ? doc.padroes.find((p) => p.id === s.id) : undefined;
    if (sp?.canal === canalId) return sp.id;
    const ultimo = [...doc.arranjo.clipes].reverse().find((c) => c.canal === canalId && c.padrao);
    return ultimo?.padrao ?? doc.padroes.find((p) => p.canal === canalId)?.id;
  };
  const pintarComeco = (e: React.PointerEvent<HTMLDivElement>, canalId: string, tipo: string) => {
    if (e.button !== 0 || tipo === 'audio') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const b = (e.clientX - e.currentTarget.getBoundingClientRect().left) / px;
    const a = Math.floor(b / bpc) * bpc;
    const proximo = doc.arranjo.clipes.filter((c) => c.canal === canalId && c.em >= a + 1e-6).reduce((mn, c) => Math.min(mn, c.em), Infinity);
    setPintura({canal: canalId, x0: e.clientX, a, b: a + bpc, max: proximo});
  };
  const pintarMover = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pintura) return;
    const b = (e.clientX - e.currentTarget.getBoundingClientRect().left) / px;
    const fim = Math.max(pintura.a + bpc, Math.ceil(b / bpc) * bpc);
    setPintura({...pintura, b: Math.min(fim, pintura.max)});
  };
  const pintarFim = async (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pintura;
    setPintura(null);
    if (!p || Math.abs(e.clientX - p.x0) < 8) return;
    pintou.current = true;
    const padrao = padraoParaPintar(p.canal);
    if (!padrao) return avisar('Este canal ainda não tem padrão: crie um em Passos (+ Padrão) e arraste de novo', 'info');
    const r = await arranjar({acao: 'por', canal: p.canal, padrao, em: p.a, dur: p.b - p.a});
    const id = r?.extra?.clipe as string | undefined;
    if (id) selecionarMusica({tipo: 'clipe', id});
  };
  const bpc = m.batidas_por_compasso;
  const total = Math.max(16 * bpc, Math.ceil((m.duracao_batidas + 4 * bpc) / bpc) * bpc);
  const cortes = useMemo(() => (video ? cortesDoVideo(video).map((ms) => ({ms, b: (ms - (doc.video?.em_ms ?? 0)) / 1000 / m.seg_por_batida})).filter((x) => x.b > 0) : []),
    [video, doc.video?.em_ms, m.seg_por_batida]);

  // teclas da área Música (na captura, como as faixas de áudio do vídeo)
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (loja.get().area !== 'musica' || e.ctrlKey || e.altKey || e.metaKey || musica.get().focoNotas) return;
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
  const zoomar = (f: number) => musica.definir((s) => ({pxPorBatida: Math.min(160, Math.max(6, s.pxPorBatida * f))}));
  // Ctrl + roda do mouse: o ouvinte tem de ser nativo e não passivo para o preventDefault valer (o do React é passivo)
  useEffect(() => {
    const el = rolo.current;
    if (!el) return;
    const roda = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomar(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    el.addEventListener('wheel', roda, {passive: false});
    return () => el.removeEventListener('wheel', roda);
  }, []);
  const nomeDoClipe = (c: ClipeMusicaP) => {
    if (c.audio) return `${(c.audio.split('/').pop() ?? '').replace(/\.[0-9a-f]{16}(?=\.\w+$)/, '')}${c.corte_s ? ` · desde ${c.corte_s.toFixed(1)} s` : ''}`;
    const p = c.padrao ? doc.padroes.find((x) => x.id === c.padrao) : undefined;
    return p?.nome ?? c.padrao ?? c.id;
  };

  return (
    <div className="arranjo">
      <div className="cabecas" ref={cabecas}>
        <div className="cab-regua">{m.bpm} BPM · {m.compasso[0]}/{m.compasso[1]}
          <span className="zoom-botoes">
            <button className="bti" title="Afastar (Ctrl + roda do mouse)" onClick={() => zoomar(1 / 1.3)}><ZoomOut size={12} /></button>
            <button className="bti" title="Aproximar (Ctrl + roda do mouse)" onClick={() => zoomar(1.3)}><ZoomIn size={12} /></button>
          </span></div>
        {doc.secoes?.length ? <div className="cab-acordes" style={{color: 'var(--comentario)'}}>Seções</div> : null}
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
        <CabecaAutomacao doc={doc} />
        <div style={{height: 16}} /> {/* o espaço da barra de rolagem horizontal do arranjo: o fim das duas colunas coincide */}
      </div>
      <div className="rolo" ref={rolo} onScroll={(e) => { if (cabecas.current) cabecas.current.scrollTop = e.currentTarget.scrollTop; }} onClick={() => selecionarMusica(null)}>
        <div className="tela" style={{width: total * px + 40}}>
          <div className="regua" onClick={(e) => (e.stopPropagation(), irPara(e))} title="Clique para levar a cabeça; Ctrl + roda do mouse muda o zoom">
            {Array.from({length: Math.ceil(total / bpc)}, (_, k) => <span key={k} className="compasso" style={{left: k * bpc * px, width: bpc * px}}>{k + 1}</span>)}
            {loop && <span className="loop" style={{left: loop.de * px, width: ((loop.ate ?? m.duracao_batidas) - loop.de) * px}} />}
          </div>
          {doc.secoes?.length ? (
            <div className="faixa-acordes faixa-secoes" style={{position: 'relative', top: 0, height: 18, borderBottom: '1px solid var(--borda)'}}>
              {doc.secoes.map((s) => {
                const d = secaoArrastada?.id === s.id ? Math.round(secaoArrastada.db / bpc) * bpc : 0;
                return (
                  <span key={s.id} className="acorde secao" style={{left: Math.max(0, s.em + d) * px, width: Math.max(8, s.dur * px - 2)}} title={`${s.nome}: arraste para mover com os clipes`}
                    onPointerDown={(e) => (e.stopPropagation(), (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId), setSecaoArrastada({id: s.id, x0: e.clientX, db: 0}))}
                    onPointerMove={(e) => secaoArrastada?.id === s.id && setSecaoArrastada({...secaoArrastada, db: (e.clientX - secaoArrastada.x0) / px})}
                    onPointerUp={() => {
                      const a = secaoArrastada;
                      setSecaoArrastada(null);
                      const dd = a ? Math.round(a.db / bpc) * bpc : 0;
                      if (a && dd) void arranjar({acao: 'mover_secao', secao: s.id, em: Math.max(0, s.em + dd)});
                    }}
                    onClick={(e) => e.stopPropagation()}>{s.nome}</span>
                );
              })}
            </div>
          ) : null}
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
            <div key={canal.id} className={`linha-canal${canal.tipo === 'audio' ? '' : ' pintavel'}`}
              onPointerDown={(e) => pintarComeco(e, canal.id, canal.tipo)} onPointerMove={pintarMover} onPointerUp={(e) => void pintarFim(e)} onPointerCancel={() => setPintura(null)}
              onClick={(e) => { if (pintou.current) { pintou.current = false; e.stopPropagation(); } }}
              title={canal.tipo === 'audio' ? undefined : 'Arraste no vazio para pintar o padrão em compassos inteiros'}>
              {pintura?.canal === canal.id && <span className="mclipe fantasma" style={{left: pintura.a * px, width: Math.max(6, (pintura.b - pintura.a) * px - 1)}}>
                <span className="txt">{doc.padroes.find((x) => x.id === padraoParaPintar(canal.id))?.nome ?? 'sem padrão'} · {Math.round((pintura.b - pintura.a) / bpc)} comp.</span></span>}
              {m.clipes.filter((c) => c.canal === canal.id).map((c) => (
                <Clipe key={c.id} c={c} m={m} px={px} sel={selecao?.tipo === 'clipe' && selecao.id === c.id} arrasto={arrasto} titulo={nomeDoClipe(c)}
                  aoPegar={pegar} aoMover={mover} aoSoltar={soltar} veio={Boolean(doc.arranjo.clipes[c.indice]?.origem)} />
              ))}
            </div>
          ))}
          <LinhaAutomacao doc={doc} px={px} largura={total * px + 40} />
          <span className="cabeca" style={{left: (cabeca / m.seg_por_batida) * px, top: 0}} />
        </div>
        {avisos.length > 0 && <div className="vazio" style={{position: 'sticky', left: 0}}>{avisos.slice(0, 3).join(' · ')}</div>}
      </div>
    </div>
  );
};
