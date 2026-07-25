import type { DatabaseSync } from "node:sqlite";
import type { Req, Res } from "../http/respond.ts";
import { json } from "../http/respond.ts";
import type { Route } from "../http/router.ts";
import { compilePath } from "../http/router.ts";
import { currentMonth } from "../domain/dates.ts";
import { addMonths, projectInstallments } from "../domain/commitments.ts";
import { normalizeMerchant } from "../domain/merchant.ts";
import { detectRecurrences, projectRecurrences } from "../domain/recurrence.ts";
import type { Recurrence } from "../domain/recurrence.ts";

const HORIZON_MONTHS = 12;
// Nada mais velho que isto pode passar no filtro de staleness — varrer o
// histórico inteiro seria trabalho jogado fora.
const RECURRENCE_LOOKBACK_MONTHS = 18;

// Regras canônicas (CLAUDE.md): consumo-despesa e receita real.
const CONSUMPTION_EXPENSE =
  `flow='expense' AND method != 'transfer' AND is_settlement=0
   AND is_third_party=0 AND dest_account_id IS NULL`;
const REAL_INCOME = `flow='income' AND is_revenue=1 AND is_third_party=0`;

const SQL_RECURRENCE_ROWS = `
  SELECT date, amount_cents AS amountCents, flow, description
  FROM transactions
  WHERE date >= ? AND ((${CONSUMPTION_EXPENSE}) OR (${REAL_INCOME}))
  ORDER BY date`;

const SQL_LAST_LEDGER_MONTH = `SELECT MAX(substr(date, 1, 7)) AS ym FROM transactions`;

// Vencimento de posição aberta: evento de ENTRADA na visão de futuro.
// O valor é o do último snapshot — projetar rendimento até o vencimento seria
// chute, e a regra da casa é que yield se computa, não se estima.
const SQL_MATURITIES = `
  SELECT i.name, i.type, i.bank, i.group_name, i.maturity_date AS maturityDate,
         ps.net_cents AS netCents
  FROM investments i
  LEFT JOIN (
    SELECT ps1.*
    FROM position_snapshots ps1
    INNER JOIN (
      SELECT investment_id, MAX(ref_date) AS max_date
      FROM position_snapshots GROUP BY investment_id
    ) ps2 ON ps1.investment_id = ps2.investment_id AND ps1.ref_date = ps2.max_date
  ) ps ON ps.investment_id = i.id
  WHERE i.closed_at IS NULL AND i.maturity_date IS NOT NULL AND i.maturity_date >= ?
  ORDER BY i.maturity_date`;

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

    const maturities = (db.prepare(SQL_MATURITIES).all(`${startYm}-01`) as any[]).map(m => ({
      name: m.name, type: m.type, bank: m.bank, group_name: m.group_name,
      maturity_date: m.maturityDate, value: (m.netCents ?? 0) / 100,
    }));
    const matByMonth = new Map<string, number>();
    for (const m of maturities) {
      const ym = String(m.maturity_date).slice(0, 7);
      matByMonth.set(ym, (matByMonth.get(ym) ?? 0) + m.value);
    }

    const series: any[] = [];
    for (let k = 0; k < HORIZON_MONTHS; k++) {
      const ym = addMonths(startYm, k);
      const invoice = invByMonth.get(ym) ?? 0;
      const proj = projByMonth.get(ym) ?? 0;
      const maturity = matByMonth.get(ym) ?? 0;
      if (invoice === 0 && proj === 0 && maturity === 0) continue;
      const [y, m] = ym.split("-");
      series.push({
        month: ym, label: `${m}/${y}`,
        invoice: invoice / 100, projected: proj / 100, total: (invoice + proj) / 100,
        maturity,
      });
    }

    json(res, {
      open_invoices: open.map(o => ({
        ref_month: o.ref_month, due_date: o.due_date,
        account_id: o.account_id, total: o.total_cents / 100,
      })),
      series,
      maturities,
      recurring: buildRecurring(startYm),
    });
  }

  // Camada PREVISTA — separada da `series`, que é só compromisso DURO.
  // Detecta contra o último mês COM dados (a mesma convenção do seletor de mês);
  // projeta a partir do mês-calendário corrente, pra alinhar com a série dura e
  // nunca emitir mês passado.
  function buildRecurring(startYm: string) {
    const lastLedgerYm =
      (db.prepare(SQL_LAST_LEDGER_MONTH).get() as any)?.ym as string | null;
    if (!lastLedgerYm) {
      return { items: [], expense_monthly: 0, income_monthly: 0, series: [] };
    }

    const cutoff = `${addMonths(lastLedgerYm, -RECURRENCE_LOOKBACK_MONTHS)}-01`;
    const rows = db.prepare(SQL_RECURRENCE_ROWS).all(cutoff) as any[];

    const recs = detectRecurrences(
      rows.map(r => ({
        date: String(r.date),
        amountCents: r.amountCents,
        flow: r.flow as "expense" | "income",
        merchant: normalizeMerchant(r.description),
      })),
      lastLedgerYm,
    );

    const monthlyTotal = (flow: Recurrence["flow"]) =>
      recs.filter(r => r.flow === flow).reduce((n, r) => n + r.monthlyCents, 0) / 100;

    return {
      items: recs.map(r => ({
        merchant: r.merchant,
        flow: r.flow,
        monthly: r.monthlyCents / 100,
        cadence_months: r.cadenceMonths,
        occurrences: r.occurrences,
        last_month: r.lastMonth,
        stale_months: r.staleMonths,
      })),
      expense_monthly: monthlyTotal("expense"),
      income_monthly: monthlyTotal("income"),
      series: projectRecurrences(recs, startYm, HORIZON_MONTHS).map(m => {
        const [y, mm] = m.month.split("-");
        return {
          month: m.month, label: `${mm}/${y}`,
          expense: m.expenseCents / 100, income: m.incomeCents / 100,
        };
      }),
    };
  }

  return [{ method: "GET", ...compilePath("/api/commitments"), handler: getCommitments }];
}
