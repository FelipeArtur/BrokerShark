import type { DatabaseSync } from "node:sqlite";

export interface CaixinhaResult { investmentId: number | null; balanceCents: number; legs: number }

const MATCH_KEY = "ledger:caixinha-nubank";

const CREATE_POSITION = `
  INSERT INTO investments (name, match_key, type, bank, source, group_name)
  VALUES ('Caixinha Nubank', '${MATCH_KEY}', 'rdb', 'nubank', 'ledger', NULL)`;

export function deriveCaixinha(db: DatabaseSync, caixinhaTxIds: number[]): CaixinhaResult {
  // Sem perna nenhuma não há Caixinha: criar a posição assim mesmo produziria
  // uma linha aberta e sem snapshot, que o painel mostra como "R$ 0,00" pra quem
  // nunca usou a Caixinha — e quebra a invariante posição-aberta-tem-snapshot.
  if (!caixinhaTxIds.length) return { investmentId: null, balanceCents: 0, legs: 0 };

  const investmentId = Number(db.prepare(CREATE_POSITION).run().lastInsertRowid);

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
    "SELECT id FROM investments WHERE match_key = ?",
  ).get(MATCH_KEY) as { id: number } | undefined;

  // Nada pra ligar e nenhuma posição existente → não há o que derivar.
  if (!found && !newLegIds.length) return { investmentId: null, balanceCents: 0, legs: 0 };

  const investmentId = found ? found.id : Number(db.prepare(CREATE_POSITION).run().lastInsertRowid);

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
