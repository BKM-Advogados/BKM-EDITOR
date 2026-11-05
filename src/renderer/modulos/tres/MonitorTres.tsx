// Monitor 3D: a cena do documento ativo pelo motor (Three.js puro). Trilho flutuante com Q seleção, W mover, E girar,
// R escala e M comentário (as teclas valem neste monitor). Clique seleciona; o gizmo grava um patch só ao soltar e,
// durante o arrasto, mostra o valor junto ao cursor; Ctrl encaixa. No alto, o rótulo da vista ("Câmera da cena" ou
// "Perspectiva · vista livre") e, quando a vista sai da câmera, "Usar a vista atual" e "Voltar à câmera". Delete exclui
// o objeto selecionado (Ctrl+Z desfaz). Com a ferramenta de comentário, clicar abre um balão ancorado no objeto e no ponto.
import React, {useEffect, useRef, useState} from 'react';
import {Camera, MessageSquarePlus, MousePointer2, Move3d, Pause, Play, Rotate3d, Scale3d, Undo2} from 'lucide-react';
import type {TransformControlsMode} from 'three/examples/jsm/controls/TransformControls.js';
import type {DocCena3D, OperacaoPatch, Vetor3} from '../../../nucleo/documentos';
import {aplicar, comentar, loja, patchTrocar, selecionar, useLoja} from '../../estado/loja';
import {arredV, iguaisV, indiceEm, objetosDe, type Transformacao} from './comum';
import {Motor} from './motor';
import {Trilho, teclaLivre} from '../../componentes/Trilho';
import {excluirObjeto} from './acoes';
import {registrarVista, usarVistaComoCamera} from './vista';

type Modo = TransformControlsMode | 'selecao';
const MODOS: {modo: Modo; nome: string; tecla: string; icone: React.ReactNode}[] = [
  {modo: 'selecao', nome: 'Seleção (sem gizmo)', tecla: 'Q', icone: <MousePointer2 />},
  {modo: 'translate', nome: 'Mover', tecla: 'W', icone: <Move3d />},
  {modo: 'rotate', nome: 'Girar', tecla: 'E', icone: <Rotate3d />},
  {modo: 'scale', nome: 'Escala', tecla: 'R', icone: <Scale3d />},
];
const POR_TECLA: Record<string, Modo> = {q: 'selecao', w: 'translate', e: 'rotate', r: 'scale'};
const VERBO = {posicao: 'mover', rotacao: 'girar', escala: 'escalar'} as const;

// teto do perfil (o processo principal mede a RAM com os.totalmem); sem perfil, 1,5
const pixelRatio = () => Math.min(window.devicePixelRatio || 1, loja.get().info?.perfil?.pixel_ratio ?? 1.5);

