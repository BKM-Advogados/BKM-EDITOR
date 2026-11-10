// Linha do tempo da Animação: régua, zoom, cabeça de reprodução, uma linha por camada e losangos por propriedade
import React, {useCallback, useEffect, useRef, useState} from "react";
import {Diamond, Maximize2, Pause, Play, ZoomIn, ZoomOut} from "lucide-react";
import type {DocAnimacao, PropriedadeAnimavel, QuadroChave} from "../../../nucleo/animacao";
import {aplicar, selecionar, useLoja} from "../../estado/loja";
import {alternar, aoQuadro, assinarControle, formatarTempo, irPara, msAtual} from "./tocador";

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

  return (
    <div className="painel-lt-animacao" ref={containerRef}>
      <div className="plt-topo">
        <div className="plt-controles">
          <button className="bt-icone" onClick={alternar} title="Reproduzir / Pausar (Espaço)">
            {tocando ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <span className="plt-tempo">{formatarTempo(tempoMs)}</span>
          <span className="plt-duracao">/ {formatarTempo(duracaoMs)}</span>
        </div>
        <div className="plt-zoom">
          <button className="bt-icone" onClick={() => setZoom((z) => Math.max(40, z - 25))} title="Diminuir Zoom">
            <ZoomOut size={14} />
          </button>
          <button className="bt-icone" onClick={() => setZoom((z) => Math.min(400, z + 25))} title="Aumentar Zoom">
            <ZoomIn size={14} />
          </button>
          <button
            className="bt-icone"
            onClick={() => {
              if (containerRef.current) {
                const w = containerRef.current.clientWidth - LARGURA_ROTULO - 40;
                setZoom(Math.max(40, Math.floor(w / Math.max(1, duracaoSeg))));
              }
            }}
            title="Ajustar à Janela"
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      <div className="plt-area-rolagem">
        {/* Régua */}
        <div className="plt-linha-regua">
          <div className="plt-col-rotulo plt-rotulo-regua">Camada</div>
          <div className="plt-trilha plt-regua" style={{width: larguraTrilha}} onClick={aoClicarTrilha} ref={trilhaRef}>
            {marcas.map((s) => (
              <div key={s} className="plt-marca" style={{left: msParaX(s * 1000)}}>
                <span className="plt-marca-texto">{s}s</span>
              </div>
            ))}
            {/* Cabeça de reprodução na régua */}
            <div
              className="plt-cabeca-marcador"
              style={{left: cabecaX}}
              onMouseDown={iniciarArrastoCabeca}
              title="Arrastar cabeça de reprodução"
            />
          </div>
        </div>

        {/* Linhas das camadas */}
        <div className="plt-corpo">
          {camadas.map((c, i) => {
            const caminho = `/camadas/${i}`;
            const selecionada = selecao === caminho;
            const trilhas = c.trilhas ?? {};
            const propsComTrilha = Object.entries(trilhas).filter(([_, ks]) => ks && ks.length > 0);

            return (
              <div
                key={c.id ?? i}
                className={`plt-linha-camada${selecionada ? " selecionada" : ""}`}
                onClick={() => selecionar({documento: ativo, caminho})}
              >
                <div className="plt-col-rotulo">
                  <span className="plt-camada-nome" title={c.nome}>
                    {c.nome}
                  </span>
                </div>
                <div
                  className="plt-trilha"
                  style={{width: larguraTrilha}}
                  onClick={aoClicarTrilha}
                >
                  {/* Losangos dos quadros-chave */}
                  {propsComTrilha.map(([p, ks]) =>
                    (ks as QuadroChave[]).map((k, kIdx) => {
                      const kx = msParaX(k.t_ms);
                      return (
                        <div
                          key={`${p}-${kIdx}`}
                          className="plt-losango-wrapper"
                          style={{left: kx}}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            selecionar({documento: ativo, caminho});
                            irPara(k.t_ms);
                            setArrastoK({
                              camadaIdx: i,
                              prop: p as PropriedadeAnimavel,
                              kIdx,
                              origemX: e.clientX,
                              tMsOriginal: k.t_ms,
                            });
                          }}
                          title={`Quadro-chave (${p}): ${k.t_ms} ms, valor: ${k.valor}, curva: ${k.curva ?? "linear"}`}
                        >
                          <Diamond size={10} className="plt-losango-icone" fill="currentColor" />
                        </div>
                      );
                    })
                  )}

                  {/* Linha vertical da cabeça passando pela trilha */}
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
