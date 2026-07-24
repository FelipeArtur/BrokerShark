import type { Req, Res } from "./respond.ts";

const clients = new Set<Res>();

export function broadcast(event = "update"): void {
  for (const res of clients) {
    try { res.write(`data: ${event}\n\n`); } catch { clients.delete(res); }
  }
}

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

setInterval(() => {
  for (const res of clients) {
    try { res.write(": ping\n\n"); } catch { clients.delete(res); }
  }
}, 30_000).unref();
