import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initSchema } from "../db/open.ts";
import { seedAccountsAndCategories } from "../jobs/backfill/seeds.ts";
import { runMigrations } from "../db/migrate.ts";
import { accountRoutes } from "./accounts.ts";

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  seedAccountsAndCategories(db);
  runMigrations(db); // due_date column from 0001_invoice_due_date.sql
  return db;
}

function getAvailable(db: DatabaseSync): any {
  const route = accountRoutes(db).find(r => r.path === "/api/available" || (r as any).source === "/api/available")
    ?? accountRoutes(db).find(r => r.method === "GET" && String((r as any).re).includes("available"));
  // Fallback robusto: pega a 2ª rota GET (available) se o matcher acima falhar.
  const routes = accountRoutes(db).filter(r => r.method === "GET");
  const target = route ?? routes[1];
  let payload: any;
  const res: any = { setHeader() {}, end(s: string) { payload = JSON.parse(s); }, writeHead() {} };
  target.handler({ url: "/api/available", params: {} } as any, res);
  return payload;
}

test("available: sem fatura aberta → net == bruto, committed 0", () => {
  const db = freshDb();
  const out = getAvailable(db);
  assert.equal(out.committed_this_month, 0);
  assert.equal(out.available_net, out.available);
});

test("available: fatura aberta vencendo este mês abate no net", () => {
  const db = freshDb();
  const now = new Date();
  const dd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-15`;
  db.prepare(
    "INSERT INTO invoices (account_id, ref_month, due_date, total_cents, source_file) VALUES ('inter-cc','2026-07',?,10000,'ui')",
  ).run(dd);
  const out = getAvailable(db);
  assert.equal(out.committed_this_month, 100);
  assert.equal(out.available_net, out.available - 100);
});

test("available: fatura sem due_date não abate", () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO invoices (account_id, ref_month, due_date, total_cents, source_file) VALUES ('inter-cc','2026-07',NULL,10000,'ui')",
  ).run();
  const out = getAvailable(db);
  assert.equal(out.committed_this_month, 0);
  assert.equal(out.available_net, out.available);
});
