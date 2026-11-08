// Casca do Estúdio: barra com as quatro áreas, painéis acopláveis (dockview) e rodapé de estado. Cada área guarda o
// próprio arranjo de painéis (como as páginas do Resolve e os workspaces do Blender); o terminal é o mesmo em todas.
// A barra tem o menu de costume dos editores (Novo, Abrir, Abrir recente, Duplicar, Fechar, Preferências), o nome do
// projeto renomeável com um clique, o "Salvo" (tudo grava na hora; Ctrl+S marca um ponto de restauração) e o Exportar,
// que abre o diálogo de exportação do documento da área (componentes/DialogoExportar.tsx). No grupo do inspetor, ao lado
// de Comentários e Histórico, fica o painel Pesquisa (só leitura: fontes e fatos de pesquisa/pesquisa.json).
import React, {Suspense, useCallback, useEffect, useRef, useState} from 'react';
import {DockviewReact, type DockviewApi, type DockviewReadyEvent, type DockviewTheme, type IDockviewPanelHeaderProps, type IDockviewPanelProps} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import {Blend, BookOpen, Box, Check, Copy, Download, Film, FilePlus2, FolderOpen, FolderSearch, History, Home, Image as ImageIcon, LayoutPanelLeft, ListTree,
  MessageSquare, MessageSquarePlus, MonitorPlay, Music, Palette, Plus, Quote, Rows3, Settings, SlidersHorizontal, Sparkle, Undo2, X} from 'lucide-react';
import type {Preferencias, Recente} from '../../compartilhado/api';
import type {Modulo} from '../../nucleo/documentos';
import {FORMATOS_IMAGEM, FORMATOS_VIDEO} from '../../nucleo/formatos';
import {abrirProjeto, avisar, criarDocumento, desfazer, fecharProjeto, loja, mensagemDe, quandoVerFato, useLoja, type Area} from '../estado/loja';
import {pedirTexto} from '../componentes/Dialogo';
import type {PaineisDoModulo} from './contrato';
import {PaineisVideo} from '../modulos/video/paineis';
import {PaineisImagem} from '../modulos/imagem/paineis';
import {PaineisEfeitos} from '../modulos/efeitos/paineis';
import {abrirDialogoExportar, RaizDialogoExportar} from '../componentes/DialogoExportar';
import {Comentarios} from '../paineis/Comentarios';
import {Historico} from '../paineis/Historico';
import {Pesquisa} from '../paineis/Pesquisa';
import {Rodape} from './Rodape';
import {PaineisMusica} from '../modulos/musica/paineis'; // frente Música
import {FaixaTransicao} from '../modulos/musica/FaixaTransicao';
import {observarMusica} from '../modulos/musica/estado';
import {PainelMarca} from './PainelMarca';
import './casca.css';

// o 3D (Three.js) e o terminal (xterm.js) só carregam quando alguém abre: a memória do app parado fica menor
const Terminal = React.lazy(() => import('../paineis/Terminal').then((m) => ({default: m.Terminal})));
const carregar3d = () => import('../modulos/tres/paineis').then((m) => m.PaineisTres);
let Paineis3d: PaineisDoModulo | null = null;

const AREAS: {id: Area; nome: string; icone: React.ReactNode; atalho: string}[] = [
  {id: 'video', nome: 'Vídeo', icone: <Film size={15} />, atalho: '1'},
  {id: 'imagem', nome: 'Imagem', icone: <ImageIcon size={15} />, atalho: '2'},
  {id: '3d', nome: '3D', icone: <Box size={15} />, atalho: '3'},
  {id: 'efeitos', nome: 'Efeitos', icone: <Blend size={15} />, atalho: '4'},
  {id: 'musica', nome: 'Música', icone: <Music size={15} />, atalho: '5'}, // frente Música
];

const Carregando: React.FC = () => <div className="vazio">carregando…</div>;

