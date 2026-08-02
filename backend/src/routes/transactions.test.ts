import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { learnCategoryRule } from "./transactions.ts";

function db0(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE rules (id INTEGER PRIMARY KEY, matcher TEXT, match_field TEXT, action TEXT, value TEXT, priority INTEGER, enabled INTEGER DEFAULT 1);`);
  return db;
}

test("learnCategoryRule inserts a category rule from the merchant core", () => {
  const db = db0();
  learnCategoryRule(db, "POSTO SOL COSTA AZUL SALVADOR BRA", 7);
  const r = db.prepare("SELECT matcher, action, value FROM rules WHERE action='category'").get() as any;
  assert.equal(r.matcher, "posto sol costa azul");
  assert.equal(r.value, "7");
});

test("learnCategoryRule updates the value when the same merchant is re-categorized", () => {
  const db = db0();
  learnCategoryRule(db, "MAMMA JAMMA SALVADOR BRA", 3);
  learnCategoryRule(db, "MAMMA JAMMA SALVADOR BRA", 9);
  const rows = db.prepare("SELECT value FROM rules WHERE action='category' AND matcher='mamma jamma'").all() as any[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, "9");
});

test("learnCategoryRule ignores a blank merchant core", () => {
  const db = db0();
  learnCategoryRule(db, "   ", 4);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM rules").get() as any).n, 0);
});

// ── marcar/desmarcar recorrente ─────────────────────────────────────────────
// A marca mora em `recurring_marks`, não numa coluna de `transactions`, então o
// PATCH tem que escrever fora do UPDATE — e tem que funcionar sozinho no corpo,
// que é o caso comum: marcar recorrente sem mexer em mais nada.

import { Readable } from "node:stream";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initSchema } from "../db/open.ts";
import { runMigrations } from "../db/migrate.ts";
import { seedAccounts } from "../jobs/backfill/seeds.ts";
import { dispatch } from "../http/router.ts";
import { transactionRoutes } from "./transactions.ts";
import { useTestConfig } from "../testing/fixtures.ts";

useTestConfig();

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../db/migrations");

function dbCheio(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  runMigrations(db, MIGRATIONS_DIR);
  seedAccounts(db);
  return db;
}

async function chamar(db: DatabaseSync, method: string, url: string, body?: unknown) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as any;
  req.method = method; req.url = url; req.headers = { "content-type": "application/json" };
  let status = 200; let payload: any;
  const res: any = {
    headersSent: false, setHeader() {},
    writeHead(s: number) { status = s; },
    end(s: string) { payload = s ? JSON.parse(s) : undefined; },
  };
  const hit = await dispatch(transactionRoutes(db), req, res, url.split("?")[0]);
  assert.ok(hit, `nenhuma rota casou com ${method} ${url}`);
  return { status, payload };
}

const novoTx = (db: DatabaseSync) => Number(db.prepare(
  `INSERT INTO transactions (date, flow, method, account_id, amount_cents, description)
   VALUES ('2026-04-10','expense','pix','conta-a',120000,'Aluguel')`).run().lastInsertRowid);

const marcas = (db: DatabaseSync) =>
  (db.prepare("SELECT COUNT(*) n FROM recurring_marks").get() as any).n;

test("recurring:1 sozinho no corpo marca o lançamento", async () => {
  const db = dbCheio();
  const id = novoTx(db);
  const out = await chamar(db, "PATCH", `/api/transactions/${id}`, { recurring: 1 });
  assert.equal(out.status, 200);
  assert.equal(marcas(db), 1);
});

test("marcar duas vezes não duplica", async () => {
  const db = dbCheio();
  const id = novoTx(db);
  await chamar(db, "PATCH", `/api/transactions/${id}`, { recurring: 1 });
  await chamar(db, "PATCH", `/api/transactions/${id}`, { recurring: 1 });
  assert.equal(marcas(db), 1);
});

test("recurring:0 desmarca", async () => {
  const db = dbCheio();
  const id = novoTx(db);
  await chamar(db, "PATCH", `/api/transactions/${id}`, { recurring: 1 });
  await chamar(db, "PATCH", `/api/transactions/${id}`, { recurring: 0 });
  assert.equal(marcas(db), 0);
});

test("valor fora de 0|1 é recusado e não escreve nada", async () => {
  const db = dbCheio();
  const id = novoTx(db);
  const out = await chamar(db, "PATCH", `/api/transactions/${id}`, { recurring: 2 });
  assert.equal(out.status, 400);
  assert.equal(marcas(db), 0);
});

test("lançamento inexistente devolve 404 sem criar marca órfã", async () => {
  const db = dbCheio();
  const out = await chamar(db, "PATCH", "/api/transactions/999", { recurring: 1 });
  assert.equal(out.status, 404);
  assert.equal(marcas(db), 0);
});

test("recurring viaja junto de outro campo sem atropelar o UPDATE", async () => {
  const db = dbCheio();
  const id = novoTx(db);
  const out = await chamar(db, "PATCH", `/api/transactions/${id}`,
    { recurring: 1, display_name: "Aluguel do apê" });
  assert.equal(out.status, 200);
  assert.equal(marcas(db), 1);
  assert.equal(
    (db.prepare("SELECT display_name d FROM transactions WHERE id=?").get(id) as any).d,
    "Aluguel do apê",
  );
});

test("month-transactions devolve is_recurring pra tela saber o estado", async () => {
  const db = dbCheio();
  const id = novoTx(db);
  await chamar(db, "PATCH", `/api/transactions/${id}`, { recurring: 1 });
  const out = await chamar(db, "GET", "/api/month-transactions?year=2026&month=4");
  assert.equal(out.payload.length, 1);
  assert.equal(out.payload[0].is_recurring, 1);
});
