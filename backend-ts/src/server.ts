/**
 * server.ts — HTTP server local: rotas /api + SSE + frontend estático.
 *
 * Zero deps: node:http + micro-router próprio (routes/helpers.ts).
 * Bind em 127.0.0.1 — ferramenta pessoal, sem auth; a fronteira é a máquina.
 *
 * Uso: node src/server.ts [<db>] [--port N]
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDb } from "./db/open.ts";
import type { Req, Res, Route } from "./routes/helpers.ts";
import { error, json, sseClients } from "./routes/helpers.ts";
import { accountRoutes } from "./routes/accounts.ts";
import { transactionRoutes } from "./routes/transactions.ts";
import { categoryRoutes } from "./routes/categories.ts";
import { analyticsRoutes } from "./routes/analytics.ts";
import { investmentRoutes } from "./routes/investments.ts";

// ── Config ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const PORT = portIdx >= 0 ? Number(args[portIdx + 1]) : Number(process.env.PORT ?? 8000);
const dbPath = args.find((a, i) => !a.startsWith("--") && i !== portIdx + 1)
  ?? join(import.meta.dirname, "../../data/brokershark-v2.db");
const FRONTEND_DIR = resolve(import.meta.dirname, "../../frontend");

if (!existsSync(dbPath)) {
  console.error(`DB não encontrado: ${dbPath}\nRode o backfill primeiro: node src/jobs/backfill.ts "<dir do acervo>"`);
  process.exit(1);
}

const db: DatabaseSync = openDb(dbPath);

// ── Rotas ──────────────────────────────────────────────────────────────────
const routes: Route[] = [
  ...accountRoutes(db),
  ...transactionRoutes(db),
  ...categoryRoutes(db),
  ...analyticsRoutes(db),
  ...investmentRoutes(db),
];

// ── SSE ────────────────────────────────────────────────────────────────────
function handleSse(req: Req, res: Res): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    "Connection": "keep-alive",
  });
  res.write(": connected\n\n");
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
}

// keepalive — evita timeout de socket ocioso
setInterval(() => {
  for (const res of sseClients) {
    try { res.write(": ping\n\n"); } catch { sseClients.delete(res); }
  }
}, 30_000).unref();

// ── Backup status (footer) ─────────────────────────────────────────────────
// Snapshot de backup ainda não reimplementado no v2 — o footer mostra "sem backup".
function handleBackupStatus(_req: Req, res: Res): void {
  json(res, { exists: false });
}

// ── Frontend estático ──────────────────────────────────────────────────────
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

function serveStatic(pathname: string, res: Res): void {
  // contrato v1: assets sob /static/<subdir> → frontend/<subdir>
  const path = pathname.startsWith("/static/") ? pathname.slice("/static".length) : pathname;
  const rel = path === "/" ? "index.html" : path.slice(1);
  const file = resolve(FRONTEND_DIR, rel);
  // guarda contra path traversal
  if (!file.startsWith(FRONTEND_DIR + "/") && file !== join(FRONTEND_DIR, "index.html")) {
    return error(res, "not found", 404);
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    return error(res, "not found", 404);
  }
  res.writeHead(200, {
    "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  createReadStream(file).pipe(res);
}

// ── Dispatch ───────────────────────────────────────────────────────────────
const server = createServer(async (req: Req, res: Res) => {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";
  const qIdx = url.indexOf("?");
  const pathname = qIdx >= 0 ? url.slice(0, qIdx) : url;

  try {
    if (method === "GET" && pathname === "/api/events") return handleSse(req, res);
    if (method === "GET" && pathname === "/api/backup-status") return handleBackupStatus(req, res);

    for (const route of routes) {
      if (route.method !== method) continue;
      const m = route.pattern.exec(pathname);
      if (!m) continue;
      req.params = {};
      route.keys.forEach((k, i) => { req.params![k] = decodeURIComponent(m[i + 1]); });
      await route.handler(req, res);
      return;
    }

    if (pathname.startsWith("/api/")) return error(res, "endpoint não implementado", 404);
    if (method === "GET") return serveStatic(pathname, res);
    error(res, "not found", 404);
  } catch (err) {
    console.error(`${method} ${url} —`, err);
    if (!res.headersSent) error(res, "internal error", 500);
    else res.end();
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`BrokerShark v2 — http://127.0.0.1:${PORT}`);
  console.log(`DB: ${dbPath}`);
});
