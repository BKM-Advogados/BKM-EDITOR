// Monitor da imagem: prévia em DOM do documento (fundo, camadas e pilha de efeitos) sobre o entorno cinza, com xadrez
// onde o fundo é transparente e o rótulo "Capa · 1080 × 1350" acima da peça. À esquerda, o trilho: V mover, H mão,
// Z zoom | T texto, U forma, inserir imagem | M comentário (as teclas valem neste monitor). Apertar numa camada já a
// escolhe e arrastar a move, mesmo sem estar selecionada (o gesto do Canva); Shift+clique põe ou tira da seleção,
// arrastar no vazio faz o laço, Ctrl+A escolhe a página toda e Esc solta. Várias selecionadas andam juntas e a barra
// de cima alinha e distribui (BarraSelecao.tsx). Grupo (Ctrl+G, Ctrl+Shift+G): o clique escolhe o grupo inteiro e o
// duplo clique uma camada dele. Camada travada (Ctrl+Shift+L) se escolhe mas não anda nem muda de tamanho. No arrasto,
// a caixa encaixa nas bordas e centros da prancheta e das outras camadas, na margem segura e na grade (5 px de tela; Alt
// solta), com as guias e a distância até o vizinho à vista; réguas, grade e margem ligam no menu Guias (Guias.tsx). A alça redimensiona uma camada (Shift mantém a proporção; girada, o
// canto oposto fica parado), com um patch só ao soltar. Com a ferramenta de comentário (M), clicar abre um balão ancorado na camada e
// no ponto da imagem; os pinos mostram os comentários do documento. Num carrossel, o monitor mostra a página ativa (a
// barra de páginas fica entre a peça e o transporte, PaginasImagem.tsx) e os caminhos das camadas levam a página.
// Foto recortada por máscara: o clique escolhe a máscara e arrastá-la leva a foto junto; o duplo clique escolhe a foto,
// que então anda e muda de tamanho dentro da máscara sem mexer nela.
import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {Check, ChevronDown, Download, Hand, ImagePlus, Lock, Magnet, MessageSquarePlus, MousePointer2, MoveUpRight, Shapes, Square, Type, X, ZoomIn} from 'lucide-react';
import type {CamadaImagem, Comentario, DocImagem} from '../../../nucleo/documentos';
import {caminhoDoAlvo, paginaDoAlvo, paginaDoCaminho, temPaginas} from '../../../nucleo/carrossel';
import {caixaDe, caixaDeVarias, comAcompanhantes, membrosDoGrupo, patchMover, redimensionarGirada, tocadasPor, travada, type Caixa} from '../../../nucleo/layout-imagem';
import {mascarasEmUso} from '../../../nucleo/acabamento';
import {resolverCamada, resolverCor, resolverDegrade} from '../../../nucleo/cor-marca';
import {alvosDeEncaixe, distancias, encaixar, margemSegura, passoDaGrade, TOLERANCIA_TELA, type Alvos, type Distancia, type Guia} from '../../../nucleo/encaixe-imagem';
import {CamadaEfeitos} from '../../../composicoes/efeitos/CamadaEfeitos';
import {aplicar, caminhosDaSelecao, comentar, loja, patchTrocar, selecionar, selecionarVarias, useLoja} from '../../estado/loja';
import {SemDocumento} from '../../componentes/SemDocumento';
import {BotaoMenu, usarFora} from '../../componentes/Menu';
import {Trilho, teclaLivre} from '../../componentes/Trilho';
import {comValor, definirPrevia, docValido, indiceDe, irParaPagina, paginaAtivaDe, rotuloCamada, usarDocumentoImagem, usarPaginaAtiva, usarPrevia, visivel} from './comum';
import {novaForma, novaImagem, novoTexto} from './acoes';
import {exportarPng} from './exportarPng';
import {exportarPagina} from './exportarPaginas';
import {BuscaIcones} from './BuscaIcones';
import {InserirLinha} from './InserirLinha';
import {PaginasImagem} from './PaginasImagem';
import {CamadasDaPagina, FundoPintado} from './Prancheta';
import {BarraSelecao, type VistaAlvo} from './BarraSelecao';
import {agruparSelecao, alternarTravaSelecao, desagruparSelecao} from './acoesSelecao';
import {AjudaDoArrasto, Grade, Margem, Reguas, ROTULOS_GUIAS, usarOpcoesGuias} from './Guias';
import {mudouEm} from '../../estado/agente';
import {AvisoAgente, MarcasAgente} from '../../componentes/Agente';