const paineisDa = (area: Area): PaineisDoModulo | null => {
  if (area === 'video') return PaineisVideo;
  if (area === 'imagem') return PaineisImagem;
  if (area === 'efeitos') return PaineisEfeitos;
  if (area === 'musica') return PaineisMusica; // frente Música
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
  comentarios: <MessageSquare size={14} />, historico: <History size={14} />, pesquisa: <Quote size={14} />, terminal: <Sparkle size={14} />,
};
const ESSENCIAIS = new Set(['monitor', 'linha', 'lista', 'inspector', 'terminal']);
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
      {abertos > 0 && <span className="aba-contador">{abertos}</span>}
      {!ESSENCIAIS.has(api.id) && (
        <span className="aba-x" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => (e.stopPropagation(), api.close())} title="Fechar"><X size={12} /></span>
      )}
    </div>
  );
};
const TEMA: DockviewTheme = {name: 'estudio', className: 'dockview-theme-estudio', colorScheme: 'dark', gap: 2};

const componentes: Record<string, React.FC<IDockviewPanelProps>> = {
  lista: () => <PorArea parte="Lista" />,
  monitor: () => <PorArea parte="Monitor" />,
  inspector: () => <PorArea parte="Inspector" />,
  linha: () => <PorArea parte="Linha" />,
  comentarios: () => <Comentarios />,
  historico: () => <Historico />,
  pesquisa: () => <Pesquisa />,
  terminal: () => <Suspense fallback={<Carregando />}><Terminal /></Suspense>,
};

// faixas de layout de docs/tela.md: C (compacta) abaixo de 1600x800, P (padrão) acima; cada área x faixa guarda o seu.
// No Vídeo, o arranjo depende também do formato: vertical (V) quer o monitor em coluna, horizontal (H) quer largura.
// A versão na chave sobe quando entra painel novo no arranjo padrão (v6: Pesquisa), para os layouts gravados o verem.
type Faixa = 'C' | 'P';
type Orientacao = 'V' | 'H';
const faixaAtual = (): Faixa => (window.innerWidth < 1600 || window.innerHeight < 800 ? 'C' : 'P');
const CHAVE = (area: Area, faixa: Faixa, o: Orientacao) => `estudio:layout:v6:${area}:${faixa}${area === 'video' ? `:${o}` : ''}`;
const lerLayout = (area: Area, faixa: Faixa, o: Orientacao) => {
  try {
    const t = localStorage.getItem(CHAVE(area, faixa, o));
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
};
const gravarLayout = (area: Area, faixa: Faixa, o: Orientacao, api: DockviewApi) => {
  try {
    localStorage.setItem(CHAVE(area, faixa, o), JSON.stringify(api.toJSON()));
  } catch {
    /* sem armazenamento: volta ao arranjo padrão na próxima vez */
  }
};

// O terminal fica sempre na coluna da direita: embaixo é da linha do tempo, e altura é o que falta em notebook.
const layoutPadrao = (api: DockviewApi, area: Area, faixa: Faixa, o: Orientacao) => {
  const temLinha = area === 'video' || area === 'efeitos' || area === 'musica';
  const W = window.innerWidth;
  const H = window.innerHeight;
  const abasDoInspector = (comLista: boolean) => {
    if (comLista) api.addPanel({id: 'lista', component: 'lista', title: 'Lista', position: {referencePanel: 'inspector', direction: 'within'}});
    api.addPanel({id: 'comentarios', component: 'comentarios', title: 'Comentários', position: {referencePanel: 'inspector', direction: 'within'}});
    api.addPanel({id: 'historico', component: 'historico', title: 'Histórico', position: {referencePanel: 'inspector', direction: 'within'}});
    api.addPanel({id: 'pesquisa', component: 'pesquisa', title: 'Pesquisa', position: {referencePanel: 'inspector', direction: 'within'}});
    api.getPanel('inspector')?.api.setActive();
  };
  api.addPanel({id: 'monitor', component: 'monitor', title: 'Monitor'});
  if (faixa === 'P') {
    if (temLinha) api.addPanel({id: 'linha', component: 'linha', title: 'Linha do tempo', position: {direction: 'below'}, initialHeight: 260});
    api.addPanel({id: 'terminal', component: 'terminal', title: 'Claude', position: {direction: 'right'}, initialWidth: o === 'H' && area === 'video' ? 480 : 600});
    api.addPanel({id: 'lista', component: 'lista', title: 'Lista', position: {referencePanel: 'monitor', direction: 'left'}, initialWidth: 260});
    api.addPanel({id: 'inspector', component: 'inspector', title: 'Propriedades', position: {referencePanel: 'monitor', direction: 'right'}, initialWidth: 310});
    abasDoInspector(false);
  } else if (area === 'video' && o === 'V') {
    // vídeo vertical: o monitor numa coluna de altura total; à direita, propriedades e terminal em cima e a linha embaixo
    api.addPanel({id: 'terminal', component: 'terminal', title: 'Claude', position: {direction: 'right'}, initialWidth: Math.max(620, W - 380)});
    api.addPanel({id: 'linha', component: 'linha', title: 'Linha do tempo', position: {referencePanel: 'terminal', direction: 'below'}, initialHeight: Math.max(200, Math.round(H * 0.34))});
    api.addPanel({id: 'inspector', component: 'inspector', title: 'Propriedades', position: {referencePanel: 'terminal', direction: 'left'}, initialWidth: 300});
    abasDoInspector(true);
  } else {
    // vídeo horizontal, imagem, 3D e efeitos: monitor largo; à direita o terminal em cima e, embaixo dele, lista e propriedades
    if (temLinha) api.addPanel({id: 'linha', component: 'linha', title: 'Linha do tempo', position: {referencePanel: 'monitor', direction: 'below'}, initialHeight: 200});
    api.addPanel({id: 'terminal', component: 'terminal', title: 'Claude', position: {direction: 'right'}, initialWidth: Math.min(620, Math.round(W * 0.42))});
    api.addPanel({id: 'lista', component: 'lista', title: 'Lista', position: {referencePanel: 'terminal', direction: 'below'}, initialHeight: Math.round(H * 0.5)});
    api.addPanel({id: 'inspector', component: 'inspector', title: 'Propriedades', position: {referencePanel: 'lista', direction: 'right'}});
    abasDoInspector(false);
  }
};

const TITULOS: Record<Area, string> = {video: 'Cenas e blocos', imagem: 'Camadas', '3d': 'Objetos', efeitos: 'Pilha de efeitos', musica: 'Canais'};

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
  if (modulo === 'musica') return avisar('A música vai para o vídeo pelo "Pôr no vídeo" (ou "Concluir e voltar"); exportar a música em arquivo vem depois.', 'info'); // frente Música
  if (!id || !modulo || modulo === '3d') return avisar(e.area === '3d' ? 'A cena 3D ainda não exporta.' : 'Nada para exportar nesta área.', 'info');
  abrirDialogoExportar(id);
};

