import type { DatabaseSync } from "node:sqlite";
import type { Req, Res } from "../http/respond.ts";
import { json, error, qsStr, readBody } from "../http/respond.ts";
import type { Route } from "../http/router.ts";
import { compilePath } from "../http/router.ts";
import { broadcast } from "../http/sse.ts";
import { isIsoDate, isShortText } from "../http/validate.ts";
import { monthlyPortfolioSeries } from "../domain/positions.ts";
import { monthlyCheckingSeries } from "../domain/accountBalances.ts";
import { currentMonth, today } from "../domain/dates.ts";
import { bankColorFor } from "../config.ts";
import { fmtCents } from "../domain/money.ts";

const ACCOUNT_TYPES = new Set(["checking", "credit_card"]);
// `id` vira parte de URL e de allowlist de import; nada de espaço nem acento.
const ID_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

const BALANCE_SUMS = `
  COALESCE(SUM(CASE WHEN t.flow='income'  THEN t.amount_cents ELSE 0 END), 0) AS total_income,
  COALESCE(SUM(CASE WHEN t.flow='expense' THEN t.amount_cents ELSE 0 END), 0) AS total_expense
`;

/**
 * @brief Contas correntes ABERTAS: o recorte de "quanto eu tenho agora" e a allowlist do import.
 */
export function openCheckingIds(db: DatabaseSync): Set<string> {
  return new Set(
    (db.prepare(
      "SELECT id FROM accounts WHERE type='checking' AND closed_at IS NULL",
    ).all() as { id: string }[]).map(r => r.id),
  );
}

