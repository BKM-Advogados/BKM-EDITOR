// Monitor da imagem: prévia em DOM do documento (fundo, camadas e pilha de efeitos), numa escala que cabe no painel.
// Clicar seleciona a camada de cima sob o cursor; a caixa de seleção arrasta (x, y) e a alça redimensiona (largura,
// altura; Shift mantém a proporção), com um patch só ao soltar. Com a ferramenta de comentário (C), clicar abre um
// balão ancorado na camada e no ponto da imagem; os pinos mostram os comentários do documento.
import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {Download, MessageSquarePlus, Minus, MousePointer2, Plus} from 'lucide-react';
import type {CamadaImagem, Comentario, DocImagem, OperacaoPatch} from '../../../nucleo/documentos';
import {CamadaEfeitos} from '../../../composicoes/efeitos/CamadaEfeitos';
import {aplicar, comentar, loja, patchTrocar, selecionar, useLoja} from '../../estado/loja';
import {BitmapTrabalho} from './BitmapTrabalho';
import {ENTRELINHA, PADRAO, alinhamentoCss, definirPrevia, docValido, familiaCss, indiceDe, rotuloCamada, usarDocumentoImagem, usarPrevia, visivel} from './comum';
import {exportarPng} from './exportarPng';

type Geometria = {x: number; y: number; largura: number; altura: number};
type Gesto = Geometria & {i: number; id: string};
type Arrasto = {x0: number; y0: number; modo: 'mover' | 'redimensionar'; base: Gesto; rot: number; alvo: Gesto | null};

const CAMPOS = ['x', 'y', 'largura', 'altura'] as const;

// ref por estado: o monitor só aparece depois que o documento carrega, e o observador tem de ligar nessa hora
const usarTamanho = () => {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [t, setT] = useState({w: 0, h: 0});
  useLayoutEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setT({w: e.contentRect.width, h: e.contentRect.height}));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, t] as const;
};

const caixaCss = (c: CamadaImagem, escala: number): React.CSSProperties => ({
  left: c.x * escala, top: c.y * escala, width: c.largura * escala, height: c.altura * escala,
  transform: c.rotacao ? `rotate(${c.rotacao}deg)` : undefined,
});

const contextoDe = (c: CamadaImagem) => (c.tipo === 'texto' && c.texto ? `${c.nome ?? c.id}: ${c.texto}` : rotuloCamada(c)).slice(0, 160);

const Camada = React.memo(function Camada({c, caminho, escala}: {c: CamadaImagem; caminho: string; escala: number}) {
  const base: React.CSSProperties = {position: 'absolute', left: c.x, top: c.y, width: c.largura, height: c.altura,
    opacity: c.opacidade ?? 1, transform: c.rotacao ? `rotate(${c.rotacao}deg)` : undefined};
  if (c.tipo === 'imagem') {
    return (
      <div data-caminho={caminho} style={{...base, overflow: 'hidden'}}>
        {c.src && <BitmapTrabalho src={c.src} largura={c.largura} altura={c.altura} ajuste={c.ajuste} escala={escala} />}
      </div>
    );
  }
  if (c.tipo === 'texto') {
    return (
      <div data-caminho={caminho} style={{...base, fontFamily: familiaCss(c.fonte), fontSize: c.tamanho ?? PADRAO.tamanho, fontWeight: c.peso ?? PADRAO.peso,
        fontStyle: 'normal', letterSpacing: 'normal', color: c.cor ?? PADRAO.cor, textAlign: alinhamentoCss(c.alinhar), lineHeight: ENTRELINHA,
        whiteSpace: 'pre-wrap', overflowWrap: 'break-word'}}>
        {c.texto ?? ''}
      </div>
    );
  }
  return <div data-caminho={caminho} style={{...base, background: c.preenchimento ?? PADRAO.preenchimento,
    borderRadius: c.forma === 'elipse' ? '50%' : Math.max(0, c.raio ?? PADRAO.raio)}} />;
});

