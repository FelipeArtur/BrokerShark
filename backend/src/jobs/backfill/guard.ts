/**
 * @file guard.ts
 * @brief Guarda anti-perda: detecta overlay da UI que um rebuild do backfill apagaria.
 *
 * guard.ts — detecta dados escritos pela UI que um rebuild destruiria.
 *
 *  O backfill reconstrói o DB do zero. Depois que a UI passou a escrever
 *  (lançamento manual, edições, import incremental), um rebuild silencioso
 *  apagaria tudo isso. Esta guarda deixa o orquestrador abortar (a menos de
 *  --force) quando há overlay do usuário.
 */
import type { DatabaseSync } from "node:sqlite";

/**
 * @brief Dizer se o DB tem dados escritos pela UI (import, apelido ou terceiro).
 *
 * Os três marcadores são justamente o que o backfill NÃO sabe reproduzir a partir
 * do acervo: `import_batch_id` (import incremental), `display_name` (apelido
 * editado) e `is_third_party` (marcado à mão).
 *
 * @param db conexão do DB existente
 * @return true se houver ao menos uma transação com marca da UI
 */
export function hasUserOverlay(db: DatabaseSync): boolean {
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM transactions
    WHERE import_batch_id IS NOT NULL
       OR display_name IS NOT NULL
       OR is_third_party = 1
  `).get() as { n: number };
  return row.n > 0;
}
