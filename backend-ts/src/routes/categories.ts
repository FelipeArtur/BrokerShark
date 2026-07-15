/** categories.ts — listas de categorias (dropdowns/gestão) + CRUD. */
import type { DatabaseSync } from "node:sqlite";
import type { Req, Res } from "../http/respond.ts";
import { json, error, readBody, qsStr } from "../http/respond.ts";
import type { Route } from "../http/router.ts";
import { compilePath } from "../http/router.ts";
import { broadcast } from "../http/sse.ts";
import { isIntId, isShortText } from "../http/validate.ts";

export function categoryRoutes(db: DatabaseSync): Route[] {
  // ── GET /api/categories-full?flow= — lista p/ gestão (com contagem) ───
  function getCategoriesFull(req: Req, res: Res) {
    const flow = qsStr(req, "flow");
    const where = flow ? "WHERE c.flow = ?" : "";
    const params = flow ? [flow] : [];
    const rows = db.prepare(`
      SELECT c.id, c.name, c.flow, COUNT(t.id) AS transaction_count
      FROM categories c
      LEFT JOIN transactions t ON t.category_id = c.id
      ${where}
      GROUP BY c.id
      ORDER BY c.name
    `).all(...params) as any[];
    json(res, rows);
  }

  // ── GET /api/expense-categories — dropdowns simples ───────────────────
  function getExpenseCategories(_req: Req, res: Res) {
    json(res, db.prepare("SELECT id, name FROM categories WHERE flow='expense' ORDER BY name").all());
  }

  // ── GET /api/expense-categories-full ──────────────────────────────────
  function getExpenseCategoriesFull(_req: Req, res: Res) {
    const rows = db.prepare(`
      SELECT c.id, c.name, c.flow, COUNT(t.id) AS transaction_count
      FROM categories c
      LEFT JOIN transactions t ON t.category_id = c.id
      WHERE c.flow = 'expense'
      GROUP BY c.id
      ORDER BY c.name
    `).all() as any[];
    json(res, rows);
  }

  // ── POST /api/categories ──────────────────────────────────────────────
  async function createCategory(req: Req, res: Res) {
    const body = await readBody<{ name?: unknown; flow?: unknown }>(req);
    if (!isShortText(body.name, 60)) return error(res, "name obrigatório (≤60 chars)");
    if (body.flow !== "expense" && body.flow !== "income") {
      return error(res, "flow deve ser expense|income");
    }
    const result = db.prepare("INSERT INTO categories (name, flow) VALUES (?, ?)")
      .run(String(body.name).trim(), body.flow);
    broadcast();
    json(res, { ok: true, id: result.lastInsertRowid }, 201);
  }

  // ── DELETE /api/categories/:id — reatribui transações antes de apagar ─
  async function deleteCategory(req: Req, res: Res) {
    const id = Number(req.params!.id);
    if (!isIntId(id)) return error(res, "id inválido");
    const body = await readBody<{ reassign_to_id?: unknown }>(req);

    if (body.reassign_to_id != null) {
      if (!isIntId(body.reassign_to_id) || body.reassign_to_id === id
        || !db.prepare("SELECT 1 FROM categories WHERE id = ?").get(body.reassign_to_id)) {
        return error(res, "categoria de destino inválida");
      }
      db.prepare("UPDATE transactions SET category_id = ? WHERE category_id = ?")
        .run(body.reassign_to_id, id);
    } else {
      db.prepare("UPDATE transactions SET category_id = NULL WHERE category_id = ?").run(id);
    }
    const r = db.prepare("DELETE FROM categories WHERE id = ?").run(id);
    if (r.changes === 0) return error(res, "categoria não encontrada", 404);
    broadcast();
    json(res, { ok: true });
  }

  // ── PATCH /api/categories/:id ─────────────────────────────────────────
  async function updateCategory(req: Req, res: Res) {
    const id = Number(req.params!.id);
    if (!isIntId(id)) return error(res, "id inválido");
    const body = await readBody<{ name?: unknown }>(req);
    if (!isShortText(body.name, 60)) return error(res, "name obrigatório (≤60 chars)");
    
    db.prepare("UPDATE categories SET name = ? WHERE id = ?")
      .run(String(body.name).trim(), id);
      
    broadcast();
    json(res, { ok: true });
  }

  const cp = compilePath;
  return [
    { method: "GET", ...cp("/api/categories-full"), handler: getCategoriesFull },
    { method: "GET", ...cp("/api/expense-categories"), handler: getExpenseCategories },
    { method: "GET", ...cp("/api/expense-categories-full"), handler: getExpenseCategoriesFull },
    { method: "POST", ...cp("/api/categories"), handler: createCategory },
    { method: "PATCH", ...cp("/api/categories/:id"), handler: updateCategory },
    { method: "DELETE", ...cp("/api/categories/:id"), handler: deleteCategory },
  ];
}
