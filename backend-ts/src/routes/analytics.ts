/** analytics.ts — rotas analíticas (summary, monthly, daily-spend, cashflow, etc.). */
import type { DatabaseSync } from "node:sqlite";
import type { Req, Res, Route } from "./helpers.ts";
import { json, error, qs, qsStr, qsInt, compilePath, currentMonth, monthRange } from "./helpers.ts";

export function analyticsRoutes(db: DatabaseSync): Route[] {

  // ── GET /api/summary ───────────────────────────────────────────────────
  function getSummary(req: Req, res: Res) {
    const bank = qsStr(req, "bank");
    const period = qsStr(req, "period");
    const { month: cm, year: cy } = currentMonth();
    const month = qsInt(req, "month") ?? cm;
    const year = qsInt(req, "year") ?? cy;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (bank) { conditions.push("a.bank = ?"); params.push(bank); }

    if (period && period !== "all") {
      const months = parseInt(period);
      if (months > 0) {
        const d = new Date();
        d.setMonth(d.getMonth() - months);
        conditions.push("t.date >= ?");
        params.push(d.toISOString().slice(0, 10));
      }
    } else {
      const { start, end } = monthRange(month, year);
      conditions.push("t.date >= ? AND t.date <= ?");
      params.push(start, end);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const row = db.prepare(`
      SELECT
        COALESCE(SUM(CASE
          WHEN t.flow='income' AND t.is_revenue=1
          THEN t.amount_cents ELSE 0 END), 0) AS income_cents,
        COALESCE(SUM(CASE
          WHEN t.flow='expense' AND t.method != 'transfer'
            AND t.is_settlement=0 AND t.is_third_party=0
            AND t.dest_account_id IS NULL
          THEN t.amount_cents ELSE 0 END), 0) AS expense_cents,
        COALESCE(SUM(CASE
          WHEN t.flow='expense' AND t.method='transfer'
            AND t.dest_account_id IS NULL AND t.is_settlement=0
          THEN t.amount_cents ELSE 0 END), 0) AS invest_out_cents,
        COALESCE(SUM(CASE
          WHEN t.flow='income' AND t.is_revenue=0 AND t.method='transfer'
          THEN t.amount_cents ELSE 0 END), 0) AS invest_in_cents,
        COUNT(t.id) AS transaction_count
      FROM transactions t
      LEFT JOIN accounts a ON a.id = t.account_id
      ${where}
    `).get(...params) as any;

    json(res, {
      income: row.income_cents / 100,
      expenses: row.expense_cents / 100,
      investment_net: (row.invest_out_cents - row.invest_in_cents) / 100,
      transaction_count: row.transaction_count,
    });
  }

  // ── GET /api/monthly ───────────────────────────────────────────────────
  function getMonthly(req: Req, res: Res) {
    const bank = qsStr(req, "bank");
    const account = qsStr(req, "account");
    const present = qsStr(req, "present");

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (bank) { conditions.push("a.bank = ?"); params.push(bank); }
    if (account) { conditions.push("t.account_id = ?"); params.push(account); }

    // Excluir mês corrente se present != 1
    if (present !== "1") {
      const { month: cm, year: cy } = currentMonth();
      const currentYm = `${cy}-${String(cm).padStart(2, "0")}`;
      conditions.push("strftime('%Y-%m', t.date) < ?");
      params.push(currentYm);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = db.prepare(`
      SELECT
        strftime('%Y', t.date) AS year,
        CAST(strftime('%m', t.date) AS INTEGER) AS month,
        SUM(CASE
          WHEN t.flow='income' AND t.is_revenue=1
          THEN t.amount_cents ELSE 0 END) AS income_cents,
        SUM(CASE
          WHEN t.flow='expense' AND t.method != 'transfer'
            AND t.is_settlement=0 AND t.is_third_party=0
            AND t.dest_account_id IS NULL
          THEN t.amount_cents ELSE 0 END) AS expense_cents
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

  // ── GET /api/daily-spend ───────────────────────────────────────────────
  function getDailySpend(req: Req, res: Res) {
    const { month: cm, year: cy } = currentMonth();
    const month = qsInt(req, "month") ?? cm;
    const year = qsInt(req, "year") ?? cy;
    const { start, end } = monthRange(month, year);

    const rows = db.prepare(`
      SELECT CAST(strftime('%d', date) AS INTEGER) AS day,
        SUM(amount_cents) AS total_cents
      FROM transactions
      WHERE date >= ? AND date <= ?
        AND flow = 'expense'
        AND method != 'transfer'
        AND is_settlement = 0
        AND is_third_party = 0
        AND dest_account_id IS NULL
      GROUP BY day
      ORDER BY day
    `).all(start, end) as any[];

    json(res, rows.map(r => ({ day: r.day, amount: r.total_cents / 100 })));
  }

  // ── GET /api/pix-top ──────────────────────────────────────────────────
  // counterpart só é gravado no pareamento SELF; a contraparte de um pix comum
  // vive na description — extraída aqui (prefixos Nubank/Inter + cauda CPF/CNPJ).
  function pixCounterpart(desc: string): string {
    return String(desc ?? "")
      .replace(/"/g, "")
      .replace(/^transfer[êe]ncia enviada pelo pix\s*[-–]?\s*/i, "")
      .replace(/^pix enviado:?\s*/i, "")
      .replace(/cp\s*:\s*\d+\s*-\s*/i, "")
      .replace(/\s*[-–]\s*(?:•••|\d{3}\.\d{3}\.|\d{2}\.\d{3}\.\d{3}\/).*$/u, "")
      .replace(/\s+Agência:.*$/iu, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function getPixTop(req: Req, res: Res) {
    const { month: cm, year: cy } = currentMonth();
    const month = qsInt(req, "month") ?? cm;
    const year = qsInt(req, "year") ?? cy;
    const { start, end } = monthRange(month, year);

    const rows = db.prepare(`
      SELECT description, counterpart, amount_cents
      FROM transactions
      WHERE date >= ? AND date <= ?
        AND flow = 'expense'
        AND method = 'pix'
        AND (counterpart IS NULL OR counterpart != 'SELF')
        AND is_settlement = 0
        AND is_third_party = 0
    `).all(start, end) as any[];

    const groups = new Map<string, { counterpart: string; total_cents: number; count: number }>();
    for (const r of rows) {
      const name = r.counterpart ?? pixCounterpart(r.description);
      if (!name) continue;
      const key = name.toLowerCase();
      const g = groups.get(key) ?? { counterpart: name, total_cents: 0, count: 0 };
      g.total_cents += r.amount_cents;
      g.count += 1;
      groups.set(key, g);
    }

    json(res, [...groups.values()]
      .sort((a, b) => b.total_cents - a.total_cents)
      .slice(0, 20)
      .map(g => ({ counterpart: g.counterpart, total: g.total_cents / 100, count: g.count })));
  }

  // ── GET /api/expenses-by-method ────────────────────────────────────────
  function getExpensesByMethod(req: Req, res: Res) {
    const bank = qsStr(req, "bank");
    const conditions: string[] = [
      "t.flow = 'expense'",
      "t.method != 'transfer'",
      "t.is_settlement = 0",
      "t.is_third_party = 0",
      "t.dest_account_id IS NULL",
    ];
    const params: unknown[] = [];
    if (bank) { conditions.push("a.bank = ?"); params.push(bank); }
    const where = `WHERE ${conditions.join(" AND ")}`;

    const rows = db.prepare(`
      SELECT t.method, SUM(t.amount_cents) AS total_cents
      FROM transactions t
      LEFT JOIN accounts a ON a.id = t.account_id
      ${where}
      GROUP BY t.method
      ORDER BY total_cents DESC
    `).all(...params) as any[];

    json(res, rows.map(r => ({ method: r.method, total: r.total_cents / 100 })));
  }

  // ── GET /api/uncategorized-merchants ───────────────────────────────────
  function getUncategorizedMerchants(req: Req, res: Res) {
    const { month: cm, year: cy } = currentMonth();
    const month = qsInt(req, "month") ?? cm;
    const year = qsInt(req, "year") ?? cy;
    const { start, end } = monthRange(month, year);

    // Merchants sem categoria, agrupados por (display_name|description, flow).
    // Só linhas categorizáveis: despesa de consumo (regra completa) ou receita real.
    // ids agregados → o painel de lote categoriza todas as ocorrências de uma vez.
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
        AND (
          (t.flow = 'expense' AND t.method != 'transfer' AND t.is_settlement = 0
            AND t.is_third_party = 0 AND t.dest_account_id IS NULL)
          OR (t.flow = 'income' AND t.is_revenue = 1 AND t.is_third_party = 0)
        )
      GROUP BY merchant_key, t.flow
      ORDER BY total_cents DESC
    `).all(start, end) as any[];

    // Tentar sugerir categoria via rules
    const rules = db.prepare(
      "SELECT matcher, value FROM rules WHERE action='category' AND enabled=1 ORDER BY priority"
    ).all() as any[];

    const catMap = new Map<number, string>();
    const cats = db.prepare("SELECT id, name FROM categories").all() as any[];
    for (const c of cats) catMap.set(c.id, c.name);

    json(res, rows.map(r => {
      let sugId: number | null = null;
      let sugName: string | null = null;
      const lower = (r.merchant_key ?? "").toLowerCase();
      for (const rule of rules) {
        if (lower.includes(rule.matcher)) {
          sugId = Number(rule.value);
          sugName = catMap.get(sugId) ?? null;
          break;
        }
      }
      return {
        merchant_key: r.merchant_key,
        flow: r.flow,
        count: r.count,
        total: r.total_cents / 100,
        sample_description: r.sample_description,
        ids: String(r.ids).split(",").map(Number),
        suggested_category_id: sugId,
        suggested_category_name: sugName,
      };
    }));
  }

  // ── GET /api/cashflow-statement ────────────────────────────────────────
  function getCashflowStatement(req: Req, res: Res) {
    const { month: cm, year: cy } = currentMonth();
    const month = qsInt(req, "month") ?? cm;
    const year = qsInt(req, "year") ?? cy;
    const { start, end } = monthRange(month, year);

    const row = db.prepare(`
      SELECT
        COALESCE(SUM(CASE
          WHEN flow='income' AND is_revenue=1
          THEN amount_cents ELSE 0 END), 0) AS income_cents,
        COALESCE(SUM(CASE
          WHEN flow='expense' AND method != 'transfer'
            AND is_settlement=0 AND is_third_party=0
            AND dest_account_id IS NULL
          THEN amount_cents ELSE 0 END), 0) AS expense_cents,
        COALESCE(SUM(CASE
          WHEN flow='expense' AND method='transfer'
            AND dest_account_id IS NULL AND is_settlement=0
          THEN amount_cents ELSE 0 END), 0) AS invest_out_cents,
        COALESCE(SUM(CASE
          WHEN flow='income' AND is_revenue=0 AND method='transfer'
          THEN amount_cents ELSE 0 END), 0) AS invest_in_cents
      FROM transactions
      WHERE date >= ? AND date <= ?
    `).get(start, end) as any;

    json(res, {
      month, year,
      income_total: row.income_cents / 100,
      expense_total: row.expense_cents / 100,
      investment_net: (row.invest_out_cents - row.invest_in_cents) / 100,
    });
  }

  const cp = compilePath;
  return [
    { method: "GET", ...cp("/api/summary"), handler: getSummary },
    { method: "GET", ...cp("/api/monthly"), handler: getMonthly },
    { method: "GET", ...cp("/api/daily-spend"), handler: getDailySpend },
    { method: "GET", ...cp("/api/pix-top"), handler: getPixTop },
    { method: "GET", ...cp("/api/expenses-by-method"), handler: getExpensesByMethod },
    { method: "GET", ...cp("/api/uncategorized-merchants"), handler: getUncategorizedMerchants },
    { method: "GET", ...cp("/api/cashflow-statement"), handler: getCashflowStatement },
  ];
}
