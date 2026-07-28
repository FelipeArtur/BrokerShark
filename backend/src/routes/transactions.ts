import type { DatabaseSync } from "node:sqlite";
import type { Req, Res } from "../http/respond.ts";
import { json, error, readBody, qsInt } from "../http/respond.ts";
import type { Route } from "../http/router.ts";
import { compilePath } from "../http/router.ts";
import { broadcast } from "../http/sse.ts";
import { isIntId, isIntIdArray, isShortText } from "../http/validate.ts";
import { currentMonth, monthRange } from "../domain/dates.ts";
import { normalizeMerchant } from "../domain/merchant.ts";

// Aprende uma regra nome→categoria quando o usuário categoriza um lançamento.
// Upsert por matcher; nunca auto-aplica (só grava a regra que a sugestão vai ler).
export function learnCategoryRule(db: DatabaseSync, description: string, categoryId: number): void {
  const matcher = normalizeMerchant(description);
  if (!matcher || categoryId == null) return;
  const existing = db.prepare("SELECT id FROM rules WHERE action='category' AND matcher=?").get(matcher) as { id: number } | undefined;
  if (existing) {
    db.prepare("UPDATE rules SET value=?, enabled=1 WHERE id=?").run(String(categoryId), existing.id);
  } else {
    db.prepare("INSERT INTO rules (matcher, action, value, priority, enabled) VALUES (?, 'category', ?, 50, 1)")
      .run(matcher, String(categoryId));
  }
}

// O banco da conta viaja junto do lançamento: a tela rotula e colore por banco,
// e sem esse campo o chip cai no id cru ("conta-a"). Antes o frontend adivinhava
// pelo prefixo do id, o que só funcionava para as contas do autor.
const TX_SELECT = `
  SELECT t.*, c.name AS category_name, a.bank AS bank
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN accounts a ON a.id = t.account_id
`;

function txToJson(r: any): Record<string, unknown> {
  return {
    id: r.id,
    date: r.date,
    flow: r.flow,
    method: r.method,
    account_id: r.account_id,
    bank: r.bank ?? null,
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
    if ("category_id" in body && (body as any).category_id != null) {
      const row = db.prepare("SELECT display_name, description FROM transactions WHERE id = ?").get(id) as any;
      if (row) learnCategoryRule(db, row.display_name ?? row.description, Number((body as any).category_id));
    }
    broadcast();
    json(res, { ok: true });
  }

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

  async function categorizeBulk(req: Req, res: Res) {
    const body = await readBody<{ ids: unknown; category_id: unknown }>(req);
    if (!isIntIdArray(body.ids)) return error(res, "ids inválidos");
    if (!categoryExists(body.category_id)) return error(res, "categoria inexistente");

    const placeholders = body.ids.map(() => "?").join(",");
    db.prepare(`UPDATE transactions SET category_id = ? WHERE id IN (${placeholders})`)
      .run(body.category_id as number, ...body.ids);
    const rows = db.prepare(`SELECT display_name, description FROM transactions WHERE id IN (${placeholders})`)
      .all(...body.ids) as any[];
    for (const row of rows) learnCategoryRule(db, row.display_name ?? row.description, Number(body.category_id));
    broadcast();
    json(res, { ok: true, updated: body.ids.length });
  }

  const cp = compilePath;
  return [
    { method: "GET", ...cp("/api/month-transactions"), handler: getMonthTransactions },
    { method: "PATCH", ...cp("/api/transactions/:id"), handler: patchTransaction },
    { method: "DELETE", ...cp("/api/transactions/:id"), handler: deleteTransaction },
    { method: "POST", ...cp("/api/transactions/categorize-bulk"), handler: categorizeBulk },
    { method: "POST", ...cp("/api/transactions/restore"), handler: restoreTransactions },
  ];
}
