/** accounts.ts — rotas de contas e patrimônio. */
import type { DatabaseSync } from "node:sqlite";
import type { Req, Res, Route } from "./helpers.ts";
import { json, error, qs, qsStr, compilePath, broadcast, readBody, currentMonth, monthRange } from "./helpers.ts";
import { monthlyPortfolioSeries } from "../domain/positions.ts";

export function accountRoutes(db: DatabaseSync): Route[] {
  // ── GET /api/accounts ──────────────────────────────────────────────────
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

  // ── GET /api/account/:id ───────────────────────────────────────────────
  function getAccount(req: Req, res: Res) {
    const id = req.params!.id;
    const r = db.prepare(`
      SELECT a.id, a.bank, a.type, a.name, a.initial_balance_cents,
        COALESCE(SUM(CASE WHEN t.flow='income'  THEN t.amount_cents ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN t.flow='expense' THEN t.amount_cents ELSE 0 END), 0) AS total_expense
      FROM accounts a
      LEFT JOIN transactions t ON t.account_id = a.id
      WHERE a.id = ?
      GROUP BY a.id
    `).get(id) as any;
    if (!r) return error(res, "account not found", 404);
    json(res, {
      id: r.id, bank: r.bank, type: r.type, name: r.name,
      balance: (r.initial_balance_cents + r.total_income - r.total_expense) / 100,
    });
  }

  // ── GET /api/available ─────────────────────────────────────────────────
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
    json(res, { available: totalCents / 100, checking_total: totalCents / 100 });
  }

  // ── GET /api/account-history ───────────────────────────────────────────
  function getAccountHistory(req: Req, res: Res) {
    const accountId = qsStr(req, "account");
    if (!accountId) return error(res, "account required");

    const rows = db.prepare(`
      SELECT
        strftime('%Y', date) AS year,
        CAST(strftime('%m', date) AS INTEGER) AS month,
        SUM(CASE WHEN flow='income'  THEN amount_cents ELSE 0 END) AS income_cents,
        SUM(CASE WHEN flow='expense' THEN amount_cents ELSE 0 END) AS expense_cents
      FROM transactions
      WHERE account_id = ?
      GROUP BY year, month
      ORDER BY year, month
    `).all(accountId) as any[];

    // Para calcular saldo acumulado, precisamos do saldo inicial
    const acc = db.prepare("SELECT initial_balance_cents FROM accounts WHERE id = ?").get(accountId) as any;
    const initialCents = acc ? acc.initial_balance_cents : 0;

    let runningCents = initialCents;
    json(res, rows.map(r => {
      runningCents += r.income_cents - r.expense_cents;
      return {
        label: `${String(r.month).padStart(2, "0")}/${r.year}`,
        month: r.month,
        year: Number(r.year),
        income: r.income_cents / 100,
        expenses: r.expense_cents / 100,
        balance: runningCents / 100,
      };
    }));
  }

  // ── GET /api/patrimonio-history ────────────────────────────────────────
  function getPatrimonioHistory(_req: Req, res: Res) {
    // Patrimônio mensal = somatório dos saldos de contas checking ao final de cada mês
    const rows = db.prepare(`
      SELECT
        strftime('%Y', date) AS year,
        CAST(strftime('%m', date) AS INTEGER) AS month,
        a.id AS account_id,
        SUM(CASE WHEN flow='income'  THEN t.amount_cents ELSE 0 END) AS income_cents,
        SUM(CASE WHEN flow='expense' THEN t.amount_cents ELSE 0 END) AS expense_cents
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE a.type = 'checking'
      GROUP BY year, month, a.id
      ORDER BY year, month
    `).all() as any[];

    // Buscar saldos iniciais
    const accs = db.prepare("SELECT id, initial_balance_cents FROM accounts WHERE type='checking'").all() as any[];
    const initialMap = new Map<string, number>();
    for (const a of accs) initialMap.set(a.id, a.initial_balance_cents);

    // Agrupar por mês, acumular saldo
    const runningByAccount = new Map<string, number>();
    for (const [id, cents] of initialMap) runningByAccount.set(id, cents);

    const monthMap = new Map<string, number>();
    const months: string[] = [];
    for (const r of rows) {
      const key = `${String(r.month).padStart(2, "0")}/${r.year}`;
      const prev = runningByAccount.get(r.account_id) ?? (initialMap.get(r.account_id) ?? 0);
      const newBal = prev + r.income_cents - r.expense_cents;
      runningByAccount.set(r.account_id, newBal);

      if (!monthMap.has(key)) {
        months.push(key);
        monthMap.set(key, 0);
      }
    }

    // Recalculate: para cada mês, precisamos do saldo total de TODAS as contas
    // Recomputar com abordagem acumulada
    const runningByAcc2 = new Map<string, number>();
    for (const [id, cents] of initialMap) runningByAcc2.set(id, cents);

    const result: { label: string; value: number }[] = [];
    const seenMonths = new Set<string>();

    // Re-iterar ordenado
    for (const r of rows) {
      const prev = runningByAcc2.get(r.account_id) ?? (initialMap.get(r.account_id) ?? 0);
      runningByAcc2.set(r.account_id, prev + r.income_cents - r.expense_cents);
      const key = `${String(r.month).padStart(2, "0")}/${r.year}`;
      if (!seenMonths.has(key)) {
        seenMonths.add(key);
      }
    }

    // Precisamos da evolução mês a mês — vou usar uma query mais simples
    const monthlyRows = db.prepare(`
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

    let totalInitial = 0;
    for (const [, cents] of initialMap) totalInitial += cents;

    let running = totalInitial;
    const out: { label: string; value: number }[] = [];
    for (const r of monthlyRows) {
      running += r.income_cents - r.expense_cents;
      const [y, m] = r.ym.split("-");
      out.push({ label: `${m}/${y}`, value: running / 100 });
    }
    json(res, out);
  }

  // ── GET /api/liquidity-history ─────────────────────────────────────────
  function getLiquidityHistory(_req: Req, res: Res) {
    // Liquidez = patrimônio checking + investimentos resgatáveis
    // Simplificação v2: checking + último snapshot de investimentos por mês
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

    // Carteira mensal com carry-forward (snapshots são esparsos entre relatórios);
    // meses após o último snapshot herdam o último total conhecido.
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
    { method: "GET", ...cp("/api/account/:id"), handler: getAccount },
    { method: "GET", ...cp("/api/available"), handler: getAvailable },
    { method: "GET", ...cp("/api/account-history"), handler: getAccountHistory },
    { method: "GET", ...cp("/api/patrimonio-history"), handler: getPatrimonioHistory },
    { method: "GET", ...cp("/api/liquidity-history"), handler: getLiquidityHistory },
  ];
}
