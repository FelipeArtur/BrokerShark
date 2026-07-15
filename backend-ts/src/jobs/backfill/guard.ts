/** guard.ts — detecta dados escritos pela UI que um rebuild destruiria.
 *
 *  O backfill reconstrói o DB do zero. Depois que a UI passou a escrever
 *  (lançamento manual, edições, import incremental), um rebuild silencioso
 *  apagaria tudo isso. Esta guarda deixa o orquestrador abortar (a menos de
 *  --force) quando há overlay do usuário.
 */
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
