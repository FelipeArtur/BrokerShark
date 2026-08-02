export type MonthlySnap = { investment_id: number; ym: string; net_cents: number };

function nextYm(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function monthlyPortfolioSeries(
  snaps: MonthlySnap[],
  closedYm: Map<number, string>,
): { ym: string; total_cents: number }[] {
  if (!snaps.length) return [];

  const byYm = new Map<string, MonthlySnap[]>();
  for (const s of snaps) {
    const list = byYm.get(s.ym) ?? [];
    list.push(s);
    byYm.set(s.ym, list);
  }

  const yms = [...byYm.keys()].sort();
  const last = new Map<number, number>();
  const out: { ym: string; total_cents: number }[] = [];

  for (let ym = yms[0]; ym <= yms[yms.length - 1]; ym = nextYm(ym)) {
    for (const s of byYm.get(ym) ?? []) last.set(s.investment_id, s.net_cents);
    let total = 0;
    for (const [id, cents] of last) {
      const closed = closedYm.get(id);
      if (closed && ym > closed) continue;
      total += cents;
    }
    out.push({ ym, total_cents: total });
  }
  return out;
}

/**
 * @brief   Série mensal da carteira, lida direto do banco.
 * @details A consulta de snapshots, o mapa de fechadas e o carry-forward viviam
 *          copiados em `/api/liquidity-history` e `/api/investment-evolution`. Duas
 *          cópias divergindo fariam o gráfico de patrimônio e o de investimentos
 *          discordarem sobre o mesmo mês.
 */
export function portfolioSeriesFromDb(db: {
  prepare: (sql: string) => { all: (...a: unknown[]) => unknown[] };
}): { ym: string; total_cents: number }[] {
  const snaps = db.prepare(`
    SELECT investment_id, ym, net_cents FROM (
      SELECT ps.investment_id, strftime('%Y-%m', ps.ref_date) AS ym, ps.net_cents,
        ROW_NUMBER() OVER (
          PARTITION BY ps.investment_id, strftime('%Y-%m', ps.ref_date)
          ORDER BY ps.ref_date DESC, ps.id DESC
        ) AS rn
      FROM position_snapshots ps
    ) WHERE rn = 1 ORDER BY ym
  `).all() as never[];

  const closedYm = new Map<number, string>(
    (db.prepare(
      "SELECT id, strftime('%Y-%m', closed_at) AS ym FROM investments WHERE closed_at IS NOT NULL",
    ).all() as { id: number; ym: string }[]).map(r => [r.id, r.ym]),
  );
  return monthlyPortfolioSeries(snaps, closedYm);
}