// ---------- preferências ----------
const PainelPreferencias: React.FC<{aoFechar: () => void}> = ({aoFechar}) => {
  const [p, setP] = useState<Preferencias | null>(null);
  useEffect(() => void window.estudio.preferencias().then(setP), []);
  const gravar = async (m: Partial<Preferencias>) => setP(await window.estudio.gravarPreferencias(m));
  return (
    <div className="dialogo-fundo" onPointerDown={(e) => e.target === e.currentTarget && aoFechar()} onKeyDown={(e) => e.key === 'Escape' && aoFechar()}>
      <div className="dialogo" role="dialog" aria-label="Preferências">
        <div className="dialogo-titulo">Preferências</div>
        {!p ? <div className="vazio">carregando…</div> : (
          <>
            <label className="dialogo-campo"><span>Pasta dos projetos novos</span>
              <span style={{display: 'flex', gap: 6}}>
                <input className="campo" readOnly value={p.pasta_projetos} title={p.pasta_projetos} />
                <button className="bt" onClick={async () => {
                  const pasta = await window.estudio.escolherPasta('Pasta dos projetos do Estúdio');
                  if (pasta) void gravar({pasta_projetos: pasta});
                }}>Trocar…</button>
              </span>
            </label>
            {/onedrive/i.test(p.pasta_projetos) && <div className="dialogo-texto" style={{color: 'var(--aviso)'}}>Pasta dentro do OneDrive: a sincronização pode travar a gravação.</div>}
            <label className="dialogo-campo"><span>Ao iniciar o Estúdio</span>
              <select className="campo" value={p.ao_iniciar} onChange={(e) => void gravar({ao_iniciar: e.target.value as Preferencias['ao_iniciar']})}>
                <option value="inicio">Mostrar a tela inicial</option>
                <option value="ultimo">Abrir o último projeto</option>
              </select>
            </label>
          </>
        )}
        <div className="dialogo-botoes"><button className="bt principal" onClick={aoFechar} autoFocus>Fechar</button></div>
      </div>
    </div>
  );
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
      // Alt+1 a 4, Ctrl+' e os Ctrl de arquivo valem até com o terminal em foco (escuta na captura, antes do xterm)
      if (ev.altKey && !ev.ctrlKey && /^Digit[1-5]$/.test(ev.code)) {
        ev.preventDefault();
        ev.stopPropagation();
        loja.definir({area: AREAS[Number(ev.code.slice(5)) - 1].id});
      } else if (ev.ctrlKey && !ev.altKey && (ev.code === 'Quote' || ev.code === 'Backquote')) {
        ev.preventDefault();
        ev.stopPropagation();
        api.current?.getPanel('terminal')?.api.setActive();
        (document.querySelector('.conversa .caixa-pedido textarea, .terminal-corpo textarea') as HTMLTextAreaElement | null)?.focus();
      } else if (ev.ctrlKey && !ev.altKey && !ev.shiftKey && k === 'o') {
        ev.preventDefault();
        void abrirRef.current();
      } else if (ev.ctrlKey && !ev.altKey && !ev.shiftKey && k === 'n') {
        ev.preventDefault();
        novoProjeto();
      } else if (ev.ctrlKey && !ev.altKey && !ev.shiftKey && k === 'w') {
        ev.preventDefault();
        voltarAoInicio();
      } else if (ev.ctrlKey && !ev.altKey && !ev.shiftKey && k === 's') {
        ev.preventDefault();
        void marcarVersao();
      } else if (ev.ctrlKey && ev.shiftKey && !ev.altKey && k === 'e') {
        ev.preventDefault();
        exportarArea();
      } else if (ev.ctrlKey && k === 'z' && !digitando) {
        ev.preventDefault();
        void desfazer();
      } else if (!digitando && !ev.ctrlKey && !ev.altKey && /^[1-5]$/.test(ev.key)) {
        loja.definir({area: AREAS[Number(ev.key) - 1].id});
      } else if (!digitando && !ev.ctrlKey && k === 'm') {
        loja.definir((s) => ({modoComentario: !s.modoComentario}));
      } else if (!digitando && !ev.ctrlKey && k === 'v') {
        loja.definir({modoComentario: false});
      } else if (ev.key === 'Escape') {
        loja.definir({modoComentario: false, comentarioAberto: undefined});
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
    const f = m === 'video' ? FORMATOS_VIDEO.find((x) => x.id === prefs?.formato_video) ?? FORMATOS_VIDEO[0]
      : m === 'imagem' ? FORMATOS_IMAGEM.find((x) => x.id === prefs?.formato_imagem) ?? FORMATOS_IMAGEM[0] : undefined;
    void criarDocumento(m, f ? {largura: f.largura, altura: f.altura, fps: 30} : undefined);
  };
  const item = (f: () => void) => () => {
    setMenu(false);
    f();
  };

  const ativo = useLoja((e) => e.ativo);
  const alvoEfeitos = useLoja((e) => e.alvoEfeitos);
  const idDoc = area === 'efeitos' ? alvoEfeitos : (ativo as Record<string, string | undefined>)[area];
  const docAtivo = info?.manifesto.documentos.find((d) => d.id === idDoc);
  const podeExportar = Boolean(docAtivo && docAtivo.modulo !== '3d' && docAtivo.modulo !== 'musica');

  return (
    <div className="casca">
      <header className="barra">
        <button className="marca" onPointerDown={(e) => e.stopPropagation()} onClick={() => setMenu((m) => !m)} title="Menu do Estúdio">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9" rx="2" fill="none" stroke="var(--acento)" strokeWidth="1.5" /><rect x="5.5" y="5.5" width="9" height="9" rx="2" fill="none" stroke="var(--agente)" strokeWidth="1.5" /></svg>
          Estúdio
        </button>
        {menu && (
          <div className="menu-app" onPointerDown={(e) => e.stopPropagation()}>
            <button onClick={item(novoProjeto)}><Plus size={14} />Novo projeto…<kbd>Ctrl+N</kbd></button>
            <div className="menu-sub">
              <span className="menu-rotulo"><FilePlus2 size={14} />Novo neste projeto</span>
              <span className="menu-linha">
                <button onClick={() => novoDocumento('video')}><Film size={13} />Vídeo</button>
                <button onClick={() => novoDocumento('imagem')}><ImageIcon size={13} />Imagem</button>
                <button onClick={() => novoDocumento('3d')}><Box size={13} />3D</button>
              </span>
            </div>
            <hr />
            <button onClick={item(() => void abrir())}><FolderOpen size={14} />Abrir pasta…<kbd>Ctrl+O</kbd></button>
            {recentes.length > 0 && (
              <>
                <span className="menu-rotulo">Abrir recente</span>
                {recentes.map((r) => <button key={r.raiz} className="recente" title={r.raiz} onClick={item(() => void abrirRecente(r))}>{r.nome}</button>)}
              </>
            )}
            <hr />
            <button onClick={item(() => void duplicar())}><Copy size={14} />Duplicar projeto…</button>
            <button onClick={item(() => window.estudio.mostrarNaPasta())}><FolderSearch size={14} />Mostrar na pasta</button>
            <button onClick={item(() => void marcarVersao())}><Check size={14} />Marcar ponto de restauração<kbd>Ctrl+S</kbd></button>
            <button onClick={item(() => void window.estudio.abrirExemplo().then(abrirProjeto).catch((e: Error) => avisar(mensagemDe(e), 'erro')))}><BookOpen size={14} />Ver um pronto (exemplo Cliente)</button>
            <hr />
            <button onClick={item(() => setMarca(true))}><Palette size={14} />Marca…</button>
            <button onClick={item(() => setPreferencias(true))}><Settings size={14} />Preferências…</button>
            <button onClick={item(() => montar(area, true))}><LayoutPanelLeft size={14} />Redefinir os painéis desta área</button>
            <hr />
            <button onClick={item(voltarAoInicio)}><Home size={14} />Fechar projeto e ir ao início<kbd>Ctrl+W</kbd></button>
          </div>
        )}
        <span className="projeto">
          <span className="sep">/</span>
          <NomeProjeto nome={info?.manifesto.nome ?? 'Sem nome'} raiz={info?.raiz} />
          {docAtivo && <><span className="sep">›</span><span className="doc">{docAtivo.titulo}</span></>}
          <span className="salvo" title={info?.git ? 'Cada edição grava na hora. Ctrl+S marca um ponto de restauração.' : 'Cada edição grava na hora. Sem o Git, não há pontos de restauração.'}>
            <Check size={12} />Salvo
          </span>
        </span>
        <nav className="areas">
          {AREAS.map((a) => (
            <button key={a.id} className={a.id === area ? 'ativa' : ''} onClick={() => loja.definir({area: a.id})} title={`${a.nome} · ${a.atalho} ou Alt+${a.atalho}`}>
              {a.icone}{a.nome}
            </button>
          ))}
        </nav>
        <div className="acoes">
          <button className={`bt fantasma${modoComentario ? ' ligado' : ''}`} onClick={() => loja.definir((s) => ({modoComentario: !s.modoComentario}))} title="Comentar na tela (M)">
            <MessageSquarePlus size={15} />Comentar<kbd>M</kbd>
          </button>
          <button className="bt fantasma" onClick={() => void desfazer()} title="Desfazer a sua última edição (Ctrl+Z)"><Undo2 size={15} /></button>
          <button className="bt exportar" disabled={!podeExportar} onClick={exportarArea}
            title={podeExportar ? `Exportar ${docAtivo!.modulo === 'video' ? 'o vídeo' : 'a imagem'} para a pasta saidas… (Ctrl+Shift+E)` : docAtivo?.modulo === 'musica' ? 'A música vai para o vídeo pelo "Pôr no vídeo"' : 'A cena 3D ainda não exporta'}>
            <Download size={15} />Exportar
          </button>
        </div>
      </header>
      <FaixaTransicao />
      <div className="doca">
        <DockviewReact theme={TEMA} components={componentes} defaultTabComponent={AbaDoPainel} onReady={pronto} />
      </div>
      <Rodape />
      {preferencias && <PainelPreferencias aoFechar={() => setPreferencias(false)} />}
      {marca && <PainelMarca aoFechar={() => setMarca(false)} />}
      <RaizDialogoExportar />
    </div>
  );
};
