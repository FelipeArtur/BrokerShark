import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initSchema } from "./open.ts";
import { runMigrations } from "./migrate.ts";
import { seedAccounts } from "../jobs/backfill/seeds.ts";
import type { FaturaItem } from "../ingest/interFatura.ts";
import { insertOpenFatura, pruneEmptyOpenInvoices } from "./faturaImport.ts";
import { reconcileOpenInvoices } from "./reconcile.ts";

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  runMigrations(db);
  seedAccounts(db);
  return db;
}

function item(date: string, description: string, cents: number, extra: Partial<FaturaItem> = {}): FaturaItem {
  return { date, description, bankCategory: "Lazer", amountCents: cents, ...extra };
}

function consumptionCount(db: DatabaseSync): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM transactions
    WHERE flow='expense' AND method != 'transfer' AND is_settlement=0
      AND is_third_party=0 AND dest_account_id IS NULL`).get() as { n: number }).n;
}

test("insertOpenFatura: cria fatura aberta + itens como credit no inter-cc", () => {
  const db = freshDb();
  const res = insertOpenFatura(db, {
    refMonth: "2026-06",
    dueDate: "2026-07-15",
    items: [item("2026-06-01", "Steam", 3100), item("2026-06-03", "Mercado", 8000)],
    sourceFile: "fatura-inter-2026-06.csv",
    importBatchId: "sess-1",
  });

  assert.equal(res.inserted, 2);
  assert.equal(res.totalCents, 11100);

  const inv = db.prepare("SELECT account_id, payment_tx_id, due_date, total_cents FROM invoices WHERE id=?")
    .get(res.invoiceId) as { account_id: string; payment_tx_id: number | null; due_date: string; total_cents: number };
  assert.equal(inv.account_id, "inter-cc");
  assert.equal(inv.payment_tx_id, null);
  assert.equal(inv.due_date, "2026-07-15");
  assert.equal(inv.total_cents, 11100);

  const rows = db.prepare("SELECT flow, method, account_id, amount_cents, is_revenue, invoice_id, import_batch_id FROM transactions ORDER BY amount_cents").all() as any[];
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.method, "credit");
    assert.equal(r.account_id, "inter-cc");
    assert.equal(r.flow, "expense");
    assert.equal(r.is_revenue, 0);
    assert.equal(r.invoice_id, res.invoiceId);
    assert.equal(r.import_batch_id, "sess-1");
  }

  assert.equal(consumptionCount(db), 2);
});

test("insertOpenFatura: estorno (valor negativo) → income, is_revenue=0, não verde", () => {
  const db = freshDb();
  const res = insertOpenFatura(db, {
    refMonth: "2026-06", dueDate: null,
    items: [item("2026-06-01", "Compra", 5000), item("2026-06-05", "Estorno", -2000)],
    sourceFile: "f.csv", importBatchId: "sess-1",
  });
  assert.equal(res.totalCents, 3000);
  const est = db.prepare("SELECT flow, is_revenue FROM transactions WHERE description='Estorno'").get() as { flow: string; is_revenue: number };
  assert.equal(est.flow, "income");
  assert.equal(est.is_revenue, 0);
  assert.equal(consumptionCount(db), 1);
});

test("insertOpenFatura: reimport da mesma fatura → upsert, dedup por contagem", () => {
  const db = freshDb();
  const p = {
    refMonth: "2026-06", dueDate: "2026-07-15",
    items: [item("2026-06-01", "Steam", 3100), item("2026-06-03", "Mercado", 8000)],
    sourceFile: "f.csv", importBatchId: "sess-1",
  };
  const first = insertOpenFatura(db, p);
  const second = insertOpenFatura(db, { ...p, importBatchId: "sess-2" });

  assert.equal(second.invoiceId, first.invoiceId);
  assert.equal(second.inserted, 0);
  assert.equal(second.duplicate, 2);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM transactions").get() as { n: number }).n, 2);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM invoices").get() as { n: number }).n, 1);
});

test("insertOpenFatura: fatura que cresceu → insere só o item novo", () => {
  const db = freshDb();
  const base = {
    refMonth: "2026-06", dueDate: "2026-07-15",
    sourceFile: "f.csv", importBatchId: "sess-1",
  };
  insertOpenFatura(db, { ...base, items: [item("2026-06-01", "Steam", 3100)] });
  const grown = insertOpenFatura(db, {
    ...base, importBatchId: "sess-2",
    items: [item("2026-06-01", "Steam", 3100), item("2026-06-10", "Novo", 4200)],
  });
  assert.equal(grown.inserted, 1);
  assert.equal(grown.duplicate, 1);
  assert.equal(grown.totalCents, 7300);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM transactions").get() as { n: number }).n, 2);
});

test("pruneEmptyOpenInvoices: apaga fatura aberta que ficou sem itens (H4)", () => {
  const db = freshDb();
  const res = insertOpenFatura(db, {
    refMonth: "2026-06", dueDate: null,
    items: [item("2026-06-01", "X", 1000)], sourceFile: "f.csv", importBatchId: "sess-1",
  });

  db.prepare("DELETE FROM transactions WHERE import_batch_id = 'sess-1'").run();
  const pruned = pruneEmptyOpenInvoices(db, [res.invoiceId]);
  assert.equal(pruned, 1);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM invoices WHERE id=?").get(res.invoiceId) as { n: number }).n, 0);
});

test("pruneEmptyOpenInvoices: NÃO apaga fatura paga nem fatura com itens", () => {
  const db = freshDb();
  const paid = insertOpenFatura(db, {
    refMonth: "2026-05", dueDate: null, items: [item("2026-05-01", "A", 500)],
    sourceFile: "f.csv", importBatchId: "s1",
  });
  db.prepare("UPDATE invoices SET payment_tx_id = 1 WHERE id = ?").run(paid.invoiceId);
  const withItems = insertOpenFatura(db, {
    refMonth: "2026-06", dueDate: null, items: [item("2026-06-01", "B", 500)],
    sourceFile: "f.csv", importBatchId: "s2",
  });
  const pruned = pruneEmptyOpenInvoices(db, [paid.invoiceId, withItems.invoiceId]);
  assert.equal(pruned, 0);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM invoices").get() as { n: number }).n, 2);
});

test("INTEGRAÇÃO (C1+H2): fatura aberta + pagamento no extrato → sem double-count", () => {
  const db = freshDb();

  const fat = insertOpenFatura(db, {
    refMonth: "2026-05", dueDate: "2026-06-10",
    items: [item("2026-05-01", "Steam", 3100), item("2026-05-03", "Mercado", 8000)],
    sourceFile: "fatura-inter-2026-05.csv", importBatchId: "fat-1",
  });

  db.prepare(`INSERT INTO transactions
    (date, flow, method, account_id, amount_cents, description, import_batch_id)
    VALUES ('2026-05-12','expense','pix','inter-db', 11100, 'Pagamento de fatura', 'ext-1')`).run();

  assert.equal(consumptionCount(db), 3);

  const n = reconcileOpenInvoices(db);
  assert.equal(n, 1);

  const inv = db.prepare("SELECT payment_tx_id FROM invoices WHERE id=?").get(fat.invoiceId) as { payment_tx_id: number | null };
  assert.notEqual(inv.payment_tx_id, null);
  assert.equal(consumptionCount(db), 2);
});

test("insertOpenFatura: recusa reabrir fatura já paga", () => {
  const db = freshDb();
  const res = insertOpenFatura(db, {
    refMonth: "2026-06", dueDate: null,
    items: [item("2026-06-01", "X", 1000)], sourceFile: "f.csv", importBatchId: "sess-1",
  });

  db.prepare("UPDATE invoices SET payment_tx_id = 999 WHERE id = ?").run(res.invoiceId);
  assert.throws(
    () => insertOpenFatura(db, {
      refMonth: "2026-06", dueDate: null,
      items: [item("2026-06-01", "X", 1000)], sourceFile: "f.csv", importBatchId: "sess-2",
    }),
    /paga|reconcili/i,
  );
});
