import type { DatabaseSync } from "node:sqlite";

/**
 * @file    Guarda anti-perda: o backfill recria o DB do zero.
 * @details Antes de apagar, pergunta o que existe ali que nenhum rebuild recria.
 * @warning Sonda que falta = perda silenciosa. Sem `closed_at`, conta morta volta a
 *          somar no disponível e o herói mente pra cima.
 */

export type OverlayFinding = { label: string; count: number };

/**
 * @brief   `needs` são as colunas que a consulta exige.
 * @details A guarda roda ANTES das migrations, então pode ver schema mais velho que ela.
 *          Sonda cuja coluna não existe é pulada: sem a coluna, o dado não pode existir.
 */
type Probe = { label: string; table: string; needs?: string[]; sql: string };

const PROBES: Probe[] = [
  {
    label: "lançamentos importados ou editados pela UI",
    table: "transactions",
    needs: ["import_batch_id", "display_name", "is_third_party"],
    sql: `SELECT COUNT(*) AS n FROM transactions
          WHERE import_batch_id IS NOT NULL
             OR display_name IS NOT NULL
             OR is_third_party = 1`,
  },
  {
    //> O seed não grava data nenhuma: qualquer uma das duas preenchida = UI.
    label: "contas criadas ou encerradas pela UI",
    table: "accounts",
    needs: ["opened_at", "closed_at"],
    sql: `SELECT COUNT(*) AS n FROM accounts
          WHERE opened_at IS NOT NULL OR closed_at IS NOT NULL`,
  },
  {
    label: "alvos de gasto por categoria",
    table: "category_budgets",
    sql: `SELECT COUNT(*) AS n FROM category_budgets`,
  },
  {
    //> O seed só grava `investment_leg`/`settlement`: `category` é sempre da UI.
    label: "regras de categoria aprendidas ao categorizar",
    table: "rules",
    sql: `SELECT COUNT(*) AS n FROM rules WHERE action = 'category'`,
  },
  {
    //> Nenhum acervo contém: é afirmação sua sobre o futuro, e o extrato só fala do passado.
    label: "recorrências declaradas por você",
    table: "recurring_marks",
    sql: `SELECT COUNT(*) AS n FROM recurring_marks`,
  },
];

function tableColumns(db: DatabaseSync, table: string): Set<string> | null {
  const exists = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
  ).get(table);
  if (!exists) return null;
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name),
  );
}

/** O que existe no DB que um rebuild apagaria, item a item. */
export function userOverlay(db: DatabaseSync): OverlayFinding[] {
  const out: OverlayFinding[] = [];
  for (const p of PROBES) {
    const cols = tableColumns(db, p.table);
    if (!cols) continue;
    if ((p.needs ?? []).some(c => !cols.has(c))) continue;
    const n = Number((db.prepare(p.sql).get() as { n: number }).n ?? 0);
    if (n > 0) out.push({ label: p.label, count: n });
  }
  return out;
}

export function hasUserOverlay(db: DatabaseSync): boolean {
  return userOverlay(db).length > 0;
}
