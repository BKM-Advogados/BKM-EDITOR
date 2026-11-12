// Quem pode falar com o /mcp: só o próprio PC, e nada vindo de página web (DNS rebinding, CSRF). As duas portas que
// atendem o MCP por HTTP (a do servidor de mídia, para as abas e o Claude Desktop, e a dos apps de fora) usam esta regra.
import type http from 'node:http';

/** Host exato (127.0.0.1 ou localhost na porta que atendeu o pedido) e sem Origin: os clientes do MCP não mandam Origin. */
export const pedidoLocal = (req: http.IncomingMessage) => {
  const porta = req.socket.localPort;
  const host = req.headers.host;
  return (host === `127.0.0.1:${porta}` || host === `localhost:${porta}`) && req.headers.origin === undefined;
};
