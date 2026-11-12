// Casca do Estúdio: barra com as quatro áreas, painéis acopláveis (dockview) e rodapé de estado. Cada área guarda o
// próprio arranjo de painéis (como as páginas do Resolve e os workspaces do Blender); o terminal é o mesmo em todas.
// A barra tem o menu de costume dos editores (Novo, Abrir, Abrir recente, Duplicar, Fechar, Preferências), o nome do
// projeto renomeável com um clique, o "Salvo" (tudo grava na hora; Ctrl+S marca um ponto de restauração) e o Exportar,
// que abre o diálogo de exportação do documento da área (componentes/DialogoExportar.tsx). No grupo do inspetor, ao lado
// de Comentários e Histórico, fica o painel Pesquisa (só leitura: fontes e fatos de pesquisa/pesquisa.json).
import React, {Suspense, useCallback, useEffect, useRef, useState} from 'react';
import {usarTemExemplo} from '../estado/exemplo';
import {DockviewReact, type DockviewApi, type DockviewReadyEvent, type DockviewTheme, type IDockviewPanelHeaderProps, type IDockviewPanelProps} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import {Blend, BookMarked, BookOpen, Box, Maximize2, Minimize2, Check, Copy, Download, Film, FilePlus2, FolderOpen, FolderSearch, History, Home, Image as ImageIcon, Images, LayoutPanelLeft, ListTree,
  MessageSquare, MessageSquarePlus, MonitorPlay, Music, Palette, Plus, Rows3, Settings, SlidersHorizontal, Sparkle, Sparkles, Undo2, X} from 'lucide-react';
import type {Preferencias, Recente} from '../../compartilhado/api';
import type {Modulo} from '../../nucleo/documentos';
import {FORMATOS_IMAGEM, FORMATOS_VIDEO} from '../../nucleo/formatos';
import {abrirProjeto, avisar, criarDocumento, desfazer, dispensarMudancasAgente, fecharProjeto, loja, mensagemDe, quandoVerFato, useLoja, type Area} from '../estado/loja';
import {pedirTexto} from '../componentes/Dialogo';
import {IconeEstudio} from '../componentes/Icones';
import {acaoDeArquivo} from './atalhos';
import {comando, comModificador, rotuloDoAtalho} from '../teclas';
import {SeloSalvo} from './SeloSalvo';
import {faixaAtual, gravarLayout, layoutPadrao, lerLayout, type Faixa, type Orientacao} from './arranjos';
import {PainelPreferencias} from './Preferencias';
import {PrimeirosPassos} from './PrimeirosPassos';
import {Midia} from '../paineis/Midia'; // frente Casca (rodada 3): painel de mídia
import type {PaineisDoModulo} from './contrato';
import {PaineisVideo} from '../modulos/video/paineis';
import {PaineisImagem} from '../modulos/imagem/paineis';
import {PaineisEfeitos} from '../modulos/efeitos/paineis';
import {PaineisAnimacao} from '../modulos/animacao/paineis';
import {abrirDialogoExportar, RaizDialogoExportar} from '../componentes/DialogoExportar';
import {alternarTelaCheia, sairDaTelaCheia} from '../componentes/TelaCheia';
import {Comentarios} from '../paineis/Comentarios';
import {Historico} from '../paineis/Historico';
import {Pesquisa} from '../paineis/Pesquisa';
import {Rodape} from './Rodape';
import {PaineisMusica} from '../modulos/musica/paineis'; // frente Música
import {FaixaTransicao} from '../modulos/musica/FaixaTransicao';
import {musica, observarMusica} from '../modulos/musica/estado';
import {exportarMusica} from '../modulos/musica/acoes';
import {PainelMarca} from './PainelMarca';
import {usarAparencia} from '../estado/aparencia';
import './casca.css';

// o 3D (Three.js) e o terminal (xterm.js) só carregam quando alguém abre: a memória do app parado fica menor
const Terminal = React.lazy(() => import('../paineis/Terminal').then((m) => ({default: m.Terminal})));
const carregar3d = () => import('../modulos/tres/paineis').then((m) => m.PaineisTres);
let Paineis3d: PaineisDoModulo | null = null;

