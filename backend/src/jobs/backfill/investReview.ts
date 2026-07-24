import type { DatabaseSync } from "node:sqlite";

export interface InvestPanorama {
  totalCents: number;
  byType: { type: string; cents: number; pct: number }[];
  topConcentration: { name: string; pct: number } | null;
  bySource: { source: string; count: number }[];
}

export interface InvestReview { violations: string[]; panorama: InvestPanorama }

export function reviewInvestments(db: DatabaseSync): InvestReview {
  const all = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...(p as never[])) as T[];
  const get = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).get(...(p as never[])) as T | undefined;
  const violations: string[] = [];

  for (const r of all<{ name: string }>(
    "SELECT name FROM investments WHERE source='ledger' AND match_key != 'ledger:caixinha-nubank'",
  )) violations.push(`posição ledger inesperada "${r.name}" — só a Caixinha deve ser derivada (Porquinho é B3)`);

  const cx = get<{ id: number }>("SELECT id FROM investments WHERE match_key='ledger:caixinha-nubank'");
  if (cx) {
    const legs = get<{ s: number }>(
      "SELECT COALESCE(SUM(CASE WHEN flow='expense' THEN amount_cents ELSE -amount_cents END),0) AS s FROM transactions WHERE investment_id=?",
      cx.id,
    )!.s;
    const snap = get<{ net_cents: number }>(
      "SELECT net_cents FROM position_snapshots WHERE investment_id=? AND source='derived' ORDER BY ref_date DESC LIMIT 1",
      cx.id,
    );
    if (snap && snap.net_cents !== legs)
      violations.push(`Caixinha não reconcilia: snapshot ${snap.net_cents} ≠ Σ pernas ${legs}`);
  }

  for (const r of all<{ name: string }>(
    "SELECT i.name FROM investments i LEFT JOIN position_snapshots ps ON ps.investment_id=i.id WHERE i.closed_at IS NULL AND ps.id IS NULL",
  )) violations.push(`posição aberta "${r.name}" sem nenhum snapshot`);

  for (const r of all<{ name: string; net_cents: number }>(
    "SELECT i.name, ps.net_cents FROM position_snapshots ps JOIN investments i ON i.id=ps.investment_id WHERE ps.net_cents < 0",
  )) violations.push(`net negativo em "${r.name}": ${r.net_cents}`);

  const open = all<{ type: string; name: string; net: number | null }>(`
    SELECT i.type, i.name,
      (SELECT net_cents FROM position_snapshots s WHERE s.investment_id=i.id ORDER BY ref_date DESC LIMIT 1) AS net
    FROM investments i WHERE i.closed_at IS NULL
  `);
  const totalCents = open.reduce((s, r) => s + (r.net ?? 0), 0);
  const pct = (c: number) => (totalCents > 0 ? Math.round((c / totalCents) * 1000) / 10 : 0);
  const byTypeMap = new Map<string, number>();
  for (const r of open) byTypeMap.set(r.type, (byTypeMap.get(r.type) ?? 0) + (r.net ?? 0));
  const byType = [...byTypeMap].map(([type, cents]) => ({ type, cents, pct: pct(cents) }))
    .sort((a, b) => b.cents - a.cents);
  const top = open.filter((r) => r.net != null).sort((a, b) => b.net! - a.net!)[0];
  const topConcentration = top && totalCents > 0 ? { name: top.name, pct: pct(top.net!) } : null;
  const bySource = all<{ source: string; count: number }>(
    "SELECT source, COUNT(*) AS count FROM investments WHERE closed_at IS NULL GROUP BY source",
  );

  return { violations, panorama: { totalCents, byType, topConcentration, bySource } };
}
