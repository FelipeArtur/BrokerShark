import type { DatabaseSync } from "node:sqlite";
import type { InvoiceItem } from "../ingest/invoiceItemized.ts";
import { primaryCard } from "../config.ts";

export interface OpenFaturaParams {
  refMonth: string;
  dueDate: string | null;
  items: InvoiceItem[];
  sourceFile: string;
  importBatchId: string;
  /** Cartão que recebe os itens. Omitido, vale o cartão da config. */
  cardAccountId?: string;
}

export interface OpenFaturaResult {
  invoiceId: number;
  inserted: number;
  duplicate: number;
  totalCents: number;
}

export function insertOpenFatura(db: DatabaseSync, p: OpenFaturaParams): OpenFaturaResult {
  const cardId = p.cardAccountId ?? primaryCard()?.card.id;
  if (!cardId) throw new Error("nenhuma conta de cartão configurada — ver config/");
  const totalCents = p.items.reduce((s, it) => s + it.amountCents, 0);

  const existing = db.prepare(
    "SELECT id, payment_tx_id FROM invoices WHERE account_id = ? AND ref_month = ?",
  ).get(cardId, p.refMonth) as { id: number; payment_tx_id: number | null } | undefined;

  let invoiceId: number;
  if (existing) {
    if (existing.payment_tx_id != null) {
      throw new Error(`fatura ${p.refMonth} já está paga/reconciliada — não dá pra reabrir`);
    }
    invoiceId = existing.id;
    db.prepare("UPDATE invoices SET total_cents = ?, due_date = ?, source_file = ? WHERE id = ?")
      .run(totalCents, p.dueDate, p.sourceFile, invoiceId);
  } else {
    invoiceId = Number(
      db.prepare(
        "INSERT INTO invoices (account_id, ref_month, total_cents, source_file, due_date) VALUES (?, ?, ?, ?, ?)",
      ).run(cardId, p.refMonth, totalCents, p.sourceFile, p.dueDate).lastInsertRowid,
    );
  }

  const countStmt = db.prepare(`
    SELECT COUNT(*) AS n FROM transactions
    WHERE invoice_id = ? AND date = ? AND description = ? AND amount_cents = ? AND flow = ?
      AND IFNULL(installment_seq, -1) = ? AND IFNULL(installment_total, -1) = ?
  `);
  const ins = db.prepare(`
    INSERT INTO transactions
      (date, flow, method, account_id, amount_cents, description, is_revenue,
       invoice_id, installment_seq, installment_total, bank_category, source_file, import_batch_id)
    VALUES (?, ?, 'credit', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
  `);

  const seen = new Map<string, number>();
  let inserted = 0;
  let duplicate = 0;
  for (const it of p.items) {
    const flow = it.amountCents >= 0 ? "expense" : "income";
    const amt = Math.abs(it.amountCents);
    const seq = it.installmentSeq ?? null;
    const tot = it.installmentTotal ?? null;
    const key = `${it.date}|${it.description}|${amt}|${flow}|${seq}|${tot}`;
    if (!seen.has(key)) {
      const n = (countStmt.get(invoiceId, it.date, it.description, amt, flow, seq ?? -1, tot ?? -1) as { n: number }).n;
      seen.set(key, n);
    }
    const remaining = seen.get(key)!;
    if (remaining > 0) { duplicate++; seen.set(key, remaining - 1); continue; }
    ins.run(it.date, flow, cardId, amt, it.description, invoiceId, seq, tot, it.bankCategory || null, p.sourceFile, p.importBatchId);
    inserted++;
  }

  return { invoiceId, inserted, duplicate, totalCents };
}

export function pruneEmptyOpenInvoices(db: DatabaseSync, invoiceIds: number[]): number {
  const del = db.prepare(`
    DELETE FROM invoices
    WHERE id = ? AND payment_tx_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM transactions WHERE invoice_id = invoices.id)
  `);
  let pruned = 0;
  for (const id of new Set(invoiceIds)) {
    if (id == null) continue;
    pruned += del.run(id).changes as number;
  }
  return pruned;
}