export const MonitorImagem: React.FC<{documento?: string}> = ({documento: forcado}) => {
  const documentoPadrao = usarDocumentoImagem();
  const documento = forcado ?? documentoPadrao;
  const doc = useLoja((e) => (documento ? (e.docs[documento]?.doc as DocImagem | undefined) : undefined));
  const editavel = useLoja((e) => e.area !== 'efeitos');
  const selecao = useLoja((e) => e.selecao);
  const modoComentario = useLoja((e) => e.modoComentario);
  const comentarios = useLoja((e) => e.comentarios);
  const comentarioAberto = useLoja((e) => e.comentarioAberto);
  const previaEfeitos = useLoja((e) => (e.previaEfeitos && e.previaEfeitos.documento === documento ? e.previaEfeitos.efeitos : undefined));
  const previa = usarPrevia();
  const palco = useRef<HTMLDivElement>(null);
  const [refMonitor, {w, h}] = usarTamanho();
  const [zoom, setZoom] = useState<number | null>(null);
  const [gesto, setGesto] = useState<Gesto | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [balao, setBalao] = useState<{x: number; y: number; caminho?: string} | null>(null);
  const [textoBalao, setTextoBalao] = useState('');
  const [exportando, setExportando] = useState(false);
  const arrasto = useRef<Arrasto | null>(null);

  // camadas como aparecem: o documento, mais o campo em prévia (inspector) e o arrasto em curso
  const camadas = useMemo(() => {
    const p = previa && previa.documento === documento ? /^\/camadas\/(\d+)\/(\w+)$/.exec(previa.caminho) : null;
    return (docValido(doc) ? doc.camadas : []).map((c, i) => {
      let r = c;
      if (p && Number(p[1]) === i) r = {...r, [p[2]]: previa!.valor};
      if (gesto && gesto.i === i && gesto.id === c.id) r = {...r, x: gesto.x, y: gesto.y, largura: gesto.largura, altura: gesto.altura};
      return r;
    });
  }, [doc, previa, gesto, documento]);
  const pinos = useMemo(() => comentarios.filter((c) => c.documento === documento && c.alvo.ponto), [comentarios, documento]);
  // a prévia vale até o documento mudar (o patch dela chegou, ou outra mão mexeu)
  useEffect(() => definirPrevia(null), [doc]);

  if (!documento) return <div className="vazio">nenhuma imagem no projeto</div>;
  if (!doc) return <div className="vazio">carregando…</div>;
  if (!docValido(doc)) return <div className="vazio" style={{color: 'var(--erro)'}}>o documento {documento} não tem a lista "camadas"</div>;

  const W = Math.max(1, doc.largura);
  const H = Math.max(1, doc.altura);
  const ajustada = Math.max(0.02, Math.min((w - 24) / W, (h - 24) / H));
  const escala = zoom ?? ajustada;
  const fundo = previa && previa.documento === documento && previa.caminho === '/fundo' ? String(previa.valor) : doc.fundo;
  const iSel = editavel && selecao?.documento === documento ? indiceDe(selecao.caminho) : -1;
  const sel = iSel >= 0 ? camadas[iSel] : undefined;
  const iHover = hover && hover !== selecao?.caminho ? indiceDe(hover) : -1;
  const sobre = iHover >= 0 ? camadas[iHover] : undefined;

  const caminhoSob = (x: number, y: number) => {
    for (const el of document.elementsFromPoint(x, y)) {
      const alvo = (el as HTMLElement).closest?.('[data-caminho]') as HTMLElement | null;
      if (alvo && palco.current?.contains(alvo)) return alvo.dataset.caminho ?? null;
    }
    return null;
  };

  const clicar = (ev: React.MouseEvent) => {
    const caminho = caminhoSob(ev.clientX, ev.clientY);
    if (modoComentario) {
      const b = palco.current!.getBoundingClientRect();
      setTextoBalao('');
      setBalao({x: ev.clientX - b.left, y: ev.clientY - b.top, caminho: caminho ?? undefined});
      return;
    }
    if (editavel) selecionar(caminho ? {documento, caminho} : null);
  };

  const mover = (ev: React.MouseEvent) => {
    if (arrasto.current || modoComentario || !editavel) return;
    setHover(caminhoSob(ev.clientX, ev.clientY));
  };

  const iniciar = (ev: React.PointerEvent, modo: Arrasto['modo']) => {
    const c = doc.camadas[iSel];
    if (!c || ev.button !== 0) return;
    ev.stopPropagation();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    arrasto.current = {x0: ev.clientX, y0: ev.clientY, modo, rot: c.rotacao ?? 0, alvo: null,
      base: {i: iSel, id: c.id, x: c.x, y: c.y, largura: c.largura, altura: c.altura}};
  };

  const durante = (ev: React.PointerEvent) => {
    const a = arrasto.current;
    if (!a) return;
    const tx = ev.clientX - a.x0;
    const ty = ev.clientY - a.y0;
    if (!a.alvo && Math.hypot(tx, ty) < 3) return;
    const dx = tx / escala;
    const dy = ty / escala;
    const b = a.base;
    if (a.modo === 'mover') a.alvo = {...b, x: Math.round(b.x + dx), y: Math.round(b.y + dy)};
    else {
      // camada girada: o arrasto é projetado nos eixos dela
      const t = (-a.rot * Math.PI) / 180;
      const largura = Math.max(4, Math.round(b.largura + dx * Math.cos(t) - dy * Math.sin(t)));
      const altura = ev.shiftKey ? Math.max(4, Math.round((largura * b.altura) / b.largura)) : Math.max(4, Math.round(b.altura + dx * Math.sin(t) + dy * Math.cos(t)));
      a.alvo = {...b, largura, altura};
    }
    setGesto(a.alvo);
  };

  const soltar = async (ev: React.PointerEvent) => {
    const a = arrasto.current;
    arrasto.current = null;
    if (!a) return;
    if (!a.alvo) {
      // clique sem arrasto: escolhe a camada de cima naquele ponto (pode ser outra, menor, por cima da selecionada)
      const caminho = caminhoSob(ev.clientX, ev.clientY);
      if (caminho) selecionar({documento, caminho});
      return;
    }
    const g = a.alvo;
    const atual = loja.get().docs[documento]?.doc;
    const caminho = `/camadas/${g.i}`;
    const mudancas = CAMPOS.flatMap((k) => (g[k] !== a.base[k] ? patchTrocar(atual, `${caminho}/${k}`, g[k]) : []));
    if (mudancas.length) {
      const patch: OperacaoPatch[] = [{op: 'test', path: `${caminho}/id`, value: g.id}, ...mudancas];
      await aplicar(documento, patch, a.modo === 'mover' ? `mover camada ${g.id}` : `tamanho da camada ${g.id}`);
    }
    setGesto(null);
  };

  const cancelar = () => {
    arrasto.current = null;
    setGesto(null);
  };

  const salvarComentario = async () => {
    if (!balao || !textoBalao.trim()) return setBalao(null);
    const b = palco.current!.getBoundingClientRect();
    const c = balao.caminho ? doc.camadas[indiceDe(balao.caminho)] : undefined;
    await comentar(documento, textoBalao.trim(), {
      objeto: c ? balao.caminho : undefined, objeto_id: c?.id, contexto: c ? contextoDe(c) : undefined,
      ponto: {x: +(balao.x / b.width).toFixed(4), y: +(balao.y / b.height).toFixed(4)},
    });
    setBalao(null);
    loja.definir({modoComentario: false});
  };

  const abrirPino = (c: Comentario) => {
    loja.definir({comentarioAberto: c.id});
    if (!editavel) return;
    const porId = c.alvo.objeto_id ? doc.camadas.findIndex((x) => x.id === c.alvo.objeto_id) : -1;
    const caminho = porId >= 0 ? `/camadas/${porId}` : c.alvo.objeto;
    if (caminho) selecionar({documento, caminho});
  };

  const aproximar = (fator: number) => setZoom(Math.min(8, Math.max(0.02, +(escala * fator).toFixed(4))));

  const exportar = () => {
    setExportando(true);
    void exportarPng(documento).finally(() => setExportando(false));
  };

  return (
    <div className="painel">
      <div className="monitor" ref={refMonitor} style={{overflow: 'auto', justifyContent: 'flex-start', alignItems: 'flex-start'}}>
        {w > 0 && h > 0 && <div className="palco" ref={palco} style={{width: W * escala, height: H * escala, margin: 'auto', flex: 'none', cursor: modoComentario ? 'crosshair' : 'default'}}
          onClick={clicar} onMouseMove={mover} onMouseLeave={() => setHover(null)}>
          <div style={{position: 'absolute', left: 0, top: 0, width: W, height: H, transform: `scale(${escala})`, transformOrigin: '0 0',
            background: fundo, overflow: 'hidden', userSelect: 'none'}}>
            <CamadaEfeitos efeitos={previaEfeitos ?? doc.efeitos} quadro={0}>
              <div style={{position: 'absolute', inset: 0, background: fundo}} />
              {camadas.map((c, i) => visivel(c) && <Camada key={c.id || i} c={c} caminho={`/camadas/${i}`} escala={escala} />)}
            </CamadaEfeitos>
          </div>
          <div className="sobreposicao">
            {sobre && <div className="caixa-hover" style={caixaCss(sobre, escala)} />}
            {sel && (
              <div className="caixa-sel" style={{...caixaCss(sel, escala), pointerEvents: modoComentario ? 'none' : undefined, borderStyle: visivel(sel) ? undefined : 'dashed'}}
                onPointerDown={(e) => iniciar(e, 'mover')} onPointerMove={durante} onPointerUp={(e) => void soltar(e)} onPointerCancel={cancelar}
                onClick={(e) => e.stopPropagation()}>
                <div className="alca" onPointerDown={(e) => iniciar(e, 'redimensionar')} title="Redimensionar (Shift mantém a proporção)" />
              </div>
            )}
            {pinos.map((c) => (
              <div key={c.id} className={`pino${c.estado === 'resolvido' ? ' resolvido' : ''}`} title={c.texto}
                style={{left: `${c.alvo.ponto!.x * 100}%`, top: `${c.alvo.ponto!.y * 100}%`, outline: c.id === comentarioAberto ? '2px solid var(--acento)' : undefined}}
                onClick={(e) => {
                  e.stopPropagation();
                  abrirPino(c);
                }}>
                {c.id.replace(/\D/g, '').replace(/^0+/, '')}
              </div>
            ))}
            {balao && (
              <div className="balao" style={{left: Math.max(0, Math.min(balao.x, W * escala - 270)), top: Math.max(0, Math.min(balao.y + 8, H * escala - 150))}}
                onClick={(e) => e.stopPropagation()}>
                <div className="rotulo" style={{marginBottom: 6}}>comentário{balao.caminho ? ` · ${balao.caminho}` : ''}</div>
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
        </div>}
      </div>
      <div className="controles">
        <div className="ferramentas">
          <button className={`bt mini${!modoComentario ? ' ligado' : ''}`} onClick={() => loja.definir({modoComentario: false})} title="Selecionar"><MousePointer2 size={13} /></button>
          <button className={`bt mini${modoComentario ? ' ligado' : ''}`} onClick={() => loja.definir({modoComentario: true})} title="Comentar (C)"><MessageSquarePlus size={13} /></button>
        </div>
        <span className="rotulo" style={{textTransform: 'none'}}>{doc.largura}×{doc.altura}</span>
        <span style={{flex: 1}} />
        <button className="bt fantasma mini" onClick={() => aproximar(1 / 1.25)} title="Afastar"><Minus size={13} /></button>
        <button className={`bt mini${zoom === null ? ' ligado' : ''}`} onClick={() => setZoom(null)} title={zoom === null ? 'Ajustado ao painel' : 'Ajustar ao painel'}
          style={{minWidth: 52, justifyContent: 'center'}}>
          {Math.round(escala * 100)}%
        </button>
        <button className="bt fantasma mini" onClick={() => aproximar(1.25)} title="Aproximar"><Plus size={13} /></button>
        <button className="bt mini" disabled={exportando} onClick={exportar} title="Exportar PNG em resolução cheia, com os efeitos"><Download size={13} />Exportar PNG</button>
      </div>
    </div>
  );
};