// na ordem de uso (as menos usadas, Efeitos e 3D, no fim); as teclas 1 a 6 (e Alt+1 a 6) seguem esta ordem
export const AREAS: {id: Area; nome: string; icone: React.ReactNode; atalho: string}[] = [
  {id: 'video', nome: 'Vídeo', icone: <Film size={15} />, atalho: '1'},
  {id: 'imagem', nome: 'Imagem', icone: <ImageIcon size={15} />, atalho: '2'},
  {id: 'animacao', nome: 'Animação', icone: <Sparkles size={15} />, atalho: '3'},
  {id: 'musica', nome: 'Música', icone: <Music size={15} />, atalho: '4'}, // frente Música
  {id: 'efeitos', nome: 'Efeitos', icone: <Blend size={15} />, atalho: '5'},
  {id: '3d', nome: '3D', icone: <Box size={15} />, atalho: '6'},
];

const Carregando: React.FC = () => <div className="vazio">carregando…</div>;

const paineisDa = (area: Area): PaineisDoModulo | null => {
  if (area === 'video') return PaineisVideo;
  if (area === 'imagem') return PaineisImagem;
  if (area === 'efeitos') return PaineisEfeitos;
  if (area === 'musica') return PaineisMusica; // frente Música
  if (area === 'animacao') return PaineisAnimacao;
  return Paineis3d;
};

// componentes de painel: leem a área atual e mostram o pedaço do módulo certo
const PorArea: React.FC<{parte: 'Lista' | 'Monitor' | 'Inspector' | 'Linha'}> = ({parte}) => {
  const area = useLoja((e) => e.area);
  const [, forcar] = React.useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (area === '3d' && !Paineis3d) void carregar3d().then((p) => ((Paineis3d = p), forcar()));
  }, [area]);
  const p = paineisDa(area);
  if (!p) return <Carregando />;
  const C = p[parte];
  return C ? <C /> : <div className="vazio">sem linha do tempo neste módulo</div>;
};

// aba dos painéis: ícone + nome; em grupo estreito as abas de trás ficam só com o ícone (casca.css). Os painéis que
// sustentam a área não têm ×; os outros mostram o × ao passar o mouse.
const ICONES_ABA: Record<string, React.ReactNode> = {
  monitor: <MonitorPlay size={14} />, linha: <Rows3 size={14} />, lista: <ListTree size={14} />, inspector: <SlidersHorizontal size={14} />,
  comentarios: <MessageSquare size={14} />, historico: <History size={14} />, pesquisa: <BookMarked size={14} />, midia: <Images size={14} />, terminal: <Sparkle size={14} />,
};
const ESSENCIAIS = new Set(['monitor', 'linha', 'lista', 'inspector', 'terminal']);
// nome curto das abas de trás num grupo estreito (o inspetor tem ~310 px na tela grande): o nome inteiro fica na dica
const CURTOS: Record<string, string> = {comentarios: 'Coment.', historico: 'Hist.', pesquisa: 'Pesq.', midia: 'Mídia', inspector: 'Props.'};
const AbaDoPainel: React.FC<IDockviewPanelHeaderProps> = ({api}) => {
  const [titulo, setTitulo] = useState(api.title ?? '');
  useEffect(() => {
    const d = api.onDidTitleChange((e) => setTitulo(e.title));
    return () => d.dispose();
  }, [api]);
  const abertos = useLoja((e) => (api.id === 'comentarios' ? e.comentarios.filter((c) => c.estado === 'aberto').length : 0));
  return (
    <div className={`aba-doca aba-${api.id}`} title={titulo}>
      <span className="aba-icone">{ICONES_ABA[api.id]}</span>
      <span className="aba-titulo">{titulo}</span>
      {CURTOS[api.id] && <span className="aba-curto" aria-hidden="true">{CURTOS[api.id]}</span>}
      {abertos > 0 && <span className="aba-contador">{abertos}</span>}
      {!ESSENCIAIS.has(api.id) && (
        <span className="aba-x" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => (e.stopPropagation(), api.close())} title="Fechar"><X size={12} /></span>
      )}
    </div>
  );
};
const TEMAS: Record<'escuro' | 'claro', DockviewTheme> = {
  escuro: {name: 'estudio', className: 'dockview-theme-estudio', colorScheme: 'dark', gap: 2},
  claro: {name: 'estudio-claro', className: 'dockview-theme-estudio', colorScheme: 'light', gap: 2},
};

