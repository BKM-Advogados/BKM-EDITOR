// Ícones do Lucide na imagem: a geometria de cada um (icones-geometria.json, gerada por scripts/gerar-icones.mjs) e a
// pintura em canvas. O ícone é vetorial: cada elemento vira um Path2D na grade de 24 do Lucide e o traço (arredondado,
// espessura 2 por padrão) escala com a caixa da camada, então sai nítido em 1x, 2x e 4x, na prévia e no PNG. A cor é a
// de `preenchimento` da forma (ou o degradê, que tinge o traço pronto). Licença do Lucide (ISC): LICENSE-Lucide.txt.
import type {CamadaImagem} from '../../../nucleo/documentos';
import geometriaJson from './icones-geometria.json';

/** Elementos de um ícone: os traçados e, em poucos, os preenchidos (pontos). */
export type GeometriaIcone = {tracos: string[]; cheios: string[]};

const ICONES = (geometriaJson as unknown as {icones: Record<string, [string[], string[]?]>}).icones;
const prontos = new Map<string, {tracos: Path2D[]; cheios: Path2D[]}>();

export const GRADE_ICONE = 24;
export const ESPESSURA_ICONE = 2;

/** Os caminhos SVG de um ícone (para a lista de ícones e a prévia em SVG); null se o nome não existe. */
export const geometriaDoIcone = (nome: string): GeometriaIcone | null => {
  const g = ICONES[nome];
  return g ? {tracos: g[0], cheios: g[1] ?? []} : null;
};

const caminhosDe = (nome: string) => {
  const ja = prontos.get(nome);
  if (ja) return ja;
  const g = geometriaDoIcone(nome);
  if (!g) return null;
  const feitos = {tracos: g.tracos.map((d) => new Path2D(d)), cheios: g.cheios.map((d) => new Path2D(d))};
  prontos.set(nome, feitos);
  return feitos;
};

/** Desenha o ícone da camada, no espaço dela (0..largura × 0..altura): quadrado do menor lado, centrado na caixa. Nome que
 *  não existe vira uma moldura tracejada, para a camada não sumir sem aviso. */
export const desenharIcone = (ctx: CanvasRenderingContext2D, c: Pick<CamadaImagem, 'largura' | 'altura' | 'icone' | 'icone_espessura'>, cor: string) => {
  const lado = Math.min(c.largura, c.altura);
  if (!(lado > 0)) return;
  ctx.save();
  ctx.translate((c.largura - lado) / 2, (c.altura - lado) / 2);
  ctx.scale(lado / GRADE_ICONE, lado / GRADE_ICONE);
  ctx.strokeStyle = cor;
  ctx.fillStyle = cor;
  ctx.lineWidth = c.icone_espessura && c.icone_espessura > 0 ? c.icone_espessura : ESPESSURA_ICONE;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const g = caminhosDe(c.icone ?? '');
  if (g) {
    for (const p of g.tracos) ctx.stroke(p);
    for (const p of g.cheios) ctx.fill(p);
  } else {
    ctx.setLineDash([2, 2]);
    ctx.strokeRect(3, 3, 18, 18);
  }
  ctx.restore();
};
