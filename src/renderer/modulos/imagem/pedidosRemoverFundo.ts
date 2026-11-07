// Pedidos da ferramenta remover_fundo do Claude, ouvidos desde a abertura do app (main.tsx), em qualquer área. O
// módulo que roda o modelo (removerFundo.ts) só carrega no primeiro pedido, para não pesar a abertura.
window.estudio?.removerFundo?.aoPedido((id, src) => {
  void import('./removerFundo').then((m) => m.atenderPedido(id, src)).catch((e: unknown) =>
    window.estudio.removerFundo.responder(id, {ok: false, mensagem: (e as Error)?.message ?? String(e)}));
});

export {};
