// Linha do tempo da Animação: régua, zoom, cabeça de reprodução, uma linha por camada e losangos por propriedade
import React, {useCallback, useEffect, useRef, useState} from "react";
import {Diamond, Maximize2, Pause, Play, ZoomIn, ZoomOut} from "lucide-react";
import type {DocAnimacao, PropriedadeAnimavel, QuadroChave} from "../../../nucleo/animacao";
import {aplicar, selecionar, useLoja} from "../../estado/loja";
import {alternar, aoQuadro, assinarControle, formatarTempo, irPara, msAtual} from "./tocador";
import {iconeTipoAnimacao} from "./CamadasAnimacao";

const LARGURA_ROTULO = 140;

export const LinhaDoTempoAnimacao: React.FC = () => {
  const ativo = useLoja((e) => e.ativo.animacao);
  const doc = useLoja((e) => (ativo ? (e.docs[ativo]?.doc as DocAnimacao | undefined) : undefined));
  const selecao = useLoja((e) => (e.selecao && e.selecao.documento === ativo ? e.selecao.caminho : null));
  const [tempoMs, setTempoMs] = useState(msAtual());
  const [tocando, setTocando] = useState(false);
  const [zoom, setZoom] = useState(150); // px por segundo
  const [arrastandoCabeca, setArrastandoCabeca] = useState(false);
  const [arrastoK, setArrastoK] = useState<{
    camadaIdx: number;
    prop: PropriedadeAnimavel;
    kIdx: number;
    origemX: number;
    tMsOriginal: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const trilhaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const limpa1 = aoQuadro((ms) => setTempoMs(ms));
    const limpa2 = assinarControle((c) => setTocando(c.tocando));
    return () => {
      limpa1();
      limpa2();
    };
  }, []);

  const duracaoMs = doc?.duracao_ms ?? 3000;
  const duracaoSeg = duracaoMs / 1000;
  const larguraTrilha = Math.max(600, duracaoSeg * zoom);

  const msParaX = useCallback((ms: number) => (ms / 1000) * zoom, [zoom]);
  const xParaMs = useCallback((x: number) => Math.max(0, Math.min(duracaoMs, (x / zoom) * 1000)), [duracaoMs, zoom]);

  // Arrastar cabeça de reprodução
  const aoClicarTrilha = (e: React.MouseEvent) => {
    if (!trilhaRef.current) return;
    const rect = trilhaRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    irPara(xParaMs(x));
  };

  const iniciarArrastoCabeca = (e: React.MouseEvent) => {
    e.stopPropagation();
    setArrastandoCabeca(true);
  };

  const moverArrasto = useCallback((e: MouseEvent) => {
    if (!trilhaRef.current) return;
    const rect = trilhaRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ms = xParaMs(x);

    if (arrastandoCabeca) {
      irPara(ms);
    } else if (arrastoK && doc && ativo) {
      const deltaX = e.clientX - arrastoK.origemX;
      const deltaMs = (deltaX / zoom) * 1000;
      const novoTMs = Math.max(0, Math.min(duracaoMs, Math.round(arrastoK.tMsOriginal + deltaMs)));

      const camada = doc.camadas[arrastoK.camadaIdx];
      if (!camada || !camada.trilhas) return;
      const trilha = [...(camada.trilhas[arrastoK.prop] ?? [])];
      if (!trilha[arrastoK.kIdx]) return;
      trilha[arrastoK.kIdx] = {...trilha[arrastoK.kIdx], t_ms: novoTMs};
      trilha.sort((a, b) => a.t_ms - b.t_ms);

      const trilhas = {...camada.trilhas, [arrastoK.prop]: trilha};
      aplicar(ativo, [{op: "add", path: `/camadas/${arrastoK.camadaIdx}/trilhas`, value: trilhas}], "mover quadro-chave");
    }
  }, [arrastandoCabeca, arrastoK, ativo, doc, duracaoMs, xParaMs, zoom]);

  const finalizarArrasto = useCallback(() => {
    setArrastandoCabeca(false);
    setArrastoK(null);
  }, []);

  useEffect(() => {
    if (arrastandoCabeca || arrastoK) {
      window.addEventListener("mousemove", moverArrasto);
      window.addEventListener("mouseup", finalizarArrasto);
      return () => {
        window.removeEventListener("mousemove", moverArrasto);
        window.removeEventListener("mouseup", finalizarArrasto);
      };
    }
  }, [arrastandoCabeca, arrastoK, moverArrasto, finalizarArrasto]);

  if (!ativo || !doc) return null;

  const camadas = doc.camadas ?? [];
  const cabecaX = msParaX(tempoMs);

  // Marcas da régua
  const passoSeg = zoom > 200 ? 0.5 : zoom > 80 ? 1 : 2;
  const marcas: number[] = [];
  for (let s = 0; s <= duracaoSeg; s += passoSeg) {
    marcas.push(s);
  }

  const ajustar = () => {
    if (containerRef.current) {
      const w = containerRef.current.clientWidth - LARGURA_ROTULO - 40;
      setZoom(Math.max(40, Math.floor(w / Math.max(1, duracaoSeg))));
    }
  };
  const nChaves = camadas.reduce((n, c) => n + Object.values(c.trilhas ?? {}).reduce((m, ks) => m + (ks?.length ?? 0), 0), 0);

  return (
    <div className="painel lt-animacao" ref={containerRef}>
      <div className="barra-lt">
        <button className="bti" onClick={alternar} title="Tocar ou pausar  Espaço" aria-label={tocando ? "Pausar" : "Tocar"}>{tocando ? <Pause /> : <Play />}</button>
        <span className="plt-tempo">{formatarTempo(tempoMs)}</span>
        <span className="plt-duracao">/ {formatarTempo(duracaoMs)}</span>
        <div className="acoes-lt">
          <span className="conta">{nChaves === 1 ? "1 quadro-chave" : `${nChaves} quadros-chave`}</span>
          <button className="bti" onClick={() => setZoom((z) => Math.max(40, z - 25))} title="Diminuir o zoom" aria-label="Diminuir o zoom"><ZoomOut /></button>
          <button className="bti" onClick={() => setZoom((z) => Math.min(400, z + 25))} title="Aumentar o zoom" aria-label="Aumentar o zoom"><ZoomIn /></button>
          <button className="bti" onClick={ajustar} title="Ajustar à janela" aria-label="Ajustar à janela"><Maximize2 /></button>
        </div>
      </div>

      <div className="plt-area-rolagem">
        <div className="plt-linha-regua">
          <div className="plt-col-rotulo plt-rotulo-regua">Camadas</div>
          <div className="plt-trilha plt-regua" style={{width: larguraTrilha}} onClick={aoClicarTrilha} ref={trilhaRef}>
            {marcas.map((s) => (
              <div key={s} className="plt-marca" style={{left: msParaX(s * 1000)}}>
                <span className="plt-marca-texto">{String(s).replace(".", ",")} s</span>
              </div>
            ))}
            <div className="plt-cabeca-marcador" style={{left: cabecaX}} onMouseDown={iniciarArrastoCabeca} title="Arraste a agulha" />
          </div>
        </div>

        <div className="plt-corpo">
          {[...camadas].map((_, k) => {
            const i = camadas.length - 1 - k; // a da frente em cima, como na lista
            const c = camadas[i];
            const caminho = `/camadas/${i}`;
            const selecionada = selecao === caminho;
            const trilhas = c.trilhas ?? {};
            const propsComTrilha = Object.entries(trilhas).filter(([, ks]) => ks && ks.length > 0);
            return (
              <div key={c.id ?? i} className={`plt-linha-camada${selecionada ? " selecionada" : ""}`} onClick={() => selecionar({documento: ativo, caminho})}>
                <div className="plt-col-rotulo">
                  <span className="plt-tipo">{iconeTipoAnimacao(c.tipo)}</span>
                  <span className="plt-camada-nome" title={c.nome}>{c.nome}</span>
                </div>
                <div className="plt-trilha" style={{width: larguraTrilha}} onClick={aoClicarTrilha}>
                  {propsComTrilha.map(([p, ks]) =>
                    (ks as QuadroChave[]).map((q, kIdx) => {
                      const agora = Math.abs(q.t_ms - tempoMs) < 25;
                      return (
                        <div key={`${p}-${kIdx}`} className={`plt-losango-wrapper${agora ? " agora" : ""}`} style={{left: msParaX(q.t_ms)}}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            selecionar({documento: ativo, caminho});
                            irPara(q.t_ms);
                            setArrastoK({camadaIdx: i, prop: p as PropriedadeAnimavel, kIdx, origemX: e.clientX, tMsOriginal: q.t_ms});
                          }}
                          title={`Quadro-chave de ${p} em ${(q.t_ms / 1000).toFixed(2).replace(".", ",")} s · valor ${q.valor} · curva ${q.curva ?? "linear"}`}>
                          <Diamond className="plt-losango-icone" fill="currentColor" />
                        </div>
                      );
                    }),
                  )}
                  <div className="plt-guia-cabeca" style={{left: cabecaX}} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
