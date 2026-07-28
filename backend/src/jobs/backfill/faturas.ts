import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fmtCents } from "../../domain/money.ts";
import { parseInvoiceItemized } from "../../ingest/invoiceItemized.ts";
import { reconcileInvoicePayment } from "../../db/reconcile.ts";
import type { TxInserter } from "./txInsert.ts";
import { primaryCard } from "../../config.ts";

export function importFaturas(db: DatabaseSync, ins: TxInserter, files: string[]): string[] {
  const card = primaryCard();
  if (!card) return ["  (nenhum cartão configurado — faturas ignoradas)"];
  const report: string[] = [];
  const insInvoice = db.prepare(
    "INSERT INTO invoices (account_id, ref_month, total_cents, source_file) VALUES (?,?,?,?)",
  );

  for (const f of files) {
    const fat = parseInvoiceItemized(readFileSync(f, "utf-8"), basename(f));
    const invId = Number(insInvoice.run(card.card.id, fat.refMonth, fat.totalCents, basename(f)).lastInsertRowid);
    for (const it of fat.items) {
      ins.stmt.run(
        it.date,
        it.amountCents >= 0 ? "expense" : "income",
        "credit", card.card.id, Math.abs(it.amountCents), it.description,
        0, null, invId, it.installmentSeq ?? null, it.installmentTotal ?? null,
        it.bankCategory || null, basename(f),
      );
    }

    const { payment: pay } = reconcileInvoicePayment(db, {
      invoiceId: invId, refMonth: fat.refMonth, totalCents: fat.totalCents,
    });
    report.push(
      `  ${fat.refMonth}: ${fat.items.length} itens = ${fmtCents(fat.totalCents)}` +
      (fat.skipped.length ? ` (${fat.skipped.length} espelho(s) de pagamento ignorado(s))` : "") +
      "; " +
      (pay
        ? `pagamento casado ${pay.date} ${fmtCents(pay.amountCents)} ✓ EXATO`
        : "⚠ sem pagamento de valor exato — itens entram, pagamento (se houver) fica stand-in"),
    );
  }

  const cover = db.prepare(
    "SELECT MIN(ref_month) AS lo, MAX(ref_month) AS hi FROM invoices WHERE account_id = ?",
  ).get(card.card.id) as { lo: string | null; hi: string | null };
  const strayPays = db.prepare(`
    SELECT id, date, amount_cents, description FROM transactions
    WHERE account_id = ? AND flow='expense'
      AND lower(description) LIKE '%fatura%' AND invoice_id IS NULL ORDER BY date
  `).all(card.paidFrom.id) as { id: number; date: string; amount_cents: number; description: string }[];
  for (const s of strayPays) {
    const inCoverage = cover.lo !== null && s.date >= `${cover.lo}-01` && s.date <= `${cover.hi}-31`;
    if (inCoverage) {
      const inv = db.prepare(`
        SELECT id, ref_month FROM invoices WHERE account_id = ?
        ORDER BY ABS(julianday(ref_month || '-01') - julianday(?)) LIMIT 1
      `).get(card.card.id, s.date) as { id: number; ref_month: string };
      db.prepare("UPDATE transactions SET is_settlement = 1, invoice_id = ?, method = 'credit' WHERE id = ?")
        .run(inv.id, s.id);
      report.push(
        `  liquidação parcial → fatura ${inv.ref_month}: ${s.date} ${fmtCents(s.amount_cents)} ("${s.description.slice(0, 44)}")`,
      );
    } else {
      report.push(`  stand-in (fora da cobertura): ${s.date} ${fmtCents(s.amount_cents)} ("${s.description.slice(0, 44)}")`);
    }
  }
  return report;
}
