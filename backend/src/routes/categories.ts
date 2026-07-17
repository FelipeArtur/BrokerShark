/**
 * @file categories.ts
 * @brief Rotas de categorias: listagens com alvo/gasto, CRUD e alvo de orçamento.
 *
 * categories.ts — listas de categorias (dropdowns/gestão) + CRUD.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Req, Res } from "../http/respond.ts";
import { json, error, readBody, qsStr } from "../http/respond.ts";
import type { Route } from "../http/router.ts";
import { compilePath } from "../http/router.ts";
import { broadcast } from "../http/sse.ts";
import { isIntId, isShortText } from "../http/validate.ts";
import { resolveBudget, isRefMonth, FIXED, type BudgetRow } from "../domain/budget.ts";
import { prevRefMonth } from "../domain/dates.ts";

/**
 * @brief SQL do gasto por categoria num período, em centavos inteiros.
 *
 * Regra consumo-despesa / receita real — mesma de analytics.ts. Divergir aqui = total errado.
 */
const SPENT_BY_CAT_SQL = `
  SELECT category_id, COALESCE(SUM(amount_cents), 0) AS spent_cents
  FROM transactions
  WHERE category_id IS NOT NULL
    AND date >= ? AND date <= ?
    AND (
      (flow = 'expense' AND method != 'transfer' AND is_settlement = 0
        AND is_third_party = 0 AND dest_account_id IS NULL)
      OR (flow = 'income' AND is_revenue = 1 AND is_third_party = 0)
    )
  GROUP BY category_id
`;

/**
 * @brief Montar as rotas de categorias e alvos ligadas a esta conexão.
 * @param db conexão do DB
 * @return rotas de listagem, CRUD de categoria e PUT/DELETE do alvo
 */
