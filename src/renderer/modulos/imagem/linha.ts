// Pintura da linha e da seta em canvas (forma "linha", src/nucleo/linha.ts): o traço, com o estilo (sólido, tracejado,
// pontilhado), as pontas e a junção que a camada pede, e cada ponta (seta aberta, triângulo, losango, círculo, barra). O mesmo
// código pinta a prévia e o PNG; o ângulo é o giro da camada, que pintura.ts aplica antes de chamar aqui.
import {tracoParaCanvas} from '../../../nucleo/acabamento';
import type {CamadaImagem} from '../../../nucleo/documentos';
import {formaDaCabeca, geometriaDaLinha} from '../../../nucleo/linha';

/** Desenha a linha da camada no espaço dela (0..largura × 0..altura), toda na cor `cor`. */
export const desenharLinha = (ctx: CanvasRenderingContext2D, c: Pick<CamadaImagem, 'largura' | 'altura' | 'linha'>, cor: string) => {
  const g = geometriaDaLinha(c);
  const t = tracoParaCanvas(g, g.espessura);
  ctx.save();
  ctx.strokeStyle = cor;
  ctx.fillStyle = cor;
  ctx.lineWidth = g.espessura;
  ctx.lineCap = t.cap;
  ctx.lineJoin = t.join;
  ctx.miterLimit = t.miterLimit;
  if (g.x1 > g.x0) {
    ctx.setLineDash(t.dash);
    ctx.beginPath();
    ctx.moveTo(g.x0, g.y);
    ctx.lineTo(g.x1, g.y);
    ctx.stroke();
  }
  // as pontas são sempre inteiras (sem tracinhos); a junção e as pontas do traço valem nos cantos delas
  ctx.setLineDash([]);
  for (const h of g.cabecas) {
    const f = formaDaCabeca(h);
    if (f.poligono) {
      ctx.beginPath();
      f.poligono.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke(); // o mesmo traço do corpo em volta: a junção arredonda, afia ou chanfra o bico
    } else if (f.circulo) {
      ctx.beginPath();
      ctx.arc(f.circulo.x, f.circulo.y, f.circulo.r, 0, Math.PI * 2);
      ctx.fill();
    } else if (f.abertos) {
      for (const linha of f.abertos) {
        ctx.beginPath();
        linha.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
    }
  }
  ctx.restore();
};
