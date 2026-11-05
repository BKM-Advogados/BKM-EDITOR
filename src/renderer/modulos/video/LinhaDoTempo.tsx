// Linha do tempo do vídeo: cenas, blocos (em faixas, porque se sobrepõem), a fala da narração e os comentários, sobre
// a mesma régua. Clicar na régua busca o tempo; arrastar um bloco muda a palavra em que ele entra (a âncora "em" passa
// a ser a palavra mais perto de onde ele foi solto).
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {ZoomIn, ZoomOut} from 'lucide-react';
import type {Palavra, TrechoNarracao} from '../../../nucleo/roteiro/resolver';
import {loja, selecionar, trocar, useLoja} from '../../estado/loja';
import {ancoraPerto} from './ancoras';
import {aoQuadro, irPara} from './tocador';

type BlocoP = {tipo: string; em: number; sai?: number; origem?: string; texto?: string; id?: string};
type CenaP = {tipo: string; t_in: number; t_out: number; n?: number; titulo?: string; tag?: string; origem?: string; blocos?: BlocoP[]};
type Legenda = {s: number; e: number; palavras: {w: string}[]};

const NOME = 25; // espaço do rótulo da trilha

export const LinhaDoTempo: React.FC = () => {
  const documento = useLoja((e) => e.area === 'efeitos' ? e.alvoEfeitos ?? e.ativo.video : e.ativo.video);
  const montado = useLoja((e) => (documento ? e.props[documento] : undefined));
  const selecao = useLoja((e) => e.selecao);
  const comentarios = useLoja((e) => e.comentarios);
  const caminhoPalavras = useLoja((e) => (documento ? (e.docs[documento]?.doc as {palavras?: string} | undefined)?.palavras : undefined));
  const [pxs, setPxs] = useState(40); // pixels por segundo
  const [ms, setMs] = useState(0);
  const [palavras, setPalavras] = useState<Palavra[]>([]);
  const [arrasto, setArrasto] = useState<{origem: string; x0: number; dms: number; em: number} | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  const tempoParado = useLoja((e) => e.tempo_ms);
  useEffect(() => aoQuadro(setMs), []);
  useEffect(() => setMs(tempoParado), [tempoParado]);
  useEffect(() => {
    if (caminhoPalavras) void window.estudio.lerJson<Palavra[]>(caminhoPalavras).then(setPalavras).catch(() => setPalavras([]));
  }, [caminhoPalavras]);

  const props = montado && 'props' in montado ? (montado.props as unknown as {duracao_ms: number; cenas: CenaP[]; legendas: Legenda[]; narracao?: {trechos: TrechoNarracao[]}}) : null;
  const x = (t: number) => NOME + (t / 1000) * pxs;

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

  // a cabeça de leitura fica visível enquanto toca
  useEffect(() => {
    const c = caixa.current;
    if (!c) return;
    const px = x(ms);
    if (px < c.scrollLeft + 40 || px > c.scrollLeft + c.clientWidth - 40) c.scrollLeft = Math.max(0, px - c.clientWidth / 3);
  }, [ms, pxs]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!documento || !props) return <div className="vazio">{montado && 'erro' in montado ? montado.erro : 'sem vídeo'}</div>;
  const largura = x(props.duracao_ms) + 80;
  const marcas = Array.from({length: Math.ceil(props.duracao_ms / 1000 / (pxs >= 30 ? 1 : 5)) + 1}, (_, i) => i * (pxs >= 30 ? 1 : 5));

  const buscar = (ev: React.MouseEvent) => {
    const b = caixa.current!.getBoundingClientRect();
    irPara(((ev.clientX - b.left + caixa.current!.scrollLeft - NOME) / pxs) * 1000);
  };

  const soltarBloco = async () => {
    const a = arrasto;
    setArrasto(null);
    if (!a || Math.abs(a.dms) < 60 || !props.narracao) return;
    const alvo = ancoraPerto(a.em + a.dms, palavras, props.narracao.trechos);
    if (!alvo) return;
    await trocar(documento, `${a.origem}/em`, alvo.ancora, `bloco entra em "${alvo.palavra.w.trim()}"`);
  };

  return (
    <div className="painel">
      <div className="painel-topo">
        <span className="titulo">Linha do tempo</span>
        <span className="rotulo">arraste um bloco para mudar a palavra em que ele entra</span>
        <span className="esp" />
        <button className="bt fantasma mini" onClick={() => setPxs((p) => Math.max(8, p / 1.5))} title="Afastar"><ZoomOut size={14} /></button>
        <button className="bt fantasma mini" onClick={() => setPxs((p) => Math.min(400, p * 1.5))} title="Aproximar"><ZoomIn size={14} /></button>
      </div>
      <div className="lt" ref={caixa} onPointerMove={(e) => {
          const a = arrasto;
          if (a) setArrasto({...a, dms: ((e.clientX - a.x0) / pxs) * 1000});
        }}
        onPointerUp={() => void soltarBloco()}>
        <div style={{width: largura, position: 'relative'}}>
          <div className="regua" onClick={buscar}>
            {marcas.map((s) => <div key={s} className="marca-t" style={{left: x(s * 1000)}}>{s % 5 === 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : ''}</div>)}
            {comentarios.filter((c) => c.documento === documento && c.alvo.tempo_ms !== undefined).map((c) => (
              <div key={c.id} className="pino-t" style={{left: x(c.alvo.tempo_ms!), opacity: c.estado === 'resolvido' ? 0.4 : 1}} title={`${c.id}: ${c.texto}`}
                onClick={(e) => {
                  e.stopPropagation();
                  irPara(c.alvo.tempo_ms!);
                  loja.definir({comentarioAberto: c.id});
                }} />
            ))}
          </div>
          <div className="trilha" onClick={buscar}>
            {props.cenas.map((c, i) => (
              <div key={i} className={`seg cena ${c.tipo}`} style={{left: x(c.t_in), width: Math.max(2, x(c.t_out) - x(c.t_in) - 1)}}
                title={c.titulo ?? c.tag ?? c.tipo}
                onClick={(e) => {
                  e.stopPropagation();
                  irPara(c.t_in);
                  if (c.origem) selecionar({documento, caminho: c.origem});
                }}>
                {c.tipo === 'parte' ? `${c.n}. ${c.titulo ?? ''}` : c.tipo}
              </div>
            ))}
          </div>
          {faixas.map((faixa, fi) => (
            <div key={fi} className="trilha">
              {faixa.map(({b, fim}) => {
                const desl = arrasto && arrasto.origem === b.origem ? (arrasto.dms / 1000) * pxs : 0;
                return (
                  <div key={b.origem} className={`seg bloco${selecao?.caminho === b.origem ? ' sel' : ''}`}
                    style={{left: x(b.em) + desl, width: Math.max(6, x(fim) - x(b.em) - 1)}} title={`${b.tipo} · ${b.origem}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      (e.target as HTMLElement).setPointerCapture(e.pointerId);
                      if (b.origem) {
                        selecionar({documento, caminho: b.origem});
                        setArrasto({origem: b.origem, x0: e.clientX, dms: 0, em: b.em});
                      }
                    }}
                    onDoubleClick={() => irPara(b.em)}>
                    {b.tipo}{b.texto ? ` · ${b.texto.replace(/\*\*/g, '')}` : ''}
                  </div>
                );
              })}
            </div>
          ))}
          <div className="trilha">
            {props.legendas.map((l, i) => (
              <div key={i} className="seg fala" style={{left: x(l.s), width: Math.max(4, x(l.e) - x(l.s))}}>{l.palavras.map((p) => p.w).join(' ')}</div>
            ))}
          </div>
          <div className="cabeca" style={{left: x(ms)}} />
        </div>
      </div>
    </div>
  );
};
