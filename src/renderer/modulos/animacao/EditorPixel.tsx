// Editor de arte em pixel (docs/animacao.md): desenha e edita a grade da camada pixel selecionada.
// Ferramentas: lápis, borracha, conta-gotas e balde (flood fill). Seletor de paleta, efeito de revelação e semente.
import React, {useCallback, useEffect, useRef, useState} from "react";
import {Eraser, PaintBucket, Pencil, Pipette, Plus, RefreshCw} from "lucide-react";
import {
  codificarCelulas, corDaCelula, decodificarCelulas, EFEITOS_PIXEL, gradeVazia, lerGrade,
  type EfeitoPixel, type GradePixel,
} from "../../../nucleo/animacao-pixel";
import type {CamadaAnimacao, TemaAnimacao} from "../../../nucleo/animacao";
import {aplicar} from "../../estado/loja";
import {CampoSelecao} from "../../componentes/Campos";

type Ferramenta = "lapis" | "borracha" | "gotas" | "balde";

export const EditorPixel: React.FC<{
  documento: string;
  camada: CamadaAnimacao;
  origem: string;
  tamanho?: number; // lado do desenho em px de tela (o editor grande usa mais)
  tema?: TemaAnimacao; // as cores do kit, para a paleta
  aoAbrirGrande?: () => void;
}> = ({documento, camada, origem, tamanho = 280, tema, aoAbrirGrande}) => {
  // grade inválida (JSON editado à mão ou aplicar_patch) não derruba o editor: vale a consertada, ou uma vazia
  const grade = React.useMemo(() => lerGrade(camada.grade).grade ?? gradeVazia(16, 16), [camada.grade]);
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
    const zoom = Math.max(8, Math.floor(tamanho / Math.max(colunas, linhas)));
    // xadrez e grade nas cores da casca (tema escuro ou claro), lidas dos tokens
    const css = getComputedStyle(cv);
    const tom = (v: string, reserva: string) => css.getPropertyValue(v).trim() || reserva;
    const xadrezA = tom("--fundo-3", "gray");
    const xadrezB = tom("--fundo-4", "dimgray");
    cv.width = colunas * zoom;
    cv.height = linhas * zoom;

    // Fundo quadriculado transparente
    for (let l = 0; l < linhas; l++) {
      for (let c = 0; c < colunas; c++) {
        ctx.fillStyle = (c + l) % 2 === 0 ? xadrezA : xadrezB;
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
    ctx.strokeStyle = tom("--borda", "gray");
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
  }, [grade, colunas, linhas, indices, tamanho]);

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

  // cor do kit: entra na paleta da grade (se ainda não estiver) e vira a cor ativa
  const usarCorDoKit = (cor: string) => {
    const c = cor.toUpperCase();
    const i = grade.paleta.findIndex((x) => x.toUpperCase() === c);
    if (i >= 0) return setCorAtiva(i);
    aplicarNovaGrade({...grade, paleta: [...grade.paleta, c]});
    setCorAtiva(grade.paleta.length);
  };

  const limparTudo = () => {
    aplicarNovaGrade(gradeVazia(colunas, linhas, grade.paleta));
  };

  return (
    <div className="editor-pixel">
      <div className="ep-barra-ferramentas">
        <button
          className={`bti${ferramenta === "lapis" ? " ligado" : ""}`} aria-label="Lápis" aria-pressed={ferramenta === "lapis"}
          onClick={() => setFerramenta("lapis")}
          title="Lápis (desenha com a cor ativa)"
        >
          <Pencil size={15} />
        </button>
        <button
          className={`bti${ferramenta === "borracha" ? " ligado" : ""}`} aria-label="Borracha" aria-pressed={ferramenta === "borracha"}
          onClick={() => setFerramenta("borracha")}
          title="Borracha (apaga para transparente)"
        >
          <Eraser size={15} />
        </button>
        <button
          className={`bti${ferramenta === "gotas" ? " ligado" : ""}`} aria-label="Conta-gotas" aria-pressed={ferramenta === "gotas"}
          onClick={() => setFerramenta("gotas")}
          title="Conta-gotas (pega a cor da célula)"
        >
          <Pipette size={15} />
        </button>
        <button
          className={`bti${ferramenta === "balde" ? " ligado" : ""}`} aria-label="Balde" aria-pressed={ferramenta === "balde"}
          onClick={() => setFerramenta("balde")}
          title="Balde (preenchimento contíguo)"
        >
          <PaintBucket size={15} />
        </button>
        <span className="esp" />
        {aoAbrirGrande && <button className="bt mini" onClick={aoAbrirGrande} title="Desenhar num editor grande">Editor grande</button>}
        <button className="bti" onClick={limparTudo} title="Limpar a grade" aria-label="Limpar a grade">
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
          <button className="bti ep-add-cor" onClick={adicionarCor} title="Adicionar cor" aria-label="Adicionar cor">
            <Plus size={13} />
          </button>
        )}
      </div>

      {tema && (
        <div className="ep-paleta ep-kit" role="group" aria-label="Cores do kit">
          <span className="rotulo">Do kit</span>
          {(["fundo", "texto", "destaque", "suave"] as const).map((k) => (
            <button key={k} type="button" className="ep-cor-kit" style={{backgroundColor: tema[k]}} title={`${k} do kit · ${tema[k]}`} aria-label={`Usar ${k} do kit`}
              onClick={() => usarCorDoKit(tema[k])} />
          ))}
        </div>
      )}
      <div className="ep-canvas-area" onMouseLeave={aoSubirMouse}>
        <canvas
          ref={canvasRef}
          className="ep-canvas"
          onMouseDown={aoBaixarMouse}
          onMouseMove={aoMoverMouse}
          onMouseUp={aoSubirMouse}
        />
      </div>

      <CampoSelecao rotulo="Revelação" valor={(camada.efeito ?? "aleatorio") as EfeitoPixel} opcoes={EFEITOS_PIXEL.map((ef): [EfeitoPixel, string] => [ef.id, ef.nome])}
        aoMudar={(v) => aplicar(documento, [{op: "add", path: `${origem}/efeito`, value: v}], "trocar efeito pixel")} />
    </div>
  );
};
