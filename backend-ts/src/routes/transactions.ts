/** transactions.ts — rotas de transações (CRUD + busca). */
import type { DatabaseSync } from "node:sqlite";
import type { Req, Res, Route } from "./helpers.ts";
import { json, error, readBody, qs, qsStr, qsInt, compilePath, broadcast, currentMonth, monthRange } from "./helpers.ts";

/** Converte row do DB → objeto JSON do frontend. */
function txToJson(r: any): Record<string, unknown> {
  return {
    id: r.id,
    date: r.date,
    flow: r.flow,
    method: r.method,
    account_id: r.account_id,
    amount: r.amount_cents / 100,
    description: r.description,
    category_id: r.category_id,
    category_name: r.category_name ?? null,
    // alias v1: TxRow/HistoryView leem `t.category`
    category: r.category_name ?? null,
    dest_account_id: r.dest_account_id,
    counterpart: r.counterpart,
    is_revenue: r.is_revenue,
    is_settlement: r.is_settlement,
    is_third_party: r.is_third_party,
    external_id: r.external_id,
    display_name: r.display_name,
    original_amount: r.original_amount_cents != null ? r.original_amount_cents / 100 : null,
    import_batch_id: r.import_batch_id,
    investment_id: r.investment_id,
    invoice_id: r.invoice_id,
    installment_seq: r.installment_seq,
    installment_total: r.installment_total,
    bank_category: r.bank_category,
    self_pair_tx_id: r.self_pair_tx_id,
    source_file: r.source_file,
    // campos opcionais vindos de JOIN
    ...(r.suggested_category_id != null ? { suggested_category_id: r.suggested_category_id } : {}),
    ...(r.suggested_category_name != null ? { suggested_category_name: r.suggested_category_name } : {}),
  };
}

const TX_SELECT = `
  SELECT t.*,
    c.name AS category_name
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
`;

