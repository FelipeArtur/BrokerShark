/**
 * @file sse.ts
 * @brief Broadcaster SSE (/api/events) que dispara o refresh reativo do frontend.
 *
 * sse.ts — broadcaster de eventos p/ o frontend (refresh reativo).
 */
import type { Req, Res } from "./respond.ts";

const clients = new Set<Res>();

/**
 * @brief Enviar um evento a todos os clientes SSE conectados.
 *
 * Cliente cujo write falhar é descartado do conjunto (socket já morto).
 *
 * @param event nome do evento enviado no campo `data` (default "update")
 */
export function broadcast(event = "update"): void {
  for (const res of clients) {
    try { res.write(`data: ${event}\n\n`); } catch { clients.delete(res); }
  }
}

/**
 * @brief Abrir o stream SSE e registrar o cliente até o fechamento da conexão.
 * @param req requisição; o evento "close" desregistra o cliente
 * @param res resposta mantida aberta como text/event-stream
 */
export function handleSse(req: Req, res: Res): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    "Connection": "keep-alive",
  });
  res.write(": connected\n\n");
  clients.add(res);
  req.on("close", () => clients.delete(res));
}

// keepalive — evita timeout de socket ocioso
setInterval(() => {
  for (const res of clients) {
    try { res.write(": ping\n\n"); } catch { clients.delete(res); }
  }
}, 30_000).unref();