const componentes: Record<string, React.FC<IDockviewPanelProps>> = {
  lista: () => <PorArea parte="Lista" />,
  monitor: () => <PorArea parte="Monitor" />,
  inspector: () => <PorArea parte="Inspector" />,
  linha: () => <PorArea parte="Linha" />,
  comentarios: () => <Comentarios />,
  historico: () => <Historico />,
  pesquisa: () => <Pesquisa />,
  midia: () => <Midia />,
  terminal: () => <Suspense fallback={<Carregando />}><Terminal /></Suspense>,
};

const COM_TELA_CHEIA = new Set<Area>(['video', 'imagem', 'animacao']);
const TITULOS: Record<Area, string> = {video: 'Cenas e blocos', imagem: 'Camadas', '3d': 'Objetos', efeitos: 'Pilha de efeitos', musica: 'Canais', animacao: 'Camadas'};

/** Orientação do vídeo ativo, pelas props montadas (sem props ainda: vertical, o carrossel). */
const orientacaoDe = (e: ReturnType<typeof loja.get>): Orientacao => {
  const id = e.ativo.video;
  const p = id ? e.props[id] : undefined;
  if (!p || !('props' in p)) return 'V';
  const {largura, altura} = p.props as {largura?: number; altura?: number};
  return largura && altura && largura > altura ? 'H' : 'V';
};

// ---------- exportar a área atual: abre o diálogo com o documento da área ----------
const exportarArea = () => {
  const e = loja.get();
  const id = e.area === 'efeitos' ? e.alvoEfeitos : e.area === '3d' ? undefined : e.ativo[e.area];
  const modulo = e.info?.manifesto.documentos.find((d) => d.id === id)?.modulo;
  if (modulo === 'musica') return void exportarMusica({formato: 'wav'}); // frente Música: WAV a −14 LUFS em saidas/; outros formatos no botão Exportar do transporte
  if (!id || !modulo || modulo === '3d') return avisar(e.area === '3d' ? 'A cena 3D ainda não exporta.' : 'Nada para exportar nesta área.', 'info');
  abrirDialogoExportar(id);
};

/** Nome do projeto na barra: um clique vira campo; Enter grava, Esc desiste. */
const NomeProjeto: React.FC<{nome: string; raiz?: string}> = ({nome, raiz}) => {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(nome);
  useEffect(() => setValor(nome), [nome]);
  const gravar = async () => {
    setEditando(false);
    const v = valor.trim();
    if (!v || v === nome) return setValor(nome);
    try {
      await window.estudio.renomearProjeto(v);
    } catch (e) {
      avisar(mensagemDe(e), 'erro');
      setValor(nome);
    }
  };
  if (editando) {
    return <input className="campo nome-projeto" autoFocus value={valor} onChange={(e) => setValor(e.target.value)} onBlur={() => void gravar()}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') (setValor(nome), setEditando(false));
      }} />;
  }
  return <button className="nome-projeto" onClick={() => setEditando(true)} title={`${raiz ?? ''}\nClique para renomear`}>{nome}</button>;
};

