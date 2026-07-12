/** selfPairs.ts — pareamento de pernas SELF (invariante v2, sem keyword list).
 *
 *  Saída pix/ted numa conta + entrada de MESMO valor em conta diferente dentro
 *  de ±3 dias = transferência própria: counterpart='SELF', fora de despesas,
 *  receitas e investimento. Pernas cruzadas via self_pair_tx_id.
 */
import type { DatabaseSync } from "node:sqlite";
import { fmtCents } from "../../domain/money.ts";

interface Leg { id: number; date: string; account_id: string; amount_cents: number; description: string }

export function pairSelfTransfers(db: DatabaseSync): string[] {
  const candidates = (flow: string) => db.prepare(`
    SELECT id, date, account_id, amount_cents, description FROM transactions
    WHERE flow = ? AND counterpart IS NULL AND invoice_id IS NULL AND is_settlement = 0
      AND method IN ('pix', 'ted') AND account_id IN ('nu-db', 'inter-db')
    ORDER BY date
  `).all(flow) as unknown as Leg[];

  const expenses = candidates("expense");
  const incomes = candidates("income");
  const usedIncome = new Set<number>();
  const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

  const log: string[] = [];
  for (const e of expenses) {
    let best: Leg | null = null;
    for (const i of incomes) {
      if (usedIncome.has(i.id) || i.account_id === e.account_id) continue;
      if (i.amount_cents !== e.amount_cents || dayDiff(e.date, i.date) > 3) continue;
      if (!best || dayDiff(e.date, i.date) < dayDiff(e.date, best.date)) best = i;
    }
    if (!best) continue;
    usedIncome.add(best.id);
    db.prepare(
      "UPDATE transactions SET counterpart='SELF', method='transfer', self_pair_tx_id=? WHERE id=?",
    ).run(best.id, e.id);
    db.prepare(
      "UPDATE transactions SET counterpart='SELF', is_revenue=0, self_pair_tx_id=? WHERE id=?",
    ).run(e.id, best.id);
    log.push(
      `  ${e.date} ${e.account_id}→${best.account_id} ${fmtCents(e.amount_cents)}  ("${e.description.slice(0, 48)}")`,
    );
  }
  return log;
}
