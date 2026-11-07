// Monitor da imagem: prévia em DOM do documento (fundo, camadas e pilha de efeitos) sobre o entorno cinza, com xadrez
// onde o fundo é transparente e o rótulo "Capa C2 · 1080 × 1350" acima da peça. À esquerda, o trilho: V mover, H mão,
// Z zoom | T texto, U forma, inserir imagem | M comentário (as teclas valem neste monitor). Clicar seleciona a camada de
// cima sob o cursor; a caixa de seleção arrasta (x, y) e a alça redimensiona (largura, altura; Shift mantém a
// proporção), com um patch só ao soltar. Com a ferramenta de comentário (M), clicar abre um balão ancorado na camada e
// no ponto da imagem; os pinos mostram os comentários do documento. Num carrossel, o monitor mostra a página ativa (a
// barra de páginas fica entre a peça e o transporte, PaginasImagem.tsx) e os caminhos das camadas levam a página.
// Foto recortada por máscara: o clique escolhe a máscara e arrastá-la leva a foto junto; o duplo clique escolhe a foto,
// que então anda e muda de tamanho dentro da máscara sem mexer nela.
import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {Check, ChevronDown, Download, Hand, ImagePlus, MessageSquarePlus, MousePointer2, Square, Type, X, ZoomIn} from 'lucide-react';
import type {CamadaImagem, Comentario, DocImagem, OperacaoPatch} from '../../../nucleo/documentos';
import {paginaDoCaminho, temPaginas} from '../../../nucleo/carrossel';
import {mascarasEmUso} from '../../../nucleo/acabamento';
import {CamadaEfeitos} from '../../../composicoes/efeitos/CamadaEfeitos';
import {aplicar, comentar, loja, patchTrocar, selecionar, useLoja} from '../../estado/loja';
import {SemDocumento} from '../../componentes/SemDocumento';
import {BotaoMenu, usarFora} from '../../componentes/Menu';
import {Trilho, teclaLivre} from '../../componentes/Trilho';
import {comValor, definirPrevia, docValido, indiceDe, irParaPagina, rotuloCamada, usarDocumentoImagem, usarPaginaAtiva, usarPrevia, visivel} from './comum';
import {novaForma, novaImagem, novoTexto} from './acoes';
import {exportarPng} from './exportarPng';
import {exportarPagina} from './exportarPaginas';
import {PaginasImagem} from './PaginasImagem';
import {CamadasDaPagina, FundoPintado} from './Prancheta';

type Geometria = {x: number; y: number; largura: number; altura: number};
// `junto`: a foto que a máscara arrastada leva (mesmo deslocamento)
type Gesto = Geometria & {i: number; id: string; junto?: {i: number; id: string; x: number; y: number}};
type Arrasto = {x0: number; y0: number; modo: 'mover' | 'redimensionar'; base: Gesto; rot: number; alvo: Gesto | null};
type Ferramenta = 'mover' | 'mao' | 'zoom' | 'texto' | 'forma';

const CAMPOS = ['x', 'y', 'largura', 'altura'] as const;
const POR_TECLA: Record<string, Ferramenta> = {v: 'mover', h: 'mao', z: 'zoom', t: 'texto', u: 'forma'};
const MARGEM = 32; // por lado; em cima sobra lugar para o rótulo da peça

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
  return [setEl, t, el] as const;
};

const caixaCss = (c: CamadaImagem, escala: number): React.CSSProperties => ({
  left: c.x * escala, top: c.y * escala, width: c.largura * escala, height: c.altura * escala,
  transform: c.rotacao ? `rotate(${c.rotacao}deg)` : undefined,
});

const contextoDe = (c: CamadaImagem) => (c.tipo === 'texto' && c.texto ? `${c.nome ?? c.id}: ${c.texto}` : rotuloCamada(c)).slice(0, 160);

