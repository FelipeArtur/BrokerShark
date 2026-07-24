/**
 * @file server.ts
 * @brief Bootstrap do servidor local: config → db → pipeline de request → listen.
 *
 * server.ts — bootstrap do servidor local.
 *
 * Pipeline por request: host allowlist → headers de segurança → SSE →
 * backup-status → rotas /api → frontend estático.
 *
 * A ORDEM do pipeline é load-bearing: Host antes de tudo (anti DNS-rebinding), e a
 * checagem de Origin antes de qualquer rota de escrita (anti-CSRF).
 *
 * Bind fixo em 127.0.0.1 — o app não tem auth; a máquina é o perímetro.
 *
 * Uso: node src/server.ts [<db>] [--port N]   (PORT no env também vale)
 *
 * Script de entrada — executa no import; não exporta nada.
 */
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDb, initSchema, restrictPermissions } from "./db/open.ts";
import { runMigrations } from "./db/migrate.ts";
import type { Req, Res } from "./http/respond.ts";
import { error, json, HttpError } from "./http/respond.ts";
import type { Route } from "./http/router.ts";
import { dispatch } from "./http/router.ts";
import { handleSse } from "./http/sse.ts";
import { makeStatic } from "./http/static.ts";
import { hostAllowed, securityHeaders, originAllowed } from "./http/security.ts";
import { accountRoutes } from "./routes/accounts.ts";
import { transactionRoutes } from "./routes/transactions.ts";
import { categoryRoutes } from "./routes/categories.ts";
import { analyticsRoutes } from "./routes/analytics.ts";
import { investmentRoutes } from "./routes/investments.ts";
import { importRoutes } from "./routes/import.ts";
import { commitmentRoutes } from "./routes/commitments.ts";
import { backupStatus } from "./jobs/backup.ts";

// ── Config ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const PORT = portIdx >= 0 ? Number(args[portIdx + 1]) : Number(process.env.PORT ?? 8000);
const dbPath = args.find((a, i) => !a.startsWith("--") && i !== portIdx + 1)
  ?? join(import.meta.dirname, "../data/brokershark-v2.db");
const serveStatic = makeStatic(resolve(import.meta.dirname, "../../frontend"));
const BACKUP_DIR = process.env.BROKERSHARK_BACKUP_DIR ?? join(homedir(), "brokershark-backups");

if (!existsSync(dbPath)) {
  console.error(`DB não encontrado: ${dbPath}\nRode o backfill primeiro: node src/jobs/backfill.ts "<dir do acervo>"`);
  process.exit(1);
}

const db: DatabaseSync = openDb(dbPath);
// schema.sql (CREATE IF NOT EXISTS) = baseline idempotente: cria tabela nova num
// DB vivo sem rebuild, no-op quando já existe. Migrations cobrem o que ele não
// expressa (ALTER/rename/drop) — aplicadas uma vez por DB logo em seguida.
initSchema(db);
runMigrations(db);
restrictPermissions(dbPath); // WAL/SHM recriados pelo server também ficam 0600

const routes: Route[] = [
  ...accountRoutes(db),
  ...transactionRoutes(db),
  ...categoryRoutes(db),
  ...analyticsRoutes(db),
  ...investmentRoutes(db),
  ...importRoutes(db),
  ...commitmentRoutes(db),
];

/**
 * @brief Responder o estado do backup mais recente lendo o diretório de backups.
 * @param _req requisição (ignorada) · @param res resposta {exists, name?, age_seconds?}
 */
function handleBackupStatus(_req: Req, res: Res): void {
  json(res, backupStatus(BACKUP_DIR));
}

// ── Server ─────────────────────────────────────────────────────────────────
const server = createServer(async (req: Req, res: Res) => {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";
  const qIdx = url.indexOf("?");
  const pathname = qIdx >= 0 ? url.slice(0, qIdx) : url;

  try {
    if (!hostAllowed(req)) return error(res, "host não permitido", 403);
    securityHeaders(res);
    // CSRF: escrita só de origem localhost (GET/HEAD são idempotentes/leitura)
    if (method !== "GET" && method !== "HEAD" && !originAllowed(req)) {
      return error(res, "origin não permitido", 403);
    }

    if (method === "GET" && pathname === "/api/events") return handleSse(req, res);
    if (method === "GET" && pathname === "/api/backup-status") return handleBackupStatus(req, res);

    if (await dispatch(routes, req, res, pathname)) return;

    if (pathname.startsWith("/api/")) return error(res, "endpoint não implementado", 404);
    if (method === "GET") return serveStatic(pathname, res);
    error(res, "not found", 404);
  } catch (err) {
    if (err instanceof HttpError && !res.headersSent) return error(res, err.message, err.status);
    console.error(`${method} ${url} —`, err);
    if (!res.headersSent) error(res, "internal error", 500);
    else res.end();
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`BrokerShark v2 — http://127.0.0.1:${PORT}`);
  console.log(`DB: ${dbPath}`);
});
