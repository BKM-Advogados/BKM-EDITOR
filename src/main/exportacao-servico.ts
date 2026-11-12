// O serviço da exportação final do MCP (src/nucleo/mcp-exportacao-final.ts), montado nos três lugares que o usam:
// - no app (main.ts): o vídeo pelo exportador da tela (a mesma trava de uma exportação por vez) e a imagem e o carrossel
//   pela ponte com a janela, que desenha no canvas como o diálogo (src/renderer/modulos/imagem/exportarPeloMcp.ts);
// - no MCP da IDE e no do Claude Desktop com o app fechado (mcp/nucleo.ts, mcp/desktop.ts): só o vídeo, renderizado no
//   próprio processo (renderStdio); sem janela, a imagem e o carrossel respondem que é preciso abrir o projeto no app.
import type {ServicoExportacaoFinal} from '../nucleo/mcp-exportacao-final';
import {ABRA_NO_APP} from '../nucleo/mcp-exportacao-final';
import {criarExportadorVideo, type ExportadorVideo} from './exportacao-video';
import type {PedirAJanela} from './ponte-janela';
import {renderStdio} from './previa-stdio';

/** Quanto a janela tem para desenhar e gravar (o cartão e esta espera cabem nos 15 min do repasse da IDE). */
export const TEMPO_DA_JANELA_MS = 4 * 60 * 1000;

/** Pede à janela e devolve os dados, ou lança com uma mensagem que diz o que fazer. */
const daJanela = async <T,>(janela: PedirAJanela, acao: string, dados: unknown): Promise<T> => {
  const r = await janela(acao, dados, {tempo_ms: TEMPO_DA_JANELA_MS});
  if (r.ok) return r.dados as T;
  const m = r.mensagem ?? 'a janela não respondeu';
  if (/sem janela|não atende/.test(m)) throw new Error(ABRA_NO_APP);
  if (/não respondeu/.test(m)) throw new Error(`${m}; a exportação pode ainda terminar sozinha em saidas/`);
  throw new Error(m);
};

export const servicoDeExportacao = (exportador: ExportadorVideo, janela?: PedirAJanela): ServicoExportacaoFinal => ({
  video: (projeto, documento, opcoes, aviso) => exportador.exportar(projeto, documento, opcoes, aviso),
  cancelarVideo: () => exportador.cancelar(),
  ...(janela ? {
    imagem: (_projeto, pedido) => daJanela(janela, 'exportar:imagem', pedido),
    carrossel: (_projeto, pedido) => daJanela(janela, 'exportar:carrossel', pedido),
  } : {}),
});

/** Fora do app: o vídeo com o render de onde veio o nucleo.cjs (a pasta acima de dist-mcp/). */
export const servicoDeExportacaoStdio = (acima: string) => servicoDeExportacao(criarExportadorVideo(renderStdio(acima)));
