import type { DatabaseSync } from "node:sqlite";

export function hasUserOverlay(db: DatabaseSync): boolean {
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM transactions
    WHERE import_batch_id IS NOT NULL
       OR display_name IS NOT NULL
       OR is_third_party = 1
  `).get() as { n: number };
  return row.n > 0;
}