export function categoryRoutes(db: DatabaseSync): Route[] {
  /**
   * @brief Gasto por categoria no mês, aplicando a regra de consumo.
   *
   * Gasto por categoria no mês 'YYYY-MM' (regra de consumo).
   *
   * @param refMonth mês "YYYY-MM"
   * @return mapa category_id → gasto do mês em centavos inteiros
   */
  function spentMap(refMonth: string): Map<number, number> {
    const start = `${refMonth}-01`;
    const end = `${refMonth}-31`;  // comparação lexical de data ISO — '-31' cobre qualquer mês
    const rows = db.prepare(SPENT_BY_CAT_SQL).all(start, end) as any[];
    return new Map(rows.map(r => [r.category_id as number, r.spent_cents as number]));
  }

  // ── GET /api/categories-full?flow=&month=YYYY-MM ──────────────────────
  // Sem `month`: só contagem + alvo fixo. Com `month`: alvo vigente resolvido
  // (override → fixo), gasto do mês e gasto do mês anterior (Δ do cabeçalho de grupo).
  /**
   * @brief Listar categorias com alvo vigente, gasto do mês e gasto do mês anterior.
   *
   * Diferente do resto das rotas, os valores saem em CENTAVOS inteiros
   * (`budget_cents`, `spent_cents`, `prev_spent_cents`) — o alvo é editado em
   * centavos pela UI, sem round-trip por float.
   *
   * `budget_cents = null` significa SEM ALVO, nunca zero (ver domain/budget.ts).
   *
   * @param req requisição; query `flow` e `month` (YYYY-MM) opcionais
   * @param res resposta; 400 se `month` não for YYYY-MM
   */
  function getCategoriesFull(req: Req, res: Res) {
    const flow = qsStr(req, "flow");
    const month = qsStr(req, "month");
    if (month && !isRefMonth(month)) return error(res, "month deve ser YYYY-MM");

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

    const budgets = db.prepare(
      "SELECT category_id, ref_month, amount_cents FROM category_budgets"
    ).all() as BudgetRow[];

    const spent = month ? spentMap(month) : null;
    const prevSpent = month ? spentMap(prevRefMonth(month)) : null;

    for (const r of rows) {
      const b = resolveBudget(budgets, r.id, month || FIXED);
      r.budget_cents = b ? b.amount_cents : null;
      r.budget_source = b ? b.source : null;
      if (month) {
        r.spent_cents = spent!.get(r.id) ?? 0;
        r.prev_spent_cents = prevSpent!.get(r.id) ?? 0;
      }
    }
    json(res, rows);
  }

  // ── PUT /api/category-budget — grava alvo (fixo ou override do mês) ────
  /**
   * @brief Gravar o alvo de gasto de uma categoria (fixo ou override do mês).
   *
   * Só categoria de DESPESA tem alvo. `amount_cents` aceita 0 — "alvo de R$ 0,00" é
   * um estado legítimo, diferente de "sem alvo" (que se obtém pelo DELETE).
   *
   * @param req requisição; body `{ category_id, ref_month?, amount_cents }`, com
   *            `amount_cents` em CENTAVOS inteiros >= 0 e `ref_month` '' = alvo fixo
   * @param res resposta; 400 em id/mês/valor inválidos ou categoria não-despesa
   * @throws HttpError 400/413 vindos de readBody
   */
  async function putCategoryBudget(req: Req, res: Res) {
    const body = await readBody<{ category_id?: unknown; ref_month?: unknown; amount_cents?: unknown }>(req);
    if (!isIntId(body.category_id)) return error(res, "category_id inválido");
    if (!db.prepare("SELECT 1 FROM categories WHERE id = ? AND flow = 'expense'").get(body.category_id)) {
      return error(res, "categoria de despesa não encontrada");
    }
    const refMonth = body.ref_month ?? FIXED;
    if (!isRefMonth(refMonth)) return error(res, "ref_month deve ser '' ou YYYY-MM");
    if (typeof body.amount_cents !== "number" || !Number.isInteger(body.amount_cents)
      || body.amount_cents < 0 || body.amount_cents > 1_000_000_000) {
      return error(res, "amount_cents deve ser inteiro >= 0");
    }
    db.prepare(`
      INSERT INTO category_budgets (category_id, ref_month, amount_cents) VALUES (?, ?, ?)
      ON CONFLICT (category_id, ref_month) DO UPDATE SET amount_cents = excluded.amount_cents
    `).run(body.category_id, refMonth, body.amount_cents);
    broadcast();
    json(res, { ok: true });
  }

  // ── DELETE /api/category-budget — tira o alvo (override some → herda o fixo) ─
  /**
   * @brief Remover o alvo de uma categoria (o override some → volta a herdar o fixo).
   * @param req requisição; body `{ category_id, ref_month? }` ('' = remove o fixo)
   * @param res resposta; 400 em id ou mês inválido
   * @throws HttpError 400/413 vindos de readBody
   */
  async function deleteCategoryBudget(req: Req, res: Res) {
    const body = await readBody<{ category_id?: unknown; ref_month?: unknown }>(req);
    if (!isIntId(body.category_id)) return error(res, "category_id inválido");
    const refMonth = body.ref_month ?? FIXED;
    if (!isRefMonth(refMonth)) return error(res, "ref_month deve ser '' ou YYYY-MM");
    db.prepare("DELETE FROM category_budgets WHERE category_id = ? AND ref_month = ?")
      .run(body.category_id, refMonth);
    broadcast();
    json(res, { ok: true });
  }

  // ── GET /api/expense-categories — dropdowns simples ───────────────────
  /**
   * @brief Listar as categorias de despesa (id + nome) para os dropdowns.
   * @param _req requisição (ignorada)
   * @param res resposta; lista ordenada por nome
   */
  function getExpenseCategories(_req: Req, res: Res) {
    json(res, db.prepare("SELECT id, name FROM categories WHERE flow='expense' ORDER BY name").all());
  }

  // ── GET /api/expense-categories-full ──────────────────────────────────
  /**
   * @brief Listar as categorias de despesa com a contagem de transações de cada.
   * @param _req requisição (ignorada)
   * @param res resposta; lista com `transaction_count`, ordenada por nome
   */
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
  /**
   * @brief Criar uma categoria.
   * @param req requisição; body `{ name, flow }` com flow em expense|income
   * @param res resposta; 201 + id no sucesso, 400 em nome ou flow inválido
   * @throws HttpError 400/413 vindos de readBody
   */
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
  /**
   * @brief Apagar uma categoria, reatribuindo ou descategorizando suas transações.
   *
   * As transações NUNCA são apagadas junto: sem `reassign_to_id` elas ficam com
   * `category_id = NULL`. Apagar uma categoria é perder uma etiqueta, jamais um
   * lançamento do ledger.
   *
   * @param req requisição; param `:id`, body `{ reassign_to_id? }`
   * @param res resposta; 400 em destino inválido, 404 se a categoria não existir
   * @throws HttpError 400/413 vindos de readBody
   */
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
  /**
   * @brief Renomear uma categoria.
   * @param req requisição; param `:id`, body `{ name }` (≤60 chars)
   * @param res resposta; 400 em id ou nome inválido
   * @throws HttpError 400/413 vindos de readBody
   */
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
    { method: "PUT", ...cp("/api/category-budget"), handler: putCategoryBudget },
    { method: "DELETE", ...cp("/api/category-budget"), handler: deleteCategoryBudget },
    { method: "POST", ...cp("/api/categories"), handler: createCategory },
    { method: "PATCH", ...cp("/api/categories/:id"), handler: updateCategory },
    { method: "DELETE", ...cp("/api/categories/:id"), handler: deleteCategory },
  ];
}
