// Monitor da Animação: Remotion Player com seleção e arrasto de camadas (atualiza ou cria quadro-chave na cabeça)
import React, {useCallback, useEffect, useRef, useState} from "react";
import {Player, type PlayerRef} from "@remotion/player";
import {Download, Pause, Play, Repeat2, SkipBack} from "lucide-react";
import {Animacao} from "../../../composicoes/animacao/Animacao";
import type {DocAnimacao} from "../../../nucleo/animacao";
import {resolverAnimacao, valorEm} from "../../../nucleo/animacao";
import {aplicar, avisar, selecionar, useLoja} from "../../estado/loja";
import {SemDocumento} from "../../componentes/SemDocumento";
import {abrirDialogoExportar} from "../../componentes/DialogoExportar";
import {
  alternar, alternarRepetir, aoQuadro, assinarControle, definirFps, formatarTempo,
  irPara, msAtual, registrarPlayer,
} from "./tocador";

export const MonitorAnimacao: React.FC = () => {
  const ativo = useLoja((e) => e.ativo.animacao);
  const doc = useLoja((e) => (ativo ? (e.docs[ativo]?.doc as DocAnimacao | undefined) : undefined));
  const selecao = useLoja((e) => (e.selecao && e.selecao.documento === ativo ? e.selecao.caminho : null));
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
      const wDisponivel = el.clientWidth - 40;
      const hDisponivel = el.clientHeight - 80;
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
    if (trilhas.x || trilhas.y) {
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

  // Caixa de seleção sobre a camada selecionada no monitor
  let caixaSelecao: {x: number; y: number; w: number; h: number} | null = null;
  if (camadaSelecionada && camadaSelecionada.visivel !== false) {
    const cx = Number(valorEm(camadaSelecionada, "x", tempoMs));
    const cy = Number(valorEm(camadaSelecionada, "y", tempoMs));
    const cw = camadaSelecionada.tipo === "pixel" && camadaSelecionada.grade
      ? camadaSelecionada.grade.colunas * Number(valorEm(camadaSelecionada, "tamanho_pixel", tempoMs))
      : camadaSelecionada.largura;
    const ch = camadaSelecionada.tipo === "pixel" && camadaSelecionada.grade
      ? camadaSelecionada.grade.linhas * Number(valorEm(camadaSelecionada, "tamanho_pixel", tempoMs))
      : camadaSelecionada.altura;
    caixaSelecao = {x: cx, y: cy, w: cw, h: ch};
  }

  return (
    <div className="painel-monitor-animacao" ref={containerRef}>
      <div
        className="pma-palco-wrapper"
        style={{
          width: doc.largura * escala,
          height: doc.altura * escala,
        }}
      >
        <div
          className="pma-palco"
          style={{
            width: doc.largura,
            height: doc.altura,
            transform: `scale(${escala})`,
            transformOrigin: "top left",
          }}
        >
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

          {/* Camada interativa de seleção e arrasto */}
          <div
            className="pma-overlay-interacao"
            onClick={(e) => {
              // Clicar fora desmarca seleção
              if (e.target === e.currentTarget) selecionar(null);
            }}
          >
            {doc.camadas.map((c, i) => {
              if (c.visivel === false || c.travada) return null;
              const cx = Number(valorEm(c, "x", tempoMs));
              const cy = Number(valorEm(c, "y", tempoMs));
              const cw = c.tipo === "pixel" && c.grade
                ? c.grade.colunas * Number(valorEm(c, "tamanho_pixel", tempoMs))
                : c.largura;
              const ch = c.tipo === "pixel" && c.grade
                ? c.grade.linhas * Number(valorEm(c, "tamanho_pixel", tempoMs))
                : c.altura;

              return (
                <div
                  key={c.id ?? i}
                  style={{
                    position: "absolute",
                    left: cx,
                    top: cy,
                    width: cw,
                    height: ch,
                    cursor: "grab",
                    pointerEvents: "auto",
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    selecionar({documento: ativo, caminho: `/camadas/${i}`});
                    setArrasto({
                      camadaIdx: i,
                      origemX: e.clientX,
                      origemY: e.clientY,
                      xInicial: cx,
                      yInicial: cy,
                    });
                  }}
                />
              );
            })}

            {/* Borda da camada selecionada */}
            {caixaSelecao && (
              <div
                className="pma-borda-selecao"
                style={{
                  position: "absolute",
                  left: caixaSelecao.x,
                  top: caixaSelecao.y,
                  width: caixaSelecao.w,
                  height: caixaSelecao.h,
                  pointerEvents: "none",
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Barra de transporte */}
      <div className="pma-transporte">
        <div className="pma-controles-esq">
          <button className="bt-transporte" onClick={() => irPara(0)} title="Voltar ao início">
            <SkipBack size={15} />
          </button>
          <button className="bt-transporte principal" onClick={alternar} title="Reproduzir / Pausar (Espaço)">
            {tocando ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button
            className={`bt-transporte${repetir ? " ativo" : ""}`}
            onClick={alternarRepetir}
            title="Repetir reprodução"
          >
            <Repeat2 size={15} />
          </button>
          <span className="pma-tempo-display">{formatarTempo(tempoMs)}</span>
        </div>

        <div className="pma-controles-dir">
          <button
            className="bt exportar"
            onClick={() => abrirDialogoExportar(ativo)}
            title="Exportar animação em MP4 ou PNG"
          >
            <Download size={14} />Exportar
          </button>
        </div>
      </div>
    </div>
  );
};
