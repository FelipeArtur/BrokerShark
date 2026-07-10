/** categories.ts — rotas de categorias. */
import type { DatabaseSync } from "node:sqlite";
import type { Req, Res, Route } from "./helpers.ts";
import { json, error, readBody, qs, qsStr, qsInt, compilePath, broadcast, currentMonth, monthRange } from "./helpers.ts";

export function categoryRoutes(db: DatabaseSync): Route[] {
  // ── GET /api/categories ────────────────────────────────────────────────
  // Totais de despesa por categoria, filtrado por período/banco/conta
  function getCategories(req: Req, res: Res) {
    const bank = qsStr(req, "bank");
    const account = qsStr(req, "account");
    const period = qsStr(req, "period");
    const month = qsInt(req, "month");
    const year = qsInt(req, "year");

    const conditions: string[] = [
      "t.flow = 'expense'",
      "t.method != 'transfer'",
      "t.is_settlement = 0",
      "t.is_third_party = 0",
      "t.dest_account_id IS NULL",
    ];
    const params: unknown[] = [];

    if (bank) { conditions.push("a.bank = ?"); params.push(bank); }
    if (account) { conditions.push("t.account_id = ?"); params.push(account); }

    if (month && year) {
      const { start, end } = monthRange(month, year);
      conditions.push("t.date >= ? AND t.date <= ?");
      params.push(start, end);
    } else if (period) {
      // period = "3m", "6m", "12m", "all"
      if (period !== "all") {
        const months = parseInt(period);
        if (months > 0) {
          const d = new Date();
          d.setMonth(d.getMonth() - months);
          const start = d.toISOString().slice(0, 10);
          conditions.push("t.date >= ?");
          params.push(start);
        }
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = db.prepare(`
      SELECT COALESCE(c.name, 'Sem categoria') AS name,
        SUM(t.amount_cents) AS total_cents
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
      ${where}
      GROUP BY COALESCE(c.name, 'Sem categoria')
      ORDER BY total_cents DESC
    `).all(...params) as any[];

    json(res, rows.map(r => ({ name: r.name, total: r.total_cents / 100 })));
  }

  // ── GET /api/categories-full ───────────────────────────────────────────
  function getCategoriesFull(req: Req, res: Res) {
    const flow = qsStr(req, "flow");
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (flow) { conditions.push("c.flow = ?"); params.push(flow); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = db.prepare(`
      SELECT c.id, c.name, c.flow,
        COUNT(t.id) AS transaction_count
      FROM categories c
      LEFT JOIN transactions t ON t.category_id = c.id
      ${where}
      GROUP BY c.id
      ORDER BY c.name
    `).all(...params) as any[];

    json(res, rows);
  }

  // ── GET /api/expense-categories ────────────────────────────────────────
  function getExpenseCategories(_req: Req, res: Res) {
    const rows = db.prepare("SELECT id, name FROM categories WHERE flow='expense' ORDER BY name").all() as any[];
    json(res, rows);
  }

  // ── GET /api/expense-categories-full ───────────────────────────────────
  function getExpenseCategoriesFull(_req: Req, res: Res) {
    const rows = db.prepare(`
      SELECT c.id, c.name, c.flow,
        COUNT(t.id) AS transaction_count
      FROM categories c
      LEFT JOIN transactions t ON t.category_id = c.id
      WHERE c.flow = 'expense'
      GROUP BY c.id
      ORDER BY c.name
    `).all() as any[];
    json(res, rows);
  }

  // ── POST /api/categories ───────────────────────────────────────────────
  async function createCategory(req: Req, res: Res) {
    const body = await readBody<{ name: string; flow: string }>(req);
    if (!body.name || !body.flow) return error(res, "name and flow required");
    if (!["expense", "income"].includes(body.flow)) return error(res, "flow must be expense or income");

    const result = db.prepare("INSERT INTO categories (name, flow) VALUES (?, ?)").run(body.name, body.flow);
    broadcast();
    json(res, { ok: true, id: result.lastInsertRowid }, 201);
  }

  // ── DELETE /api/categories/:id ─────────────────────────────────────────
  async function deleteCategory(req: Req, res: Res) {
    const id = Number(req.params!.id);
    const body = await readBody<{ reassign_to_id?: number }>(req);

    // Reassign transactions to another category before deleting
    if (body.reassign_to_id != null) {
      db.prepare("UPDATE transactions SET category_id = ? WHERE category_id = ?").run(body.reassign_to_id, id);
    } else {
      db.prepare("UPDATE transactions SET category_id = NULL WHERE category_id = ?").run(id);
    }
    db.prepare("DELETE FROM categories WHERE id = ?").run(id);
    broadcast();
    json(res, { ok: true });
  }

  const cp = compilePath;
  return [
    { method: "GET", ...cp("/api/categories"), handler: getCategories },
    { method: "GET", ...cp("/api/categories-full"), handler: getCategoriesFull },
    { method: "GET", ...cp("/api/expense-categories"), handler: getExpenseCategories },
    { method: "GET", ...cp("/api/expense-categories-full"), handler: getExpenseCategoriesFull },
    { method: "POST", ...cp("/api/categories"), handler: createCategory },
    { method: "DELETE", ...cp("/api/categories/:id"), handler: deleteCategory },
  ];
}