export function accountRoutes(db: DatabaseSync): Route[] {

  const findAccount = (id: unknown) =>
    typeof id === "string"
      ? db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as any
      : undefined;

  const txCount = (id: string): number =>
    (db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE account_id = ?").get(id) as { n: number }).n;

  /**
   * @brief   Dívida em aberto, em texto. `null` quando está quite.
   * @details Cartão: fatura sem pagamento casado. Conta: saldo negativo.
   * @warning Encerrar zera o saldo na posição — com dívida pendurada, o herói sobe sozinho.
   */
  function outstandingDebt(acc: any): string | null {
    if (acc.type === "credit_card") {
      const open = db.prepare(
        `SELECT ref_month, total_cents FROM invoices
         WHERE account_id = ? AND payment_tx_id IS NULL ORDER BY ref_month`,
      ).all(acc.id) as { ref_month: string; total_cents: number }[];
      if (!open.length) return null;
      const list = open.map(i => `${i.ref_month} (${fmtCents(i.total_cents)})`).join(", ");
      return `o cartão tem fatura em aberto: ${list}`;
    }
    const row = db.prepare(
      `SELECT a.initial_balance_cents AS initial, ${BALANCE_SUMS}
       FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
       WHERE a.id = ?`,
    ).get(acc.id) as { initial: number; total_income: number; total_expense: number };
    const cents = row.initial + row.total_income - row.total_expense;
    return cents < 0 ? `a conta está com saldo devedor de ${fmtCents(-cents)}` : null;
  }

  /**
   * @brief   Fatura em aberto por cartão: o que falta pagar e o vencimento mais próximo.
   * @details Viaja junto da conta porque cartão não é conta irmã, é a fatura de uma conta.
   *          Mais de uma fatura aberta soma; a data é a que cobra primeiro.
   */
  function openInvoicesByAccount(): Map<string, { total: number; due_date: string | null }> {
    const rows = db.prepare(
      `SELECT account_id, SUM(total_cents) AS cents, MIN(due_date) AS due
       FROM invoices WHERE payment_tx_id IS NULL GROUP BY account_id`,
    ).all() as { account_id: string; cents: number; due: string | null }[];
    return new Map(rows.map(r => [r.account_id, { total: r.cents / 100, due_date: r.due }]));
  }

  function getAccounts(req: Req, res: Res) {
    const bank = qsStr(req, "bank");
    const withClosed = qsStr(req, "closed") === "1";

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (bank) { conditions.push("a.bank = ?"); params.push(bank); }
    if (!withClosed) conditions.push("a.closed_at IS NULL");
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = db.prepare(`
      SELECT a.id, a.bank, a.type, a.name, a.initial_balance_cents,
             a.opened_at, a.closed_at, ${BALANCE_SUMS}
      FROM accounts a
      LEFT JOIN transactions t ON t.account_id = a.id
      ${where}
      GROUP BY a.id
      ORDER BY a.closed_at IS NOT NULL, a.bank, a.type, a.name
    `).all(...params) as any[];

    const openInvoices = openInvoicesByAccount();

    json(res, rows.map(r => ({
      id: r.id,
      bank: r.bank,
      open_invoice: openInvoices.get(r.id) ?? null,
      bank_color: bankColorFor(r.bank),
      type: r.type,
      name: r.name,
      opened_at: r.opened_at,
      closed_at: r.closed_at,
      //> Conta encerrada vale ZERO, nunca o último saldo do extrato: o dinheiro pode
      //> já não existir (saque em espécie, import parado).
      balance: r.closed_at
        ? 0
        : (r.initial_balance_cents + r.total_income - r.total_expense) / 100,
    })));
  }

  function getAvailable(_req: Req, res: Res) {
    const rows = db.prepare(`
      SELECT a.id, a.initial_balance_cents, ${BALANCE_SUMS}
      FROM accounts a
      LEFT JOIN transactions t ON t.account_id = a.id
      WHERE a.type = 'checking' AND a.closed_at IS NULL
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
    //> Encerradas entram: o histórico é real. Quem corta é `monthlyCheckingSeries`.
    const accs = (db.prepare(`
      SELECT id, initial_balance_cents, strftime('%Y-%m', closed_at) AS closed_ym
      FROM accounts WHERE type='checking'
    `).all() as any[]).map(a => ({
      id: a.id as string,
      initialCents: a.initial_balance_cents as number,
      closedYm: (a.closed_ym as string | null) ?? null,
    }));

    const deltas = (db.prepare(`
      SELECT t.account_id, strftime('%Y-%m', t.date) AS ym,
        SUM(CASE WHEN t.flow='income' THEN t.amount_cents ELSE -t.amount_cents END) AS delta_cents
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE a.type = 'checking'
      GROUP BY t.account_id, ym
      ORDER BY ym
    `).all() as any[]).map(r => ({
      account_id: r.account_id as string,
      ym: r.ym as string,
      deltaCents: r.delta_cents as number,
    }));

    const checking = monthlyCheckingSeries(accs, deltas);

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

    const out = checking.map(p => {
      const investCents = investMap.get(p.ym) ?? (p.ym > lastSnapYm ? lastTotal : 0);
      const [y, m] = p.ym.split("-");
      return { label: `${m}/${y}`, value: (p.total_cents + investCents) / 100 };
    });
    json(res, out);
  }

  async function createAccount(req: Req, res: Res) {
    const body = await readBody<Record<string, unknown>>(req);
    const id = body.id;
    if (typeof id !== "string" || !ID_RE.test(id)) {
      return error(res, "id inválido — use minúsculas, dígitos e hífen (2 a 32 caracteres)");
    }
    if (findAccount(id)) return error(res, "já existe conta com esse id", 409);
    if (!isShortText(body.bank, 40)) return error(res, "bank inválido");
    if (!isShortText(body.name, 60)) return error(res, "name inválido");
    if (typeof body.type !== "string" || !ACCOUNT_TYPES.has(body.type)) {
      return error(res, "type deve ser checking ou credit_card");
    }
    const initial = body.initial_balance_cents ?? 0;
    if (!Number.isInteger(initial) || Math.abs(initial as number) >= 1_000_000_000) {
      return error(res, "initial_balance_cents deve ser inteiro em centavos");
    }
    const openedAt = body.opened_at ?? today();
    if (!isIsoDate(openedAt)) return error(res, "opened_at inválido");

    db.prepare(
      `INSERT INTO accounts (id, bank, type, name, initial_balance_cents, opened_at)
       VALUES (?,?,?,?,?,?)`,
    ).run(id, (body.bank as string).trim(), body.type, (body.name as string).trim(),
          initial as number, openedAt);
    broadcast();
    json(res, { ok: true, id }, 201);
  }

  async function patchAccount(req: Req, res: Res) {
    const acc = findAccount(req.params!.id);
    if (!acc) return error(res, "conta não encontrada", 404);
    const body = await readBody<Record<string, unknown>>(req);

    const updates: string[] = [];
    const params: unknown[] = [];
    if ("name" in body) {
      if (!isShortText(body.name, 60)) return error(res, "name inválido");
      updates.push("name = ?"); params.push((body.name as string).trim());
    }
    if ("closed_at" in body) {
      const v = body.closed_at;
      //> null reabre a conta — encerrar por engano tem que ser reversível.
      if (v !== null && !isIsoDate(v)) return error(res, "closed_at inválido");
      if (v !== null) {
        const last = db.prepare(
          "SELECT MAX(date) AS d FROM transactions WHERE account_id = ?",
        ).get(acc.id) as { d: string | null };
        //> Encerrar antes do último lançamento deixaria movimento datado depois
        //> do fim da conta — a auditoria acusaria na hora, então recusamos aqui.
        if (last.d && last.d > (v as string)) {
          return error(res, `a conta tem lançamento em ${last.d}, posterior ao encerramento`, 409);
        }
        const debt = outstandingDebt(acc);
        if (debt) return error(res, `${debt} — quite a dívida antes de encerrar`, 409);
      }
      updates.push("closed_at = ?"); params.push(v);
    }
    if (!updates.length) return error(res, "nenhum campo para atualizar");

    params.push(acc.id);
    db.prepare(`UPDATE accounts SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    broadcast();
    json(res, { ok: true });
  }

  function deleteAccount(req: Req, res: Res) {
    const acc = findAccount(req.params!.id);
    if (!acc) return error(res, "conta não encontrada", 404);
    const n = txCount(acc.id);
    //> Garantia de que "tirar conta" nunca vira "perder histórico".
    if (n > 0) {
      return error(
        res,
        `a conta tem ${n} lançamento(s) — encerre em vez de apagar, pra não perder o histórico`,
        409,
      );
    }
    db.prepare("DELETE FROM accounts WHERE id = ?").run(acc.id);
    broadcast();
    json(res, { ok: true });
  }

  const cp = compilePath;
  return [
    { method: "GET", ...cp("/api/accounts"), handler: getAccounts },
    { method: "POST", ...cp("/api/accounts"), handler: createAccount },
    { method: "PATCH", ...cp("/api/accounts/:id"), handler: patchAccount },
    { method: "DELETE", ...cp("/api/accounts/:id"), handler: deleteAccount },
    { method: "GET", ...cp("/api/available"), handler: getAvailable },
    { method: "GET", ...cp("/api/liquidity-history"), handler: getLiquidityHistory },
  ];
}
