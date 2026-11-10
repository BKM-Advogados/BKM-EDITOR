// Ações sobre a seleção da imagem (rodada 3, B2): agrupar (Ctrl+G), desagrupar (Ctrl+Shift+G) e travar ou destravar
// (Ctrl+Shift+L). Cada uma é um patch só, desfazível, e a seleção acompanha. As contas são as de layout-imagem.ts, as
// mesmas das ferramentas agrupar_camadas, desagrupar_camadas, travar_camadas e destravar_camadas do MCP.
import type {DocImagem} from '../../../nucleo/documentos';
import {patchAgrupar, patchDesagrupar, patchTravar, travada} from '../../../nucleo/layout-imagem';
import {aplicar, avisar, caminhosDaSelecao, loja, selecionarVarias} from '../../estado/loja';
import {docValido, indiceDe, paginaAtivaDe} from './comum';

/** A seleção na página ativa: documento, base, camadas da página e os índices selecionados. */
const selecaoNaPagina = () => {
  const e = loja.get();
  const documento = e.selecao?.documento;
  const doc = documento ? (e.docs[documento]?.doc as DocImagem | undefined) : undefined;
  if (!documento || !doc || !docValido(doc)) return null;
  const pg = paginaAtivaDe(e, documento, doc);
  const indices = caminhosDaSelecao(e.selecao, documento).map((c) => indiceDe(c, pg.base)).filter((i) => i >= 0 && pg.camadas[i]);
  return indices.length ? {documento, base: pg.base, camadas: pg.camadas, indices} : null;
};

export const agruparSelecao = async () => {
  const s = selecaoNaPagina();
  if (!s || s.indices.length < 2) return avisar('Para agrupar, escolha duas camadas ou mais (Shift+clique ou laço).', 'info');
  const r = patchAgrupar(s.camadas, s.base, s.indices);
  if (r && (await aplicar(s.documento, r.patch, `agrupar ${s.indices.length} camadas (${r.grupo})`))) selecionarVarias(s.documento, r.caminhos);
};

export const desagruparSelecao = async () => {
  const s = selecaoNaPagina();
  if (!s) return;
  const patch = patchDesagrupar(s.camadas, s.base, s.indices);
  if (!patch.length) return avisar('A seleção não tem grupo.', 'info');
  await aplicar(s.documento, patch, 'desagrupar');
};

/** Trava todas se alguma está solta; senão destrava todas. */
export const alternarTravaSelecao = async () => {
  const s = selecaoNaPagina();
  if (!s) return;
  const travar = s.indices.some((i) => !travada(s.camadas[i]));
  await aplicar(s.documento, patchTravar(s.camadas, s.base, s.indices, travar), `${travar ? 'travar' : 'destravar'} ${s.indices.length === 1 ? s.camadas[s.indices[0]].id : `${s.indices.length} camadas`}`);
};
