// Pré-ajustes de animação de entrada e de saída (surgir, subir, descer, crescer, girar), como as ações do Jitter: escrevem
// os quadros-chave por você. Moram no núcleo para a tela (InspectorAnimacao) e o MCP (animar_entrada e animar_saida,
// mcp-edicao-fina.ts) gravarem as mesmas trilhas. Ver ux/pesquisa-ux-visual.md, item 24.
import type {CamadaAnimacao, PropriedadeAnimavel, QuadroChave} from './animacao';
import {valorEm} from './animacao';

type Trilhas = NonNullable<CamadaAnimacao['trilhas']>;
export type Preajuste = {id: string; nome: string; de: Partial<Record<PropriedadeAnimavel, (atual: number) => number>>};

/** De onde a camada vem na entrada (e para onde vai na saída), a partir do valor que ela tem na agulha. */
export const PREAJUSTES: Preajuste[] = [
  {id: 'surgir', nome: 'Surgir', de: {opacidade: () => 0}},
  {id: 'subir', nome: 'Subir', de: {opacidade: () => 0, y: (y) => y + 80}},
  {id: 'descer', nome: 'Descer', de: {opacidade: () => 0, y: (y) => y - 80}},
  {id: 'crescer', nome: 'Crescer', de: {opacidade: () => 0, escala: (e) => e * 0.6}},
  {id: 'girar', nome: 'Girar', de: {opacidade: () => 0, rotacao: (r) => r - 90, escala: (e) => e * 0.8}},
];
export const DURACAO_PREAJUSTE_MS = 600;

/** As trilhas da camada com a entrada (que termina no valor de agora) ou a saída (que parte dele) a partir de `t_ms`.
 *  Os quadros-chave que já estavam dentro do trecho, nessas propriedades, saem; os de fora ficam. */
export const trilhasComPreajuste = (camada: CamadaAnimacao, p: Preajuste, tipo: 'entrada' | 'saida', t_ms: number, duracaoDoc: number,
  dur = DURACAO_PREAJUSTE_MS): Trilhas => {
  const ini = Math.max(0, Math.round(tipo === 'entrada' ? t_ms : Math.min(t_ms, duracaoDoc - dur)));
  const fim = Math.min(duracaoDoc, ini + dur);
  const trilhas: Trilhas = {...(camada.trilhas ?? {})};
  for (const [prop, funcao] of Object.entries(p.de) as [PropriedadeAnimavel, (n: number) => number][]) {
    const atual = Number(valorEm(camada, prop, tipo === 'entrada' ? fim : ini));
    const longe = funcao(atual);
    const fora = (trilhas[prop] ?? []).filter((k) => k.t_ms < ini || k.t_ms > fim);
    const novos: QuadroChave[] = tipo === 'entrada'
      ? [{t_ms: ini, valor: longe, curva: 'saida'}, {t_ms: fim, valor: atual, curva: 'suave'}]
      : [{t_ms: ini, valor: atual, curva: 'entrada'}, {t_ms: fim, valor: longe, curva: 'suave'}];
    trilhas[prop] = [...fora, ...novos].sort((a, b) => a.t_ms - b.t_ms);
  }
  return trilhas;
};

/** O pré-ajuste pelo id (surgir, subir…), ou undefined. */
export const preajusteDe = (id: string) => PREAJUSTES.find((p) => p.id === id);
