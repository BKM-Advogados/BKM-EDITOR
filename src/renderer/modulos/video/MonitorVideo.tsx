// Monitor do vídeo: o Player do Remotion com a composição real e, por cima (fora da composição, para não mudar pixel),
// a seleção de bloco, o arrasto para reposicionar e os pinos de comentário. À esquerda, o trilho (V seleção, M
// comentário); embaixo, o transporte com o código de tempo e J/K/L como shuttle. Clicar num bloco seleciona; com a
// ferramenta de comentário (M), clicar abre um balão ancorado no bloco, no tempo e no ponto do quadro.
// O tempo que muda a cada quadro não re-renderiza o monitor: o código de tempo é um <Tempo/> com ref, a caixa de
// seleção só muda de estado quando o bloco se mexe e os pinos olham uma janela de meio segundo. No transporte, a zona
// segura das redes (nucleo/zonas-seguras.ts) liga uma sobreposição por cima do quadro: escolha da interface, fora da
// exportação.
import React, {useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {Player, type PlayerRef} from '@remotion/player';
import {ChevronDown, Frame, MessageSquarePlus, MousePointer2, Pause, Play, Plus, Repeat2, SkipBack, SkipForward, StepBack, StepForward} from 'lucide-react';
import {COMPOSICOES, composicaoDe} from '../../../composicoes/registro';
import {etiquetasDeAudio, type AudioP} from '../../../nucleo/audio';
import {FORMATO_PADRAO} from '../../../nucleo/formatos';
import {classeDoQuadro, conjuntoDaClasse, CONJUNTO_QUADRADO, ZONAS_SEGURAS, type ClasseDoQuadro} from '../../../nucleo/zonas-seguras';
import {aplicar, comentar, loja, patchTrocar, selecionar, useLoja, valorEm} from '../../estado/loja';
import {Trilho, teclaLivre} from '../../componentes/Trilho';
import {BotaoMenu} from '../../componentes/Menu';
import {SemDocumento} from '../../componentes/SemDocumento';
import {Tempo} from './Tempo';
import {
  alternar, alternarRepetir, andar, aoQuadro, assinarControle, definirFps, FPS, formatarCurto, formatarTempo, irPara, lerControle, msAtual, parar, registrarPlayer,
  shuttle,
} from './tocador';
import {resumoBloco, tipoDe} from './tipos';
import {adicionarCena, dividirNaCabeca, duplicarSelecao, excluirSelecao} from './acoes';
import './zonas-seguras.css';
import {objetosMudados} from '../../estado/agente';
import {AvisoAgente, MarcasAgente} from '../../componentes/Agente';

const arred = (n: number) => Math.round(n * 10000) / 10000;

type Caixa = {x: number; y: number; w: number; h: number};
type CenaP = {tipo: string; t_in: number; blocos?: {em: number}[]};
const iguais = (a: Caixa | null, b: Caixa | null) =>
  a === b || (!!a && !!b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5);

const usarTamanho = (ref: React.RefObject<HTMLElement | null>) => {
  const [t, setT] = useState({w: 0, h: 0});
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // mede já na montagem: o ResizeObserver só avisa no próximo quadro desenhado (e nada, com a janela minimizada)
    setT({w: el.clientWidth, h: el.clientHeight});
    const ro = new ResizeObserver(([e]) => setT({w: e.contentRect.width, h: e.contentRect.height}));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return t;
};

// o vídeo reabre no último tempo parado; na primeira vez, no começo da 1ª parte (acaba a "prévia preta" do gancho) ou,
// no vídeo de cenas, logo depois da entrada do primeiro bloco
const chaveTempo = (documento: string) => `estudio:tempo:${loja.get().info?.raiz ?? ''}:${documento}`;
const lerTempo = (documento: string) => {
  try {
    const t = Number(localStorage.getItem(chaveTempo(documento)));
    return Number.isFinite(t) && t > 0 ? t : null;
  } catch {
    return null;
  }
};
const jaAbertos = new Set<string>();

// zona segura ligada no monitor: escolha da interface (não do documento), lembrada entre sessões **por tipo de quadro**
// (vertical, feed, YouTube e quadrado): o botão religa a zona que a pessoa usou em quadros como este, ou a do próprio quadro; um
// vídeo 16:9 não religa a zona do 9:16 de outro vídeo, e o 1:1 mostra só a margem, não as medidas do 4:5 (video-D13)
const chaveZona = (classe: ClasseDoQuadro) => `estudio:zona-segura:${classe}`;
const lerZona = (classe: ClasseDoQuadro): ClasseDoQuadro | null => {
  try {
    const v = localStorage.getItem(chaveZona(classe));
    return v && conjuntoDaClasse(v as ClasseDoQuadro) ? (v as ClasseDoQuadro) : null;
  } catch {
    return null;
  }
};
const gravarZona = (classe: ClasseDoQuadro, z: ClasseDoQuadro | null) => {
  try {
    if (z) localStorage.setItem(chaveZona(classe), z);
    else localStorage.removeItem(chaveZona(classe));
  } catch {
    /* sem armazenamento: vale só enquanto o app está aberto */
  }
};
const ultimaZona = new Map<ClasseDoQuadro, ClasseDoQuadro>(); // a que o botão religa, por tipo de quadro

export const MonitorVideo: React.FC<{documento?: string}> = ({documento: docForcado}) => {
  const docAtivo = useLoja((e) => e.ativo.video);
  const documento = docForcado ?? docAtivo;
  const montado = useLoja((e) => (documento ? e.props[documento] : undefined));
  const selecao = useLoja((e) => e.selecao);
  const modoComentario = useLoja((e) => e.modoComentario);
  const mudancas = useLoja((e) => e.mudancasAgente);
  const comentarios = useLoja((e) => e.comentarios);
  const tempoParado = useLoja((e) => e.tempo_ms);
  const blocoSel = useLoja((e) => (selecao && documento && selecao.documento === documento ? valorEm(e.docs[documento]?.doc, selecao.caminho) : undefined)) as
    {tipo?: string} | undefined;
  const controle = useSyncExternalStore(assinarControle, lerControle);
  const playerRef = useRef<PlayerRef>(null);
  const area = useRef<HTMLDivElement>(null);
  const palco = useRef<HTMLDivElement>(null);
  const {w, h} = usarTamanho(area);
  const margem = w < 480 ? 10 : 16;
  const [janela, setJanela] = useState(() => Math.round(loja.get().tempo_ms / 500)); // tempo em meios segundos, para os pinos
  const [tocandoAgora, setTocando] = useState(false);
  const [caixaSel, setCaixaSel] = useState<Caixa | null>(null);
  const [hover, setHover] = useState<Caixa | null>(null);
  const [balao, setBalao] = useState<{x: number; y: number; tempo: number; origem?: string; contexto?: string} | null>(null);
  const [textoBalao, setTextoBalao] = useState('');
  const arrasto = useRef<{x0: number; y0: number; caminho: string; y: number; x: number; largura?: number; modo: 'mover' | 'largura'} | null>(null);
  const [desloc, setDesloc] = useState({dx: 0, dy: 0, dw: 0});
  const [zona, setZona] = useState<ClasseDoQuadro | null>(null);

  const props = montado && 'props' in montado ? montado.props : null;
  // formato do vídeo: o vídeo de cenas traz largura, altura e fps nas props; o carrossel é 1080×1920 a 30
  const medidas = props as {largura?: number; altura?: number; fps?: number} | null;
  const W = medidas?.largura ?? FORMATO_PADRAO.largura;
  const H = medidas?.altura ?? FORMATO_PADRAO.altura;
  definirFps(medidas?.fps ?? FORMATO_PADRAO.fps);
  const escala = Math.max(0.05, Math.min((w - margem * 2) / W, (h - margem * 2) / H));
  const cenasRel = props?.composicao === 'VideoCenas'; // posição em frações do quadro (e não em px do 1080×1920)
  const sugerida = classeDoQuadro(W, H);
  // a zona ligada é a do tipo deste quadro, lida de novo quando o formato do vídeo muda (video-D13)
  useEffect(() => setZona(lerZona(sugerida)), [sugerida]);
  const escolherZona = (z: ClasseDoQuadro | null) => {
    setZona(z);
    gravarZona(sugerida, z);
    if (z) ultimaZona.set(sugerida, z);
  };
  const conjunto = conjuntoDaClasse(zona);
  const Componente = COMPOSICOES[composicaoDe(props)];
  const duracaoMs = props?.duracao_ms ?? 0;
  const duracao = props ? Math.max(1, Math.ceil((props.duracao_ms / 1000) * FPS)) : 1;
  const etiquetas = etiquetasDeAudio((props as {audio?: AudioP} | null)?.audio); // som-D10: o pool de <audio> cobre o pico de clipes
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
  }, [props !== null, Componente, W, H, medidas?.fps]); // eslint-disable-line react-hooks/exhaustive-deps

  // primeira abertura deste vídeo na sessão: último tempo guardado ou começo da 1ª parte
  useEffect(() => {
    if (!props || !documento) return;
    const chave = chaveTempo(documento);
    if (jaAbertos.has(chave)) return;
    jaAbertos.add(chave);
    if (loja.get().tempo_ms > 0) return;
    const parte = (props.cenas as CenaP[] | undefined)?.find((c) => c.tipo === 'parte');
    // vídeo de cenas: 0,8 s, com o primeiro bloco já entrado (no quadro 0 ele ainda está transparente)
    const t = lerTempo(documento) ?? (parte ? parte.t_in + 300 : props.composicao === 'VideoCenas' ? 800 : 0);
    if (t > 0) irPara(Math.min(t, props.duracao_ms));
  }, [props, documento]);
  useEffect(() => {
    if (!documento || tempoParado <= 0) return;
    try {
      localStorage.setItem(chaveTempo(documento), String(tempoParado));
    } catch {
      /* sem armazenamento: abre no começo da 1ª parte */
    }
  }, [tempoParado, documento]);

  const elementoDe = (origem: string) =>
    palco.current?.querySelector<HTMLElement>(`[data-origem="${CSS.escape(origem)}"]`) ?? null;
  const caixaDe = (el: HTMLElement): Caixa | null => {
    const b = palco.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!b || r.width === 0) return null;
    return {x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height};
  };

  // a caixa de seleção acompanha o quadro (blocos entram, sobem e saem), mas só muda de estado quando o bloco se mexe
  const medirSel = useRef(() => undefined as void);
  medirSel.current = () => {
    const el = selecao && selecao.documento === documento ? elementoDe(selecao.caminho) : null;
    const c = el ? caixaDe(el) : null;
    setCaixaSel((ant) => (iguais(ant, c) ? ant : c));
  };
  useEffect(() => {
    const q = requestAnimationFrame(() => medirSel.current());
    // o player redimensiona a composição depois da gente (o ResizeObserver dele): mede de novo quando ele terminou
    const t = setTimeout(() => medirSel.current(), 200);
    return () => (cancelAnimationFrame(q), clearTimeout(t));
  }, [selecao, escala, props, documento, tempoParado]);
  useEffect(() => {
    let q = 0;
    return aoQuadro((ms) => {
      setJanela(Math.round(ms / 500));
      if (!loja.get().selecao) return;
      cancelAnimationFrame(q);
      q = requestAnimationFrame(() => medirSel.current());
    });
  }, []);
  useEffect(() => setJanela(Math.round(tempoParado / 500)), [tempoParado]);

  // atalhos do monitor de vídeo: Espaço, J/K/L (shuttle; K+J e K+L andam um quadro), ←/→, ↑/↓ (bloco), Home/End
  const kSegurado = useRef(false);
  const atalhos = useRef<(e: KeyboardEvent) => void>(() => undefined);
  atalhos.current = (e: KeyboardEvent) => {
    if (!palco.current) return;
    const k = e.key.toLowerCase();
    // Delete, Ctrl+D e Ctrl+K (lâmina) só na área Vídeo (em Efeitos as mesmas teclas são da pilha de efeitos)
    const comCtrlD = e.ctrlKey && !e.altKey && !e.shiftKey && k === 'd';
    const comCtrlK = e.ctrlKey && !e.altKey && !e.shiftKey && k === 'k';
    if (loja.get().area === 'video' && documento && (e.key === 'Delete' || comCtrlD || comCtrlK) && teclaLivre(new KeyboardEvent('keydown', {key: e.key}), e.target)) {
      e.preventDefault();
      void (e.key === 'Delete' ? excluirSelecao(documento) : comCtrlK ? dividirNaCabeca(documento) : duplicarSelecao(documento));
      return;
    }
    if (!teclaLivre(e)) return;
    if (e.key === ' ') {
      e.preventDefault();
      alternar();
    } else if (k === 'k') {
      kSegurado.current = true;
      parar();
    } else if (k === 'j') kSegurado.current ? andar(-1) : shuttle(-1);
    else if (k === 'l') kSegurado.current ? andar(1) : shuttle(1);
    else if (e.key === 'ArrowLeft') andar(e.shiftKey ? -10 : -1);
    else if (e.key === 'ArrowRight') andar(e.shiftKey ? 10 : 1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const tempos = ((props?.cenas as CenaP[] | undefined) ?? []).flatMap((c) => [c.t_in, ...(c.blocos ?? []).map((b) => b.em)]).sort((a, z) => a - z);
      const agora = msAtual();
      const alvo = e.key === 'ArrowUp' ? [...tempos].reverse().find((t) => t < agora - 40) : tempos.find((t) => t > agora + 40);
      if (alvo !== undefined) irPara(alvo);
    } else if (e.key === 'Home') irPara(0);
    else if (e.key === 'End') irPara(duracaoMs);
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => atalhos.current(e);
    const solta = (e: KeyboardEvent) => e.key.toLowerCase() === 'k' && (kSegurado.current = false);
    const perdeu = () => (kSegurado.current = false);
    window.addEventListener('keydown', f);
    window.addEventListener('keyup', solta);
    window.addEventListener('blur', perdeu);
    return () => {
      window.removeEventListener('keydown', f);
      window.removeEventListener('keyup', solta);
      window.removeEventListener('blur', perdeu);
    };
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
      setBalao({x: ev.clientX - b.left, y: ev.clientY - b.top, tempo: Math.round(msAtual()), origem: el?.dataset.origem, contexto: el?.innerText.slice(0, 160)});
      return;
    }
    selecionar(el?.dataset.origem ? {documento, caminho: el.dataset.origem} : null);
  };

  const mover = (ev: React.MouseEvent) => {
    if (arrasto.current || modoComentario) return;
    const el = origemSob(ev);
    const c = el && el.dataset.origem !== selecao?.caminho ? caixaDe(el) : null;
    setHover((ant) => (iguais(ant, c) ? ant : c));
  };

  const iniciarArrasto = (ev: React.PointerEvent, modo: 'mover' | 'largura') => {
    if (!documento || !selecao || !/\/blocos\/\d+$/.test(selecao.caminho)) return;
    ev.stopPropagation();
    (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
    const bloco = valorEm(loja.get().docs[documento]?.doc, selecao.caminho) as {y?: number; x?: number; largura?: number} | undefined;
    arrasto.current = cenasRel
      ? {x0: ev.clientX, y0: ev.clientY, caminho: selecao.caminho, y: bloco?.y ?? 0.4, x: bloco?.x ?? 0.1, largura: bloco?.largura ?? 0.8, modo}
      : {x0: ev.clientX, y0: ev.clientY, caminho: selecao.caminho, y: bloco?.y ?? 600, x: bloco?.x ?? 70, largura: bloco?.largura, modo};
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
    const patch = cenasRel
      ? a.modo === 'mover'
        ? [...patchTrocar(doc, `${a.caminho}/y`, arred(a.y + d.dy / H)), ...(Math.abs(d.dx) >= 2 ? patchTrocar(doc, `${a.caminho}/x`, arred(a.x + d.dx / W)) : [])]
        : patchTrocar(doc, `${a.caminho}/largura`, Math.max(0.05, arred((a.largura ?? 0.8) + d.dw / W)))
      : a.modo === 'mover'
      ? [...patchTrocar(doc, `${a.caminho}/y`, Math.round(a.y + d.dy)), ...(Math.abs(d.dx) >= 2 ? patchTrocar(doc, `${a.caminho}/x`, Math.round(a.x + d.dx)) : [])]
      : patchTrocar(doc, `${a.caminho}/largura`, Math.max(80, Math.round((a.largura ?? 940) + d.dw)));
    await aplicar(documento, patch, a.modo === 'mover' ? `mover bloco ${a.caminho}` : `largura do bloco ${a.caminho}`);
  };

  const salvarComentario = async () => {
    if (!documento || !balao || !textoBalao.trim()) return setBalao(null);
    const b = palco.current!.getBoundingClientRect();
    const blocoId = balao.origem ? (valorEm(loja.get().docs[documento]?.doc, balao.origem) as {id?: string} | undefined)?.id : undefined;
    await comentar(documento, textoBalao.trim(), {
      objeto: balao.origem, objeto_id: blocoId, tempo_ms: balao.tempo, contexto: balao.contexto,
      ponto: {x: +(balao.x / b.width).toFixed(4), y: +(balao.y / b.height).toFixed(4)},
    });
    setBalao(null);
    loja.definir({modoComentario: false});
  };

  const agora = janela * 500;
  const pinos = comentarios.filter((c) => c.documento === documento && c.alvo.ponto && c.alvo.tempo_ms !== undefined && Math.abs(c.alvo.tempo_ms - agora) < 1500);
  const nomeSel = blocoSel?.tipo ? [tipoDe(blocoSel.tipo).nome, resumoBloco(blocoSel as Parameters<typeof resumoBloco>[0], 24)].filter(Boolean).join(' · ') : null;

  if (!documento) return <SemDocumento modulo="video" />;
  return (
    <div className="painel">
      <div className="monitor-grade">
        <Trilho grupos={[
          [
            {id: 'v', nome: 'Seleção', tecla: 'V', icone: <MousePointer2 />, ativa: !modoComentario, aoClicar: () => loja.definir({modoComentario: false})},
            {id: 'm', nome: 'Comentário', tecla: 'M', icone: <MessageSquarePlus />, ativa: modoComentario, aoClicar: () => loja.definir({modoComentario: true})},
          ],
        ]} />
        <div className="monitor" ref={area}>
          <AvisoAgente />
          {montado && 'erro' in montado && <div className="erro-monitor">{montado.erro}</div>}
          {props && (
            <div className="palco" ref={palco} style={{width: W * escala, height: H * escala, cursor: modoComentario ? 'crosshair' : 'default'}}
              onClick={clicar} onMouseMove={mover} onMouseLeave={() => setHover(null)}>
              <Player key={`${composicaoDe(props)}:${W}x${H}@${FPS}:${etiquetas}`} ref={playerRef} component={Componente} inputProps={inputProps}
                durationInFrames={duracao} fps={FPS} compositionWidth={W} compositionHeight={H} playbackRate={controle.taxa} loop={controle.repetir}
                style={{width: W * escala, height: H * escala}} clickToPlay={false} spaceKeyToPlayOrPause={false}
                doubleClickToFullscreen={false} numberOfSharedAudioTags={etiquetas} />
              <div className="sobreposicao">
                {cenasRel && !(props.cenas as unknown[]).length && (
                  <div className="sem-cenas" onClick={(e) => e.stopPropagation()}>
                    <span>Este vídeo ainda não tem cenas</span>
                    <button className="bt principal" onClick={() => void adicionarCena(documento)}><Plus size={14} />Adicionar a primeira cena</button>
                  </div>
                )}
                {conjunto && (
                  <div className="zonas-seguras" aria-hidden="true">
                    {conjunto.zonas.map((z, i) => (
                      <div key={i} className={`zona ${z.tipo}`} style={{left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.largura * 100}%`, height: `${z.altura * 100}%`}}>
                        <span>{z.rotulo}</span>
                      </div>
                    ))}
                  </div>
                )}
                <MarcasAgente caixas={objetosMudados(mudancas, documento).filter((o) => /\/blocos\/\d+$/.test(o)).flatMap((o) => {
                  const el = elementoDe(o);
                  const c = el ? caixaDe(el) : null;
                  return c ? [{chave: o, ...c}] : [];
                })} />
                {hover && !tocandoAgora && <div className="caixa-hover" style={{left: hover.x, top: hover.y, width: hover.w, height: hover.h}} />}
                {caixaSel && (
                  <div className="caixa-sel" onPointerDown={(e) => iniciarArrasto(e, 'mover')} onPointerMove={durante} onPointerUp={() => void soltar()}
                    onClick={(e) => e.stopPropagation()}
                    style={{left: caixaSel.x + desloc.dx * escala, top: caixaSel.y + desloc.dy * escala, width: caixaSel.w + desloc.dw * escala, height: caixaSel.h}}>
                    {nomeSel && caixaSel.y > 20 && <span className="etiqueta-sel">{nomeSel}</span>}
                    {/\/blocos\/\d+$/.test(selecao?.caminho ?? '') && (
                      <div className="alca" title="Arraste para mudar a largura" onPointerDown={(e) => iniciarArrasto(e, 'largura')} onPointerMove={durante} onPointerUp={() => void soltar()} />
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
                  <div className="balao" style={{left: Math.max(0, Math.min(balao.x, W * escala - 270)), top: Math.max(0, Math.min(balao.y + 8, H * escala - 150))}} onClick={(e) => e.stopPropagation()}>
                    <div className="rotulo" style={{marginBottom: 6}}>Comentário em {formatarTempo(balao.tempo)}</div>
                    <textarea className="campo" autoFocus value={textoBalao} onChange={(e) => setTextoBalao(e.target.value)} placeholder="O que mudar aqui?"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void salvarComentario();
                        if (e.key === 'Escape') setBalao(null);
                      }} />
                    <div style={{display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 6}}>
                      <button className="bt fantasma mini" onClick={() => setBalao(null)}>Cancelar</button>
                      <button className="bt principal mini" onClick={() => void salvarComentario()}>Comentar · Ctrl+Enter</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="transporte">
          <span className="tc"><Tempo />{controle.taxa !== 1 && <span className="taxa">{controle.taxa}×</span>}</span>
          <div className="centro">
            <button aria-label="Início  Home" className="bti largo" onClick={() => irPara(0)} title="Início  Home"><SkipBack /></button>
            <button aria-label="Quadro anterior  ←" className="bti" onClick={() => andar(-1)} title="Quadro anterior  ←"><StepBack /></button>
            <button aria-label="Tocar ou pausar  Espaço · J K L velocidade" className="bti tocar" onClick={() => alternar()} title="Tocar ou pausar  Espaço · J K L velocidade">{tocandoAgora ? <Pause /> : <Play />}</button>
            <button aria-label="Próximo quadro  →" className="bti" onClick={() => andar(1)} title="Próximo quadro  →"><StepForward /></button>
            <button aria-label="Fim  End" className="bti largo" onClick={() => irPara(duracaoMs)} title="Fim  End"><SkipForward /></button>
            <button aria-label="Repetir" className={`bti largo${controle.repetir ? ' ligado' : ''}`} onClick={alternarRepetir} title="Repetir"><Repeat2 /></button>
          </div>
          <span className="zona-botoes">
            <button aria-label={conjunto ? `Zona segura: ${conjunto.nome}. Clique para desligar` : 'Zona segura das redes: o que a interface do Reels, do TikTok e do YouTube cobre (só na tela, não sai na exportação)'} className={`bti${conjunto ? ' ligado' : ''}`} onClick={() => escolherZona(conjunto ? null : ultimaZona.get(sugerida) ?? lerZona(sugerida) ?? sugerida)}
              title={conjunto ? `Zona segura: ${conjunto.nome}. Clique para desligar` : 'Zona segura das redes: o que a interface do Reels, do TikTok e do YouTube cobre (só na tela, não sai na exportação)'}>
              <Frame />
            </button>
            <BotaoMenu titulo="Escolher a rede da zona segura" icone={<ChevronDown className="i12" />} className="bti estreito" acima lado="direita"
              itens={[...ZONAS_SEGURAS, {...CONJUNTO_QUADRADO, id: 'quadrado' as const}].map((z) => ({rotulo: `${z.nome} · ${z.proporcao}${z.id === sugerida ? ' · este quadro' : ''}`, acao: () => escolherZona(z.id)}))} />
          </span>
          <span className="dur" title="Duração"><span className="longa">{formatarTempo(duracaoMs)}</span><span className="curta">/{formatarCurto(duracaoMs)}</span></span>
        </div>
      </div>
    </div>
  );
};