export const Casca: React.FC = () => {
  const temExemplo = usarTemExemplo();
  const aparenciaAtual = usarAparencia();
  const area = useLoja((e) => e.area);
  const info = useLoja((e) => e.info);
  const modoComentario = useLoja((e) => e.modoComentario);
  const orientacao = useLoja(orientacaoDe);
  const api = useRef<DockviewApi | null>(null);
  const areaMontada = useRef<Area>(area);
  const orientacaoMontada = useRef<Orientacao>(orientacao);

  const faixa = useRef<Faixa>(faixaAtual());
  const abrirRef = useRef<() => Promise<void>>(async () => undefined);
  const [preferencias, setPreferencias] = useState(false);
  const [marca, setMarca] = useState(false);

  const montar = useCallback((a: Area, padrao = false) => {
    const d = api.current;
    if (!d) return;
    faixa.current = faixaAtual();
    document.documentElement.dataset.faixa = faixa.current;
    const o = orientacaoDe(loja.get());
    if (d.hasMaximizedGroup()) d.exitMaximizedGroup();
    setFocado(false);
    d.clear();
    const salvo = padrao ? null : lerLayout(a, faixa.current, o);
    try {
      if (salvo) d.fromJSON(salvo);
      else layoutPadrao(d, a, faixa.current, o);
    } catch {
      d.clear();
      layoutPadrao(d, a, faixa.current, o);
    }
    d.getPanel('lista')?.api.setTitle(TITULOS[a]);
    areaMontada.current = a;
    orientacaoMontada.current = o;
  }, []);

  const pronto = (e: DockviewReadyEvent) => {
    api.current = e.api;
    montar(loja.get().area);
    e.api.onDidLayoutChange(() => gravarLayout(areaMontada.current, faixa.current, orientacaoMontada.current, e.api));
    // projeto criado pelo campo do Claude na tela inicial: o painel do Claude vem para a frente e abre a conversa
    if (loja.get().pedidoClaude) e.api.getPanel('terminal')?.api.setActive();
  };

  // mudou de faixa (janela maximizada ou restaurada): troca para o arranjo daquela faixa
  useEffect(() => {
    const aoRedimensionar = () => {
      if (faixaAtual() !== faixa.current) montar(areaMontada.current);
    };
    window.addEventListener('resize', aoRedimensionar);
    return () => window.removeEventListener('resize', aoRedimensionar);
  }, [montar]);

  useEffect(() => {
    if (api.current && areaMontada.current !== area) montar(area);
  }, [area, montar]);
  // vídeo de outro formato no Vídeo (abriu um 16:9 depois de um 9:16): o arranjo daquela orientação
  useEffect(() => {
    if (api.current && areaMontada.current === 'video' && orientacaoMontada.current !== orientacao) montar('video');
  }, [orientacao, montar]);

  useEffect(() => observarMusica(), []); // frente Música: registro de transições e render ligado ao vídeo

  // etiqueta de fato no inspetor: o painel Pesquisa vem à frente (e volta ao grupo do inspetor se tinha sido fechado)
  useEffect(() => quandoVerFato(() => {
    const d = api.current;
    if (!d) return;
    const p = d.getPanel('pesquisa') ?? d.addPanel({id: 'pesquisa', component: 'pesquisa', title: 'Pesquisa',
      ...(d.getPanel('inspector') ? {position: {referencePanel: 'inspector', direction: 'within' as const}} : {})});
    p.api.setActive();
  }), []);

  // "N mudanças do Claude" no rodapé: o Histórico vem para a frente (volta ao grupo do inspetor se tinha sido fechado)
  useEffect(() => {
    const ver = () => {
      const d = api.current;
      if (!d) return;
      const p = d.getPanel('historico') ?? d.addPanel({id: 'historico', component: 'historico', title: 'Histórico',
        ...(d.getPanel('inspector') ? {position: {referencePanel: 'inspector', direction: 'within' as const}} : {})});
      p.api.setActive();
    };
    window.addEventListener('estudio:ver-historico', ver);
    return () => window.removeEventListener('estudio:ver-historico', ver);
  }, []);

  // o painel de mídia fechado volta pelo menu do projeto, ao lado da Lista (ou do inspetor, se a Lista não estiver)
  const abrirMidia = () => {
    const d = api.current;
    if (!d) return;
    const ref = d.getPanel('lista') ? 'lista' : 'inspector';
    const p = d.getPanel('midia') ?? d.addPanel({id: 'midia', component: 'midia', title: 'Mídia', ...(d.getPanel(ref) ? {position: {referencePanel: ref, direction: 'within' as const}} : {})});
    p.api.setActive();
  };

  // "Focar no monitor" (Ctrl+\, como o "esconder a interface" do Figma): o grupo do monitor ocupa a doca; de novo, volta
  const [focado, setFocado] = useState(false);
  const alternarFoco = () => {
    const d = api.current;
    const m = d?.getPanel('monitor');
    if (!d || !m) return;
    if (d.hasMaximizedGroup()) d.exitMaximizedGroup();
    else d.maximizeGroup(m);
    setFocado(d.hasMaximizedGroup());
  };
  const alternarFocoRef = useRef(alternarFoco);
  alternarFocoRef.current = alternarFoco;

  const marcarVersao = async () => {
    const r = await window.estudio.marcarVersao();
    avisar(r.mensagem, r.ok ? 'ok' : 'info');
  };
  const novoProjeto = () => void fecharProjeto();
  const voltarAoInicio = () => void fecharProjeto();
  const duplicar = async () => {
    const n = await pedirTexto({titulo: 'Duplicar projeto', rotulo: 'Nome da cópia', valor: `${info?.manifesto.nome ?? 'Projeto'} (cópia)`, botao: 'Duplicar e abrir',
      texto: 'A cópia fica ao lado deste projeto, sem o histórico, e abre no lugar dele.'});
    if (!n) return;
    try {
      await abrirProjeto(await window.estudio.duplicarProjeto({nome: n}));
      avisar('Cópia aberta', 'ok');
    } catch (e) {
      avisar(mensagemDe(e), 'erro');
    }
  };

  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => {
      const alvo = ev.target instanceof HTMLElement ? ev.target : document.body;
      const digitando = /INPUT|TEXTAREA|SELECT/.test(alvo.tagName) || alvo.isContentEditable || alvo.closest('.xterm');
      if (document.querySelector('.dialogo-fundo')) return;
      const k = ev.key.toLowerCase();
      // Alt+1 a 6, Ctrl+' e Ctrl+S valem até com o terminal em foco (escuta na captura, antes do xterm). Ctrl+O, N e W são
      // de arquivo só fora do terminal, onde o Ctrl+W apaga uma palavra (transversal-D4, atalhos.ts)
      const arquivo = acaoDeArquivo(ev, Boolean(alvo.closest('.xterm')));
      // Ctrl no Windows e no Linux, Cmd no Mac (teclas.ts)
      const cmd = comando(ev);
      if (ev.altKey && !ev.ctrlKey && !ev.metaKey && /^Digit[1-6]$/.test(ev.code)) {
        ev.preventDefault();
        ev.stopPropagation();
        loja.definir({area: AREAS[Number(ev.code.slice(5)) - 1].id});
      } else if (cmd && !ev.altKey && (ev.code === 'Quote' || ev.code === 'Backquote')) {
        ev.preventDefault();
        ev.stopPropagation();
        api.current?.getPanel('terminal')?.api.setActive();
        (document.querySelector('.conversa .caixa-pedido textarea, .terminal-corpo textarea') as HTMLTextAreaElement | null)?.focus();
      } else if (arquivo === 'abrir') {
        ev.preventDefault();
        void abrirRef.current();
      } else if (arquivo === 'novo') {
        ev.preventDefault();
        novoProjeto();
      } else if (arquivo === 'fechar') {
        ev.preventDefault();
        voltarAoInicio();
      } else if (cmd && !ev.altKey && !ev.shiftKey && k === 's') {
        ev.preventDefault();
        void marcarVersao();
      } else if (cmd && !ev.altKey && !ev.shiftKey && (ev.code === 'Backslash' || ev.code === 'IntlBackslash')) {
        ev.preventDefault();
        alternarFocoRef.current();
      } else if (cmd && ev.shiftKey && !ev.altKey && k === 'e') {
        ev.preventDefault();
        exportarArea();
      } else if (cmd && !ev.altKey && !ev.shiftKey && k === 'f' && !digitando && COM_TELA_CHEIA.has(loja.get().area)) {
        // tela cheia do monitor (docs/tela.md, atalhos): fora do terminal e dos campos de texto
        ev.preventDefault();
        alternarTelaCheia();
      } else if (cmd && k === 'z' && !digitando) {
        ev.preventDefault();
        void desfazer();
      } else if (!digitando && !comModificador(ev) && /^[1-6]$/.test(ev.key)) {
        loja.definir({area: AREAS[Number(ev.key) - 1].id});
      } else if (!digitando && !ev.ctrlKey && !ev.metaKey && k === 'm') {
        loja.definir((s) => ({modoComentario: !s.modoComentario}));
      } else if (!digitando && !ev.ctrlKey && !ev.metaKey && k === 'v') {
        loja.definir({modoComentario: false});
      } else if (ev.key === 'Escape' && !digitando && sairDaTelaCheia()) {
        ev.preventDefault();
      } else if (ev.key === 'Escape') {
        loja.definir({modoComentario: false, comentarioAberto: undefined});
        dispensarMudancasAgente();
      }
    };
    window.addEventListener('keydown', tecla, true);
    return () => window.removeEventListener('keydown', tecla, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const abrir = async () => {
    const i = await window.estudio.abrirPasta().catch((e: Error) => (avisar(mensagemDe(e), 'erro'), null));
    if (i) await abrirProjeto(i);
  };
  abrirRef.current = abrir;
  const abrirRecente = async (r: Recente) => {
    try {
      await abrirProjeto(await window.estudio.abrirProjeto(r.raiz));
    } catch (e) {
      avisar(mensagemDe(e), 'erro');
    }
  };

  const [menu, setMenu] = useState(false);
  const [recentes, setRecentes] = useState<Recente[]>([]);
  const [prefs, setPrefs] = useState<Preferencias | null>(null);
  useEffect(() => {
    if (!menu) return;
    void window.estudio.recentes().then((l) => setRecentes(l.filter((r) => r.existe && r.raiz !== info?.raiz).slice(0, 6)));
    void window.estudio.preferencias().then(setPrefs);
    const fechar = () => setMenu(false);
    window.addEventListener('pointerdown', fechar);
    return () => window.removeEventListener('pointerdown', fechar);
  }, [menu, info?.raiz]);
  const novoDocumento = (m: Modulo) => {
    setMenu(false);
    const f = m === 'video' || m === 'animacao' ? FORMATOS_VIDEO.find((x) => x.id === prefs?.formato_video) ?? FORMATOS_VIDEO[0]
      : m === 'imagem' ? FORMATOS_IMAGEM.find((x) => x.id === prefs?.formato_imagem) ?? FORMATOS_IMAGEM[0] : undefined;
    void criarDocumento(m, f ? {largura: f.largura, altura: f.altura, fps: 30} : undefined);
  };
  // a música começa por um modelo: a área mostra os modelos (com uma música já aberta, a tela de criar outra)
  const novaMusica = () => {
    setMenu(false);
    loja.definir({area: 'musica'});
    if (info?.manifesto.documentos.some((d) => d.modulo === 'musica')) musica.definir({escolhendoModelo: true});
  };
  const item = (f: () => void) => () => {
    setMenu(false);
    f();
  };

  const ativo = useLoja((e) => e.ativo);
  const alvoEfeitos = useLoja((e) => e.alvoEfeitos);
  const idDoc = area === 'efeitos' ? alvoEfeitos : (ativo as Record<string, string | undefined>)[area];
  const docAtivo = info?.manifesto.documentos.find((d) => d.id === idDoc);
  const podeExportar = Boolean(docAtivo && docAtivo.modulo !== '3d');

  return (
    <div className={`casca${modoComentario ? ' modo-comentario' : ''}`}>
      <header className="barra">
        <button className="marca" onPointerDown={(e) => e.stopPropagation()} onClick={() => setMenu((m) => !m)} title="Menu do Estúdio">
          <IconeEstudio />
          Estúdio
        </button>
        {menu && (
          <div className="menu-app" onPointerDown={(e) => e.stopPropagation()}>
            <button onClick={item(novoProjeto)}><Plus size={14} />Novo projeto…<kbd>{rotuloDoAtalho('Ctrl+N')}</kbd></button>
            <div className="menu-sub">
              <span className="menu-rotulo"><FilePlus2 size={14} />Novo neste projeto</span>
              <span className="menu-linha">
                <button onClick={() => novoDocumento('video')}><Film size={13} />Vídeo</button>
                <button onClick={() => novoDocumento('imagem')}><ImageIcon size={13} />Imagem</button>
                <button onClick={() => novoDocumento('animacao')}><Sparkles size={13} />Animação</button>
                <button onClick={novaMusica} title="Abre os modelos da área Música (Batida, Trilha…) para começar uma música"><Music size={13} />Música</button>
                <button onClick={() => novoDocumento('3d')}><Box size={13} />3D</button>
              </span>
            </div>
            <hr />
            <button onClick={item(() => void abrir())}><FolderOpen size={14} />Abrir pasta…<kbd>{rotuloDoAtalho('Ctrl+O')}</kbd></button>
            {recentes.length > 0 && (
              <>
                <span className="menu-rotulo">Abrir recente</span>
                {recentes.map((r) => <button key={r.raiz} className="recente" title={r.raiz} onClick={item(() => void abrirRecente(r))}>{r.nome}</button>)}
              </>
            )}
            <hr />
            <button onClick={item(() => void duplicar())}><Copy size={14} />Duplicar projeto…</button>
            <button onClick={item(() => window.estudio.mostrarNaPasta())}><FolderSearch size={14} />Mostrar na pasta</button>
            <button onClick={item(() => void marcarVersao())}><Check size={14} />Marcar ponto de restauração<kbd>{rotuloDoAtalho('Ctrl+S')}</kbd></button>
            {temExemplo && <button onClick={item(() => void window.estudio.abrirExemplo().then(abrirProjeto).catch((e: Error) => avisar(mensagemDe(e), 'erro')))}><BookOpen size={14} />Ver um exemplo</button>}
            <hr />
            <button onClick={item(abrirMidia)}><Images size={14} />Mídia do projeto</button>
            <button onClick={item(() => setMarca(true))}><Palette size={14} />Marca…</button>
            <button onClick={item(() => setPreferencias(true))}><Settings size={14} />Preferências…</button>
            <button onClick={item(() => montar(area, true))}><LayoutPanelLeft size={14} />Redefinir os painéis desta área</button>
            <hr />
            <button onClick={item(voltarAoInicio)}><Home size={14} />Fechar projeto e ir ao início<kbd>{rotuloDoAtalho('Ctrl+W')}</kbd></button>
          </div>
        )}
        <span className="projeto">
          <span className="sep">/</span>
          <NomeProjeto nome={info?.manifesto.nome ?? 'Sem nome'} raiz={info?.raiz} />
          {docAtivo && <><span className="sep">›</span><span className="doc">{docAtivo.titulo}</span></>}
          <SeloSalvo git={Boolean(info?.git)} />
        </span>
        <nav className="areas">
          {AREAS.map((a) => (
            <button key={a.id} className={a.id === area ? 'ativa' : ''} onClick={() => loja.definir({area: a.id})} title={`${a.nome} · ${a.atalho} ou Alt+${a.atalho}`}>
              {a.icone}{a.nome}
            </button>
          ))}
        </nav>
        <div className="acoes">
          <PrimeirosPassos />
          <button className={`bti${modoComentario ? ' ligado' : ''}`} onClick={() => loja.definir((s) => ({modoComentario: !s.modoComentario}))} title="Comentar na tela (M)"
            aria-label="Comentar na tela" aria-pressed={modoComentario}>
            <MessageSquarePlus size={15} />
          </button>
          <button className={`bti${focado ? ' ligado' : ''}`} onClick={alternarFoco} title={focado ? `Mostrar os painéis de novo (${rotuloDoAtalho('Ctrl+\\')})` : `Focar no monitor: esconde os outros painéis (${rotuloDoAtalho('Ctrl+\\')})`}
            aria-label={focado ? 'Mostrar os painéis' : 'Focar no monitor'} aria-pressed={focado}>{focado ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
          <button className="bti" onClick={() => void desfazer()} title={`Desfazer a sua última edição (${rotuloDoAtalho('Ctrl+Z')})`} aria-label="Desfazer"><Undo2 size={15} /></button>
          <button className="bt principal exportar" disabled={!podeExportar} onClick={exportarArea}
            title={podeExportar ? (docAtivo!.modulo === 'musica' ? 'Exportar a música em WAV para a pasta saidas (M4A, Opus, MIDI e stems: botão Exportar do transporte) (' + rotuloDoAtalho('Ctrl+Shift+E') + ')'
              : `Exportar ${docAtivo!.modulo === 'video' ? 'o vídeo' : docAtivo!.modulo === 'animacao' ? 'a animação' : 'a imagem'} para a pasta saidas… (${rotuloDoAtalho('Ctrl+Shift+E')})`)
            : area === '3d' ? 'A cena 3D ainda não exporta' : 'Nada para exportar nesta área'}>
            <Download size={15} />Exportar
          </button>
        </div>
      </header>
      <FaixaTransicao />
      <div className="doca">
        <DockviewReact theme={TEMAS[aparenciaAtual.tema]} components={componentes} defaultTabComponent={AbaDoPainel} onReady={pronto} />
      </div>
      <Rodape />
      {preferencias && <PainelPreferencias aoFechar={() => setPreferencias(false)} />}
      {marca && <PainelMarca aoFechar={() => setMarca(false)} />}
      <RaizDialogoExportar />
    </div>
  );
};
