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
