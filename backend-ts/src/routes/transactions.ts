/** transactions.ts — CRUD + busca de transações.
 *
 * Leituras: /api/transactions (filtros), /api/month-transactions (mês + sugestão
 * de categoria por rules), /api/search. Escritas: PATCH/DELETE/:id, restore
 * (undo), categorize-bulk, POST transactions|incomes (lançamento manual).
 */
import type { DatabaseSync } from "node:sqlite";
import type { Req, Res } from "../http/respond.ts";
import { json, error, readBody, qsStr, qsInt } from "../http/respond.ts";
import type { Route } from "../http/router.ts";
import { compilePath } from "../http/router.ts";
import { broadcast } from "../http/sse.ts";
import { isIsoDate, isPositiveAmount, isIntId, isIntIdArray, isShortText, TX_METHODS } from "../http/validate.ts";
import { currentMonth, monthRange } from "../domain/dates.ts";

const TX_SELECT = `
  SELECT t.*, c.name AS category_name
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
`;

/** Row do DB → JSON do frontend (centavos → reais; alias v1 \`category\`). */
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
  };
}

export function transactionRoutes(db: DatabaseSync): Route[] {
  const categoryExists = (id: unknown): boolean =>
    isIntId(id) && db.prepare("SELECT 1 FROM categories WHERE id = ?").get(id) !== undefined;
  const accountExists = (id: unknown): boolean =>
    typeof id === "string" && db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(id) !== undefined;

  // ── GET /api/transactions?account=&month=&year=&limit= ────────────────
  function getTransactions(req: Req, res: Res) {
    const accountId = qsStr(req, "account");
    const limit = Math.min(qsInt(req, "limit") ?? 200, 1000);
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
    const rows = db.prepare(`${TX_SELECT} ${where} ORDER BY t.date DESC, t.id DESC LIMIT ?`)
      .all(...params, limit) as any[];
    json(res, rows.map(txToJson));
  }

  // ── GET /api/month-transactions?month=&year= ──────────────────────────
  // Lançamentos do mês; linhas sem categoria ganham sugestão via rules
  // (menor priority vence — matching em JS, o SQL não ordenaria por grupo).
  function getMonthTransactions(req: Req, res: Res) {
    const { month: cm, year: cy } = currentMonth();
    const month = qsInt(req, "month") ?? cm;
    const year = qsInt(req, "year") ?? cy;
    const { start, end } = monthRange(month, year);

    const rows = db.prepare(`${TX_SELECT} WHERE t.date >= ? AND t.date <= ? ORDER BY t.date DESC, t.id DESC`)
      .all(start, end) as any[];

    const rules = db.prepare(
      "SELECT matcher, value FROM rules WHERE action='category' AND enabled=1 ORDER BY priority ASC, id ASC"
    ).all() as any[];
    const catName = new Map<number, string>(
      (db.prepare("SELECT id, name FROM categories").all() as any[]).map(c => [c.id, c.name]),
    );

    json(res, rows.map(r => {
      const obj = txToJson(r);
      if (r.category_id == null) {
        const hay = `${r.display_name ?? ""} ${r.description ?? ""}`.toLowerCase();
        const rule = rules.find(x => hay.includes(String(x.matcher).toLowerCase()));
        if (rule) {
          const sugId = Number(rule.value);
          obj.suggested_category_id = sugId;
          obj.suggested_category_name = catName.get(sugId) ?? null;
        }
      }
      return obj;
    }));
  }

  // ── GET /api/search?q= ────────────────────────────────────────────────
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

  // ── PATCH /api/transactions/:id — campos editáveis pela UI ────────────
  async function patchTransaction(req: Req, res: Res) {
    const id = Number(req.params!.id);
    if (!isIntId(id)) return error(res, "id inválido");
    const body = await readBody(req);

    const updates: string[] = [];
    const params: unknown[] = [];
    if ("category_id" in body) {
      const v = (body as any).category_id;
      if (v !== null && !categoryExists(v)) return error(res, "categoria inexistente");
      updates.push("category_id = ?"); params.push(v);
    }
    if ("display_name" in body) {
      const v = (body as any).display_name;
      if (v !== null && !isShortText(v)) return error(res, "display_name inválido");
      updates.push("display_name = ?"); params.push(v);
    }
    if ("is_third_party" in body) {
      const v = (body as any).is_third_party;
      if (v !== 0 && v !== 1) return error(res, "is_third_party deve ser 0|1");
      updates.push("is_third_party = ?"); params.push(v);
    }
    if (!updates.length) return error(res, "nenhum campo para atualizar");

    params.push(id);
    const r = db.prepare(`UPDATE transactions SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    if (r.changes === 0) return error(res, "transação não encontrada", 404);
    broadcast();
    json(res, { ok: true });
  }

  // ── DELETE /api/transactions/:id — apaga o par SELF junto; retorna undo ─
  async function deleteTransaction(req: Req, res: Res) {
    const id = Number(req.params!.id);
    if (!isIntId(id)) return error(res, "id inválido");

    const tx = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as any;
    if (!tx) return error(res, "transação não encontrada", 404);

    const deleted: any[] = [tx];
    if (tx.self_pair_tx_id) {
      const pair = db.prepare("SELECT * FROM transactions WHERE id = ?").get(tx.self_pair_tx_id) as any;
      if (pair) deleted.push(pair);
    }
    for (const d of deleted) db.prepare("DELETE FROM transactions WHERE id = ?").run(d.id);

    broadcast();
    json(res, { ok: true, deleted: deleted.length, restore: deleted });
  }

  // ── POST /api/transactions/restore — desfaz um delete (INSERT OR REPLACE) ─
  async function restoreTransactions(req: Req, res: Res) {
    const body = await readBody<{ restore: any[] }>(req);
    if (!Array.isArray(body.restore) || !body.restore.length) return error(res, "nada para restaurar");

    const cols = [
      "id", "date", "flow", "method", "account_id", "amount_cents", "description",
      "category_id", "dest_account_id", "counterpart", "is_revenue", "is_settlement",
      "is_third_party", "external_id", "display_name", "original_amount_cents",
      "import_batch_id", "investment_id", "invoice_id", "installment_seq",
      "installment_total", "bank_category", "self_pair_tx_id", "source_file",
    ];
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO transactions (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
    );
    for (const tx of body.restore) stmt.run(...cols.map(c => tx[c] ?? null));
    broadcast();
    json(res, { ok: true, restored: body.restore.length });
  }

  // ── POST /api/transactions/categorize-bulk ────────────────────────────
  async function categorizeBulk(req: Req, res: Res) {
    const body = await readBody<{ ids: unknown; category_id: unknown }>(req);
    if (!isIntIdArray(body.ids)) return error(res, "ids inválidos");
    if (!categoryExists(body.category_id)) return error(res, "categoria inexistente");

    const placeholders = body.ids.map(() => "?").join(",");
    db.prepare(`UPDATE transactions SET category_id = ? WHERE id IN (${placeholders})`)
      .run(body.category_id as number, ...body.ids);
    broadcast();
    json(res, { ok: true, updated: body.ids.length });
  }

  // ── POST /api/transactions | /api/incomes — lançamento manual ─────────
  function createManual(flow: "expense" | "income") {
    return async (req: Req, res: Res) => {
      const body = await readBody<any>(req);
      if (!isIsoDate(body.date)) return error(res, "date deve ser YYYY-MM-DD");
      if (!isPositiveAmount(body.amount)) return error(res, "amount deve ser número > 0");
      if (!accountExists(body.account_id)) return error(res, "conta inexistente");
      const method = body.method ?? "other";
      if (!TX_METHODS.has(method)) return error(res, "method inválido");
      // SELF é DERIVADO do pareamento de pernas (selfPairs.ts), nunca declarado:
      // uma perna SELF avulsa nasceria sem self_pair_tx_id (quebra o cruzamento)
      // e sem method='transfer' (a regra consumo-despesa a contaria como gasto).
      if (body.counterpart === "SELF") {
        return error(res, "counterpart 'SELF' é derivado do pareamento de pernas, não aceito no lançamento manual");
      }
      if (body.category_id != null && !categoryExists(body.category_id)) {
        return error(res, "categoria inexistente");
      }

      const amountCents = Math.round(body.amount * 100);
      const isRevenue = flow === "income" ? (body.is_revenue === 0 ? 0 : 1) : 0;
      db.prepare(`
        INSERT INTO transactions (date, flow, method, account_id, amount_cents, description,
          category_id, counterpart, is_revenue, is_settlement, is_third_party)
        VALUES (?,?,?,?,?,?,?,?,?, 0, ?)
      `).run(
        body.date, flow, method, body.account_id, amountCents,
        String(body.description ?? ""), body.category_id ?? null, body.counterpart ?? null,
        isRevenue, body.is_third_party === 1 ? 1 : 0,
      );
      broadcast();
      json(res, { ok: true }, 201);
    };
  }

  const cp = compilePath;
  return [
    { method: "GET", ...cp("/api/transactions"), handler: getTransactions },
    { method: "GET", ...cp("/api/month-transactions"), handler: getMonthTransactions },
    { method: "GET", ...cp("/api/search"), handler: searchTransactions },
    { method: "PATCH", ...cp("/api/transactions/:id"), handler: patchTransaction },
    { method: "DELETE", ...cp("/api/transactions/:id"), handler: deleteTransaction },
    { method: "POST", ...cp("/api/transactions/categorize-bulk"), handler: categorizeBulk },
    { method: "POST", ...cp("/api/transactions/restore"), handler: restoreTransactions },
    { method: "POST", ...cp("/api/transactions"), handler: createManual("expense") },
    { method: "POST", ...cp("/api/incomes"), handler: createManual("income") },
  ];
}
