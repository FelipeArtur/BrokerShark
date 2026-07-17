/**
 * @file accounts.ts
 * @brief Rotas de contas, disponível pra gastar e histórico de patrimônio.
 *
 * accounts.ts — rotas de contas e patrimônio.
 *
 * FRONTEIRA DE UNIDADE: o ledger guarda centavos inteiros, mas o contrato da API
 * (herdado do v1) devolve REAIS. Toda divisão por 100 aqui é essa conversão, feita
 * só na serialização — a aritmética acontece em centavos.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Req, Res } from "../http/respond.ts";
import { json, qsStr } from "../http/respond.ts";
import type { Route } from "../http/router.ts";
import { compilePath } from "../http/router.ts";
import { monthlyPortfolioSeries } from "../domain/positions.ts";

/**
 * @brief Montar as rotas de contas e patrimônio ligadas a esta conexão.
 * @param db conexão do DB
 * @return rotas GET /api/accounts, /api/available e /api/liquidity-history
 */
export function accountRoutes(db: DatabaseSync): Route[] {
  // ── GET /api/accounts ──────────────────────────────────────────────────
  /**
   * @brief Listar as contas com o saldo calculado de cada uma.
   *
   * Saldo = inicial + receitas − despesas, sobre o ledger inteiro da conta.
   *
   * @param req requisição; query `bank` filtra por banco (opcional)
   * @param res resposta; `balance` vai em REAIS (contrato da API)
   */
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

  // ── GET /api/available ─────────────────────────────────────────────────
  /**
   * @brief Calcular o "disponível pra gastar" — o KPI herói do dashboard.
   *
   * Só contas `checking`: cartão de crédito não é dinheiro disponível, e
   * investimento não é caixa. Soma em centavos inteiros, converte na saída.
   *
   * @param _req requisição (ignorada)
   * @param res resposta; `available` e `checking_total` em REAIS
   */
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

  // ── GET /api/liquidity-history ─────────────────────────────────────────
  // Patrimônio mensal = caixa acumulado (checking) + carteira de investimentos.
  /**
   * @brief Série mensal do patrimônio total (caixa acumulado + carteira).
   *
   * O caixa parte da Σ dos saldos iniciais e acumula mês a mês; a carteira vem de
   * monthlyPortfolioSeries (carry-forward). Meses depois do último snapshot herdam
   * o último total conhecido — a posição não some só porque o relatório acabou.
   *
   * @param _req requisição (ignorada)
   * @param res resposta; lista `{ label: "MM/YYYY", value }` com `value` em REAIS
   */
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
    { method: "GET", ...cp("/api/available"), handler: getAvailable },
    { method: "GET", ...cp("/api/liquidity-history"), handler: getLiquidityHistory },
  ];
}
