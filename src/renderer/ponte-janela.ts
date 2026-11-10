// Lado da janela da ponte com o processo principal (src/main/ponte-janela.ts): cada módulo registra quem atende uma
// ação ("musica:render"); pedido sem atendente responde na hora com ok: false, e o processo principal segue pelo
// caminho dele. Ligada uma vez no App.
const atendentes = new Map<string, (dados: unknown) => Promise<unknown> | unknown>();

/** Registra quem atende uma ação; devolve o que desfaz o registro. */
export const atender = (acao: string, f: (dados: unknown) => Promise<unknown> | unknown) => {
  atendentes.set(acao, f);
  return () => {
    if (atendentes.get(acao) === f) atendentes.delete(acao);
  };
};

export const ligarPonteDaJanela = () =>
  window.estudio.janela.aoPedido((id, acao, dados) => {
    const f = atendentes.get(acao);
    if (!f) return window.estudio.janela.responder(id, {ok: false, mensagem: `a janela não atende "${acao}" agora`});
    Promise.resolve()
      .then(() => f(dados))
      .then((r) => window.estudio.janela.responder(id, {ok: true, dados: r}))
      .catch((e: unknown) => window.estudio.janela.responder(id, {ok: false, mensagem: String((e as Error)?.message ?? e)}));
  });
