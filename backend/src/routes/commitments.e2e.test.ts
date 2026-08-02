import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initSchema } from "../db/open.ts";
import { runMigrations } from "../db/migrate.ts";
import { seedAccounts } from "../jobs/backfill/seeds.ts";
import { commitmentRoutes } from "./commitments.ts";
import { accountRoutes } from "./accounts.ts";
import { useTestConfig } from "../testing/fixtures.ts";

useTestConfig();

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  runMigrations(db);
  seedAccounts(db);
  return db;
}

function call(route: any, url = "/"): any {
  let payload: any;
  const res: any = { setHeader() {}, end(s: string) { payload = JSON.parse(s); }, writeHead() {} };
  route.handler({ url, params: {} } as any, res);
  return payload;
}

// Duas leituras diferentes do mesmo cartão, e elas não se confundem: a fatura em
// aberto abate o herói (é dinheiro com data pra sair), enquanto o card de
// compromissos fala das PARCELAS lançadas no mês. Fatura aberta não vira linha
// de parcela, e parcela não abate o disponível duas vezes.
test("e2e: fatura aberta abate o disponível; a parcela do mês aparece no card", () => {
  const db = freshDb();
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const dd = `${ym}-15`;

  const inv = Number(db.prepare(
    "INSERT INTO invoices (account_id, ref_month, due_date, total_cents, source_file) VALUES ('cartao-b',?,?,20000,'ui')",
  ).run(ym, dd).lastInsertRowid);
  db.prepare(`INSERT INTO transactions
    (date, flow, method, account_id, amount_cents, description, invoice_id, installment_seq, installment_total, import_batch_id)
    VALUES (?,'expense','credit','cartao-b',5000,'Steam',?,1,3,'sess-1')`).run(`${ym}-10`, inv);

  const avail = call(accountRoutes(db).filter(r => r.method === "GET")[1]);
  assert.equal(avail.committed_this_month, 200);
  assert.equal(avail.available_net, avail.available - 200);

  const commit = call(commitmentRoutes(db)[0]);
  assert.equal(commit.month, ym);
  assert.equal(commit.installments.length, 1);
  assert.equal(commit.installments[0].amount, 50);
  assert.equal(commit.installments[0].remaining, 2, "1 de 3 lançada, faltam 2");
  assert.equal(commit.total_out, 50);
});