export function transactionRoutes(db: DatabaseSync): Route[] {
  // ── GET /api/transactions ──────────────────────────────────────────────
  function getTransactions(req: Req, res: Res) {
    const accountId = qsStr(req, "account");
    const limit = qsInt(req, "limit") ?? 200;
    const month = qsInt(req, "month");
    const year = qsInt(req, "year");

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (accountId) { conditions.push("t.account_id = ?"); params.push(accountId); }
    if (month && year) {
      const { start, end } = monthRange(month, year);
      conditions.push("t.date >= ? AND t.date <= ?");
      params.push(start, end);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = db.prepare(`${TX_SELECT} ${where} ORDER BY t.date DESC, t.id DESC LIMIT ?`).all(...params, limit) as any[];
    json(res, rows.map(txToJson));
  }

  // ── GET /api/month-transactions ────────────────────────────────────────
  function getMonthTransactions(req: Req, res: Res) {
    const { month: cm, year: cy } = currentMonth();
    const month = qsInt(req, "month") ?? cm;
    const year = qsInt(req, "year") ?? cy;
    const { start, end } = monthRange(month, year);

    // Inclui suggested_category baseado em rules
    const rows = db.prepare(`
      SELECT t.*, c.name AS category_name,
        r_cat.value AS suggested_category_id
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN (
        SELECT matcher, value FROM rules
        WHERE action = 'category' AND enabled = 1
        ORDER BY priority ASC
      ) r_cat ON LOWER(t.description) LIKE '%' || r_cat.matcher || '%'
      WHERE t.date >= ? AND t.date <= ?
      GROUP BY t.id
      ORDER BY t.date DESC, t.id DESC
    `).all(start, end) as any[];

    // Resolver nomes de categorias sugeridas
    const catMap = new Map<number, string>();
    const cats = db.prepare("SELECT id, name FROM categories").all() as any[];
    for (const c of cats) catMap.set(c.id, c.name);

    json(res, rows.map(r => {
      const obj = txToJson(r);
      if (r.suggested_category_id != null && r.category_id == null) {
        const sugId = Number(r.suggested_category_id);
        obj.suggested_category_id = sugId;
        obj.suggested_category_name = catMap.get(sugId) ?? null;
      }
      return obj;
    }));
  }

  // ── GET /api/recent-activity ───────────────────────────────────────────
  function getRecentActivity(req: Req, res: Res) {
    const { month, year } = currentMonth();
    const { start, end } = monthRange(month, year);
    const rows = db.prepare(`${TX_SELECT} WHERE t.date >= ? AND t.date <= ? ORDER BY t.date DESC, t.id DESC`).all(start, end) as any[];
    json(res, rows.map(txToJson));
  }

  // ── GET /api/search ────────────────────────────────────────────────────
  function searchTransactions(req: Req, res: Res) {
    const q = qsStr(req, "q");
    if (!q) return json(res, []);
    const like = `%${q}%`;
    const rows = db.prepare(`
      ${TX_SELECT}
      WHERE t.description LIKE ? OR t.display_name LIKE ? OR c.name LIKE ?
      ORDER BY t.date DESC, t.id DESC
      LIMIT 200
    `).all(like, like, like) as any[];
    json(res, rows.map(txToJson));
  }

  // ── PATCH /api/transactions/:id ────────────────────────────────────────
  async function patchTransaction(req: Req, res: Res) {
    const id = Number(req.params!.id);
    const body = await readBody(req);
    const updates: string[] = [];
    const params: unknown[] = [];

    if ("category_id" in body) { updates.push("category_id = ?"); params.push((body as any).category_id); }
    if ("display_name" in body) { updates.push("display_name = ?"); params.push((body as any).display_name); }
    if ("is_third_party" in body) { updates.push("is_third_party = ?"); params.push((body as any).is_third_party); }

    if (!updates.length) return error(res, "nenhum campo para atualizar");

    params.push(id);
    db.prepare(`UPDATE transactions SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    broadcast();
    json(res, { ok: true });
  }

  // ── DELETE /api/transactions/:id ───────────────────────────────────────
  async function deleteTransaction(req: Req, res: Res) {
    const id = Number(req.params!.id);

    // Verificar se é SELF pair — se sim, deletar ambas as pernas
    const tx = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as any;
    if (!tx) return error(res, "transação não encontrada", 404);

    const deleted: any[] = [tx];
    if (tx.self_pair_tx_id) {
      const pair = db.prepare("SELECT * FROM transactions WHERE id = ?").get(tx.self_pair_tx_id) as any;
      if (pair) deleted.push(pair);
    }

    for (const d of deleted) {
      db.prepare("DELETE FROM transactions WHERE id = ?").run(d.id);
    }

    broadcast();
    // Retornar dados para undo (restore)
    json(res, {
      ok: true,
      deleted: deleted.length,
      restore: deleted.map(d => ({
        ...d,
        amount_cents: d.amount_cents,
      })),
    });
  }

  // ── POST /api/transactions/categorize-bulk ─────────────────────────────
  async function categorizeBulk(req: Req, res: Res) {
    const body = await readBody<{ ids: number[]; category_id: number }>(req);
    if (!body.ids?.length) return error(res, "ids required");
    const placeholders = body.ids.map(() => "?").join(",");
    db.prepare(`UPDATE transactions SET category_id = ? WHERE id IN (${placeholders})`).run(body.category_id, ...body.ids);
    broadcast();
    json(res, { ok: true, updated: body.ids.length });
  }

  // ── POST /api/transactions/restore ─────────────────────────────────────
  async function restoreTransactions(req: Req, res: Res) {
    const body = await readBody<{ restore: any[] }>(req);
    if (!body.restore?.length) return error(res, "nothing to restore");

    const cols = [
      "id", "date", "flow", "method", "account_id", "amount_cents", "description",
      "category_id", "dest_account_id", "counterpart", "is_revenue", "is_settlement",
      "is_third_party", "external_id", "display_name", "original_amount_cents",
      "import_batch_id", "investment_id", "invoice_id", "installment_seq",
      "installment_total", "bank_category", "self_pair_tx_id", "source_file",
    ];
    const placeholders = cols.map(() => "?").join(",");
    const stmt = db.prepare(`INSERT OR REPLACE INTO transactions (${cols.join(",")}) VALUES (${placeholders})`);

    for (const tx of body.restore) {
      stmt.run(...cols.map(c => tx[c] ?? null));
    }
    broadcast();
    json(res, { ok: true, restored: body.restore.length });
  }

  // ── POST /api/transactions (criar despesa manual) ──────────────────────
  async function createTransaction(req: Req, res: Res) {
    const body = await readBody<any>(req);
    const amountCents = Math.round((body.amount ?? 0) * 100);
    db.prepare(`
      INSERT INTO transactions (date, flow, method, account_id, amount_cents, description, category_id, counterpart, is_revenue, is_settlement, is_third_party)
      VALUES (?, 'expense', ?, ?, ?, ?, ?, ?, 0, 0, ?)
    `).run(
      body.date, body.method ?? "other", body.account_id,
      amountCents, body.description ?? "", body.category_id ?? null,
      body.counterpart ?? null, body.is_third_party ?? 0,
    );
    broadcast();
    json(res, { ok: true }, 201);
  }

  // ── POST /api/incomes (criar receita manual) ──────────────────────────
  async function createIncome(req: Req, res: Res) {
    const body = await readBody<any>(req);
    const amountCents = Math.round((body.amount ?? 0) * 100);
    db.prepare(`
      INSERT INTO transactions (date, flow, method, account_id, amount_cents, description, category_id, counterpart, is_revenue, is_settlement, is_third_party)
      VALUES (?, 'income', ?, ?, ?, ?, ?, ?, ?, 0, 0)
    `).run(
      body.date, body.method ?? "other", body.account_id,
      amountCents, body.description ?? "", body.category_id ?? null,
      body.counterpart ?? null, body.is_revenue ?? 1,
    );
    broadcast();
    json(res, { ok: true }, 201);
  }

  const cp = compilePath;
  return [
    { method: "GET", ...cp("/api/transactions"), handler: getTransactions },
    { method: "GET", ...cp("/api/month-transactions"), handler: getMonthTransactions },
    { method: "GET", ...cp("/api/recent-activity"), handler: getRecentActivity },
    { method: "GET", ...cp("/api/search"), handler: searchTransactions },
    { method: "PATCH", ...cp("/api/transactions/:id"), handler: patchTransaction },
    { method: "DELETE", ...cp("/api/transactions/:id"), handler: deleteTransaction },
    { method: "POST", ...cp("/api/transactions/categorize-bulk"), handler: categorizeBulk },
    { method: "POST", ...cp("/api/transactions/restore"), handler: restoreTransactions },
    { method: "POST", ...cp("/api/transactions"), handler: createTransaction },
    { method: "POST", ...cp("/api/incomes"), handler: createIncome },
  ];
}
