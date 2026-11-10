// Editor de arte em pixel (docs/animacao.md): desenha e edita a grade da camada pixel selecionada.
// Ferramentas: lápis, borracha, conta-gotas e balde (flood fill). Seletor de paleta, efeito de revelação e semente.
import React, {useCallback, useEffect, useRef, useState} from "react";
import {Eraser, PaintBucket, Pencil, Pipette, Plus, RefreshCw} from "lucide-react";
import {
  codificarCelulas, corDaCelula, decodificarCelulas, EFEITOS_PIXEL, gradeVazia,
  type EfeitoPixel, type GradePixel,
} from "../../../nucleo/animacao-pixel";
import type {CamadaAnimacao} from "../../../nucleo/animacao";
import {aplicar} from "../../estado/loja";

type Ferramenta = "lapis" | "borracha" | "gotas" | "balde";

export const EditorPixel: React.FC<{
  documento: string;
  camada: CamadaAnimacao;
  origem: string;
}> = ({documento, camada, origem}) => {
  const grade = camada.grade ?? gradeVazia(16, 16);
  const [ferramenta, setFerramenta] = useState<Ferramenta>("lapis");
  const [corAtiva, setCorAtiva] = useState(0); // índice na paleta
  const [desenhando, setDesenhando] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const colunas = Math.max(1, grade.colunas);
  const linhas = Math.max(1, grade.linhas);
  const indices = decodificarCelulas(grade.celulas);

  // Redesenha o canvas de edição quando a grade muda
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const zoom = Math.max(8, Math.floor(280 / Math.max(colunas, linhas)));
    cv.width = colunas * zoom;
    cv.height = linhas * zoom;

    // Fundo quadriculado transparente
    for (let l = 0; l < linhas; l++) {
      for (let c = 0; c < colunas; c++) {
        ctx.fillStyle = (c + l) % 2 === 0 ? "#1c2128" : "#24292f";
        ctx.fillRect(c * zoom, l * zoom, zoom, zoom);
      }
    }

    // Desenha células preenchidas
    for (let l = 0; l < linhas; l++) {
      for (let c = 0; c < colunas; c++) {
        const idx = indices[l * colunas + c];
        const cor = corDaCelula(grade, idx);
        if (cor) {
          ctx.fillStyle = cor;
          ctx.fillRect(c * zoom, l * zoom, zoom, zoom);
        }
      }
    }

    // Linhas de grade sutis
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    for (let c = 0; c <= colunas; c++) {
      ctx.beginPath();
      ctx.moveTo(c * zoom, 0);
      ctx.lineTo(c * zoom, linhas * zoom);
      ctx.stroke();
    }
    for (let l = 0; l <= linhas; l++) {
      ctx.beginPath();
      ctx.moveTo(0, l * zoom);
      ctx.lineTo(colunas * zoom, l * zoom);
      ctx.stroke();
    }
  }, [grade, colunas, linhas, indices]);

  const aplicarNovaGrade = useCallback((nova: GradePixel) => {
    // "add" e não "replace": a camada pixel nova ainda não tem o campo `grade` (replace falha em campo que não existe)
    aplicar(documento, [{op: "add", path: `${origem}/grade`, value: nova}], "editar arte em pixel");
  }, [documento, origem]);

  const pintarCelula = (c: number, l: number) => {
    if (c < 0 || c >= colunas || l < 0 || l >= linhas) return;
    const i = l * colunas + c;
    if (ferramenta === "gotas") {
      const idx = indices[i];
      if (idx >= 0) setCorAtiva(idx);
      setFerramenta("lapis");
      return;
    }
    if (ferramenta === "balde") {
      const antigo = indices[i];
      const novo = corAtiva;
      if (antigo === novo) return;
      const copia = [...indices];
      const fila: [number, number][] = [[c, l]];
      const visitados = new Uint8Array(copia.length);
      while (fila.length) {
        const [cx, cy] = fila.pop()!;
        const pos = cy * colunas + cx;
        if (visitados[pos]) continue;
        visitados[pos] = 1;
        if (copia[pos] === antigo) {
          copia[pos] = novo;
          if (cx > 0) fila.push([cx - 1, cy]);
          if (cx < colunas - 1) fila.push([cx + 1, cy]);
          if (cy > 0) fila.push([cx, cy - 1]);
          if (cy < linhas - 1) fila.push([cx, cy + 1]);
        }
      }
      aplicarNovaGrade({...grade, celulas: codificarCelulas(copia)});
      return;
    }
    const novoValor = ferramenta === "borracha" ? -1 : corAtiva;
    if (indices[i] === novoValor) return;
    const copia = [...indices];
    copia[i] = novoValor;
    aplicarNovaGrade({...grade, celulas: codificarCelulas(copia)});
  };

  const coordDoEvento = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current;
    if (!cv) return null;
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const c = Math.floor((x / r.width) * colunas);
    const l = Math.floor((y / r.height) * linhas);
    return {c, l};
  };

  const aoBaixarMouse = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setDesenhando(true);
    const p = coordDoEvento(e);
    if (p) pintarCelula(p.c, p.l);
  };

  const aoMoverMouse = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!desenhando || ferramenta === "balde" || ferramenta === "gotas") return;
    const p = coordDoEvento(e);
    if (p) pintarCelula(p.c, p.l);
  };

  const aoSubirMouse = () => setDesenhando(false);

  const adicionarCor = () => {
    const nova = "#FFFFFF";
    if (grade.paleta.includes(nova)) return;
    aplicarNovaGrade({...grade, paleta: [...grade.paleta, nova]});
  };

  const mudarCorPaleta = (idx: number, hex: string) => {
    const paleta = [...grade.paleta];
    paleta[idx] = hex.toUpperCase();
    aplicarNovaGrade({...grade, paleta});
  };

  const limparTudo = () => {
    aplicarNovaGrade(gradeVazia(colunas, linhas, grade.paleta));
  };

  return (
    <div className="editor-pixel">
      <div className="ep-barra-ferramentas">
        <button
          className={`bt-icone${ferramenta === "lapis" ? " ativo" : ""}`}
          onClick={() => setFerramenta("lapis")}
          title="Lápis (desenha com a cor ativa)"
        >
          <Pencil size={15} />
        </button>
        <button
          className={`bt-icone${ferramenta === "borracha" ? " ativo" : ""}`}
          onClick={() => setFerramenta("borracha")}
          title="Borracha (apaga para transparente)"
        >
          <Eraser size={15} />
        </button>
        <button
          className={`bt-icone${ferramenta === "gotas" ? " ativo" : ""}`}
          onClick={() => setFerramenta("gotas")}
          title="Conta-gotas (pega a cor da célula)"
        >
          <Pipette size={15} />
        </button>
        <button
          className={`bt-icone${ferramenta === "balde" ? " ativo" : ""}`}
          onClick={() => setFerramenta("balde")}
          title="Balde (preenchimento contíguo)"
        >
          <PaintBucket size={15} />
        </button>
        <button className="bt-icone fantasma" onClick={limparTudo} title="Limpar grade">
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="ep-paleta">
        {grade.paleta.map((cor, i) => (
          <div key={i} className={`ep-cor-wrapper${corAtiva === i ? " ativa" : ""}`}>
            <button
              className="ep-cor"
              style={{backgroundColor: cor}}
              onClick={() => setCorAtiva(i)}
              title={`Cor ${i + 1}: ${cor}`}
            />
            <input
              type="color"
              value={cor.startsWith("#") ? cor : "#000000"}
              onChange={(e) => mudarCorPaleta(i, e.target.value)}
              className="ep-color-input"
              title="Trocar cor"
            />
          </div>
        ))}
        {grade.paleta.length < 62 && (
          <button className="bt-icone ep-add-cor" onClick={adicionarCor} title="Adicionar cor">
            <Plus size={13} />
          </button>
        )}
      </div>

      <div className="ep-canvas-area" onMouseLeave={aoSubirMouse}>
        <canvas
          ref={canvasRef}
          className="ep-canvas"
          onMouseDown={aoBaixarMouse}
          onMouseMove={aoMoverMouse}
          onMouseUp={aoSubirMouse}
        />
      </div>

      <div className="ep-efeitos">
        <label className="rot">Efeito de revelação</label>
        <select
          className="campo"
          value={camada.efeito ?? "aleatorio"}
          onChange={(e) =>
            aplicar(documento, [{op: "replace", path: `${origem}/efeito`, value: e.target.value as EfeitoPixel}], "trocar efeito pixel")
          }
        >
          {EFEITOS_PIXEL.map((ef) => (
            <option key={ef.id} value={ef.id}>
              {ef.nome}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
