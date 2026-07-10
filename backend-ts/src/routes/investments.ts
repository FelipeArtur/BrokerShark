/** investments.ts — rotas de investimentos e movimentações. */
import type { DatabaseSync } from "node:sqlite";
import type { Req, Res, Route } from "./helpers.ts";
import { json, error, readBody, qs, qsStr, compilePath, broadcast, today } from "./helpers.ts";
import { monthlyPortfolioSeries } from "../domain/positions.ts";

export function investmentRoutes(db: DatabaseSync): Route[] {

  // ── GET /api/investments ───────────────────────────────────────────────
  function getInvestments(req: Req, res: Res) {
    const bank = qsStr(req, "bank");
    // Carteira ATUAL: posições soft-closed ficam fora — o último snapshot delas é
    // histórico (CDB vencido/resgatado), somá-lo inflaria total e patrimônio.
    const conditions: string[] = ["i.closed_at IS NULL"];
    const params: unknown[] = [];
    if (bank) { conditions.push("i.bank = ?"); params.push(bank); }

    const where = `WHERE ${conditions.join(" AND ")}`;

    // Último snapshot de cada investimento
    const rows = db.prepare(`
      SELECT i.id, i.name, i.type, i.bank, i.group_name,
        ps.net_cents, ps.source AS snap_source
      FROM investments i
      LEFT JOIN (
        SELECT ps1.*
        FROM position_snapshots ps1
        INNER JOIN (
          SELECT investment_id, MAX(ref_date) AS max_date
          FROM position_snapshots
          GROUP BY investment_id
        ) ps2 ON ps1.investment_id = ps2.investment_id AND ps1.ref_date = ps2.max_date
      ) ps ON ps.investment_id = i.id
      ${where}
      ORDER BY i.bank, i.type, i.name
    `).all(...params) as any[];

    const result: any[] = rows.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      bank: r.bank,
      balance: (r.net_cents ?? 0) / 100,
      group_name: r.group_name,
      derived: r.snap_source === "derived" ? 1 : 0,
    }));

    json(res, result);
  }

  // ── GET /api/investment-evolution ──────────────────────────────────────
  // Série mensal contínua: último snapshot de cada investimento por mês,
  // carry-forward entre relatórios, posição zera após o soft-close.
  function getInvestmentEvolution(_req: Req, res: Res) {
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

    json(res, monthlyPortfolioSeries(snaps, closedYm).map(p => {
      const [y, m] = p.ym.split("-");
      return { label: `${m}/${y}`, cumulative: p.total_cents / 100 };
    }));
  }

  // ── POST /api/investment-movements ─────────────────────────────────────
  async function postInvestmentMovement(req: Req, res: Res) {
    const body = await readBody<{
      investment_name: string;
      operation: string;    // "apply" | "redeem"
      amount: number;
      date: string;
      description?: string;
    }>(req);

    if (!body.investment_name || !body.operation || !body.amount) {
      return error(res, "investment_name, operation, amount required");
    }

    const amountCents = Math.round(body.amount * 100);
    const date = body.date ?? today();

    // Encontrar ou criar investimento
    let inv = db.prepare("SELECT id FROM investments WHERE name = ?").get(body.investment_name) as any;
    if (!inv) {
      db.prepare(
        "INSERT INTO investments (name, type, bank, source) VALUES (?, 'outro', 'manual', 'manual')"
      ).run(body.investment_name);
      inv = db.prepare("SELECT id FROM investments WHERE name = ?").get(body.investment_name) as any;
    }

    // Criar transação correspondente
    const flow = body.operation === "redeem" ? "income" : "expense";
    const isRevenue = flow === "income" ? 0 : 0;

    db.prepare(`
      INSERT INTO transactions (date, flow, method, account_id, amount_cents, description,
        is_revenue, is_settlement, is_third_party, investment_id)
      VALUES (?, ?, 'transfer', (SELECT id FROM accounts WHERE type='checking' LIMIT 1),
        ?, ?, ?, 0, 0, ?)
    `).run(date, flow, amountCents, body.description ?? body.investment_name, isRevenue, inv.id);

    // Atualizar/criar snapshot
    const lastSnap = db.prepare(`
      SELECT net_cents FROM position_snapshots
      WHERE investment_id = ? ORDER BY ref_date DESC LIMIT 1
    `).get(inv.id) as any;

    const prevCents = lastSnap?.net_cents ?? 0;
    const newCents = body.operation === "redeem"
      ? prevCents - amountCents
      : prevCents + amountCents;

    db.prepare(`
      INSERT INTO position_snapshots (investment_id, ref_date, net_cents, source)
      VALUES (?, ?, ?, 'manual')
    `).run(inv.id, date, newCents);

    broadcast();
    json(res, { ok: true }, 201);
  }

  const cp = compilePath;
  return [
    { method: "GET", ...cp("/api/investments"), handler: getInvestments },
    { method: "GET", ...cp("/api/investment-evolution"), handler: getInvestmentEvolution },
    { method: "POST", ...cp("/api/investment-movements"), handler: postInvestmentMovement },
  ];
}
