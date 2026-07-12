/** investments.ts — carteira, evolução e movimento manual. */
import type { DatabaseSync } from "node:sqlite";
import type { Req, Res } from "../http/respond.ts";
import { json, error, readBody, qsStr } from "../http/respond.ts";
import type { Route } from "../http/router.ts";
import { compilePath } from "../http/router.ts";
import { broadcast } from "../http/sse.ts";
import { isIsoDate, isPositiveAmount, isShortText } from "../http/validate.ts";
import { today } from "../domain/dates.ts";
import { monthlyPortfolioSeries } from "../domain/positions.ts";

/** Último snapshot de cada (investimento, mês) — base das séries mensais. */
const MONTHLY_SNAPS = `
  SELECT investment_id, ym, net_cents FROM (
    SELECT ps.investment_id, strftime('%Y-%m', ps.ref_date) AS ym, ps.net_cents,
      ROW_NUMBER() OVER (
        PARTITION BY ps.investment_id, strftime('%Y-%m', ps.ref_date)
        ORDER BY ps.ref_date DESC, ps.id DESC
      ) AS rn
    FROM position_snapshots ps
  ) WHERE rn = 1 ORDER BY ym
`;

export function investmentRoutes(db: DatabaseSync): Route[] {
  // ── GET /api/investments?bank= ─────────────────────────────────────────
  // Carteira ATUAL: posições soft-closed ficam fora — o último snapshot delas é
  // histórico (CDB vencido/resgatado), somá-lo inflaria total e patrimônio.
  function getInvestments(req: Req, res: Res) {
    const bank = qsStr(req, "bank");
    const conditions = ["i.closed_at IS NULL"];
    const params: unknown[] = [];
    if (bank) { conditions.push("i.bank = ?"); params.push(bank); }

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
      WHERE ${conditions.join(" AND ")}
      ORDER BY i.bank, i.type, i.name
    `).all(...params) as any[];

    json(res, rows.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      bank: r.bank,
      balance: (r.net_cents ?? 0) / 100,
      group_name: r.group_name,
      derived: r.snap_source === "derived" ? 1 : 0,
    })));
  }

  // ── GET /api/investment-evolution ──────────────────────────────────────
  // Série mensal contínua: carry-forward entre relatórios esparsos, posição
  // zera após o soft-close.
  function getInvestmentEvolution(_req: Req, res: Res) {
    const snaps = db.prepare(MONTHLY_SNAPS).all() as any[];
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

  // ── POST /api/investment-movements — aplicação/resgate manual ──────────
  async function postInvestmentMovement(req: Req, res: Res) {
    const body = await readBody<{
      investment_name?: unknown; operation?: unknown; amount?: unknown;
      date?: unknown; description?: unknown;
    }>(req);

    if (!isShortText(body.investment_name, 120)) return error(res, "investment_name obrigatório");
    if (body.operation !== "apply" && body.operation !== "redeem") {
      return error(res, "operation deve ser apply|redeem");
    }
    if (!isPositiveAmount(body.amount)) return error(res, "amount deve ser número > 0");
    const date = body.date == null ? today() : body.date;
    if (!isIsoDate(date)) return error(res, "date deve ser YYYY-MM-DD");

    const name = String(body.investment_name).trim();
    const amountCents = Math.round((body.amount as number) * 100);

    let inv = db.prepare("SELECT id FROM investments WHERE name = ?").get(name) as any;
    if (!inv) {
      db.prepare(
        "INSERT INTO investments (name, match_key, type, bank, source) VALUES (?, ?, 'outro', 'manual', 'manual')"
      ).run(name, `manual:${name.toLowerCase()}`);
      inv = db.prepare("SELECT id FROM investments WHERE name = ?").get(name) as any;
    }

    // Perna no ledger: transfer, fora de receita/despesa de consumo.
    const flow = body.operation === "redeem" ? "income" : "expense";
    db.prepare(`
      INSERT INTO transactions (date, flow, method, account_id, amount_cents, description,
        is_revenue, is_settlement, is_third_party, investment_id)
      VALUES (?, ?, 'transfer', (SELECT id FROM accounts WHERE type='checking' LIMIT 1),
        ?, ?, 0, 0, 0, ?)
    `).run(date, flow, amountCents, String(body.description ?? name), inv.id);

    // Snapshot manual: saldo anterior ± movimento.
    const lastSnap = db.prepare(`
      SELECT net_cents FROM position_snapshots
      WHERE investment_id = ? ORDER BY ref_date DESC LIMIT 1
    `).get(inv.id) as any;
    const prevCents = lastSnap?.net_cents ?? 0;
    const newCents = body.operation === "redeem" ? prevCents - amountCents : prevCents + amountCents;
    db.prepare(`
      INSERT INTO position_snapshots (investment_id, ref_date, net_cents, source)
      VALUES (?, ?, ?, 'manual')
      ON CONFLICT (investment_id, ref_date, source) DO UPDATE SET net_cents = excluded.net_cents
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