// o contexto do comentário guarda o ponto no mundo; com ele o pino acompanha a câmera
const MUNDO = /mundo \((-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\)/;
const pontoNoMundo = (contexto?: string): Vetor3 | null => {
  const m = contexto?.match(MUNDO);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

type Balao = {x: number; y: number; w: number; h: number; objeto?: string; objetoId?: string; nome?: string; contexto: string};

export const MonitorTres: React.FC = () => {
  const documento = useLoja((e) => e.ativo['3d']);
  const carregado = useLoja((e) => Boolean(documento && e.docs[documento]));
  if (!documento) return <div className="vazio">nenhuma cena 3D no projeto</div>;
  if (!carregado) return <div className="vazio">carregando a cena…</div>;
  return <Palco documento={documento} />;
};

const Palco: React.FC<{documento: string}> = ({documento}) => {
  const doc = useLoja((e) => e.docs[documento]?.doc) as DocCena3D | undefined;
  const selecao = useLoja((e) => e.selecao);
  const modoComentario = useLoja((e) => e.modoComentario);
  const comentarios = useLoja((e) => e.comentarios);
  const area = useRef<HTMLDivElement>(null);
  const motor = useRef<Motor | null>(null);
  const pinos = useRef(new Map<string, {el: HTMLDivElement; mundo: Vetor3}>());
  const [erro, setErro] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>('translate');
  const [naCamera, setNaCamera] = useState(true);
  const leitura = useRef<HTMLDivElement>(null);
  const [animando, setAnimando] = useState(false);
  const [balao, setBalao] = useState<Balao | null>(null);
  const [textoBalao, setTextoBalao] = useState('');

  const clicar = (x: number, y: number) => {
    const m = motor.current;
    const host = area.current;
    if (!m || !host) return;
    const acerto = m.tocar(x, y);
    const objetos = objetosDe(loja.get().docs[documento]?.doc as DocCena3D | undefined);
    const i = acerto ? objetos.findIndex((o) => o.id === acerto.id) : -1;
    if (!loja.get().modoComentario) return selecionar(i >= 0 ? {documento, caminho: `/objetos/${i}`} : null);
    const r = host.getBoundingClientRect();
    const o = objetos[i];
    setTextoBalao('');
    setBalao({
      x: x - r.left, y: y - r.top, w: r.width, h: r.height, objeto: o ? `/objetos/${i}` : undefined, objetoId: o?.id, nome: o?.nome,
      contexto: o && acerto ? `${o.nome} · mundo (${arredV(acerto.ponto.toArray()).join(', ')})` : 'fundo da cena',
    });
  };

  // um patch por gesto: só os vetores que mudaram entre pegar e soltar o gizmo, com teste do id e do valor antigo
  const soltar = async (id: string, antes: Transformacao, depois: Transformacao) => {
    const atual = loja.get().docs[documento]?.doc as DocCena3D | undefined;
    const objetos = objetosDe(atual);
    const i = objetos.findIndex((o) => o.id === id);
    if (!atual || i < 0) return;
    const caminho = `/objetos/${i}`;
    const mudou = (['posicao', 'rotacao', 'escala'] as const).filter((k) => !iguaisV(antes[k], depois[k]));
    if (!mudou.length) return;
    const patch: OperacaoPatch[] = [{op: 'test', path: `${caminho}/id`, value: id}, ...mudou.flatMap((k) => patchTrocar(atual, `${caminho}/${k}`, depois[k]))];
    await aplicar(documento, patch, `${mudou.map((k) => VERBO[k]).join(' e ')} ${objetos[i].nome}`);
  };

  const ultimo = useRef({clicar, soltar});
  ultimo.current = {clicar, soltar};

  useEffect(() => {
    const host = area.current;
    if (!host) return;
    let m: Motor;
    try {
      m = new Motor(host, pixelRatio());
    } catch (e) {
      setErro(`Não deu para abrir o WebGL: ${(e as Error).message}`);
      return;
    }
    motor.current = m;
    m.aoClicar = (x, y) => ultimo.current.clicar(x, y);
    m.aoSoltar = (id, a, d) => void ultimo.current.soltar(id, a, d);
    m.aoRenderizar = () => {
      for (const {el, mundo} of pinos.current.values()) {
        const p = m.projetar(mundo);
        el.style.display = p ? '' : 'none';
        if (!p) continue;
        el.style.left = `${p.x * 100}%`;
        el.style.top = `${p.y * 100}%`;
      }
    };
    m.aoMudarVista = () => setNaCamera(m.naCamera());
    // leitura do gizmo junto ao cursor, pelo DOM (o arrasto não re-renderiza o React)
    const cursor = {x: 0, y: 0};
    const seguir = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      cursor.x = e.clientX - r.left;
      cursor.y = e.clientY - r.top;
      if (leitura.current && leitura.current.style.display === 'block') {
        leitura.current.style.left = `${cursor.x + 16}px`;
        leitura.current.style.top = `${cursor.y + 16}px`;
      }
    };
    host.addEventListener('pointermove', seguir);
    m.aoLer = (texto) => {
      const el = leitura.current;
      if (!el) return;
      el.style.display = texto ? 'block' : 'none';
      if (!texto) return;
      el.textContent = texto;
      el.style.left = `${cursor.x + 16}px`;
      el.style.top = `${cursor.y + 16}px`;
    };
    const sair = registrarVista(m.lerVista, (id, a) => {
      m.cena.ajustar(id, a);
      m.pedir();
    });
    return () => {
      sair();
      host.removeEventListener('pointermove', seguir);
      m.descartar();
      motor.current = null;
      pinos.current.clear();
    };
  }, []);

  useEffect(() => {
    const m = motor.current;
    if (!m || !doc) return;
    m.sincronizar(doc);
    m.aplicarCamera(doc.camera);
    setNaCamera(m.naCamera());
  }, [doc]);

  const idSelecionado = selecao?.documento === documento ? (objetosDe(doc)[indiceEm(selecao.caminho, 'objetos')]?.id ?? null) : null;
  useEffect(() => motor.current?.selecionar(idSelecionado, modoComentario || modo === 'selecao'), [idSelecionado, modoComentario, modo, doc]);
  useEffect(() => {
    if (modo !== 'selecao') motor.current?.modo(modo);
  }, [modo]);
  useEffect(() => motor.current?.animar(animando), [animando]);

  // teclas deste monitor: Q/W/E/R trocam a ferramenta, Delete exclui o objeto selecionado, Ctrl segurado encaixa
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Control') motor.current?.encaixe(true);
      if (!teclaLivre(e)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = loja.get().selecao;
        const i = sel?.documento === documento ? indiceEm(sel.caminho, 'objetos') : -1;
        if (i >= 0) {
          e.preventDefault();
          void excluirObjeto(documento, i);
        }
        return;
      }
      const m = POR_TECLA[e.key.toLowerCase()];
      if (m && !e.shiftKey) {
        setModo(m);
        loja.definir({modoComentario: false});
      }
    };
    const solta = (e: KeyboardEvent) => e.key === 'Control' && motor.current?.encaixe(false);
    const perdeu = () => motor.current?.encaixe(false);
    window.addEventListener('keydown', tecla);
    window.addEventListener('keyup', solta);
    window.addEventListener('blur', perdeu);
    return () => {
      window.removeEventListener('keydown', tecla);
      window.removeEventListener('keyup', solta);
      window.removeEventListener('blur', perdeu);
    };
  }, [documento]);

  const salvarComentario = async () => {
    const b = balao;
    if (!b || !textoBalao.trim()) return setBalao(null);
    await comentar(documento, textoBalao.trim(), {
      objeto: b.objeto, objeto_id: b.objetoId, contexto: b.contexto,
      ponto: {x: +(b.x / b.w).toFixed(4), y: +(b.y / b.h).toFixed(4)},
    });
    setBalao(null);
    loja.definir({modoComentario: false});
  };

  const abrirPino = (c: (typeof comentarios)[number]) => {
    loja.definir({comentarioAberto: c.id});
    const i = c.alvo.objeto_id ? objetosDe(doc).findIndex((o) => o.id === c.alvo.objeto_id) : -1;
    const caminho = i >= 0 ? `/objetos/${i}` : c.alvo.objeto;
    if (caminho) selecionar({documento, caminho});
  };

  const meus = comentarios.filter((c) => c.documento === documento && c.alvo.ponto);

  return (
    <div className="painel">
      <div className="monitor">
        <div ref={area} style={{position: 'absolute', inset: 0, cursor: modoComentario ? 'crosshair' : 'default'}} />
        <Trilho flutuante grupos={[
          MODOS.map((m) => ({id: m.modo, nome: m.nome, tecla: m.tecla, icone: m.icone, ativa: !modoComentario && modo === m.modo, aoClicar: () => {
            setModo(m.modo);
            loja.definir({modoComentario: false});
          }})),
          [{id: 'm', nome: 'Comentário', tecla: 'M', icone: <MessageSquarePlus />, ativa: modoComentario, aoClicar: () => loja.definir({modoComentario: true})}],
        ]} />
        <div className="vista-3d">
          <span className="nome-vista">{naCamera ? 'Câmera da cena' : 'Perspectiva · vista livre'}</span>
          <span className="esp" />
          {!naCamera && (
            <>
              <button className="bt mini" onClick={() => motor.current?.voltarCamera()} title="Volta a vista para a câmera do documento"><Undo2 />Voltar à câmera</button>
              <button className="bt mini" onClick={() => void usarVistaComoCamera(documento)} title="Grava a vista atual em /camera"><Camera />Usar a vista atual</button>
            </>
          )}
          <button className={`bt mini${animando ? ' ligado' : ''}`} onClick={() => setAnimando((a) => !a)} title="Prévia animada: gira os objetos pelo campo gira (graus por segundo)">
            {animando ? <Pause /> : <Play />}Animar
          </button>
        </div>
        <div className="leitura-3d" ref={leitura} />
        {erro && <div className="erro-monitor">{erro}</div>}
        <div className="sobreposicao">
          {meus.map((c) => {
            const mundo = pontoNoMundo(c.alvo.contexto);
            return (
              <div key={c.id} className={`pino${c.estado === 'resolvido' ? ' resolvido' : ''}`} title={c.texto}
                style={mundo ? undefined : {left: `${c.alvo.ponto!.x * 100}%`, top: `${c.alvo.ponto!.y * 100}%`}}
                ref={(el) => {
                  if (!el || !mundo) return;
                  pinos.current.set(c.id, {el, mundo});
                  motor.current?.pedir();
                  return () => void pinos.current.delete(c.id);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  abrirPino(c);
                }}>
                {c.id.replace(/\D/g, '').replace(/^0+/, '')}
              </div>
            );
          })}
          {balao && (
            <div className="balao" style={{left: Math.max(4, Math.min(balao.x, balao.w - 270)), top: Math.max(4, Math.min(balao.y + 8, balao.h - 150))}}>
              <div className="rotulo" style={{marginBottom: 6}}>Comentário{balao.nome ? ` em ${balao.nome}` : ' na cena'}</div>
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
    </div>
  );
};
