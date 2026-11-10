// Linha do tempo do vídeo: régua hierárquica, cenas, blocos (em faixas, porque se sobrepõem), as palavras da narração
// e os comentários. Clicar ou arrastar na régua busca o tempo; arrastar um bloco muda a palavra em que ele entra; as
// alças do bloco selecionado mudam onde ele entra e onde sai (as âncoras viram "palavra@ms" da palavra mais perto).
// O zoom fica na loja (vale também em Efeitos) e começa em "ajustar à janela". A cabeça anda pelo DOM, sem re-render.
// No vídeo de cenas não há narração: arrastar grava ms contados do começo da cena, e a alça da cena selecionada muda a
// duração dela. Abaixo dos blocos, o vídeo de cenas tem as faixas de áudio (FaixasAudio.tsx), e a barra ganha o
// "+ Áudio" (narração, música, efeito ou música da biblioteca).
import React, {useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {Maximize2, Mic, Music, Plus, Volume2, ZoomIn, ZoomOut} from 'lucide-react';
import type {AudioP} from '../../../nucleo/audio';
import type {LegendasP} from '../../../nucleo/legendas'; // frente Fala
import type {Palavra, TrechoNarracao} from '../../../nucleo/roteiro/resolver';
import {aplicar, loja, patchTrocar, selecionar, trocar, useLoja, valorEm} from '../../estado/loja';
import {BotaoMenu} from '../../componentes/Menu';
import {teclaLivre} from '../../componentes/Trilho';
import {ancoraPerto} from './ancoras';
import {adicionarClipeAudio} from './acoes-audio';
import {BibliotecaTrilhas} from './BibliotecaTrilhas';
import {GravadorNarracao} from './GravadorNarracao'; // frente Som (rodada 3)
import {medirPendentes} from './envelope';
import {FaixasAudio} from './FaixasAudio';
import {FaixaLegendas} from './FaixaLegendas'; // frente Fala
import {aoQuadro, irPara, msAtual, tocando} from './tocador';
import {tipoDe} from './tipos';

type BlocoP = {tipo: string; em: number; sai?: number; origem?: string; texto?: string; id?: string};
type CenaP = {tipo: string; t_in: number; t_out: number; n?: number; titulo?: string; nome?: string; tag?: string; origem?: string; blocos?: BlocoP[]};
type Legenda = {s: number; e: number; palavras: {w: string; s?: number; e?: number}[]};
type PropsLt = {duracao_ms: number; cenas: CenaP[]; legendas?: Legenda[]; narracao?: {trechos: TrechoNarracao[]}; composicao?: string; audio?: AudioP | string};
type ArrastoCena = {origem: string; x0: number; dms: number; dur: number};
type Arrasto = {origem: string; modo: 'mover' | 'ini' | 'fim'; x0: number; dms: number; em: number; fim: number};

const ESQ = 12; // respiro antes do zero
const ZOOM_MAX = 400; // px por segundo
const PASSOS = [1, 2, 5, 10, 15, 30, 60, 120, 300]; // segundos entre rótulos da régua

// ---------- o que a barra de ações precisa saber (a barra pode morar no cabeçalho do grupo, fora deste painel) ----------
type Medidas = {ajuste: number; blocos: number; clipes: number; zoom: (pxs: number | null, clientX?: number) => void; audio?: string} | null; // audio: o documento de cenas que aceita "+ Áudio"
let medidas: Medidas = null;
const ouvintesMedidas = new Set<() => void>();
const publicar = (m: Medidas) => {
  medidas = m;
  ouvintesMedidas.forEach((f) => f());
};
const assinarMedidas = (f: () => void) => {
  ouvintesMedidas.add(f);
  return () => {
    ouvintesMedidas.delete(f);
  };
};
let noCabecalho = 0;
const ouvintesCabecalho = new Set<() => void>();
const assinarCabecalho = (f: () => void) => {
  ouvintesCabecalho.add(f);
  return () => {
    ouvintesCabecalho.delete(f);
  };
};

/** Ajustar à janela, zoom e contador de blocos. Pode ir no cabeçalho do grupo do dockview (rightHeaderActionsComponent,
 *  com `noCabecalho`): aí a linha do tempo esconde a barra própria e devolve os 28 px. */
export const AcoesLinhaDoTempo: React.FC<{noCabecalho?: boolean}> = ({noCabecalho: cab}) => {
  const m = useSyncExternalStore(assinarMedidas, () => medidas);
  const zoom = useLoja((e) => e.zoomLinha);
  useEffect(() => {
    if (!cab) return;
    noCabecalho++;
    ouvintesCabecalho.forEach((f) => f());
    return () => {
      noCabecalho--;
      ouvintesCabecalho.forEach((f) => f());
    };
  }, [cab]);
  const [biblioteca, setBiblioteca] = useState(false);
  const [gravador, setGravador] = useState(false);
  if (!m) return null;
  const minimo = Math.min(m.ajuste, 2);
  const pxs = zoom ?? m.ajuste;
  const passo = (f: number) => m.zoom(Math.max(minimo, Math.min(ZOOM_MAX, pxs * f)));
  const documento = m.audio;
  return (
    <div className="acoes-lt">
      {documento && (
        <span style={{position: 'relative', display: 'inline-flex', marginRight: 6}}>
          <BotaoMenu titulo="Adicionar áudio: narração, música ou efeito (copia o arquivo para midia/)" icone={<Plus size={13} />} rotulo="Áudio" className="bt fantasma mini" lado="esquerda"
            itens={[
              {rotulo: 'Narração…', icone: <Mic className="i14" />, acao: () => void adicionarClipeAudio(documento, 'voz')},
              {rotulo: 'Gravar narração…', icone: <Mic className="i14" />, acao: () => setGravador(true)},
              {rotulo: 'Música…', icone: <Music className="i14" />, acao: () => void adicionarClipeAudio(documento, 'musica')},
              {rotulo: 'Efeito sonoro…', icone: <Volume2 className="i14" />, acao: () => void adicionarClipeAudio(documento, 'efeitos')},
              'sep',
              {rotulo: 'Música da biblioteca…', icone: <Music className="i14" />, acao: () => setBiblioteca(true)},
            ]} />
          {biblioteca && <BibliotecaTrilhas documento={documento} aoFechar={() => setBiblioteca(false)} />}
          {gravador && <GravadorNarracao documento={documento} aoFechar={() => setGravador(false)} />}
        </span>
      )}
      <button className={`bti${zoom === null ? ' ligado' : ''}`} onClick={() => m.zoom(null)} title="Ajustar à janela  Shift+Z"><Maximize2 /></button>
      <button className="bti" onClick={() => passo(1 / 1.5)} title="Afastar  −"><ZoomOut /></button>
      <input type="range" aria-label="Zoom da linha do tempo" min={Math.log(minimo)} max={Math.log(ZOOM_MAX)} step={0.01} value={Math.log(pxs)}
        onChange={(e) => m.zoom(Math.exp(Number(e.target.value)))} />
      <button className="bti" onClick={() => passo(1.5)} title="Aproximar  ="><ZoomIn /></button>
      <span className="conta">{m.blocos} {m.blocos === 1 ? 'bloco' : 'blocos'}{m.clipes > 0 && ` · ${m.clipes} ${m.clipes === 1 ? 'clipe' : 'clipes'}`}</span>
    </div>
  );
};

// rolagem guardada entre montagens (a casca remonta os painéis ao trocar de área)
const rolagem = {x: 0, y: 0};
let medidor: CanvasRenderingContext2D | null = null;
const larguraTexto = (t: string) => {
  medidor ??= document.createElement('canvas').getContext('2d');
  if (!medidor) return t.length * 6;
  medidor.font = '11px "Inter Variable", "Segoe UI", sans-serif';
  return medidor.measureText(t).width;
};

/** Passo da régua: o menor da lista que deixa pelo menos 64 px entre rótulos. */
const passoRegua = (pxs: number) => PASSOS.find((s) => s * pxs >= 64) ?? PASSOS[PASSOS.length - 1];
const rotuloSeg = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export const LinhaDoTempo: React.FC = () => {
  const documento = useLoja((e) => (e.area === 'efeitos' ? e.alvoEfeitos ?? e.ativo.video : e.ativo.video));
  const montado = useLoja((e) => (documento ? e.props[documento] : undefined));
  const selecao = useLoja((e) => e.selecao);
  const comentarios = useLoja((e) => e.comentarios);
  const zoom = useLoja((e) => e.zoomLinha);
  const caminhoPalavras = useLoja((e) => (documento ? (e.docs[documento]?.doc as {palavras?: string} | undefined)?.palavras : undefined));
  const barraNoCabecalho = useSyncExternalStore(assinarCabecalho, () => noCabecalho > 0);
  const [palavras, setPalavras] = useState<Palavra[]>([]);
  const [arrasto, setArrasto] = useState<Arrasto | null>(null);
  const [arrastoCena, setArrastoCena] = useState<ArrastoCena | null>(null);
  const [largura, setLargura] = useState(0);
  const caixa = useRef<HTMLDivElement>(null);
  const cabeca = useRef<HTMLDivElement>(null);
  const alcaCabeca = useRef<HTMLDivElement>(null);
  const ancoraZoom = useRef<{t: number; xl: number} | null>(null);

  useEffect(() => {
    if (caminhoPalavras) void window.estudio.lerJson<Palavra[]>(caminhoPalavras).then(setPalavras).catch(() => setPalavras([]));
  }, [caminhoPalavras]);

  // largura visível: só muda no redimensionar (o zoom "ajustar" depende dela)
  useLayoutEffect(() => {
    const c = caixa.current;
    if (!c) return;
    const ro = new ResizeObserver(() => setLargura(c.clientWidth));
    ro.observe(c);
    setLargura(c.clientWidth);
    return () => ro.disconnect();
  }, [montado !== undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  const props = montado && 'props' in montado ? (montado.props as unknown as PropsLt) : null;
  const durS = Math.max(1, (props?.duracao_ms ?? 1000) / 1000);
  const ajuste = Math.max(0.5, (Math.max(largura, 120) - ESQ * 2) / durS);
  const pxs = zoom ?? ajuste;
  const x = (t: number) => ESQ + (t / 1000) * pxs;
  const pxsRef = useRef(pxs);
  pxsRef.current = pxs;

  // blocos em faixas: cada bloco vai na primeira faixa livre no tempo dele
  const faixas = useMemo(() => {
    if (!props) return [] as {b: BlocoP; fim: number}[][];
    const todos = props.cenas.flatMap((c) => (c.blocos ?? []).map((b) => ({b, fim: b.sai ?? c.t_out})));
    const out: {b: BlocoP; fim: number}[][] = [];
    for (const item of todos.sort((a, z) => a.b.em - z.b.em)) {
      const f = out.find((fx) => fx[fx.length - 1].fim <= item.b.em);
      if (f) f.push(item);
      else out.push([item]);
    }
    return out;
  }, [props]);
  const nBlocos = faixas.reduce((n, f) => n + f.length, 0);
  // só o vídeo de cenas tem faixas de áudio; no roteiro do carrossel narrado `audio` é o nome do arquivo da narração
  const audioFaixas = props && typeof props.audio === 'object' && Array.isArray(props.audio.faixas) ? props.audio : undefined;
  const nClipes = audioFaixas?.faixas.reduce((n, f) => n + f.clipes.length, 0) ?? 0;
  // clipe sem envelope (arquivo trocado à mão, projeto de outro PC): mede em segundo plano e as props voltam com a onda
  useEffect(() => medirPendentes(audioFaixas && {audio: audioFaixas}), [audioFaixas]);

  // palavras da fala no tempo de saída; as que não cabem sem encostar na anterior ficam de fora
  const falas = useMemo(() => {
    if (!props) return [] as {w: string; s: number; l: number}[];
    const lista = (props.legendas ?? []).flatMap((l) => l.palavras.map((p, i) => ({w: p.w, s: p.s ?? (i === 0 ? l.s : NaN)}))).filter((p) => Number.isFinite(p.s));
    const out: {w: string; s: number; l: number}[] = [];
    let fim = -Infinity;
    for (const p of lista) {
      const l = ESQ + (p.s / 1000) * pxs;
      if (l < fim + 6) continue;
      out.push({...p, l});
      fim = l + larguraTexto(p.w);
    }
    return out;
  }, [props, pxs]);

  // zoom no ponto do cursor (ou no meio da área visível)
  const aplicarZoom = (novo: number | null, clientX?: number) => {
    const c = caixa.current;
    if (c) {
      const r = c.getBoundingClientRect();
      const xl = clientX !== undefined ? clientX - r.left : c.clientWidth / 2;
      ancoraZoom.current = {t: (c.scrollLeft + xl - ESQ) / pxsRef.current, xl};
    }
    loja.definir({zoomLinha: novo === null ? null : Math.max(Math.min(ajuste, 2), Math.min(ZOOM_MAX, novo))});
  };
  const zoomRef = useRef(aplicarZoom);
  zoomRef.current = aplicarZoom;

  useEffect(() => {
    if (!props) return;
    publicar({ajuste, blocos: nBlocos, clipes: nClipes, zoom: (p, cx) => zoomRef.current(p, cx), audio: props.composicao === 'VideoCenas' ? documento : undefined});
  }, [ajuste, nBlocos, nClipes, props !== null, props?.composicao, documento]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => publicar(null), []);

  // depois do zoom, devolve a rolagem para o mesmo tempo sob o cursor; e repinta a cabeça na escala nova
  useLayoutEffect(() => {
    const c = caixa.current;
    const a = ancoraZoom.current;
    if (c && a) c.scrollLeft = Math.max(0, a.t * pxs + ESQ - a.xl);
    ancoraZoom.current = null;
    pintarCabeca(msAtual());
  }, [pxs]); // eslint-disable-line react-hooks/exhaustive-deps

  // rolagem: volta onde estava; roda pura rola na horizontal, Shift+roda na vertical, Ctrl/Alt+roda aproxima no cursor
  useLayoutEffect(() => {
    const c = caixa.current;
    if (!c) return;
    c.scrollLeft = rolagem.x;
    c.scrollTop = rolagem.y;
    const guardar = () => {
      rolagem.x = c.scrollLeft;
      rolagem.y = c.scrollTop;
    };
    const roda = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.altKey) zoomRef.current(pxsRef.current * Math.exp(-e.deltaY * 0.0025), e.clientX);
      else if (e.shiftKey) c.scrollTop += e.deltaY || e.deltaX;
      else c.scrollLeft += e.deltaY + e.deltaX;
    };
    c.addEventListener('scroll', guardar, {passive: true});
    c.addEventListener('wheel', roda, {passive: false});
    return () => {
      c.removeEventListener('scroll', guardar);
      c.removeEventListener('wheel', roda);
    };
  }, [props !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // a cabeça anda pelo DOM: nada de re-render a 30 Hz
  const pintarCabeca = (ms: number) => {
    const px = ESQ + (ms / 1000) * pxsRef.current;
    if (cabeca.current) cabeca.current.style.transform = `translateX(${px}px)`;
    if (alcaCabeca.current) alcaCabeca.current.style.transform = `translateX(${px}px)`;
    const c = caixa.current;
    if (c && tocando() && (px < c.scrollLeft + 40 || px > c.scrollLeft + c.clientWidth - 40)) c.scrollLeft = Math.max(0, px - c.clientWidth / 3);
  };
  const pintarRef = useRef(pintarCabeca);
  pintarRef.current = pintarCabeca;
  useEffect(() => {
    let ultimo = loja.get().tempo_ms;
    const sairQuadro = aoQuadro((ms) => pintarRef.current(ms));
    const sairLoja = loja.assinar(() => {
      const t = loja.get().tempo_ms;
      if (t === ultimo) return;
      ultimo = t;
      pintarRef.current(t);
      const c = caixa.current;
      const px = ESQ + (t / 1000) * pxsRef.current;
      if (c && !tocando() && (px < c.scrollLeft || px > c.scrollLeft + c.clientWidth)) c.scrollLeft = Math.max(0, px - c.clientWidth / 3);
    });
    return () => {
      sairQuadro();
      sairLoja();
    };
  }, []);
  useLayoutEffect(() => pintarCabeca(msAtual()));

  // Shift+Z (ou \) ajusta à janela; = e - aproximam e afastam
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(alvo.tagName) || alvo.isContentEditable || alvo.closest?.('.xterm') || e.ctrlKey || e.altKey) return;
      if ((e.shiftKey && e.code === 'KeyZ') || e.code === 'IntlBackslash' || e.code === 'Backslash') {
        e.preventDefault();
        zoomRef.current(null);
      } else if (teclaLivre(e) && (e.key === '=' || e.key === '+')) zoomRef.current(pxsRef.current * 1.5);
      else if (teclaLivre(e) && e.key === '-') zoomRef.current(pxsRef.current / 1.5);
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, []);

  if (!documento || !props) return <div className="vazio">{montado && 'erro' in montado ? montado.erro : 'sem vídeo'}</div>;
  // clipe de áudio que passa do fim do vídeo continua alcançável (para aparar ou arrastar de volta)
  const fimAudio = audioFaixas?.faixas.reduce((m, f) => f.clipes.reduce((n, c) => Math.max(n, c.em + c.duracao_ms), m), 0) ?? 0;
  const larguraConteudo = Math.max(largura, x(Math.max(props.duracao_ms, fimAudio)) + ESQ);

  // régua hierárquica: rótulos a cada passo; marcas menores quando cabem; traço de quadro a partir de 240 px/s
  const passo = passoRegua(pxs);
  const menor = [passo / 5, passo / 2].find((m) => m * pxs >= 8 && Number.isInteger(m * 10)) ?? 0;
  // a duração inteira (rolar não re-renderiza); o traço de quadro é um degradê repetido, não um nó por quadro
  const marcas: React.ReactNode[] = [];
  for (let s = 0; s <= durS + 1e-6; s += passo) {
    marcas.push(<div key={`M${s}`} className="tq maior" style={{left: x(s * 1000)}} />, <div key={`R${s}`} className="rot-t" style={{left: x(s * 1000)}}>{rotuloSeg(s)}</div>);
    if (menor) for (let m = s + menor; m < s + passo - 1e-6 && m <= durS; m += menor) marcas.push(<div key={`m${m.toFixed(2)}`} className="tq menor" style={{left: x(m * 1000)}} />);
  }
  // o traço de quadro segue os qps do vídeo (60 qps = um traço a cada 1/60 s, não a cada 1/30 s; video-D16)
  const qps = Number((props as {fps?: number}).fps) > 0 ? Number((props as {fps?: number}).fps) : 30;
  const quadros: React.CSSProperties | undefined = pxs >= 240 ? {
    backgroundImage: `repeating-linear-gradient(90deg, var(--borda) 0 1px, transparent 1px ${pxs / qps}px)`,
    backgroundSize: `${x(props.duracao_ms) - ESQ}px 3px`, backgroundPosition: `${ESQ}px 100%`, backgroundRepeat: 'no-repeat',
  } : undefined;

  const tempoDoPonto = (clientX: number) => {
    const b = caixa.current!.getBoundingClientRect();
    return Math.max(0, Math.min(props.duracao_ms, ((clientX - b.left + caixa.current!.scrollLeft - ESQ) / pxs) * 1000));
  };
  const buscar = (ev: React.MouseEvent) => irPara(tempoDoPonto(ev.clientX));
  let quadroBusca = 0;
  const arrastarRegua = (ev: React.PointerEvent) => {
    if (!(ev.buttons & 1)) return;
    const cx = ev.clientX;
    cancelAnimationFrame(quadroBusca);
    quadroBusca = requestAnimationFrame(() => irPara(tempoDoPonto(cx)));
  };

  const deCenas = props.composicao === 'VideoCenas';
  // vídeo de cenas: tempos em ms desde o começo da cena, em passos de 50 ms, sem sair dela
  const soltarBlocoCenas = async (a: Arrasto) => {
    const cena = props.cenas.find((c) => a.origem.startsWith(`${c.origem}/`));
    if (!cena) return;
    const doc = loja.get().docs[documento]?.doc;
    const b = valorEm(doc, a.origem) as {em?: number; sai?: number} | undefined;
    if (!b) return;
    const dur = cena.t_out - cena.t_in;
    const r50 = (v: number) => Math.round(v / 50) * 50;
    const emRel = a.em - cena.t_in;
    const fimRel = a.fim - cena.t_in;
    let patch;
    if (a.modo === 'mover') {
      const novo = Math.max(0, Math.min(dur - 100, r50(emRel + a.dms)));
      const delta = novo - emRel;
      patch = [...patchTrocar(doc, `${a.origem}/em`, novo), ...(b.sai !== undefined ? patchTrocar(doc, `${a.origem}/sai`, Math.max(novo + 100, Math.min(dur, b.sai + delta))) : [])];
    } else if (a.modo === 'ini') patch = patchTrocar(doc, `${a.origem}/em`, Math.max(0, Math.min(fimRel - 100, r50(emRel + a.dms))));
    else {
      const sai = Math.max(emRel + 100, Math.min(dur, r50(fimRel + a.dms)));
      patch = patchTrocar(doc, `${a.origem}/sai`, sai >= dur ? undefined : sai);
    }
    await aplicar(documento, patch, a.modo === 'mover' ? 'mover bloco no tempo' : a.modo === 'ini' ? 'onde o bloco entra' : 'onde o bloco sai');
  };
  const soltarCena = async () => {
    const a = arrastoCena;
    setArrastoCena(null);
    if (!a || Math.abs(a.dms) < 50) return;
    const dur = Math.max(300, Math.round((a.dur + a.dms) / 100) * 100);
    await trocar(documento, `${a.origem}/duracao_ms`, dur, `duração da cena: ${(dur / 1000).toLocaleString('pt-BR')} s`);
  };

  const soltarBloco = async () => {
    const a = arrasto;
    setArrasto(null);
    if (arrastoCena) return void soltarCena();
    if (a && Math.abs(a.dms) >= 50 && deCenas) return void soltarBlocoCenas(a);
    if (!a || Math.abs(a.dms) < 60 || !props.narracao) return;
    const alvo = ancoraPerto((a.modo === 'fim' ? a.fim : a.em) + a.dms, palavras, props.narracao.trechos);
    if (!alvo) return;
    const w = alvo.palavra.w.trim();
    if (a.modo === 'fim') await trocar(documento, `${a.origem}/sai`, alvo.ancora, `bloco sai em "${w}"`);
    else await trocar(documento, `${a.origem}/em`, alvo.ancora, `bloco entra em "${w}"`);
  };

  const pegar = (e: React.PointerEvent, b: BlocoP, fim: number, modo: Arrasto['modo']) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (!b.origem) return;
    selecionar({documento, caminho: b.origem});
    setArrasto({origem: b.origem, modo, x0: e.clientX, dms: 0, em: b.em, fim});
  };

  return (
    <div className="painel">
      {!barraNoCabecalho && <div className="barra-lt"><AcoesLinhaDoTempo /></div>}
      <div className="lt" ref={caixa}
        onPointerMove={(e) => {
          const a = arrasto;
          if (a) setArrasto({...a, dms: ((e.clientX - a.x0) / pxs) * 1000});
          const ac = arrastoCena;
          if (ac) setArrastoCena({...ac, dms: ((e.clientX - ac.x0) / pxs) * 1000});
        }}
        onPointerUp={() => void soltarBloco()} onPointerCancel={() => (setArrasto(null), setArrastoCena(null))}>
        <div className="conteudo" style={{width: larguraConteudo}}>
          <div className="regua" style={quadros} onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            buscar(e);
          }} onPointerMove={arrastarRegua}>
            {marcas}
            {comentarios.filter((c) => c.documento === documento && c.alvo.tempo_ms !== undefined).map((c) => (
              <div key={c.id} className={`losango${c.estado === 'resolvido' ? ' resolvido' : ''}`} style={{left: x(c.alvo.tempo_ms!)}} title={`${c.id}: ${c.texto}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  irPara(c.alvo.tempo_ms!);
                  loja.definir({comentarioAberto: c.id});
                }} />
            ))}
            <div className="alca-cabeca" ref={alcaCabeca} />
          </div>
          <div className="trilha cenas" onClick={buscar}>
            {props.cenas.map((c, i) => {
              const ac = arrastoCena && arrastoCena.origem === c.origem ? arrastoCena : null;
              const largura = Math.max(2, x(c.t_out) - x(c.t_in) + (ac ? (ac.dms / 1000) * pxs : 0));
              const sel = deCenas && c.origem && selecao?.caminho === c.origem;
              return (
                <div key={i} className={`cena${sel ? ' sel' : ''}`} style={{left: x(c.t_in), width: largura, background: i % 2 ? 'var(--trilha-cena-b)' : 'var(--trilha-cena-a)'}}
                  title={deCenas ? `Cena ${c.n}${c.nome ? ` · ${c.nome}` : ''} · ${((c.t_out - c.t_in) / 1000).toLocaleString('pt-BR')} s` : c.titulo ?? c.tag ?? c.tipo}
                  onClick={(e) => {
                    e.stopPropagation();
                    irPara(c.t_in);
                    if (c.origem) selecionar({documento, caminho: c.origem});
                  }}>
                  {c.tipo === 'parte' || c.tipo === 'cena' ? <><b>{c.n}</b>{c.titulo ?? c.nome ?? ''}</> : c.tipo}
                  {sel && (
                    <span className="alc fim" title="Arraste para mudar a duração da cena" onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        if (e.button !== 0) return;
                        (e.currentTarget.closest('.lt') as HTMLElement | null)?.setPointerCapture(e.pointerId);
                        setArrastoCena({origem: c.origem!, x0: e.clientX, dms: 0, dur: c.t_out - c.t_in});
                      }} />
                  )}
                </div>
              );
            })}
          </div>
          {(faixas.length ? faixas : [[]]).map((faixa, fi) => (
            <div key={fi} className="trilha" onClick={buscar}>
              {faixa.map(({b, fim}) => {
                const a = arrasto && arrasto.origem === b.origem ? arrasto : null;
                const d = a ? (a.dms / 1000) * pxs : 0;
                const l = x(b.em) + (a && a.modo !== 'fim' ? d : 0);
                const w = Math.max(4, x(fim) - x(b.em) - 1 + (a?.modo === 'ini' ? -d : a?.modo === 'fim' ? d : 0));
                const t = tipoDe(b.tipo);
                const Icone = t.icone;
                const sel = selecao?.caminho === b.origem;
                const texto = b.texto ? b.texto.replace(/\*\*/g, '') : t.nome;
                return (
                  <div key={b.origem} className={`bloco ${t.familia}${sel ? ' sel' : ''}`} style={{left: l, width: w}}
                    title={`${t.nome}${b.texto ? ` · ${texto}` : ''}`}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => pegar(e, b, fim, 'mover')}
                    onDoubleClick={() => irPara(b.em)}>
                    {w > 22 && <Icone />}
                    {w > 60 && <span className="txt">{texto}</span>}
                    {sel && w >= 28 && (
                      <>
                        <span className="alc ini" title="Arraste para mudar onde entra" onPointerDown={(e) => pegar(e, b, fim, 'ini')} />
                        <span className="alc fim" title="Arraste para mudar onde sai" onPointerDown={(e) => pegar(e, b, fim, 'fim')} />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {!deCenas && (
            <div className="trilha palavras" onClick={buscar}>
              {falas.map((p, i) => <div key={i} className="palavra" style={{left: p.l}}>{p.w}</div>)}
            </div>
          )}
          {deCenas && audioFaixas && <FaixasAudio documento={documento} audio={audioFaixas} x={x} pxs={pxs} duracaoVideo={props.duracao_ms} aoBuscar={buscar} />}
          {deCenas && <FaixaLegendas documento={documento} legendas={(props as {legendas_cenas?: LegendasP}).legendas_cenas} x={x} pxs={pxs} aoBuscar={buscar} />}
          <div className="cabeca" ref={cabeca} />
        </div>
      </div>
    </div>
  );
};
