// Casca do Estúdio: barra com as quatro áreas, painéis acopláveis (dockview) e rodapé de estado. Cada área guarda o
// próprio arranjo de painéis (como as páginas do Resolve e os workspaces do Blender); o terminal é o mesmo em todas.
import React, {Suspense, useCallback, useEffect, useRef} from 'react';
import {DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import {Box, Film, FolderOpen, Image as ImageIcon, LayoutPanelLeft, MessageSquarePlus, Sparkles, Undo2} from 'lucide-react';
import {abrirProjeto, avisar, desfazer, loja, useLoja, type Area} from '../estado/loja';
import type {PaineisDoModulo} from './contrato';
import {PaineisVideo} from '../modulos/video/paineis';
import {PaineisImagem} from '../modulos/imagem/paineis';
import {PaineisEfeitos} from '../modulos/efeitos/paineis';
import {Comentarios} from '../paineis/Comentarios';
import {Historico} from '../paineis/Historico';
import {Rodape} from './Rodape';

// o 3D (Three.js) e o terminal (xterm.js) só carregam quando alguém abre: a memória do app parado fica menor
const Terminal = React.lazy(() => import('../paineis/Terminal').then((m) => ({default: m.Terminal})));
const carregar3d = () => import('../modulos/tres/paineis').then((m) => m.PaineisTres);
let Paineis3d: PaineisDoModulo | null = null;

const AREAS: {id: Area; nome: string; icone: React.ReactNode; atalho: string}[] = [
  {id: 'video', nome: 'Vídeo', icone: <Film size={15} />, atalho: '1'},
  {id: 'imagem', nome: 'Imagem', icone: <ImageIcon size={15} />, atalho: '2'},
  {id: '3d', nome: '3D', icone: <Box size={15} />, atalho: '3'},
  {id: 'efeitos', nome: 'Efeitos', icone: <Sparkles size={15} />, atalho: '4'},
];

const Carregando: React.FC = () => <div className="vazio">carregando…</div>;

const paineisDa = (area: Area): PaineisDoModulo | null => {
  if (area === 'video') return PaineisVideo;
  if (area === 'imagem') return PaineisImagem;
  if (area === 'efeitos') return PaineisEfeitos;
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

const componentes: Record<string, React.FC<IDockviewPanelProps>> = {
  lista: () => <PorArea parte="Lista" />,
  monitor: () => <PorArea parte="Monitor" />,
  inspector: () => <PorArea parte="Inspector" />,
  linha: () => <PorArea parte="Linha" />,
  comentarios: () => <Comentarios />,
  historico: () => <Historico />,
  terminal: () => <Suspense fallback={<Carregando />}><Terminal /></Suspense>,
};

// faixas de layout de docs/tela.md: C (compacta) abaixo de 1600x800, P (padrão) acima; cada área x faixa guarda o seu
type Faixa = 'C' | 'P';
const faixaAtual = (): Faixa => (window.innerWidth < 1600 || window.innerHeight < 800 ? 'C' : 'P');
const CHAVE = (area: Area, faixa: Faixa) => `estudio:layout:v3:${area}:${faixa}`;
const lerLayout = (area: Area, faixa: Faixa) => {
  try {
    const t = localStorage.getItem(CHAVE(area, faixa));
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
};
const gravarLayout = (area: Area, faixa: Faixa, api: DockviewApi) => {
  try {
    localStorage.setItem(CHAVE(area, faixa), JSON.stringify(api.toJSON()));
  } catch {
    /* sem armazenamento: volta ao arranjo padrão na próxima vez */
  }
};

// O terminal fica sempre na coluna da direita: embaixo é da linha do tempo, e altura é o que falta em notebook.
const layoutPadrao = (api: DockviewApi, area: Area, faixa: Faixa) => {
  const temLinha = area === 'video' || area === 'efeitos';
  const W = window.innerWidth;
  const H = window.innerHeight;
  const abasDoInspector = (comLista: boolean) => {
    if (comLista) api.addPanel({id: 'lista', component: 'lista', title: 'Lista', position: {referencePanel: 'inspector', direction: 'within'}});
    api.addPanel({id: 'comentarios', component: 'comentarios', title: 'Comentários', position: {referencePanel: 'inspector', direction: 'within'}});
    api.addPanel({id: 'historico', component: 'historico', title: 'Histórico', position: {referencePanel: 'inspector', direction: 'within'}});
    api.getPanel('inspector')?.api.setActive();
  };
  api.addPanel({id: 'monitor', component: 'monitor', title: 'Monitor'});
  if (faixa === 'P') {
    if (temLinha) api.addPanel({id: 'linha', component: 'linha', title: 'Linha do tempo', position: {direction: 'below'}, initialHeight: 260});
    api.addPanel({id: 'terminal', component: 'terminal', title: 'Terminal', position: {direction: 'right'}, initialWidth: 600});
    api.addPanel({id: 'lista', component: 'lista', title: 'Lista', position: {referencePanel: 'monitor', direction: 'left'}, initialWidth: 260});
    api.addPanel({id: 'inspector', component: 'inspector', title: 'Propriedades', position: {referencePanel: 'monitor', direction: 'right'}, initialWidth: 310});
    abasDoInspector(false);
  } else if (area === 'video') {
    // vídeo vertical: o monitor numa coluna de altura total; à direita, propriedades e terminal em cima e a linha embaixo
    api.addPanel({id: 'terminal', component: 'terminal', title: 'Terminal', position: {direction: 'right'}, initialWidth: Math.max(620, W - 380)});
    api.addPanel({id: 'linha', component: 'linha', title: 'Linha do tempo', position: {referencePanel: 'terminal', direction: 'below'}, initialHeight: Math.max(200, Math.round(H * 0.34))});
    api.addPanel({id: 'inspector', component: 'inspector', title: 'Propriedades', position: {referencePanel: 'terminal', direction: 'left'}, initialWidth: 300});
    abasDoInspector(true);
  } else {
    // imagem, 3D e efeitos: monitor largo; à direita o terminal em cima e, embaixo dele, a lista e as propriedades
    if (temLinha) api.addPanel({id: 'linha', component: 'linha', title: 'Linha do tempo', position: {referencePanel: 'monitor', direction: 'below'}, initialHeight: 200});
    api.addPanel({id: 'terminal', component: 'terminal', title: 'Terminal', position: {direction: 'right'}, initialWidth: Math.min(620, Math.round(W * 0.45))});
    api.addPanel({id: 'lista', component: 'lista', title: 'Lista', position: {referencePanel: 'terminal', direction: 'below'}, initialHeight: Math.round(H * 0.5)});
    api.addPanel({id: 'inspector', component: 'inspector', title: 'Propriedades', position: {referencePanel: 'lista', direction: 'right'}});
    abasDoInspector(false);
  }
};

const TITULOS: Record<Area, string> = {video: 'Cenas e blocos', imagem: 'Camadas', '3d': 'Objetos', efeitos: 'Pilha de efeitos'};

export const Casca: React.FC = () => {
  const area = useLoja((e) => e.area);
  const info = useLoja((e) => e.info);
  const modoComentario = useLoja((e) => e.modoComentario);
  const api = useRef<DockviewApi | null>(null);
  const areaMontada = useRef<Area>(area);

  const faixa = useRef<Faixa>(faixaAtual());

  const montar = useCallback((a: Area, padrao = false) => {
    const d = api.current;
    if (!d) return;
    faixa.current = faixaAtual();
    d.clear();
    const salvo = padrao ? null : lerLayout(a, faixa.current);
    try {
      if (salvo) d.fromJSON(salvo);
      else layoutPadrao(d, a, faixa.current);
    } catch {
      d.clear();
      layoutPadrao(d, a, faixa.current);
    }
    d.getPanel('lista')?.api.setTitle(TITULOS[a]);
    areaMontada.current = a;
  }, []);

  const pronto = (e: DockviewReadyEvent) => {
    api.current = e.api;
    montar(loja.get().area);
    e.api.onDidLayoutChange(() => gravarLayout(areaMontada.current, faixa.current, e.api));
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

  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => {
      const alvo = ev.target as HTMLElement;
      const digitando = /INPUT|TEXTAREA|SELECT/.test(alvo.tagName) || alvo.isContentEditable || alvo.closest('.xterm');
      // Alt+1 a 4 e Ctrl+' valem até com o terminal em foco (escuta na captura, antes do xterm)
      if (ev.altKey && !ev.ctrlKey && /^Digit[1-4]$/.test(ev.code)) {
        ev.preventDefault();
        ev.stopPropagation();
        loja.definir({area: AREAS[Number(ev.code.slice(5)) - 1].id});
      } else if (ev.ctrlKey && !ev.altKey && (ev.code === 'Quote' || ev.code === 'Backquote')) {
        ev.preventDefault();
        ev.stopPropagation();
        api.current?.getPanel('terminal')?.api.setActive();
        (document.querySelector('.terminal-corpo textarea') as HTMLTextAreaElement | null)?.focus();
      } else if (ev.ctrlKey && ev.key.toLowerCase() === 'z' && !digitando) {
        ev.preventDefault();
        void desfazer();
      } else if (!digitando && !ev.ctrlKey && !ev.altKey && /^[1-4]$/.test(ev.key)) {
        loja.definir({area: AREAS[Number(ev.key) - 1].id});
      } else if (!digitando && !ev.ctrlKey && ev.key.toLowerCase() === 'm') {
        loja.definir((s) => ({modoComentario: !s.modoComentario}));
      } else if (!digitando && !ev.ctrlKey && ev.key.toLowerCase() === 'v') {
        loja.definir({modoComentario: false});
      } else if (ev.key === 'Escape') {
        loja.definir({modoComentario: false, comentarioAberto: undefined});
      }
    };
    window.addEventListener('keydown', tecla, true);
    return () => window.removeEventListener('keydown', tecla, true);
  }, []);

  const abrir = async () => {
    const i = await window.estudio.abrirPasta().catch((e: Error) => (avisar(e.message, 'erro'), null));
    if (i) await abrirProjeto(i);
  };

  return (
    <div className="casca">
      <header className="barra">
        <span className="marca">ESTÚDIO</span>
        <span className="projeto" title={info?.raiz}>{info?.manifesto.nome ?? 'nenhum projeto'}</span>
        <nav className="areas">
          {AREAS.map((a) => (
            <button key={a.id} className={a.id === area ? 'ativa' : ''} onClick={() => loja.definir({area: a.id})} title={`${a.nome} (Alt+${a.atalho})`}>
              {a.icone}{a.nome}<kbd>{a.atalho}</kbd>
            </button>
          ))}
        </nav>
        <div className="acoes">
          <button className={`bt fantasma${modoComentario ? ' ligado' : ''}`} onClick={() => loja.definir((s) => ({modoComentario: !s.modoComentario}))} title="Comentar na tela (M)">
            <MessageSquarePlus size={15} />Comentar
          </button>
          <button className="bt fantasma" onClick={() => void desfazer()} title="Desfazer a sua última edição (Ctrl+Z)"><Undo2 size={15} /></button>
          <button className="bt fantasma" onClick={() => {
            montar(area, true);
          }} title="Redefinir os painéis desta área"><LayoutPanelLeft size={15} /></button>
          <button className="bt fantasma" onClick={() => void abrir()} title="Abrir projeto"><FolderOpen size={15} /></button>
        </div>
      </header>
      <div className="doca">
        <DockviewReact className="dockview-theme-estudio" components={componentes} onReady={pronto} />
      </div>
      <Rodape />
    </div>
  );
};
