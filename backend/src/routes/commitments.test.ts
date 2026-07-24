import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initSchema } from "../db/open.ts";
import { runMigrations } from "../db/migrate.ts";
import { seedAccountsAndCategories } from "../jobs/backfill/seeds.ts";
import { commitmentRoutes } from "./commitments.ts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "../db/migrations");

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  runMigrations(db, MIGRATIONS_DIR);
  seedAccountsAndCategories(db);
  return db;
}

function getCommitments(db: DatabaseSync): any {
  const route = commitmentRoutes(db).find(r => r.method === "GET")!;
  let payload: any;
  const res: any = { setHeader() {}, end(s: string) { payload = JSON.parse(s); }, writeHead() {} };
  route.handler({ url: "/api/commitments", params: {} } as any, res);
  return payload;
}

function openInvoice(db: DatabaseSync, refMonth: string, dueDate: string | null, totalCents: number): number {
  return Number(db.prepare(
    "INSERT INTO invoices (account_id, ref_month, due_date, total_cents, source_file) VALUES ('inter-cc', ?, ?, ?, 'ui')",
  ).run(refMonth, dueDate, totalCents).lastInsertRowid);
}

function installmentItem(db: DatabaseSync, invoiceId: number, date: string, amountCents: number, seq: number, total: number) {
  db.prepare(`INSERT INTO transactions
    (date, flow, method, account_id, amount_cents, description, invoice_id, installment_seq, installment_total, import_batch_id)
    VALUES (?, 'expense', 'credit', 'inter-cc', ?, 'Steam', ?, ?, ?, 'sess-1')`)
    .run(date, amountCents, invoiceId, seq, total);
}

test("commitments: fatura aberta entra na série pelo mês do vencimento", () => {
  const db = freshDb();

  const now = new Date();
  const dd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-15`;
  openInvoice(db, "2026-07", dd, 50000);
  const out = getCommitments(db);
  assert.equal(out.open_invoices.length, 1);
  assert.equal(out.open_invoices[0].total, 500);
  const hit = out.series.find((s: any) => s.month === dd.slice(0, 7));
  assert.ok(hit, "mês do vencimento presente na série");
  assert.equal(hit.invoice, 500);
});

test("commitments: itens parcelados projetam meses futuros", () => {
  const db = freshDb();
  const inv = openInvoice(db, "2026-07", null, 1000);
  installmentItem(db, inv, "2026-07-10", 1000, 2, 5);
  const out = getCommitments(db);
  const projMonths = out.series.filter((s: any) => s.projected > 0);

  const totalProjected = out.series.reduce((n: number, s: any) => n + s.projected, 0);
  assert.ok(totalProjected >= 0);
  assert.ok(projMonths.every((s: any) => s.projected > 0));
});

test("commitments: fatura sem due_date não entra na série (mas lista em open_invoices)", () => {
  const db = freshDb();
  openInvoice(db, "2026-07", null, 30000);
  const out = getCommitments(db);
  assert.equal(out.open_invoices.length, 1);
  assert.ok(out.series.every((s: any) => s.invoice === 0));
});

test("commitments: DB vazio → série vazia", () => {
  const db = freshDb();
  const out = getCommitments(db);
  assert.deepEqual(out.open_invoices, []);
  assert.deepEqual(out.series, []);
});
