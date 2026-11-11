// Monitor da Animação: Remotion Player com seleção e arrasto de camadas (atualiza ou cria quadro-chave na cabeça), no
// mesmo desenho dos outros monitores (entorno cinza, caixa de seleção da casa e o transporte de sempre). Exportar fica
// só na barra, como nas outras áreas.
import React, {useCallback, useEffect, useRef, useState, useSyncExternalStore} from "react";
import {Player, type PlayerRef} from "@remotion/player";
import {Pause, Play, Repeat2, SkipBack, SkipForward, StepBack, StepForward} from "lucide-react";
import {Animacao} from "../../../composicoes/animacao/Animacao";
import type {DocAnimacao} from "../../../nucleo/animacao";
import {resolverAnimacao, valorEm} from "../../../nucleo/animacao";
import {aplicar, avisar, selecionar, useLoja} from "../../estado/loja";
import {SemDocumento} from "../../componentes/SemDocumento";
import {
  alternar, alternarRepetir, aoQuadro, assinarControle, definirFps, formatarTempo,
  irPara, msAtual, registrarPlayer,
} from "./tocador";
import {mudouEm} from "../../estado/agente";
import {AvisoAgente, MarcasAgente} from "../../componentes/Agente";
import {modoAnimar} from "./preajustes";

