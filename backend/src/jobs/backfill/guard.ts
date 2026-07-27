import type { DatabaseSync } from "node:sqlite";

// Guarda anti-perda: o backfill reconstrói o DB do zero, então antes de apagar
// ele pergunta o que existe ali que NENHUM rebuild consegue recriar.
//
// A guarda antiga só olhava `transactions`, e isso deixava passar tudo que a UI
// escreve FORA da tabela de lançamentos — conta criada, conta encerrada, alvo de
// gasto, regra aprendida. Um rebuild levava embora em silêncio. O caso mais caro
// é o encerramento de conta: sem `closed_at` a conta morta volta a somar no
// disponível, e o número que o produto inteiro existe pra responder mente pra
// cima sem avisar.

export type OverlayFinding = { label: string; count: number };

// `needs` são as colunas que a consulta exige. A guarda roda ANTES das
// migrations — é o primeiro passo do backfill, sobre o DB que já estava lá —
// então pode encontrar um schema mais velho que ela. Consultar uma coluna que
// ainda não existe estoura com "SQL logic error" e troca a guarda por um stack
// trace. Sonda cuja coluna não existe é PULADA, e isso é correto e não
// paliativo: sem a coluna, o dado que ela procura não pode existir.
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
    // O seed cria as contas sem data nenhuma; POST /api/accounts sempre grava
    // `opened_at`, e encerrar grava `closed_at`. Uma das duas preenchidas = UI.
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
    // Categorizar um lançamento vindo do backfill não deixa marca no próprio
    // lançamento — a marca é a regra aprendida. O seed só grava
    // `investment_leg` e `settlement`, então `category` é sempre da UI.
    // (Categoria criada pela UI e nunca usada ainda escapa: não há coluna que a
    // distinga do seed, e comparar com a lista semeada duplicaria o seed aqui.
    // Na prática toda categoria criada acaba usada, e o uso cai nesta sonda.)
    label: "regras de categoria aprendidas ao categorizar",
    table: "rules",
    sql: `SELECT COUNT(*) AS n FROM rules WHERE action = 'category'`,
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
