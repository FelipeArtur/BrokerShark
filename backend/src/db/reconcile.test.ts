import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initSchema } from "./open.ts";
import { seedAccounts } from "../jobs/backfill/seeds.ts";
import { reconcileInvoicePayment, reconcileOpenInvoices } from "./reconcile.ts";

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  seedAccounts(db);
  return db;
}

function openInvoice(db: DatabaseSync, refMonth: string, totalCents: number): number {
  return Number(
    db.prepare(
      "INSERT INTO invoices (account_id, ref_month, total_cents, source_file) VALUES ('inter-cc', ?, ?, 'ui')",
    ).run(refMonth, totalCents).lastInsertRowid,
  );
}

function paymentLeg(db: DatabaseSync, date: string, amountCents: number): number {
  return Number(
    db.prepare(`INSERT INTO transactions
      (date, flow, method, account_id, amount_cents, description, import_batch_id)
      VALUES (?, 'expense', 'pix', 'inter-db', ?, 'Pagamento de fatura', 'sess-1')`)
      .run(date, amountCents).lastInsertRowid,
  );
}

function consumptionCount(db: DatabaseSync): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM transactions
    WHERE flow='expense' AND method != 'transfer' AND is_settlement=0
      AND is_third_party=0 AND dest_account_id IS NULL`).get() as { n: number }).n;
}

test("reconcileInvoicePayment: pagamento exato vira liquidação e NÃO double-conta", () => {
  const db = freshDb();
  const invId = openInvoice(db, "2026-05", 183062);
  const payId = paymentLeg(db, "2026-05-10", 183062);

  assert.equal(consumptionCount(db), 1);

  const res = reconcileInvoicePayment(db, { invoiceId: invId, refMonth: "2026-05", totalCents: 183062 });

  assert.equal(res.matched, true);
  assert.equal(res.payment?.id, payId);

  const tx = db.prepare("SELECT is_settlement, invoice_id, method FROM transactions WHERE id=?").get(payId) as
    { is_settlement: number; invoice_id: number; method: string };
  assert.equal(tx.is_settlement, 1);
  assert.equal(tx.invoice_id, invId);
  assert.equal(tx.method, "credit");

  const inv = db.prepare("SELECT payment_tx_id FROM invoices WHERE id=?").get(invId) as { payment_tx_id: number };
  assert.equal(inv.payment_tx_id, payId);

  assert.equal(consumptionCount(db), 0);
});

test("reconcileInvoicePayment: sem pagamento de valor exato → não casa, nada muda", () => {
  const db = freshDb();
  const invId = openInvoice(db, "2026-05", 183062);
  paymentLeg(db, "2026-05-10", 180000);

  const res = reconcileInvoicePayment(db, { invoiceId: invId, refMonth: "2026-05", totalCents: 183062 });

  assert.equal(res.matched, false);
  const inv = db.prepare("SELECT payment_tx_id FROM invoices WHERE id=?").get(invId) as { payment_tx_id: number | null };
  assert.equal(inv.payment_tx_id, null);
  assert.equal(consumptionCount(db), 1);
});

test("reconcileInvoicePayment: pagamento fora da janela −70/+35d não casa", () => {
  const db = freshDb();
  const invId = openInvoice(db, "2026-05", 183062);
  paymentLeg(db, "2026-08-01", 183062);

  const res = reconcileInvoicePayment(db, { invoiceId: invId, refMonth: "2026-05", totalCents: 183062 });
  assert.equal(res.matched, false);
});

test("reconcileInvoicePayment: perna já casada (invoice_id set) não é re-casada", () => {
  const db = freshDb();
  const invA = openInvoice(db, "2026-05", 183062);
  const invB = openInvoice(db, "2026-06", 183062);
  paymentLeg(db, "2026-05-10", 183062);
  const first = reconcileInvoicePayment(db, { invoiceId: invA, refMonth: "2026-05", totalCents: 183062 });
  assert.equal(first.matched, true);

  const res = reconcileInvoicePayment(db, { invoiceId: invB, refMonth: "2026-06", totalCents: 183062 });
  assert.equal(res.matched, false);
});

test("reconcileOpenInvoices: casa todas as faturas abertas com pernas exatas", () => {
  const db = freshDb();
  const invA = openInvoice(db, "2026-04", 163915);
  const invB = openInvoice(db, "2026-05", 183062);
  paymentLeg(db, "2026-04-08", 163915);
  paymentLeg(db, "2026-05-10", 183062);

  const n = reconcileOpenInvoices(db);
  assert.equal(n, 2);

  for (const id of [invA, invB]) {
    const inv = db.prepare("SELECT payment_tx_id FROM invoices WHERE id=?").get(id) as { payment_tx_id: number | null };
    assert.notEqual(inv.payment_tx_id, null);
  }
  assert.equal(consumptionCount(db), 0);
});

test("reconcileOpenInvoices: sem faturas abertas → no-op (0)", () => {
  const db = freshDb();
  paymentLeg(db, "2026-05-10", 183062);
  assert.equal(reconcileOpenInvoices(db), 0);
  assert.equal(consumptionCount(db), 1);
});
