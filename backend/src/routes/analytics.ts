import type { DatabaseSync } from "node:sqlite";
import type { Req, Res } from "../http/respond.ts";
import { json, qsStr, qsInt } from "../http/respond.ts";
import type { Route } from "../http/router.ts";
import { compilePath } from "../http/router.ts";
import { currentMonth, monthRange } from "../domain/dates.ts";
import { consumptionExpense, realIncome } from "../db/ledgerSql.ts";

const FLOW_SUMS = `
  COALESCE(SUM(CASE
    WHEN ${realIncome("t")}
    THEN t.amount_cents ELSE 0 END), 0) AS income_cents,
  COALESCE(SUM(CASE
    WHEN ${consumptionExpense("t")}
    THEN t.amount_cents ELSE 0 END), 0) AS expense_cents,
  COALESCE(SUM(CASE
    WHEN t.flow='expense' AND t.method='transfer'
      AND t.dest_account_id IS NULL AND t.is_settlement=0
    THEN t.amount_cents ELSE 0 END), 0) AS invest_out_cents,
  COALESCE(SUM(CASE
    WHEN t.flow='income' AND t.is_revenue=0 AND t.method='transfer'
    THEN t.amount_cents ELSE 0 END), 0) AS invest_in_cents
`;

export function analyticsRoutes(db: DatabaseSync): Route[] {

  function getMonthly(req: Req, res: Res) {
    const bank = qsStr(req, "bank");
    const account = qsStr(req, "account");
    const present = qsStr(req, "present");

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (bank) { conditions.push("a.bank = ?"); params.push(bank); }
    if (account) { conditions.push("t.account_id = ?"); params.push(account); }
    if (present !== "1") {
      const { month: cm, year: cy } = currentMonth();
      conditions.push("strftime('%Y-%m', t.date) < ?");
      params.push(`${cy}-${String(cm).padStart(2, "0")}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = db.prepare(`
      SELECT
        strftime('%Y', t.date) AS year,
        CAST(strftime('%m', t.date) AS INTEGER) AS month,
        ${FLOW_SUMS}
      FROM transactions t
      LEFT JOIN accounts a ON a.id = t.account_id
      ${where}
      GROUP BY year, month
      ORDER BY year, month
    `).all(...params) as any[];

    json(res, rows.map(r => ({
      label: `${String(r.month).padStart(2, "0")}/${r.year}`,
      month: r.month,
      year: Number(r.year),
      income: r.income_cents / 100,
      expenses: r.expense_cents / 100,
    })));
  }

  function getCashflowStatement(req: Req, res: Res) {
    const { month: cm, year: cy } = currentMonth();
    const month = qsInt(req, "month") ?? cm;
    const year = qsInt(req, "year") ?? cy;
    const { start, end } = monthRange(month, year);

    const row = db.prepare(`
      SELECT ${FLOW_SUMS} FROM transactions t WHERE t.date >= ? AND t.date <= ?
    `).get(start, end) as any;

    json(res, {
      month, year,
      income_total: row.income_cents / 100,
      expense_total: row.expense_cents / 100,
      investment_net: (row.invest_out_cents - row.invest_in_cents) / 100,
    });
  }

  function getUncategorizedMerchants(req: Req, res: Res) {
    const { month: cm, year: cy } = currentMonth();
    const month = qsInt(req, "month") ?? cm;
    const year = qsInt(req, "year") ?? cy;
    const { start, end } = monthRange(month, year);

    const rows = db.prepare(`
      SELECT
        COALESCE(t.display_name, t.description) AS merchant_key,
        t.flow,
        COUNT(*) AS count,
        SUM(t.amount_cents) AS total_cents,
        MIN(t.description) AS sample_description,
        GROUP_CONCAT(t.id) AS ids
      FROM transactions t
      WHERE t.category_id IS NULL
        AND t.date >= ? AND t.date <= ?
        AND ((${consumptionExpense("t")}) OR (${realIncome("t")}))
      GROUP BY merchant_key, t.flow
      ORDER BY total_cents DESC
    `).all(start, end) as any[];

    const rules = db.prepare(
      "SELECT matcher, value FROM rules WHERE action='category' AND enabled=1 ORDER BY priority ASC, id ASC"
    ).all() as any[];
    const catName = new Map<number, string>(
      (db.prepare("SELECT id, name FROM categories").all() as any[]).map(c => [c.id, c.name]),
    );

    json(res, rows.map(r => {
      const hay = String(r.merchant_key ?? "").toLowerCase();
      const rule = rules.find(x => hay.includes(String(x.matcher).toLowerCase()));
      const sugId = rule ? Number(rule.value) : null;
      return {
        merchant_key: r.merchant_key,
        flow: r.flow,
        count: r.count,
        total: r.total_cents / 100,
        sample_description: r.sample_description,
        ids: String(r.ids).split(",").map(Number),
        suggested_category_id: sugId,
        suggested_category_name: sugId != null ? catName.get(sugId) ?? null : null,
      };
    }));
  }

  const cp = compilePath;
  return [
    { method: "GET", ...cp("/api/monthly"), handler: getMonthly },
    { method: "GET", ...cp("/api/cashflow-statement"), handler: getCashflowStatement },
    { method: "GET", ...cp("/api/uncategorized-merchants"), handler: getUncategorizedMerchants },
  ];
}
