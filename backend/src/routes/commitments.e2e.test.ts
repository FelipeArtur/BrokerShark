import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initSchema } from "../db/open.ts";
import { runMigrations } from "../db/migrate.ts";
import { seedAccountsAndCategories } from "../jobs/backfill/seeds.ts";
import { commitmentRoutes } from "./commitments.ts";
import { accountRoutes } from "./accounts.ts";

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  runMigrations(db);
  seedAccountsAndCategories(db);
  return db;
}

function call(route: any): any {
  let payload: any;
  const res: any = { setHeader() {}, end(s: string) { payload = JSON.parse(s); }, writeHead() {} };
  route.handler({ url: "/", params: {} } as any, res);
  return payload;
}

test("e2e: fatura aberta vencendo este mês + parcela → net abatido e projeção na série", () => {
  const db = freshDb();
  const now = new Date();
  const dd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-15`;
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const inv = Number(db.prepare(
    "INSERT INTO invoices (account_id, ref_month, due_date, total_cents, source_file) VALUES ('inter-cc',?,?,20000,'ui')",
  ).run(ym, dd).lastInsertRowid);
  db.prepare(`INSERT INTO transactions
    (date, flow, method, account_id, amount_cents, description, invoice_id, installment_seq, installment_total, import_batch_id)
    VALUES ('2026-07-10','expense','credit','inter-cc',5000,'Steam',?,1,3,'sess-1')`).run(inv);

  const avail = call(accountRoutes(db).filter(r => r.method === "GET")[1]);
  assert.equal(avail.committed_this_month, 200);
  assert.equal(avail.available_net, avail.available - 200);

  const commit = call(commitmentRoutes(db)[0]);
  assert.equal(commit.open_invoices.length, 1);
  const projTotal = commit.series.reduce((n: number, s: any) => n + s.projected, 0);
  assert.ok(projTotal > 0, "projeção de parcelas presente na série");
});
