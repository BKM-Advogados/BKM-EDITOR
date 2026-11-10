// Ponte com a janela (seção 0.1 de estudio-ia-provedores-2026-11-07/05-ferramentas-novas.md): o processo principal pede
// à janela uma ação ({id, acao, dados}) e espera a resposta com prazo, como o remover_fundo já fazia, agora num canal
// genérico (estudio:mcp-pedido / estudio:mcp-resposta) que qualquer ferramenta pode usar. Sem janela, ou sem quem atenda
// a ação na janela, a resposta vem na hora com ok: false, e quem pediu segue pelo caminho dele. Feita pela frente Música
// (render da música no Web Worker da janela); a janela registra quem atende em src/renderer/ponte-janela.ts.
import {randomUUID} from 'node:crypto';
import {CANAL, type RespostaJanela} from '../compartilhado/api';

export type PedirAJanela = (acao: string, dados: unknown, o?: {tempo_ms?: number}) => Promise<RespostaJanela>;

export const criarPonteJanela = (d: {enviar: (canal: string, ...a: unknown[]) => void; ouvir: (canal: string, f: (...a: never[]) => void) => void; temJanela: () => boolean}): PedirAJanela => {
  const pendentes = new Map<string, {ok: (r: RespostaJanela) => void; relogio: NodeJS.Timeout}>();
  d.ouvir(CANAL.mcpResposta, ((id: string, r: RespostaJanela) => {
    const p = pendentes.get(id);
    if (!p) return;
    clearTimeout(p.relogio);
    pendentes.delete(id);
    p.ok(r && typeof r === 'object' ? r : {ok: false, mensagem: 'resposta vazia da janela'});
  }) as never);
  return (acao, dados, o = {}) => new Promise<RespostaJanela>((ok) => {
    if (!d.temJanela()) return ok({ok: false, mensagem: 'sem janela do Estúdio aberta'});
    const id = randomUUID();
    const relogio = setTimeout(() => {
      pendentes.delete(id);
      ok({ok: false, mensagem: `a janela não respondeu "${acao}" em ${Math.round((o.tempo_ms ?? 60_000) / 1000)} s`});
    }, o.tempo_ms ?? 60_000);
    pendentes.set(id, {ok, relogio});
    d.enviar(CANAL.mcpPedido, id, acao, dados);
  });
};
