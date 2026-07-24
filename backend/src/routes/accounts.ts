import type { DatabaseSync } from "node:sqlite";
import type { Req, Res } from "../http/respond.ts";
import { json, qsStr } from "../http/respond.ts";
import type { Route } from "../http/router.ts";
import { compilePath } from "../http/router.ts";
import { monthlyPortfolioSeries } from "../domain/positions.ts";
import { currentMonth } from "../domain/dates.ts";

export function accountRoutes(db: DatabaseSync): Route[] {

  function getAccounts(req: Req, res: Res) {
    const bank = qsStr(req, "bank");
    let where = "";
    const params: unknown[] = [];
    if (bank) { where = "WHERE a.bank = ?"; params.push(bank); }

    const rows = db.prepare(`
      SELECT a.id, a.bank, a.type, a.name, a.initial_balance_cents,
        COALESCE(SUM(CASE WHEN t.flow='income'  THEN t.amount_cents ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN t.flow='expense' THEN t.amount_cents ELSE 0 END), 0) AS total_expense
      FROM accounts a
      LEFT JOIN transactions t ON t.account_id = a.id
      ${where}
      GROUP BY a.id
      ORDER BY a.bank, a.type, a.name
    `).all(...params) as any[];

    json(res, rows.map(r => ({
      id: r.id,
      bank: r.bank,
      type: r.type,
      name: r.name,
      balance: (r.initial_balance_cents + r.total_income - r.total_expense) / 100,
    })));
  }

  function getAvailable(_req: Req, res: Res) {
    const rows = db.prepare(`
      SELECT a.id, a.initial_balance_cents,
        COALESCE(SUM(CASE WHEN t.flow='income'  THEN t.amount_cents ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN t.flow='expense' THEN t.amount_cents ELSE 0 END), 0) AS total_expense
      FROM accounts a
      LEFT JOIN transactions t ON t.account_id = a.id
      WHERE a.type = 'checking'
      GROUP BY a.id
    `).all() as any[];

    let totalCents = 0;
    for (const r of rows) {
      totalCents += r.initial_balance_cents + r.total_income - r.total_expense;
    }

    const { month, year } = currentMonth();
    const curYm = `${year}-${String(month).padStart(2, "0")}`;
    const committedCents = (db.prepare(
      `SELECT COALESCE(SUM(total_cents), 0) AS c FROM invoices
       WHERE payment_tx_id IS NULL AND due_date IS NOT NULL
         AND strftime('%Y-%m', due_date) = ?`,
    ).get(curYm) as { c: number }).c;

    json(res, {
      available: totalCents / 100,
      checking_total: totalCents / 100,
      committed_this_month: committedCents / 100,
      available_net: (totalCents - committedCents) / 100,
    });
  }

  function getLiquidityHistory(_req: Req, res: Res) {
    const accs = db.prepare("SELECT id, initial_balance_cents FROM accounts WHERE type='checking'").all() as any[];
    let totalInitial = 0;
    for (const a of accs) totalInitial += a.initial_balance_cents;

    const monthlyChecking = db.prepare(`
      SELECT
        strftime('%Y-%m', t.date) AS ym,
        SUM(CASE WHEN t.flow='income'  THEN t.amount_cents ELSE 0 END) AS income_cents,
        SUM(CASE WHEN t.flow='expense' THEN t.amount_cents ELSE 0 END) AS expense_cents
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE a.type = 'checking'
      GROUP BY ym
      ORDER BY ym
    `).all() as any[];

    const snaps = db.prepare(`
      SELECT investment_id, ym, net_cents FROM (
        SELECT ps.investment_id, strftime('%Y-%m', ps.ref_date) AS ym, ps.net_cents,
          ROW_NUMBER() OVER (
            PARTITION BY ps.investment_id, strftime('%Y-%m', ps.ref_date)
            ORDER BY ps.ref_date DESC, ps.id DESC
          ) AS rn
        FROM position_snapshots ps
      ) WHERE rn = 1 ORDER BY ym
    `).all() as any[];
    const closedYm = new Map<number, string>(
      (db.prepare(
        "SELECT id, strftime('%Y-%m', closed_at) AS ym FROM investments WHERE closed_at IS NOT NULL"
      ).all() as any[]).map(r => [r.id, r.ym]),
    );
    const series = monthlyPortfolioSeries(snaps, closedYm);
    const investMap = new Map(series.map(p => [p.ym, p.total_cents]));
    const lastSnapYm = series.length ? series[series.length - 1].ym : "";
    const lastTotal = series.length ? series[series.length - 1].total_cents : 0;

    let runningChecking = totalInitial;
    const out: { label: string; value: number }[] = [];
    for (const r of monthlyChecking) {
      runningChecking += r.income_cents - r.expense_cents;
      const investCents = investMap.get(r.ym) ?? (r.ym > lastSnapYm ? lastTotal : 0);
      const [y, m] = r.ym.split("-");
      out.push({ label: `${m}/${y}`, value: (runningChecking + investCents) / 100 });
    }
    json(res, out);
  }

  const cp = compilePath;
  return [
    { method: "GET", ...cp("/api/accounts"), handler: getAccounts },
    { method: "GET", ...cp("/api/available"), handler: getAvailable },
    { method: "GET", ...cp("/api/liquidity-history"), handler: getLiquidityHistory },
  ];
}
