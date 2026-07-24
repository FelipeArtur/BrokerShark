import type { DatabaseSync } from "node:sqlite";

export interface InvoiceToReconcile {
  invoiceId: number;
  refMonth: string;
  totalCents: number;
}

export interface MatchedPayment {
  id: number;
  date: string;
  amountCents: number;
}

export interface ReconcileResult {
  matched: boolean;
  payment?: MatchedPayment;
}

export function reconcileInvoicePayment(db: DatabaseSync, inv: InvoiceToReconcile): ReconcileResult {
  const refStart = `${inv.refMonth}-01`;
  const pay = db.prepare(`
    SELECT id, date, amount_cents FROM transactions
    WHERE account_id = 'inter-db' AND flow = 'expense'
      AND lower(description) LIKE '%fatura%' AND invoice_id IS NULL
      AND amount_cents = ?
      AND julianday(date) BETWEEN julianday(?) - 70 AND julianday(?) + 35
    ORDER BY ABS(julianday(date) - julianday(?)) LIMIT 1
  `).get(inv.totalCents, refStart, refStart, refStart) as
    { id: number; date: string; amount_cents: number } | undefined;

  if (!pay) return { matched: false };

  db.prepare("UPDATE transactions SET is_settlement = 1, invoice_id = ?, method = 'credit' WHERE id = ?")
    .run(inv.invoiceId, pay.id);
  db.prepare("UPDATE invoices SET payment_tx_id = ? WHERE id = ?").run(pay.id, inv.invoiceId);

  return { matched: true, payment: { id: pay.id, date: pay.date, amountCents: pay.amount_cents } };
}

export function reconcileOpenInvoices(db: DatabaseSync): number {
  const open = db.prepare(
    "SELECT id, ref_month, total_cents FROM invoices WHERE account_id = 'inter-cc' AND payment_tx_id IS NULL",
  ).all() as { id: number; ref_month: string; total_cents: number }[];

  let matched = 0;
  for (const inv of open) {
    const r = reconcileInvoicePayment(db, {
      invoiceId: inv.id, refMonth: inv.ref_month, totalCents: inv.total_cents,
    });
    if (r.matched) matched++;
  }
  return matched;
}
