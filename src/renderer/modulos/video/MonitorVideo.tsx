// Monitor do vídeo: o Player do Remotion com a composição real e, por cima (fora da composição, para não mudar pixel),
// a seleção de bloco, o arrasto para reposicionar e os pinos de comentário. Clicar num bloco seleciona; com a ferramenta
// de comentário (C), clicar abre um balão ancorado no bloco, no tempo e no ponto do quadro.
import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {Player, type PlayerRef} from '@remotion/player';
import {ChevronLeft, ChevronRight, Download, MessageSquarePlus, MousePointer2, Pause, Play} from 'lucide-react';
import {CarrosselTema} from '../../../composicoes/cliente/CarrosselTema';
import {aplicar, avisar, comentar, loja, patchTrocar, selecionar, useLoja, valorEm} from '../../estado/loja';
import {alternar, andar, aoQuadro, FPS, formatarTempo, irPara, registrarPlayer} from './tocador';

const W = 1080;
const H = 1920;

type Caixa = {x: number; y: number; w: number; h: number};

const usarTamanho = (ref: React.RefObject<HTMLElement | null>) => {
  const [t, setT] = useState({w: 0, h: 0});
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setT({w: e.contentRect.width, h: e.contentRect.height}));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return t;
};

export const MonitorVideo: React.FC<{documento?: string}> = ({documento: docForcado}) => {
  const docAtivo = useLoja((e) => e.ativo.video);
  const documento = docForcado ?? docAtivo;
  const montado = useLoja((e) => (documento ? e.props[documento] : undefined));
  const selecao = useLoja((e) => e.selecao);
  const modoComentario = useLoja((e) => e.modoComentario);
  const comentarios = useLoja((e) => e.comentarios);
  const playerRef = useRef<PlayerRef>(null);
  const area = useRef<HTMLDivElement>(null);
  const palco = useRef<HTMLDivElement>(null);
  const {w, h} = usarTamanho(area);
  const escala = Math.max(0.05, Math.min((w - 24) / W, (h - 24) / H));
  const [ms, setMs] = useState(0);
  const [tocandoAgora, setTocando] = useState(false);
  const [caixaSel, setCaixaSel] = useState<Caixa | null>(null);
  const [hover, setHover] = useState<Caixa | null>(null);
  const [balao, setBalao] = useState<{x: number; y: number; origem?: string; contexto?: string} | null>(null);
  const [textoBalao, setTextoBalao] = useState('');
  const arrasto = useRef<{x0: number; y0: number; caminho: string; y: number; x: number; largura?: number; modo: 'mover' | 'largura'} | null>(null);
  const [desloc, setDesloc] = useState({dx: 0, dy: 0, dw: 0});

  const props = montado && 'props' in montado ? montado.props : null;
  const duracao = props ? Math.max(1, Math.ceil((props.duracao_ms / 1000) * FPS)) : 1;
  const previa = useLoja((e) => (e.previaEfeitos && e.previaEfeitos.documento === documento ? e.previaEfeitos.efeitos : undefined));
  const inputProps = useMemo(() => (props ? (previa ? {...props, efeitos: previa} : props) : {}), [props, previa]);

  useEffect(() => {
    registrarPlayer(playerRef.current);
    const p = playerRef.current;
    if (!p) return;
    const on = () => setTocando(true);
    const off = () => setTocando(false);
    p.addEventListener('play', on);
    p.addEventListener('pause', off);
    p.seekTo(Math.round((loja.get().tempo_ms / 1000) * FPS));
    return () => {
      p.removeEventListener('play', on);
      p.removeEventListener('pause', off);
    };
  }, [props !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => aoQuadro(setMs), []);

  const elementoDe = (origem: string) =>
    palco.current?.querySelector<HTMLElement>(`[data-origem="${CSS.escape(origem)}"]`) ?? null;
  const caixaDe = (el: HTMLElement): Caixa | null => {
    const b = palco.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!b || r.width === 0) return null;
    return {x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height};
  };

  // a caixa de seleção acompanha o quadro (blocos entram, sobem e saem)
  useEffect(() => {
    if (!selecao || selecao.documento !== documento) return setCaixaSel(null);
    const el = elementoDe(selecao.caminho);
    setCaixaSel(el ? caixaDe(el) : null);
  }, [selecao, ms, escala, props, documento]); // eslint-disable-line react-hooks/exhaustive-deps

  const atalhos = useRef<(e: KeyboardEvent) => void>(() => undefined);
  atalhos.current = (e: KeyboardEvent) => {
    const alvo = e.target as HTMLElement;
    if (/INPUT|TEXTAREA|SELECT/.test(alvo.tagName) || alvo.closest('.xterm') || !palco.current) return;
    if (e.key === ' ' || e.key.toLowerCase() === 'k') {
      e.preventDefault();
      alternar();
    } else if (e.key === 'ArrowLeft') andar(e.shiftKey ? -10 : -1);
    else if (e.key === 'ArrowRight') andar(e.shiftKey ? 10 : 1);
    else if (e.key.toLowerCase() === 'j') andar(-FPS);
    else if (e.key.toLowerCase() === 'l') andar(FPS);
    else if (e.key === 'Home') irPara(0);
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => atalhos.current(e);
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);

  const origemSob = (ev: React.MouseEvent) => {
    const el = document.elementsFromPoint(ev.clientX, ev.clientY).map((x) => (x as HTMLElement).closest?.('[data-origem]') as HTMLElement | null).find(Boolean);
    return el && palco.current?.contains(el) ? el : null;
  };

  const clicar = (ev: React.MouseEvent) => {
    if (!documento) return;
    const el = origemSob(ev);
    if (modoComentario) {
      const b = palco.current!.getBoundingClientRect();
      setTextoBalao('');
      setBalao({x: ev.clientX - b.left, y: ev.clientY - b.top, origem: el?.dataset.origem, contexto: el?.innerText.slice(0, 160)});
      return;
    }
    selecionar(el?.dataset.origem ? {documento, caminho: el.dataset.origem} : null);
  };

  const mover = (ev: React.MouseEvent) => {
    if (arrasto.current || modoComentario) return;
    const el = origemSob(ev);
    setHover(el && el.dataset.origem !== selecao?.caminho ? caixaDe(el) : null);
  };

  const iniciarArrasto = (ev: React.PointerEvent, modo: 'mover' | 'largura') => {
    if (!documento || !selecao || !/\/blocos\/\d+$/.test(selecao.caminho)) return;
    ev.stopPropagation();
    (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
    const bloco = valorEm(loja.get().docs[documento]?.doc, selecao.caminho) as {y?: number; x?: number; largura?: number} | undefined;
    arrasto.current = {x0: ev.clientX, y0: ev.clientY, caminho: selecao.caminho, y: bloco?.y ?? 600, x: bloco?.x ?? 70, largura: bloco?.largura, modo};
  };
  const durante = (ev: React.PointerEvent) => {
    const a = arrasto.current;
    if (!a) return;
    const dx = (ev.clientX - a.x0) / escala;
    const dy = (ev.clientY - a.y0) / escala;
    setDesloc(a.modo === 'mover' ? {dx, dy, dw: 0} : {dx: 0, dy: 0, dw: dx});
  };
  const soltar = async () => {
    const a = arrasto.current;
    arrasto.current = null;
    const d = desloc;
    setDesloc({dx: 0, dy: 0, dw: 0});
    if (!a || !documento || (Math.abs(d.dx) < 2 && Math.abs(d.dy) < 2 && Math.abs(d.dw) < 2)) return;
    const doc = loja.get().docs[documento]?.doc;
    const patch = a.modo === 'mover'
      ? [...patchTrocar(doc, `${a.caminho}/y`, Math.round(a.y + d.dy)), ...(Math.abs(d.dx) >= 2 ? patchTrocar(doc, `${a.caminho}/x`, Math.round(a.x + d.dx)) : [])]
      : patchTrocar(doc, `${a.caminho}/largura`, Math.max(80, Math.round((a.largura ?? 940) + d.dw)));
    await aplicar(documento, patch, a.modo === 'mover' ? `mover bloco ${a.caminho}` : `largura do bloco ${a.caminho}`);
  };

  const salvarComentario = async () => {
    if (!documento || !balao || !textoBalao.trim()) return setBalao(null);
    const b = palco.current!.getBoundingClientRect();
    const blocoId = balao.origem ? (valorEm(loja.get().docs[documento]?.doc, balao.origem) as {id?: string} | undefined)?.id : undefined;
    await comentar(documento, textoBalao.trim(), {
      objeto: balao.origem, objeto_id: blocoId, tempo_ms: Math.round(ms), contexto: balao.contexto,
      ponto: {x: +(balao.x / b.width).toFixed(4), y: +(balao.y / b.height).toFixed(4)},
    });
    setBalao(null);
    loja.definir({modoComentario: false});
  };

  const pinos = comentarios.filter((c) => c.documento === documento && c.alvo.ponto && c.alvo.tempo_ms !== undefined && Math.abs(c.alvo.tempo_ms - ms) < 1500);

  if (!documento) return <div className="vazio">nenhum vídeo no projeto</div>;
  return (
    <div className="painel">
      <div className="monitor" ref={area}>
        {montado && 'erro' in montado && <div className="vazio" style={{color: 'var(--erro)', position: 'absolute', top: 8, left: 8, right: 8, zIndex: 3, background: 'var(--fundo-2)', borderRadius: 6}}>
          {montado.erro}
        </div>}
        {props && (
          <div className="palco" ref={palco} style={{width: W * escala, height: H * escala, cursor: modoComentario ? 'crosshair' : 'default'}}
            onClick={clicar} onMouseMove={mover} onMouseLeave={() => setHover(null)}>
            <Player ref={playerRef} component={CarrosselTema as unknown as React.FC<Record<string, unknown>>} inputProps={inputProps}
              durationInFrames={duracao} fps={FPS} compositionWidth={W} compositionHeight={H}
              style={{width: W * escala, height: H * escala}} clickToPlay={false} spaceKeyToPlayOrPause={false}
              doubleClickToFullscreen={false} numberOfSharedAudioTags={12} />
            <div className="sobreposicao">
              {hover && !tocandoAgora && <div className="caixa-hover" style={{left: hover.x, top: hover.y, width: hover.w, height: hover.h}} />}
              {caixaSel && (
                <div className="caixa-sel" onPointerDown={(e) => iniciarArrasto(e, 'mover')} onPointerMove={durante} onPointerUp={() => void soltar()}
                  onClick={(e) => e.stopPropagation()}
                  style={{left: caixaSel.x + desloc.dx * escala, top: caixaSel.y + desloc.dy * escala, width: caixaSel.w + desloc.dw * escala, height: caixaSel.h}}>
                  {/\/blocos\/\d+$/.test(selecao?.caminho ?? '') && (
                    <div className="alca" onPointerDown={(e) => iniciarArrasto(e, 'largura')} onPointerMove={durante} onPointerUp={() => void soltar()} />
                  )}
                </div>
              )}
              {pinos.map((c) => (
                <div key={c.id} className={`pino${c.estado === 'resolvido' ? ' resolvido' : ''}`} title={c.texto}
                  style={{left: `${c.alvo.ponto!.x * 100}%`, top: `${c.alvo.ponto!.y * 100}%`}}
                  onClick={(e) => {
                    e.stopPropagation();
                    loja.definir({comentarioAberto: c.id});
                    if (c.alvo.objeto) selecionar({documento, caminho: c.alvo.objeto});
                  }}>
                  {c.id.replace(/\D/g, '').replace(/^0+/, '')}
                </div>
              ))}
              {balao && (
                <div className="balao" style={{left: Math.min(balao.x, W * escala - 270), top: Math.min(balao.y + 8, H * escala - 150)}} onClick={(e) => e.stopPropagation()}>
                  <div className="rotulo" style={{marginBottom: 6}}>comentário em {formatarTempo(ms)}{balao.origem ? ` · ${balao.origem}` : ''}</div>
                  <textarea className="campo" autoFocus value={textoBalao} onChange={(e) => setTextoBalao(e.target.value)} placeholder="O que mudar aqui?"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void salvarComentario();
                      if (e.key === 'Escape') setBalao(null);
                    }} />
                  <div style={{display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 6}}>
                    <button className="bt fantasma mini" onClick={() => setBalao(null)}>Cancelar</button>
                    <button className="bt principal mini" onClick={() => void salvarComentario()}>Comentar (Ctrl+Enter)</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="controles">
        <button className="bt fantasma mini" onClick={() => andar(-1)} title="Quadro anterior (←)"><ChevronLeft size={15} /></button>
        <button className="bt mini" onClick={() => alternar()} title="Tocar / pausar (Espaço)">{tocandoAgora ? <Pause size={14} /> : <Play size={14} />}</button>
        <button className="bt fantasma mini" onClick={() => andar(1)} title="Próximo quadro (→)"><ChevronRight size={15} /></button>
        <span className="tempo">{formatarTempo(ms)}<span className="largo"> / {formatarTempo(props?.duracao_ms ?? 0)}</span></span>
        <div className="ferramentas">
          <button className={`bt mini${!modoComentario ? ' ligado' : ''}`} onClick={() => loja.definir({modoComentario: false})} title="Selecionar (V)"><MousePointer2 size={13} /></button>
          <button className={`bt mini${modoComentario ? ' ligado' : ''}`} onClick={() => loja.definir({modoComentario: true})} title="Comentar (M)"><MessageSquarePlus size={13} /></button>
        </div>
        <span style={{flex: 1}} />
        <span className="rotulo largo">{Math.round(escala * 100)}%</span>
        <button className="bt mini" onClick={() => void exportar(documento)} title="Exportar MP4 (renderiza com o Remotion)"><Download size={13} /><span className="largo">Exportar</span></button>
      </div>
    </div>
  );
};

const exportar = async (documento: string) => {
  avisar('Exportando… (a primeira vez empacota as composições e pode levar um minuto)');
  const r = await window.estudio.exportarVideo(documento);
  avisar(r.ok ? `Exportado: ${r.arquivo}` : `Exportação: ${r.mensagem}`, r.ok ? 'ok' : 'erro');
};
