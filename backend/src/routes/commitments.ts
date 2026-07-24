import type { DatabaseSync } from "node:sqlite";
import type { Req, Res } from "../http/respond.ts";
import { json } from "../http/respond.ts";
import type { Route } from "../http/router.ts";
import { compilePath } from "../http/router.ts";
import { currentMonth } from "../domain/dates.ts";
import { addMonths, projectInstallments } from "../domain/commitments.ts";

export function commitmentRoutes(db: DatabaseSync): Route[] {

  function getCommitments(_req: Req, res: Res) {
    const open = db.prepare(
      `SELECT id, ref_month, due_date, account_id, total_cents
       FROM invoices WHERE payment_tx_id IS NULL ORDER BY ref_month`,
    ).all() as any[];

    const openIds = open.map(o => o.id);
    let projRows: any[] = [];
    if (openIds.length) {
      const ph = openIds.map(() => "?").join(",");
      projRows = db.prepare(
        `SELECT i.ref_month AS refMonth, t.amount_cents AS amountCents,
                t.installment_seq AS installmentSeq, t.installment_total AS installmentTotal,
                t.description AS description
         FROM transactions t JOIN invoices i ON i.id = t.invoice_id
         WHERE t.invoice_id IN (${ph})
           AND t.installment_total IS NOT NULL
           AND t.installment_seq IS NOT NULL
           AND t.installment_seq < t.installment_total`,
      ).all(...openIds) as any[];
    }
    const projected = projectInstallments(projRows.map(r => ({
      description: r.description, refMonth: r.refMonth, amountCents: r.amountCents,
      installmentSeq: r.installmentSeq, installmentTotal: r.installmentTotal,
    })));

    const invByMonth = new Map<string, number>();
    for (const o of open) {
      if (!o.due_date) continue;
      const ym = String(o.due_date).slice(0, 7);
      invByMonth.set(ym, (invByMonth.get(ym) ?? 0) + o.total_cents);
    }
    const projByMonth = new Map(projected.map(p => [p.month, p.amountCents]));

    const { month, year } = currentMonth();
    const startYm = `${year}-${String(month).padStart(2, "0")}`;
    const series: any[] = [];
    for (let k = 0; k < 12; k++) {
      const ym = addMonths(startYm, k);
      const invoice = invByMonth.get(ym) ?? 0;
      const proj = projByMonth.get(ym) ?? 0;
      if (invoice === 0 && proj === 0) continue;
      const [y, m] = ym.split("-");
      series.push({
        month: ym, label: `${m}/${y}`,
        invoice: invoice / 100, projected: proj / 100, total: (invoice + proj) / 100,
      });
    }

    json(res, {
      open_invoices: open.map(o => ({
        ref_month: o.ref_month, due_date: o.due_date,
        account_id: o.account_id, total: o.total_cents / 100,
      })),
      series,
    });
  }

  return [{ method: "GET", ...compilePath("/api/commitments"), handler: getCommitments }];
}
