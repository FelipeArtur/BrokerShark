import type { DatabaseSync } from "node:sqlite";
import type { Req, Res } from "../http/respond.ts";
import { json, error, qsStr } from "../http/respond.ts";
import { isIntId } from "../http/validate.ts";
import type { Route } from "../http/router.ts";
import { compilePath } from "../http/router.ts";
import { monthlyPortfolioSeries } from "../domain/positions.ts";

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

  /**
   * @brief   Ficha da posição + todos os snapshots datados.
   * @warning Rendimento é COMPUTADO (net − applied), nunca guardado: guardado ficaria
   *          velho no instante seguinte e passaria a mentir.
   */
  function getInvestmentDetail(req: Req, res: Res) {
    const id = Number(req.params!.id);
    if (!isIntId(id)) return error(res, "id inválido");

    const inv = db.prepare(`
      SELECT id, name, code, type, bank, indexer, rate_text, maturity_date,
             group_name, source, opened_at, closed_at
      FROM investments WHERE id = ?
    `).get(id) as any;
    if (!inv) return error(res, "posição não encontrada", 404);

    const snaps = db.prepare(`
      SELECT ref_date, quantity, unit_price_cents, applied_cents, gross_cents, net_cents, source
      FROM position_snapshots WHERE investment_id = ?
      ORDER BY ref_date ASC, id ASC
    `).all(id) as any[];

    json(res, {
      id: inv.id,
      name: inv.name,
      code: inv.code,
      type: inv.type,
      bank: inv.bank,
      indexer: inv.indexer,
      rate_text: inv.rate_text,
      maturity_date: inv.maturity_date,
      group_name: inv.group_name,
      source: inv.source,
      opened_at: inv.opened_at,
      closed_at: inv.closed_at,
      snapshots: snaps.map(s => {
        const applied = s.applied_cents ?? 0;
        const net = s.net_cents ?? 0;
        return {
          ref_date: s.ref_date,
          quantity: s.quantity,
          unit_price: s.unit_price_cents != null ? s.unit_price_cents / 100 : null,
          applied: applied / 100,
          gross: s.gross_cents != null ? s.gross_cents / 100 : null,
          net: net / 100,
          //> Sem aplicado é null ("não sei"), nunca zero ("rendeu nada").
          yield: applied > 0 ? (net - applied) / 100 : null,
          yield_pct: applied > 0 ? ((net - applied) / applied) * 100 : null,
          source: s.source,
        };
      }),
    });
  }

  const cp = compilePath;
  return [
    { method: "GET", ...cp("/api/investments"), handler: getInvestments },
    { method: "GET", ...cp("/api/investments/:id"), handler: getInvestmentDetail },
    { method: "GET", ...cp("/api/investment-evolution"), handler: getInvestmentEvolution },
  ];
}
