import type { DatabaseSync } from "node:sqlite";

export interface CaixinhaResult { investmentId: number; balanceCents: number; legs: number }

export function deriveCaixinha(db: DatabaseSync, caixinhaTxIds: number[]): CaixinhaResult {
  const investmentId = Number(db.prepare(`
    INSERT INTO investments (name, match_key, type, bank, source, group_name)
    VALUES ('Caixinha Nubank', 'ledger:caixinha-nubank', 'rdb', 'nubank', 'ledger', NULL)
  `).run().lastInsertRowid);

  if (!caixinhaTxIds.length) return { investmentId, balanceCents: 0, legs: 0 };

  const ph = caixinhaTxIds.map(() => "?").join(",");
  db.prepare(`UPDATE transactions SET investment_id = ? WHERE id IN (${ph})`)
    .run(investmentId, ...caixinhaTxIds);

  const legs = db.prepare(`
    SELECT date, flow, amount_cents FROM transactions
    WHERE investment_id = ? ORDER BY date
  `).all(investmentId) as unknown as { date: string; flow: string; amount_cents: number }[];

  const byMonth = new Map<string, number>();
  let running = 0;
  for (const l of legs) {
    running += l.flow === "expense" ? l.amount_cents : -l.amount_cents;
    byMonth.set(l.date.slice(0, 7), running);
  }

  const insSnap = db.prepare(`
    INSERT INTO position_snapshots (investment_id, ref_date, net_cents, source)
    VALUES (?,?,?,'derived')
  `);
  for (const [month, bal] of byMonth) {
    const [y, mo] = month.split("-").map(Number) as [number, number];
    const last = new Date(y, mo, 0).getDate();
    insSnap.run(investmentId, `${month}-${String(last).padStart(2, "0")}`, bal);
  }
  return { investmentId, balanceCents: running, legs: caixinhaTxIds.length };
}

export function rederiveCaixinha(db: DatabaseSync, newLegIds: number[]): CaixinhaResult {
  const found = db.prepare(
    "SELECT id FROM investments WHERE match_key = 'ledger:caixinha-nubank'",
  ).get() as { id: number } | undefined;
  const investmentId = found ? found.id : Number(db.prepare(`
    INSERT INTO investments (name, match_key, type, bank, source, group_name)
    VALUES ('Caixinha Nubank', 'ledger:caixinha-nubank', 'rdb', 'nubank', 'ledger', NULL)
  `).run().lastInsertRowid);

  if (newLegIds.length) {
    const ph = newLegIds.map(() => "?").join(",");
    db.prepare(`UPDATE transactions SET investment_id = ? WHERE id IN (${ph})`)
      .run(investmentId, ...newLegIds);
  }

  db.prepare("DELETE FROM position_snapshots WHERE investment_id = ? AND source = 'derived'")
    .run(investmentId);

  const legs = db.prepare(`
    SELECT date, flow, amount_cents FROM transactions
    WHERE investment_id = ? ORDER BY date
  `).all(investmentId) as unknown as { date: string; flow: string; amount_cents: number }[];

  const byMonth = new Map<string, number>();
  let running = 0;
  for (const l of legs) {
    running += l.flow === "expense" ? l.amount_cents : -l.amount_cents;
    byMonth.set(l.date.slice(0, 7), running);
  }
  const insSnap = db.prepare(`
    INSERT INTO position_snapshots (investment_id, ref_date, net_cents, source)
    VALUES (?,?,?,'derived')
  `);
  for (const [month, bal] of byMonth) {
    const [y, mo] = month.split("-").map(Number) as [number, number];
    const last = new Date(y, mo, 0).getDate();
    insSnap.run(investmentId, `${month}-${String(last).padStart(2, "0")}`, bal);
  }
  return { investmentId, balanceCents: running, legs: legs.length };
}