/** Popover do "inserir imagem": o campo de caminho de sempre (até a Onda 3 trazer arrastar e colar). */
const InserirImagem: React.FC<{documento: string; doc: DocImagem; fechar: () => void}> = ({documento, doc, fechar}) => {
  const [caminho, setCaminho] = useState('');
  const caixa = usarFora(true, fechar);
  const confirmar = async () => {
    if (await novaImagem(documento, doc, caminho)) fechar();
  };
  return (
    <div ref={caixa} className="flutuante pop-trilho" style={{top: 160}}>
      <input className="campo" autoFocus value={caminho} placeholder="midia/logo-exemplo.png" title="Caminho do arquivo dentro da pasta do projeto"
        onChange={(e) => setCaminho(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void confirmar()} />
      <button className="bti ligado" disabled={!caminho.trim()} onClick={() => void confirmar()} title="Inserir"><Check /></button>
      <button className="bti" onClick={fechar} title="Cancelar"><X /></button>
    </div>
  );
};

export const MonitorImagem: React.FC<{documento?: string}> = ({documento: forcado}) => {
  const documentoPadrao = usarDocumentoImagem();
  const documento = forcado ?? documentoPadrao;
  const doc = useLoja((e) => (documento ? (e.docs[documento]?.doc as DocImagem | undefined) : undefined));
  const ativa = usarPaginaAtiva(documento, doc);
  const titulo = useLoja((e) => e.info?.manifesto.documentos.find((d) => d.id === documento)?.titulo ?? documento);
  const editavel = useLoja((e) => e.area !== 'efeitos');
  const selecao = useLoja((e) => e.selecao);
  const modoComentario = useLoja((e) => e.modoComentario);
  const comentarios = useLoja((e) => e.comentarios);
  const comentarioAberto = useLoja((e) => e.comentarioAberto);
  const previaEfeitos = useLoja((e) => (e.previaEfeitos && e.previaEfeitos.documento === documento ? e.previaEfeitos.efeitos : undefined));
  const previa = usarPrevia();
  const palco = useRef<HTMLDivElement>(null);
  const coords = useRef<HTMLSpanElement>(null);
  const [refMonitor, {w, h}, monitorEl] = usarTamanho();
  const [zoom, setZoom] = useState<number | null>(null);
  const [ferramenta, setFerramenta] = useState<Ferramenta>('mover');
  const [inserindo, setInserindo] = useState(false);
  const [gesto, setGesto] = useState<Gesto | null>(null);
  const [nova, setNova] = useState<Geometria | null>(null); // forma sendo desenhada
  const [hover, setHover] = useState<string | null>(null);
  const [balao, setBalao] = useState<{x: number; y: number; caminho?: string} | null>(null);
  const [textoBalao, setTextoBalao] = useState('');
  const [exportando, setExportando] = useState(false);
  const arrasto = useRef<Arrasto | null>(null);
  const desenho = useRef<{x0: number; y0: number} | null>(null);
  const panoramica = useRef<{x: number; y: number; sl: number; st: number} | null>(null);
  const ancoraZoom = useRef<{px: number; py: number; cx: number; cy: number} | null>(null);

  // a página ativa: as camadas dela e a base dos caminhos ("/camadas" ou "/paginas/2/camadas")
  const base = ativa?.base ?? '/camadas';
  const camadasPag = ativa?.camadas ?? [];
  // camadas como aparecem: a página, mais o campo em prévia (inspector) e o arrasto em curso
  const camadas = useMemo(() => {
    const p = previa && previa.documento === documento && previa.caminho.startsWith(`${base}/`) ? /^(\d+)\/(.+)$/.exec(previa.caminho.slice(base.length + 1)) : null;
    return camadasPag.map((c, i) => {
      let r = c;
      if (p && Number(p[1]) === i) r = comValor(r, p[2], previa!.valor);
      if (gesto && gesto.i === i && gesto.id === c.id) r = {...r, x: gesto.x, y: gesto.y, largura: gesto.largura, altura: gesto.altura};
      const j = gesto?.junto;
      if (j && j.i === i && j.id === c.id) r = {...r, x: j.x + gesto!.x - camadasPag[gesto!.i].x, y: j.y + gesto!.y - camadasPag[gesto!.i].y};
      return r;
    });
  }, [camadasPag, base, previa, gesto, documento]);
  // pinos da página ativa (e os sem camada, que são do documento)
  const pinos = useMemo(() => comentarios.filter((c) => c.documento === documento && c.alvo.ponto && (!c.alvo.objeto || !docValido(doc) || !temPaginas(doc) || paginaDoCaminho(doc, c.alvo.objeto) === (ativa?.p ?? 0))),
    [comentarios, documento, doc, ativa?.p]);
  // a prévia vale até o documento mudar (o patch dela chegou, ou outra mão mexeu)
  useEffect(() => definirPrevia(null), [doc]);
  // seleção numa camada de outra página (pelo painel de comentários, pelo pino): a página dela vem para a frente
  useEffect(() => {
    if (!documento || !docValido(doc) || !ativa || selecao?.documento !== documento) return;
    const p = paginaDoCaminho(doc, selecao.caminho);
    if (p >= 0 && p !== ativa.p) irParaPagina(documento, doc, p);
  }, [selecao, documento, doc, ativa]);

  const valido = docValido(doc);
  const W = valido ? Math.max(1, doc.largura) : 1;
  const H = valido ? Math.max(1, doc.altura) : 1;
  const ajustada = Math.max(0.02, Math.min((w - MARGEM * 2) / W, (h - MARGEM * 2) / H));
  const escala = zoom ?? ajustada;

  // zoom no ponto: depois de mudar a escala, a rolagem devolve o mesmo ponto da peça para baixo do cursor
  const aproximar = (fator: number | null, cx?: number, cy?: number) => {
    const p = palco.current;
    if (p && monitorEl && cx !== undefined && cy !== undefined) {
      const r = p.getBoundingClientRect();
      ancoraZoom.current = {px: (cx - r.left) / escala, py: (cy - r.top) / escala, cx, cy};
    }
    setZoom(fator === null ? null : Math.min(8, Math.max(0.02, +(escala * fator).toFixed(4))));
  };
  useLayoutEffect(() => {
    const a = ancoraZoom.current;
    ancoraZoom.current = null;
    const p = palco.current;
    if (!a || !p || !monitorEl) return;
    const r = p.getBoundingClientRect();
    monitorEl.scrollLeft += r.left + a.px * escala - a.cx;
    monitorEl.scrollTop += r.top + a.py * escala - a.cy;
  }, [escala]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl+roda aproxima no cursor
  const aproximarRef = useRef(aproximar);
  aproximarRef.current = aproximar;
  useEffect(() => {
    if (!monitorEl) return;
    const roda = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      aproximarRef.current(Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
    };
    monitorEl.addEventListener('wheel', roda, {passive: false});
    return () => monitorEl.removeEventListener('wheel', roda);
  }, [monitorEl]);

  // teclas das ferramentas deste monitor (V também sai do modo comentário, pela casca)
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && (e.key === '0' || e.key === '1')) {
        const alvo = e.target as HTMLElement;
        if (/INPUT|TEXTAREA|SELECT/.test(alvo.tagName) || alvo.closest?.('.xterm')) return;
        e.preventDefault();
        setZoom(e.key === '0' ? null : 1);
        return;
      }
      if (!teclaLivre(e) || e.shiftKey) return;
      const f = POR_TECLA[e.key.toLowerCase()];
      if (!f || (!editavel && (f === 'texto' || f === 'forma'))) return;
      setFerramenta(f);
      if (f !== 'mover') loja.definir({modoComentario: false});
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [editavel]);

  if (!documento) return <SemDocumento modulo="imagem" />;
  if (!doc) return <div className="vazio">carregando…</div>;
  if (!valido || !ativa) return <div className="vazio" style={{color: 'var(--erro)'}}>o documento {documento} não tem a lista "camadas" nem "paginas"</div>;

  const fundo = previa && previa.documento === documento && previa.caminho === '/fundo' ? String(previa.valor) : doc.fundo;
  const fundoDegrade = previa && previa.documento === documento && previa.caminho.startsWith('/fundo_degrade/')
    ? comValor(doc.fundo_degrade, previa.caminho.slice('/fundo_degrade/'.length), previa.valor) : doc.fundo_degrade;
  const iSel = editavel && selecao?.documento === documento ? indiceDe(selecao.caminho, base) : -1;
  const sel = iSel >= 0 ? camadas[iSel] : undefined;
  const iHover = hover && hover !== selecao?.caminho ? indiceDe(hover, base) : -1;
  const sobre = iHover >= 0 ? camadas[iHover] : undefined;
  const ferr: Ferramenta = modoComentario ? 'mover' : ferramenta;
  const variasPaginas = ativa.paginas.length > 1;

  const caminhoSob = (x: number, y: number) => {
    for (const el of document.elementsFromPoint(x, y)) {
      const alvo = (el as HTMLElement).closest?.('[data-caminho]') as HTMLElement | null;
      if (alvo && palco.current?.contains(alvo)) return alvo.dataset.caminho ?? null;
    }
    return null;
  };
  const pontoDoc = (cx: number, cy: number) => {
    const r = palco.current!.getBoundingClientRect();
    return {x: (cx - r.left) / escala, y: (cy - r.top) / escala};
  };

  const clicar = (ev: React.MouseEvent) => {
    if (panoramica.current || desenho.current) return;
    if (modoComentario) {
      const b = palco.current!.getBoundingClientRect();
      setTextoBalao('');
      setBalao({x: ev.clientX - b.left, y: ev.clientY - b.top, caminho: caminhoSob(ev.clientX, ev.clientY) ?? undefined});
      return;
    }
    if (ferr === 'zoom') return aproximar(ev.altKey ? 1 / 1.5 : 1.5, ev.clientX, ev.clientY);
    if (ferr === 'texto' && editavel) {
      void novoTexto(documento, doc, pontoDoc(ev.clientX, ev.clientY)).then((ok) => ok && setFerramenta('mover'));
      return;
    }
    if (ferr !== 'mover') return;
    const caminho = caminhoSob(ev.clientX, ev.clientY);
    if (editavel) selecionar(caminho ? {documento, caminho} : null);
  };

  // duplo clique numa foto recortada: escolhe a foto (para mover e escalar dentro da máscara)
  const duploClique = (ev: React.MouseEvent) => {
    if (!editavel || modoComentario || ferr !== 'mover') return;
    for (const el of document.elementsFromPoint(ev.clientX, ev.clientY)) {
      const foto = ((el as HTMLElement).closest?.('[data-foto]') as HTMLElement | null)?.dataset.foto;
      if (foto && palco.current?.contains(el)) return selecionar({documento, caminho: foto});
    }
  };

  const mover = (ev: React.MouseEvent) => {
    if (coords.current) {
      const p = pontoDoc(ev.clientX, ev.clientY);
      coords.current.textContent = `x ${Math.round(p.x)} · y ${Math.round(p.y)}`;
    }
    if (arrasto.current || modoComentario || !editavel || ferr !== 'mover') return;
    const c = caminhoSob(ev.clientX, ev.clientY);
    setHover((ant) => (ant === c ? ant : c));
  };

  // mão (H) ou botão do meio: arrasta a vista
  const comecarPanoramica = (ev: React.PointerEvent) => {
    if (!monitorEl || !(ev.button === 1 || (ev.button === 0 && ferr === 'mao' && !modoComentario))) return false;
    ev.preventDefault();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    panoramica.current = {x: ev.clientX, y: ev.clientY, sl: monitorEl.scrollLeft, st: monitorEl.scrollTop};
    return true;
  };
  const durantePanoramica = (ev: React.PointerEvent) => {
    const p = panoramica.current;
    if (!p || !monitorEl) return false;
    monitorEl.scrollLeft = p.sl - (ev.clientX - p.x);
    monitorEl.scrollTop = p.st - (ev.clientY - p.y);
    return true;
  };

  // forma (U): arrasta para desenhar; Shift faz quadrado; um clique cria o tamanho padrão no ponto
  const comecarForma = (ev: React.PointerEvent) => {
    if (ferr !== 'forma' || !editavel || ev.button !== 0 || modoComentario) return;
    ev.stopPropagation();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const p = pontoDoc(ev.clientX, ev.clientY);
    desenho.current = {x0: p.x, y0: p.y};
    setNova({x: p.x, y: p.y, largura: 0, altura: 0});
  };
  const duranteForma = (ev: React.PointerEvent) => {
    const d = desenho.current;
    if (!d) return;
    const p = pontoDoc(ev.clientX, ev.clientY);
    let lw = p.x - d.x0;
    let lh = p.y - d.y0;
    if (ev.shiftKey) {
      const m = Math.max(Math.abs(lw), Math.abs(lh));
      lw = Math.sign(lw || 1) * m;
      lh = Math.sign(lh || 1) * m;
    }
    setNova({x: Math.min(d.x0, d.x0 + lw), y: Math.min(d.y0, d.y0 + lh), largura: Math.abs(lw), altura: Math.abs(lh)});
  };
  const soltarForma = () => {
    const d = desenho.current;
    const n = nova;
    desenho.current = null;
    setNova(null);
    if (!d || !n) return;
    const lado = Math.max(8, Math.round(Math.min(W, H) * 0.3));
    const caixa = n.largura * escala < 4 || n.altura * escala < 4 ? {x: d.x0 - lado / 2, y: d.y0 - lado / 2, largura: lado, altura: lado} : n;
    void novaForma(documento, doc, caixa).then((ok) => ok && setFerramenta('mover'));
  };

  const iniciar = (ev: React.PointerEvent, modo: Arrasto['modo']) => {
    const c = camadasPag[iSel];
    if (!c || ev.button !== 0 || ferr !== 'mover') return;
    ev.stopPropagation();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    // a máscara de uma foto recortada leva a foto quando anda (não quando muda de tamanho: isso recorta outro pedaço)
    const iFoto = modo === 'mover' ? mascarasEmUso(camadasPag).get(iSel) : undefined;
    const foto = iFoto !== undefined ? camadasPag[iFoto] : undefined;
    arrasto.current = {x0: ev.clientX, y0: ev.clientY, modo, rot: c.rotacao ?? 0, alvo: null,
      base: {i: iSel, id: c.id, x: c.x, y: c.y, largura: c.largura, altura: c.altura, ...(foto ? {junto: {i: iFoto!, id: foto.id, x: foto.x, y: foto.y}} : {})}};
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
    const caminho = `${base}/${g.i}`;
    const mudancas = CAMPOS.flatMap((k) => (g[k] !== a.base[k] ? patchTrocar(atual, `${caminho}/${k}`, g[k]) : []));
    const j = g.junto;
    const daFoto = j && mudancas.length ? [{op: 'test', path: `${base}/${j.i}/id`, value: j.id} as OperacaoPatch,
      ...patchTrocar(atual, `${base}/${j.i}/x`, j.x + g.x - a.base.x), ...patchTrocar(atual, `${base}/${j.i}/y`, j.y + g.y - a.base.y)] : [];
    if (mudancas.length) {
      const patch: OperacaoPatch[] = [{op: 'test', path: `${caminho}/id`, value: g.id}, ...mudancas, ...daFoto];
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
    const c = balao.caminho ? camadasPag[indiceDe(balao.caminho, base)] : undefined;
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
    const porId = c.alvo.objeto_id ? camadasPag.findIndex((x) => x.id === c.alvo.objeto_id) : -1;
    const caminho = porId >= 0 ? `${base}/${porId}` : c.alvo.objeto;
    if (caminho) selecionar({documento, caminho});
  };

  // uma prancheta só: o PNG de sempre; carrossel: só a página ativa ("<nome> - 02.png")
  const exportar = () => {
    setExportando(true);
    void (temPaginas(doc) ? exportarPagina(documento, ativa.p) : exportarPng(documento)).finally(() => setExportando(false));
  };

  const usar = (f: Ferramenta) => () => {
    setFerramenta(f);
    loja.definir({modoComentario: false});
  };
  const grupos = [
    [
      {id: 'mover', nome: 'Mover', tecla: 'V', icone: <MousePointer2 />, ativa: !modoComentario && ferramenta === 'mover', aoClicar: usar('mover')},
      {id: 'mao', nome: 'Mão', tecla: 'H', icone: <Hand />, ativa: !modoComentario && ferramenta === 'mao', aoClicar: usar('mao')},
      {id: 'zoom', nome: 'Zoom (Alt afasta)', tecla: 'Z', icone: <ZoomIn />, ativa: !modoComentario && ferramenta === 'zoom', aoClicar: usar('zoom')},
    ],
    ...(editavel ? [[
      {id: 'texto', nome: 'Texto', tecla: 'T', icone: <Type />, ativa: !modoComentario && ferramenta === 'texto', aoClicar: usar('texto')},
      {id: 'forma', nome: 'Forma (Shift faz quadrado)', tecla: 'U', icone: <Square />, ativa: !modoComentario && ferramenta === 'forma', aoClicar: usar('forma')},
      {id: 'imagem', nome: 'Inserir imagem do projeto', icone: <ImagePlus />, ativa: inserindo, aoClicar: () => setInserindo(true)},
    ]] : []),
    [{id: 'm', nome: 'Comentário', tecla: 'M', icone: <MessageSquarePlus />, ativa: modoComentario, aoClicar: () => loja.definir({modoComentario: true})}],
  ];
  const cursor = modoComentario ? 'crosshair' : ferr === 'mao' ? 'grab' : ferr === 'zoom' ? 'zoom-in' : ferr === 'texto' ? 'text' : ferr === 'forma' ? 'crosshair' : 'default';

  return (
    <div className="painel">
      <div className={`monitor-grade${editavel ? ' com-paginas' : ''}`}>
        <Trilho grupos={grupos} />
        <div className="monitor" ref={refMonitor} style={{overflow: 'auto', justifyContent: 'flex-start', alignItems: 'flex-start', padding: `${MARGEM + 8}px ${MARGEM}px ${MARGEM - 8}px`}}
          onPointerDown={(e) => comecarPanoramica(e)} onPointerMove={(e) => durantePanoramica(e)}
          onPointerUp={() => setTimeout(() => (panoramica.current = null), 0)}>
          {w > 0 && h > 0 && <div className="palco xadrez" ref={palco} style={{width: W * escala, height: H * escala, margin: 'auto', cursor}}
            onClick={clicar} onDoubleClick={duploClique} onMouseMove={mover} onMouseLeave={() => {
              setHover(null);
              if (coords.current) coords.current.textContent = '';
            }}
            onPointerDown={comecarForma} onPointerMove={duranteForma} onPointerUp={() => desenho.current && setTimeout(soltarForma, 0)}>
            <span className="rotulo-peca" title="Propriedades da imagem" onClick={(e) => {
              e.stopPropagation();
              if (editavel) selecionar(null);
            }}><b>{titulo}</b> · {W} × {H}{variasPaginas && <> · {ativa.p + 1}/{ativa.paginas.length} {ativa.pagina.nome}</>}</span>
            <div style={{position: 'absolute', left: 0, top: 0, width: W, height: H, transform: `scale(${escala})`, transformOrigin: '0 0',
              background: fundo, overflow: 'hidden', userSelect: 'none'}}>
              <CamadaEfeitos efeitos={previaEfeitos ?? doc.efeitos} quadro={0}>
                <div style={{position: 'absolute', inset: 0, background: fundo}} />
                {fundoDegrade !== undefined && <FundoPintado degrade={fundoDegrade} largura={W} altura={H} escala={escala} />}
                <CamadasDaPagina camadas={camadas} base={base} escala={escala} largura={W} altura={H} />
              </CamadaEfeitos>
            </div>
            <div className="sobreposicao">
              {sobre && <div className="caixa-hover" style={caixaCss(sobre, escala)} />}
              {nova && <div className="caixa-nova" style={{left: nova.x * escala, top: nova.y * escala, width: nova.largura * escala, height: nova.altura * escala}} />}
              {sel && (
                <div className="caixa-sel" style={{...caixaCss(sel, escala), pointerEvents: modoComentario || ferr !== 'mover' ? 'none' : undefined, borderStyle: visivel(sel) ? undefined : 'dashed'}}
                  onPointerDown={(e) => iniciar(e, 'mover')} onPointerMove={durante} onPointerUp={(e) => void soltar(e)} onPointerCancel={cancelar}
                  onClick={(e) => e.stopPropagation()}>
                  {!sel.rotacao && sel.y * escala > 20 && <span className="etiqueta-sel">{rotuloCamada(sel)}</span>}
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
                  <div className="rotulo" style={{marginBottom: 6}}>Comentário{balao.caminho && camadasPag[indiceDe(balao.caminho, base)] ? ` em ${rotuloCamada(camadasPag[indiceDe(balao.caminho, base)])}` : ''}</div>
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
          </div>}
        </div>
        {editavel && <PaginasImagem documento={documento} doc={doc} />}
        <div className="transporte transporte-imagem">
          <BotaoMenu className="bt mini zoom-bt" lado="esquerda" acima titulo={zoom === null ? 'Zoom: ajustado ao painel' : 'Zoom'} icone={null}
            rotulo={<>{Math.round(escala * 100)}%<ChevronDown className="i12" /></>}
            itens={[
              {rotulo: 'Ajustar ao painel', tecla: 'Ctrl+0', acao: () => setZoom(null)},
              'sep',
              {rotulo: '50%', acao: () => setZoom(0.5)},
              {rotulo: '100%', tecla: 'Ctrl+1', acao: () => setZoom(1)},
              {rotulo: '200%', acao: () => setZoom(2)},
            ]} />
          <span className="coords largo" ref={coords} />
          <button className="bt fantasma" style={{marginLeft: 'auto'}} disabled={exportando} onClick={exportar}
            title={variasPaginas ? 'Exportar só esta página em PNG, com os efeitos (o carrossel inteiro sai pela barra de páginas)' : 'Exportar PNG em resolução cheia, com os efeitos'}>
            <Download /><span className="largo">{variasPaginas ? 'Exportar página' : 'Exportar PNG'}</span>
          </button>
        </div>
      </div>
      {inserindo && editavel && <InserirImagem documento={documento} doc={doc} fechar={() => setInserindo(false)} />}
    </div>
  );
};