export const MonitorAnimacao: React.FC = () => {
  const ativo = useLoja((e) => e.ativo.animacao);
  const doc = useLoja((e) => (ativo ? (e.docs[ativo]?.doc as DocAnimacao | undefined) : undefined));
  const selecao = useLoja((e) => (e.selecao && e.selecao.documento === ativo ? e.selecao.caminho : null));
  const mudancas = useLoja((e) => e.mudancasAgente);
  const animando = useSyncExternalStore(modoAnimar.assinar, modoAnimar.get);
  const [tempoMs, setTempoMs] = useState(msAtual());
  const [tocando, setTocando] = useState(false);
  const [repetir, setRepetir] = useState(true);
  const [escala, setEscala] = useState(1);

  const playerRef = useRef<PlayerRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Arrasto de camada selecionada
  const [arrasto, setArrasto] = useState<{
    camadaIdx: number;
    origemX: number;
    origemY: number;
    xInicial: number;
    yInicial: number;
  } | null>(null);

  useEffect(() => {
    if (playerRef.current) {
      registrarPlayer(playerRef.current);
    }
  }, [playerRef.current]);

  useEffect(() => {
    if (doc?.fps) definirFps(doc.fps);
  }, [doc?.fps]);

  useEffect(() => {
    const limpa1 = aoQuadro((ms) => setTempoMs(ms));
    const limpa2 = assinarControle((c) => {
      setTocando(c.tocando);
      setRepetir(c.repetir);
    });
    return () => {
      limpa1();
      limpa2();
    };
  }, []);

  // Ajusta a escala da prévia para caber no container do monitor
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !doc) return;
    const atualizar = () => {
      const wDisponivel = el.clientWidth - 48;
      const hDisponivel = el.clientHeight - 48;
      if (wDisponivel > 0 && hDisponivel > 0) {
        const sx = wDisponivel / doc.largura;
        const sy = hDisponivel / doc.altura;
        setEscala(Math.min(1, Math.min(sx, sy)));
      }
    };
    atualizar();
    const ro = new ResizeObserver(atualizar);
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc?.largura, doc?.altura]);

  // Teclas de atalho no monitor (Espaço, K, Delete, Ctrl+Z)
  useEffect(() => {
    const aoTecla = (ev: KeyboardEvent) => {
      // Ignora se estiver digitando em campo de texto
      const tag = (ev.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if (ev.code === "Space") {
        ev.preventDefault();
        alternar();
      } else if (ev.key === "k" || ev.key === "K") {
        if (!doc || !ativo || !selecao) return;
        const m = selecao.match(/^\/camadas\/(\d+)$/);
        if (!m) return;
        const idx = Number(m[1]);
        const camada = doc.camadas[idx];
        if (!camada) return;
        // Insere quadro-chave nas propriedades x e y
        const trilhas = {...(camada.trilhas ?? {})};
        const curX = valorEm(camada, "x", tempoMs);
        const curY = valorEm(camada, "y", tempoMs);
        const ksX = [...(trilhas.x ?? [])];
        const ksY = [...(trilhas.y ?? [])];
        ksX.push({t_ms: Math.round(tempoMs), valor: curX, curva: "suave"});
        ksY.push({t_ms: Math.round(tempoMs), valor: curY, curva: "suave"});
        ksX.sort((a, b) => a.t_ms - b.t_ms);
        ksY.sort((a, b) => a.t_ms - b.t_ms);
        trilhas.x = ksX;
        trilhas.y = ksY;
        aplicar(ativo, [{op: "add", path: `/camadas/${idx}/trilhas`, value: trilhas}], "inserir quadro-chave (K)");
        avisar("Quadro-chave adicionado na posição", "info");
      }
    };
    window.addEventListener("keydown", aoTecla);
    return () => window.removeEventListener("keydown", aoTecla);
  }, [ativo, doc, selecao, tempoMs]);

  const moverCamadaArrasto = useCallback((e: MouseEvent) => {
    if (!arrasto || !doc || !ativo) return;
    const dx = (e.clientX - arrasto.origemX) / escala;
    const dy = (e.clientY - arrasto.origemY) / escala;
    const novoX = Math.round(arrasto.xInicial + dx);
    const novoY = Math.round(arrasto.yInicial + dy);

    const camada = doc.camadas[arrasto.camadaIdx];
    if (!camada) return;

    // Se tem trilha, cria ou atualiza quadro-chave na cabeça de reprodução
    const trilhas = {...(camada.trilhas ?? {})};
    if (trilhas.x || trilhas.y || modoAnimar.get()) {
      const listaX = [...(trilhas.x ?? [])];
      const listaY = [...(trilhas.y ?? [])];
      const kx = listaX.find((item) => Math.abs(item.t_ms - tempoMs) < 25);
      const ky = listaY.find((item) => Math.abs(item.t_ms - tempoMs) < 25);
      if (kx) kx.valor = novoX;
      else {
        listaX.push({t_ms: Math.round(tempoMs), valor: novoX, curva: "suave"});
        listaX.sort((a, b) => a.t_ms - b.t_ms);
      }
      if (ky) ky.valor = novoY;
      else {
        listaY.push({t_ms: Math.round(tempoMs), valor: novoY, curva: "suave"});
        listaY.sort((a, b) => a.t_ms - b.t_ms);
      }
      trilhas.x = listaX;
      trilhas.y = listaY;
      aplicar(ativo, [{op: "add", path: `/camadas/${arrasto.camadaIdx}/trilhas`, value: trilhas}], "arrastar camada");
    } else {
      // Atualiza x e y base
      aplicar(
        ativo,
        [
          {op: "replace", path: `/camadas/${arrasto.camadaIdx}/x`, value: novoX},
          {op: "replace", path: `/camadas/${arrasto.camadaIdx}/y`, value: novoY},
        ],
        "mover camada"
      );
    }
  }, [arrasto, ativo, doc, escala, tempoMs]);

  const soltarArrasto = useCallback(() => {
    setArrasto(null);
  }, []);

  useEffect(() => {
    if (arrasto) {
      window.addEventListener("mousemove", moverCamadaArrasto);
      window.addEventListener("mouseup", soltarArrasto);
      return () => {
        window.removeEventListener("mousemove", moverCamadaArrasto);
        window.removeEventListener("mouseup", soltarArrasto);
      };
    }
  }, [arrasto, moverCamadaArrasto, soltarArrasto]);

  if (!ativo || !doc) return <SemDocumento modulo="animacao" />;

  const {props} = resolverAnimacao(doc);
  const duracaoFrames = Math.max(1, Math.ceil((doc.duracao_ms / 1000) * doc.fps));

  const matchCamada = selecao?.match(/^\/camadas\/(\d+)$/);
  const indiceSelecionado = matchCamada ? Number(matchCamada[1]) : -1;
  const camadaSelecionada = indiceSelecionado >= 0 ? doc.camadas[indiceSelecionado] : null;

  const caixaDe = (c: (typeof doc.camadas)[number]) => {
    const x = Number(valorEm(c, "x", tempoMs));
    const y = Number(valorEm(c, "y", tempoMs));
    const pixel = c.tipo === "pixel" && c.grade ? Number(valorEm(c, "tamanho_pixel", tempoMs)) : 0;
    return {x, y, w: pixel ? c.grade!.colunas * pixel : c.largura, h: pixel ? c.grade!.linhas * pixel : c.altura};
  };
  const caixaSelecao = camadaSelecionada && camadaSelecionada.visivel !== false ? caixaDe(camadaSelecionada) : null;

  const pararEm = (ms: number) => irPara(Math.max(0, Math.min(doc.duracao_ms, ms)));
  const umQuadro = 1000 / Math.max(1, doc.fps);

  return (
    <div className="painel">
      <div className="monitor-grade sem-trilho">
        <div className={`monitor monitor-animacao${animando ? " animando" : ""}`} ref={containerRef}>
          <AvisoAgente />
          <div className="palco" style={{width: doc.largura * escala, height: doc.altura * escala}}>
            <div className="pma-palco" style={{width: doc.largura, height: doc.altura, transform: `scale(${escala})`, transformOrigin: "top left"}}>
              <Player
                ref={playerRef}
                component={Animacao}
                inputProps={props}
                durationInFrames={duracaoFrames}
                compositionWidth={doc.largura}
                compositionHeight={doc.altura}
                fps={doc.fps}
                loop={repetir}
                style={{width: "100%", height: "100%"}}
              />
            </div>
            {/* seleção e arrasto por cima do palco, em pixels da tela (a borda não engrossa com a escala) */}
            <div className="sobreposicao" style={{pointerEvents: "auto"}} onClick={(e) => e.target === e.currentTarget && selecionar(null)}>
              {doc.camadas.map((c, i) => {
                if (c.visivel === false || c.travada) return null;
                const caixa = caixaDe(c);
                return (
                  <div key={c.id ?? i} className="alvo-camada" style={{left: caixa.x * escala, top: caixa.y * escala, width: caixa.w * escala, height: caixa.h * escala}}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      selecionar({documento: ativo, caminho: `/camadas/${i}`});
                      setArrasto({camadaIdx: i, origemX: e.clientX, origemY: e.clientY, xInicial: caixa.x, yInicial: caixa.y});
                    }} />
                );
              })}
              <MarcasAgente caixas={doc.camadas.flatMap((c, i) => {
                if (c.visivel === false || !mudouEm(mudancas, ativo, `/camadas/${i}`)) return [];
                const k = caixaDe(c);
                return [{chave: `/camadas/${i}`, x: k.x * escala, y: k.y * escala, w: k.w * escala, h: k.h * escala}];
              })} />
              {caixaSelecao && (
                <div className="caixa-sel" style={{left: caixaSelecao.x * escala, top: caixaSelecao.y * escala, width: caixaSelecao.w * escala, height: caixaSelecao.h * escala, pointerEvents: "none"}}>
                  {camadaSelecionada && caixaSelecao.y * escala > 20 && <span className="etiqueta-sel">{camadaSelecionada.nome}</span>}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="transporte">
          <span className="tc">{formatarTempo(tempoMs)}</span>
          <div className="centro">
            <button className="bti largo" onClick={() => pararEm(0)} title="Início  Home" aria-label="Início"><SkipBack /></button>
            <button className="bti" onClick={() => pararEm(tempoMs - umQuadro)} title="Quadro anterior" aria-label="Quadro anterior"><StepBack /></button>
            <button className="bti tocar" onClick={alternar} title="Tocar ou pausar  Espaço" aria-label={tocando ? "Pausar" : "Tocar"}>{tocando ? <Pause /> : <Play />}</button>
            <button className="bti" onClick={() => pararEm(tempoMs + umQuadro)} title="Próximo quadro" aria-label="Próximo quadro"><StepForward /></button>
            <button className="bti largo" onClick={() => pararEm(doc.duracao_ms)} title="Fim  End" aria-label="Fim"><SkipForward /></button>
            <button className={`bti largo${repetir ? " ligado" : ""}`} onClick={alternarRepetir} title="Repetir" aria-label="Repetir" aria-pressed={repetir}><Repeat2 /></button>
          </div>
          <span className="dur" title="Duração · quadros por segundo">{formatarTempo(doc.duracao_ms)} · {doc.fps} qps</span>
        </div>
      </div>
    </div>
  );
};
