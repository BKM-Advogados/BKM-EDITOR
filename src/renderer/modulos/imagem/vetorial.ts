// O corpo vetorial de uma camada de forma: o ícone do Lucide (icone.ts) ou a linha e a seta (linha.ts). pintura.ts chama
// aqui no lugar do preenchimento quando `ehVetorial(c)`.
import {ehLinha} from '../../../nucleo/acabamento';
import type {CamadaImagem} from '../../../nucleo/documentos';
import {desenharIcone} from './icone';
import {desenharLinha} from './linha';

export const desenharVetorial = (ctx: CanvasRenderingContext2D, c: CamadaImagem, cor: string) => (ehLinha(c) ? desenharLinha(ctx, c, cor) : desenharIcone(ctx, c, cor));