type Geometria = {x: number; y: number; largura: number; altura: number};
// uma camada no gesto: índice, id (para o test do patch) e a geometria
type Peca = Geometria & {i: number; id: string};
// mover: as selecionadas (mais a foto de cada máscara) com o mesmo deslocamento; redimensionar: uma só, com o giro dela
// no mover, `encaixe` traz onde encaixar e as caixas das outras camadas (para as distâncias), calculados no apertar
type Arrasto = {x0: number; y0: number; modo: 'mover' | 'redimensionar'; pecas: Peca[]; rot: number; alvo: Peca[] | null;
  // no clique sem arrasto, recolher à camada de cima (dentro de uma seleção) ou manter a seleção que o apertar acabou de
  // fazer (grupo escolhido de novo): o clique numa camada de grupo escolhe o grupo inteiro, não uma só (docs/imagem.md)
  colapsar: boolean; encaixe?: {alvos: Alvos; outras: Caixa[]}};
// laço: retângulo arrastado no vazio, em px do documento; `somar` é a seleção de antes (com Shift)
type Laco = {x0: number; y0: number; x1: number; y1: number; somar: string[]};
type Ferramenta = 'mover' | 'mao' | 'zoom' | 'texto' | 'forma';

const CAMPOS = ['x', 'y', 'largura', 'altura'] as const;
const pecaDe = (c: CamadaImagem, i: number): Peca => ({i, id: c.id, x: c.x, y: c.y, largura: c.largura, altura: c.altura});
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
      <input className="campo" autoFocus value={caminho} placeholder="midia/logo.png" title="Caminho do arquivo dentro da pasta do projeto"
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
  const mudancas = useLoja((e) => e.mudancasAgente);
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
  const [buscandoIcone, setBuscandoIcone] = useState(false); // frente Marca: busca de ícones do Lucide
  const [inserindoLinha, setInserindoLinha] = useState(false); // frente Marca: linha e seta
  const [gesto, setGesto] = useState<Peca[] | null>(null);
  const [laco, setLaco] = useState<Laco | null>(null);
  const lacoAtual = useRef<Laco | null>(null); // o laço em curso (o estado só desenha; os eventos leem daqui)
  const [vistaAlvo, setVistaAlvo] = useState<VistaAlvo>(null);
  const [opcoesGuias, alternarGuia] = usarOpcoesGuias();
  const [ajuda, setAjuda] = useState<{guias: Guia[]; distancias: Distancia[]} | null>(null);
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
      const g = gesto?.find((x) => x.i === i && x.id === c.id);
      if (g) r = {...r, x: g.x, y: g.y, largura: g.largura, altura: g.altura};
      return resolverCamada(r, doc?.marca); // marca: cor "@destaque" lida do kit da imagem
    });
  }, [camadasPag, base, previa, gesto, documento, doc?.marca]);
  // pinos da página ativa (e os sem camada, que são do documento)
  // num carrossel, o pino fica na página do comentário pelo id dela (imagem-D5), não pelo caminho gravado
  const pinos = useMemo(() => comentarios.filter((c) => c.documento === documento && c.alvo.ponto
    && (!(c.alvo.objeto || c.alvo.pagina_id) || !docValido(doc) || !temPaginas(doc) || paginaDoAlvo(doc, c.alvo) === (ativa?.p ?? 0))),
  [comentarios, documento, doc, ativa?.p]);
  // a prévia vale até o documento mudar (o patch dela chegou, ou outra mão mexeu)
  useEffect(() => definirPrevia(null), [doc]);
  // seleção numa camada de outra página (pelo painel de comentários, pelo pino): a página dela vem para a frente
  useEffect(() => {
    if (!documento || !docValido(doc) || !ativa || selecao?.documento !== documento) return;
    const p = paginaDoCaminho(doc, selecao.caminho);
    if (p >= 0 && p !== ativa.p) irParaPagina(documento, doc, p);
  }, [selecao, documento, doc, ativa]);
  // comentário aberto pelo painel (que escolhe o caminho gravado): a camada é achada de novo pela página e pelo id dela,
  // que não mudam quando as páginas mudam de lugar (imagem-D5)
  useEffect(() => {
    const c = comentarios.find((x) => x.id === comentarioAberto);
    if (!c || !documento || c.documento !== documento || !docValido(doc) || !temPaginas(doc) || !c.alvo.pagina_id) return;
    const caminho = caminhoDoAlvo(doc, c.alvo);
    const atual = loja.get().selecao;
    if (caminho && !(atual?.documento === documento && atual.caminho === caminho)) selecionar({documento, caminho});
    else if (!caminho && paginaDoAlvo(doc, c.alvo) >= 0) irParaPagina(documento, doc, paginaDoAlvo(doc, c.alvo));
  }, [comentarioAberto]); // eslint-disable-line react-hooks/exhaustive-deps

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
      // Ctrl+A escolhe todas as camadas visíveis da página; Esc solta a seleção (fora de campo de texto e do terminal)
      const alvoTecla = e.target as HTMLElement;
      const livreDeCampo = !(/INPUT|TEXTAREA|SELECT/.test(alvoTecla.tagName) || alvoTecla.isContentEditable || alvoTecla.closest?.('.xterm'));
      if (editavel && livreDeCampo && loja.get().area === 'imagem' && documento) {
        const d = loja.get().docs[documento]?.doc as DocImagem | undefined;
        const pg = d && docValido(d) ? paginaAtivaDe(loja.get(), documento, d) : null;
        if (pg && (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'a') {
          e.preventDefault();
          selecionarVarias(documento, pg.camadas.flatMap((c, i) => (visivel(c) ? [`${pg.base}/${i}`] : [])));
          return;
        }
        if (e.key === 'Escape' && !e.ctrlKey && loja.get().selecao?.documento === documento) return void selecionar(null);
        // Ctrl+G agrupa, Ctrl+Shift+G desagrupa, Ctrl+Shift+L trava ou destrava (com seleção nesta imagem)
        const tecla = e.key.toLowerCase();
        if ((e.ctrlKey || e.metaKey) && !e.altKey && (tecla === 'g' || (tecla === 'l' && e.shiftKey)) && loja.get().selecao?.documento === documento) {
          e.preventDefault();
          void (tecla === 'l' ? alternarTravaSelecao() : e.shiftKey ? desagruparSelecao() : agruparSelecao());
          return;
        }
      }
      if (!teclaLivre(e) || e.shiftKey) return;
      const f = POR_TECLA[e.key.toLowerCase()];
      if (!f || (!editavel && (f === 'texto' || f === 'forma'))) return;
      setFerramenta(f);
      if (f !== 'mover') loja.definir({modoComentario: false});
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [editavel, documento]);

  if (!documento) return <SemDocumento modulo="imagem" />;
  if (!doc) return <div className="vazio">carregando…</div>;
  if (!valido || !ativa) return <div className="vazio" style={{color: 'var(--erro)'}}>o documento {documento} não tem a lista "camadas" nem "paginas"</div>;

  const fundo = resolverCor(previa && previa.documento === documento && previa.caminho === '/fundo' ? String(previa.valor) : doc.fundo, doc.marca);
  const fundoDegrade = resolverDegrade(previa && previa.documento === documento && previa.caminho.startsWith('/fundo_degrade/')
    ? comValor(doc.fundo_degrade, previa.caminho.slice('/fundo_degrade/'.length), previa.valor) : doc.fundo_degrade, doc.marca);
  // a seleção na página ativa: todas (`idxSel`) e, com uma só, a que ganha a alça (`sel`)
  const caminhosSel = editavel ? caminhosDaSelecao(selecao, documento) : [];
  const idxSel = caminhosSel.map((c) => indiceDe(c, base)).filter((i) => i >= 0 && camadas[i]);
  const iSel = idxSel.length === 1 ? idxSel[0] : -1;
  const sel = iSel >= 0 ? camadas[iSel] : undefined;
  const caixaSel = idxSel.length > 1 ? idxSel.map((i) => caixaDe(camadas[i])).reduce((a, k) => {
    const x = Math.min(a.x, k.x);
    const y = Math.min(a.y, k.y);
    return {x, y, w: Math.max(a.x + a.w, k.x + k.w) - x, h: Math.max(a.y + a.h, k.y + k.h) - y};
  }) : null;
  const iHover = hover && !caminhosSel.includes(hover) ? indiceDe(hover, base) : -1;
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
    // com a ferramenta mover, quem escolhe é o apertar (comecarMover) e o soltar (soltar)
  };

  // duplo clique numa foto recortada: escolhe a foto (para mover e escalar dentro da máscara)
  const duploClique = (ev: React.MouseEvent) => {
    if (!editavel || modoComentario || ferr !== 'mover') return;
    for (const el of document.elementsFromPoint(ev.clientX, ev.clientY)) {
      const foto = ((el as HTMLElement).closest?.('[data-foto]') as HTMLElement | null)?.dataset.foto;
      if (foto && palco.current?.contains(el)) return selecionar({documento, caminho: foto});
    }
    // dentro de um grupo: só a camada sob o cursor
    const caminho = caminhoSob(ev.clientX, ev.clientY);
    const i = caminho ? indiceDe(caminho, base) : -1;
    if (caminho && i >= 0 && camadasPag[i]?.grupo) selecionar({documento, caminho});
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

  // o ponto está dentro da seleção (a caixa dela ou o contorno de uma das selecionadas)?
  const naSelecao = (x: number, y: number) => document.elementsFromPoint(x, y).some((el) => (el as HTMLElement).dataset?.sel !== undefined && palco.current?.contains(el));

  const comecarArrasto = (ev: React.PointerEvent, modo: Arrasto['modo'], indices: number[], colapsar = true) => {
    // camada travada fica (o resto da seleção anda)
    const pecas = (modo === 'mover' ? comAcompanhantes(camadasPag, indices) : indices).filter((i) => !travada(camadasPag[i])).map((i) => pecaDe(camadasPag[i], i));
    if (!pecas.length) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const andando = new Set(pecas.map((p) => p.i));
    const encaixe = modo === 'mover' ? {
      alvos: alvosDeEncaixe(camadasPag, andando, {largura: W, altura: H}, opcoesGuias.margem ? margemSegura(W, H) : undefined),
      outras: camadasPag.flatMap((c, i) => (!c || andando.has(i) || c.visivel === false ? [] : [caixaDe(c)])),
    } : undefined;
    arrasto.current = {x0: ev.clientX, y0: ev.clientY, modo, pecas, rot: modo === 'redimensionar' ? (camadasPag[indices[0]].rotacao ?? 0) : 0, alvo: null, colapsar, encaixe};
  };

  // mover (V): apertar numa camada a escolhe e já arrasta (D2); dentro da seleção arrasta todas; Shift põe ou tira; no
  // vazio começa o laço. A alça tem o seu (redimensionar) e não chega aqui.
  const comecarMover = (ev: React.PointerEvent) => {
    if (ferr !== 'mover' || !editavel || modoComentario || ev.button !== 0) return;
    if ((ev.target as HTMLElement).closest?.('.pino, .balao')) return;
    const caminho = caminhoSob(ev.clientX, ev.clientY);
    const i = caminho ? indiceDe(caminho, base) : -1;
    // camada de grupo vem com o grupo inteiro (a que se apertou fica como principal)
    const grupo = i >= 0 ? membrosDoGrupo(camadasPag, i) : [];
    if (ev.shiftKey && caminho) {
      const todos = grupo.map((k) => `${base}/${k}`);
      const dentro = caminhosSel.includes(caminho);
      return selecionarVarias(documento, dentro ? caminhosSel.filter((c) => !todos.includes(c)) : [...caminhosSel, ...todos.filter((c) => c !== caminho), caminho]);
    }
    if (!ev.shiftKey && (naSelecao(ev.clientX, ev.clientY) || idxSel.includes(i)) && idxSel.length) return comecarArrasto(ev, 'mover', idxSel);
    if (caminho && i >= 0) {
      selecionarVarias(documento, [...grupo.filter((k) => k !== i).map((k) => `${base}/${k}`), caminho]);
      return comecarArrasto(ev, 'mover', grupo, false); // escolha nova (grupo inteiro): não recolhe no soltar
    }
    // vazio: o laço (com Shift, soma à seleção de agora)
    if (!ev.shiftKey) selecionar(null);
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const p = pontoDoc(ev.clientX, ev.clientY);
    lacoAtual.current = {x0: p.x, y0: p.y, x1: p.x, y1: p.y, somar: ev.shiftKey ? caminhosSel : []};
    setLaco(lacoAtual.current);
  };

  const iniciarRedimensionar = (ev: React.PointerEvent) => {
    if (iSel < 0 || ev.button !== 0 || ferr !== 'mover') return;
    ev.stopPropagation();
    comecarArrasto(ev, 'redimensionar', [iSel]);
  };

  const durante = (ev: React.PointerEvent) => {
    const l = lacoAtual.current;
    if (l) {
      const p = pontoDoc(ev.clientX, ev.clientY);
      lacoAtual.current = {...l, x1: p.x, y1: p.y};
      setLaco(lacoAtual.current);
      return;
    }
    const a = arrasto.current;
    if (!a) return;
    const tx = ev.clientX - a.x0;
    const ty = ev.clientY - a.y0;
    if (!a.alvo && Math.hypot(tx, ty) < 3) return;
    let dx = tx / escala;
    let dy = ty / escala;
    if (a.modo === 'mover') {
      // encaixe: a caixa do que anda encosta no alvo mais perto a 5 px de tela; Alt solta
      // a caixa que encaixa é a do que se vê: a foto que anda com a máscara fica de fora (o que aparece é a máscara)
      const fotos = new Set(mascarasEmUso(camadasPag).values());
      const vistas = a.pecas.filter((b) => !fotos.has(b.i));
      const base0 = caixaDeVarias((vistas.length ? vistas : a.pecas).map((b) => ({...b, rotacao: camadasPag[b.i]?.rotacao})))!;
      if (a.encaixe && opcoesGuias.encaixe && !ev.altKey) {
        const e = encaixar({...base0, x: base0.x + dx, y: base0.y + dy}, a.encaixe.alvos, TOLERANCIA_TELA / escala, opcoesGuias.grade ? passoDaGrade(W) : undefined);
        dx += e.dx;
        dy += e.dy;
        setAjuda({guias: e.guias, distancias: distancias({...base0, x: base0.x + dx, y: base0.y + dy}, a.encaixe.outras, {largura: W, altura: H})});
      } else setAjuda(a.encaixe ? {guias: [], distancias: distancias({...base0, x: base0.x + dx, y: base0.y + dy}, a.encaixe.outras, {largura: W, altura: H})} : null);
      a.alvo = a.pecas.map((b) => ({...b, x: Math.round(b.x + dx), y: Math.round(b.y + dy)}));
    }
    else {
      // camada girada: o arrasto é projetado nos eixos dela, e o canto de cima à esquerda fica parado (D15)
      const b = a.pecas[0];
      const t = (-a.rot * Math.PI) / 180;
      const largura = Math.max(4, Math.round(b.largura + dx * Math.cos(t) - dy * Math.sin(t)));
      const altura = ev.shiftKey ? Math.max(4, Math.round((largura * b.altura) / b.largura)) : Math.max(4, Math.round(b.altura + dx * Math.sin(t) + dy * Math.cos(t)));
      a.alvo = [{...b, ...redimensionarGirada({...b, rotacao: a.rot}, largura, altura)}];
    }
    setGesto(a.alvo);
  };

  const soltar = async (ev: React.PointerEvent) => {
    const l = lacoAtual.current;
    if (l) {
      const r = {x: Math.min(l.x0, l.x1), y: Math.min(l.y0, l.y1), w: Math.abs(l.x1 - l.x0), h: Math.abs(l.y1 - l.y0)};
      lacoAtual.current = null;
      setLaco(null);
      if (r.w * escala < 3 && r.h * escala < 3) return; // clique no vazio: a seleção já saiu no apertar
      selecionarVarias(documento, [...l.somar, ...tocadasPor(camadasPag, r).map((i) => `${base}/${i}`)]);
      return;
    }
    const a = arrasto.current;
    arrasto.current = null;
    if (!a) return;
    if (!a.alvo) {
      // clique sem arrasto: dentro de uma seleção, escolhe a camada de cima naquele ponto (pode ser outra, menor, por
      // cima da selecionada); uma escolha nova (grupo inteiro) fica como o apertar deixou
      const caminho = a.modo === 'mover' ? caminhoSob(ev.clientX, ev.clientY) : null;
      if (a.colapsar && caminho && !(idxSel.length === 1 && caminho === caminhosSel[0])) selecionar({documento, caminho});
      return;
    }
    const atual = loja.get().docs[documento]?.doc;
    if (a.modo === 'mover') {
      const d = {dx: a.alvo[0].x - a.pecas[0].x, dy: a.alvo[0].y - a.pecas[0].y};
      const patch = patchMover(camadasPag, base, a.pecas.map((p) => p.i), a.pecas.map(() => d));
      if (patch.length) await aplicar(documento, patch, a.pecas.length > 1 ? `mover ${a.pecas.length} camadas` : `mover camada ${a.pecas[0].id}`);
    } else {
      const g = a.alvo[0];
      const caminho = `${base}/${g.i}`;
      const mudancas = CAMPOS.flatMap((k) => (g[k] !== a.pecas[0][k] ? patchTrocar(atual, `${caminho}/${k}`, g[k]) : []));
      if (mudancas.length) await aplicar(documento, [{op: 'test', path: `${caminho}/id`, value: g.id}, ...mudancas], `tamanho da camada ${g.id}`);
    }
    setGesto(null);
    setAjuda(null);
  };

  const cancelar = () => {
    arrasto.current = null;
    setGesto(null);
    setAjuda(null);
    lacoAtual.current = null;
    setLaco(null);
  };

  const salvarComentario = async () => {
    if (!balao || !textoBalao.trim()) return setBalao(null);
    const b = palco.current!.getBoundingClientRect();
    const c = balao.caminho ? camadasPag[indiceDe(balao.caminho, base)] : undefined;
    await comentar(documento, textoBalao.trim(), {
      objeto: c ? balao.caminho : undefined, objeto_id: c?.id, contexto: c ? contextoDe(c) : undefined,
      ponto: {x: +(balao.x / b.width).toFixed(4), y: +(balao.y / b.height).toFixed(4)},
      ...(temPaginas(doc) ? {pagina_id: ativa.pagina.id} : {}), // a página pelo id: o caminho muda quando as páginas mudam (imagem-D5)
    });
    setBalao(null);
    loja.definir({modoComentario: false});
  };

  const abrirPino = (c: Comentario) => {
    loja.definir({comentarioAberto: c.id});
    if (!editavel) return;
    const caminho = caminhoDoAlvo(doc, c.alvo) ?? (c.alvo.pagina_id ? undefined : c.alvo.objeto);
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
      {id: 'icone', nome: 'Inserir ícone (balança, contrato, prazo…)', icone: <Shapes />, ativa: buscandoIcone, aoClicar: () => setBuscandoIcone(true)},
      {id: 'linha', nome: 'Inserir linha ou seta', icone: <MoveUpRight />, ativa: inserindoLinha, aoClicar: () => setInserindoLinha(true)},
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
          <AvisoAgente />
          {w > 0 && h > 0 && <div className="palco xadrez" ref={palco} style={{width: W * escala, height: H * escala, margin: 'auto', cursor}}
            onClick={clicar} onDoubleClick={duploClique} onMouseMove={mover} onMouseLeave={() => {
              setHover(null);
              if (coords.current) coords.current.textContent = '';
            }}
            onPointerDown={(e) => (comecarForma(e), comecarMover(e))} onPointerMove={(e) => (duranteForma(e), durante(e))} onPointerCancel={cancelar}
            onPointerUp={(e) => {
              if (desenho.current) setTimeout(soltarForma, 0);
              void soltar(e);
            }}>
            <span className="rotulo-peca" title="Propriedades da imagem" onClick={(e) => {
              e.stopPropagation();
              if (editavel) selecionar(null);
            }}><b>{titulo}</b> · {W} × {H}{variasPaginas && <> · {ativa.p + 1}/{ativa.paginas.length} {ativa.pagina.nome}</>}</span>
            <div style={{position: 'absolute', left: 0, top: 0, width: W, height: H, transform: `scale(${escala})`, transformOrigin: '0 0',
              background: fundo, overflow: 'hidden', userSelect: 'none'}}>
              <CamadaEfeitos efeitos={previaEfeitos ?? doc.efeitos} quadro={0} largura={doc.largura} altura={doc.altura}>
                <div style={{position: 'absolute', inset: 0, background: fundo}} />
                {fundoDegrade !== undefined && <FundoPintado degrade={fundoDegrade} largura={W} altura={H} escala={escala} />}
                <CamadasDaPagina camadas={camadas} base={base} escala={escala} largura={W} altura={H} />
              </CamadaEfeitos>
            </div>
            <div className="sobreposicao">
              <MarcasAgente caixas={camadas.flatMap((c, i) => (mudouEm(mudancas, documento, `${base}/${i}`) ? [{chave: `${base}/${i}`, x: c.x * escala, y: c.y * escala,
                w: c.largura * escala, h: c.altura * escala}] : []))} />
              {sobre && <div className="caixa-hover" style={caixaCss(sobre, escala)} />}
              {nova && <div className="caixa-nova" style={{left: nova.x * escala, top: nova.y * escala, width: nova.largura * escala, height: nova.altura * escala}} />}
              {sel && (
                <div className="caixa-sel" data-sel="" style={{...caixaCss(sel, escala), pointerEvents: modoComentario || ferr !== 'mover' ? 'none' : undefined,
                  borderStyle: visivel(sel) && !travada(sel) ? undefined : 'dashed', cursor: travada(sel) ? 'not-allowed' : undefined}} title={travada(sel) ? 'Travada: Ctrl+Shift+L destrava' : undefined}
                  onClick={(e) => e.stopPropagation()}>
                  {!sel.rotacao && sel.y * escala > 20 && <span className="etiqueta-sel">{travada(sel) && <Lock className="i12" style={{marginRight: 3}} />}{rotuloCamada(sel)}</span>}
                  {!travada(sel) && <div className="alca" onPointerDown={iniciarRedimensionar} title="Redimensionar (Shift mantém a proporção)" />}
                </div>
              )}
              {caixaSel && (
                <>
                  {idxSel.map((i) => <div key={i} className="caixa-multi" data-sel="" style={caixaCss(camadas[i], escala)} />)}
                  <div className="caixa-grupo" data-sel="" title={`${idxSel.length} camadas: arraste para mover juntas`}
                    style={{left: caixaSel.x * escala, top: caixaSel.y * escala, width: caixaSel.w * escala, height: caixaSel.h * escala,
                      pointerEvents: modoComentario || ferr !== 'mover' ? 'none' : undefined}} onClick={(e) => e.stopPropagation()} />
                </>
              )}
              {laco && <div className="laco" style={{left: Math.min(laco.x0, laco.x1) * escala, top: Math.min(laco.y0, laco.y1) * escala,
                width: Math.abs(laco.x1 - laco.x0) * escala, height: Math.abs(laco.y1 - laco.y0) * escala}} />}
              {opcoesGuias.grade && <Grade escala={escala} largura={W} altura={H} passo={passoDaGrade(W)} />}
              {opcoesGuias.margem && <Margem escala={escala} areas={margemSegura(W, H)} />}
              {opcoesGuias.reguas && <Reguas escala={escala} largura={W} altura={H} />}
              {ajuda && gesto && <AjudaDoArrasto escala={escala} largura={W} altura={H} guias={ajuda.guias} distancias={ajuda.distancias} />}
              {vistaAlvo?.alvo && <div className="alvo-alinhar" style={{left: vistaAlvo.alvo.x * escala, top: vistaAlvo.alvo.y * escala, width: vistaAlvo.alvo.w * escala, height: vistaAlvo.alvo.h * escala}} />}
              {vistaAlvo?.fantasmas.map((f, k) => <div key={k} className="fantasma-alvo" style={{left: f.x * escala, top: f.y * escala, width: f.w * escala, height: f.h * escala}} />)}
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
          <BotaoMenu className="bt mini" lado="esquerda" acima titulo="Guias: encaixe, réguas, grade e margem segura" icone={<Magnet className="i14" />}
            rotulo={<span className="largo">Guias</span>}
            itens={ROTULOS_GUIAS.map(([k, nome]) => ({rotulo: `${opcoesGuias[k] ? '✓ ' : '   '}${nome}`, acao: () => alternarGuia(k)}))} />
          <span className="coords largo" ref={coords} />
          <button className="bt fantasma" style={{marginLeft: 'auto'}} disabled={exportando} onClick={exportar}
            title={variasPaginas ? 'Exportar só esta página em PNG, com os efeitos (o carrossel inteiro sai pela barra de páginas)' : 'Exportar PNG em resolução cheia, com os efeitos'}>
            <Download /><span className="largo">{variasPaginas ? 'Exportar página' : 'Exportar PNG'}</span>
          </button>
        </div>
      </div>
      {inserindo && editavel && <InserirImagem documento={documento} doc={doc} fechar={() => setInserindo(false)} />}
      {buscandoIcone && editavel && <BuscaIcones documento={documento} doc={doc} fechar={() => setBuscandoIcone(false)} />}
      {inserindoLinha && editavel && <InserirLinha documento={documento} doc={doc} fechar={() => setInserindoLinha(false)} />}
      {editavel && idxSel.length > 0 && !gesto && (
        <BarraSelecao documento={documento} base={base} camadas={camadasPag} indices={idxSel} prancheta={{largura: W, altura: H}} aoVer={setVistaAlvo} />
      )}
    </div>
  );
};
