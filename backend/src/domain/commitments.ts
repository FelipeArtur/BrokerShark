export type InstallmentRow = {
  description: string;
  refMonth: string;
  amountCents: number;
  installmentSeq: number;
  installmentTotal: number;
};

export type ProjectedMonth = { month: string; amountCents: number; count: number };

export function addMonths(refMonth: string, k: number): string {
  const y = Number(refMonth.slice(0, 4));
  const m = Number(refMonth.slice(5, 7));
  const total = y * 12 + (m - 1) + k;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

export function projectInstallments(rows: InstallmentRow[]): ProjectedMonth[] {
  const byMonth = new Map<string, { amountCents: number; count: number }>();
  for (const r of rows) {
    const remaining = r.installmentTotal - r.installmentSeq;
    for (let j = 1; j <= remaining; j++) {
      const month = addMonths(r.refMonth, j);
      const cur = byMonth.get(month) ?? { amountCents: 0, count: 0 };
      cur.amountCents += r.amountCents;
      cur.count += 1;
      byMonth.set(month, cur);
    }
  }
  return [...byMonth.entries()]
    .map(([month, v]) => ({ month, amountCents: v.amountCents, count: v.count }))
    .sort((a, b) => a.month.localeCompare(b.month));
}
