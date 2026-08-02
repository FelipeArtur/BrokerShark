import type { DatabaseSync } from "node:sqlite";
import { config } from "../../config.ts";

export interface SavingsResult { investmentId: number | null; balanceCents: number; legs: number }

// A posição derivada é a poupança que NÃO tem custódia em corretora: nenhum
// relatório a lista, então o saldo dela só existe como Σ(aplicações) −
// Σ(resgates) das pernas do extrato. Nome, banco e tipo saem da config — o
// produto se chama diferente em cada instituição.
const MATCH_KEY = "ledger:derived-savings";

function createPosition(db: DatabaseSync): number {
  const s = config().derivedSavings;
  if (!s) throw new Error("derivedSavings não configurado — ver config/");
  return Number(db.prepare(`
    INSERT INTO investments (name, match_key, type, bank, source, group_name)
    VALUES (?, ?, ?, ?, 'ledger', NULL)`,
  ).run(s.name, MATCH_KEY, s.type, s.bank).lastInsertRowid);
}

export function deriveSavings(db: DatabaseSync, savingsTxIds: number[]): SavingsResult {
  //> Sem perna não há poupança: criar assim quebraria posição-aberta-tem-snapshot.
  if (!savingsTxIds.length) return { investmentId: null, balanceCents: 0, legs: 0 };

  const investmentId = createPosition(db);

  const ph = savingsTxIds.map(() => "?").join(",");
  db.prepare(`UPDATE transactions SET investment_id = ? WHERE id IN (${ph})`)
    .run(investmentId, ...savingsTxIds);

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
  return { investmentId, balanceCents: running, legs: savingsTxIds.length };
}

export function rederiveSavings(db: DatabaseSync, newLegIds: number[]): SavingsResult {
  const found = db.prepare(
    "SELECT id FROM investments WHERE match_key = ?",
  ).get(MATCH_KEY) as { id: number } | undefined;

  if (!found && !newLegIds.length) return { investmentId: null, balanceCents: 0, legs: 0 };

  const investmentId = found ? found.id : createPosition(db);

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
