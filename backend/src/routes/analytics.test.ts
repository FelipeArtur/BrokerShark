import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initSchema } from "../db/open.ts";
import { runMigrations } from "../db/migrate.ts";
import { seedAccounts } from "../jobs/backfill/seeds.ts";
import { analyticsRoutes } from "./analytics.ts";
import { useTestConfig } from "../testing/fixtures.ts";

useTestConfig();

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "../db/migrations");

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  runMigrations(db, MIGRATIONS_DIR);
  seedAccounts(db);
  return db;
}

function get(db: DatabaseSync, path: string): any {
  const route = analyticsRoutes(db).find(r => r.method === "GET" && r.pattern.test(path.split("?")[0]!))!;
  let payload: any;
  const res: any = { setHeader() {}, end(s: string) { payload = JSON.parse(s); }, writeHead() {} };
  route.handler({ url: path, params: {} } as any, res);
  return payload;
}

function tx(db: DatabaseSync, cols: Record<string, unknown>): void {
  const base: Record<string, unknown> = {
    date: "2026-06-10", flow: "expense", method: "pix", account_id: "conta-a",
    amount_cents: 1000, description: "teste",
    is_revenue: 0, is_settlement: 0, is_third_party: 0,
  };
  const all = { ...base, ...cols };
  const keys = Object.keys(all);
  db.prepare(
    `INSERT INTO transactions (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
  ).run(...keys.map(k => all[k] as never));
}

// Junho como o ledger vivo tinha quando o furo apareceu: salário, um gasto,
// um resgate de verdade e uma transferência entre contas do próprio dono.
function june(db: DatabaseSync): void {
  tx(db, { date: "2026-06-05", flow: "income", method: "ted", is_revenue: 1,
           amount_cents: 420000, description: "salario" });
  tx(db, { date: "2026-06-09", amount_cents: 148547, description: "mercado" });
  tx(db, { date: "2026-06-21", flow: "income", method: "transfer", is_revenue: 0,
           amount_cents: 300000, description: "Resgate RDB" });
  //> Par SELF: conta-a → conta-b. A saída sai reescrita pra `transfer`.
  tx(db, { date: "2026-06-21", method: "transfer", amount_cents: 200000,
           description: "self-saida", counterpart: "SELF" });
  tx(db, { date: "2026-06-21", flow: "income", method: "pix", account_id: "conta-b",
           is_revenue: 0, amount_cents: 200000, description: "self-entrada", counterpart: "SELF" });
  db.exec(`
    UPDATE transactions SET self_pair_tx_id=(SELECT id FROM transactions WHERE description='self-entrada')
      WHERE description='self-saida';
    UPDATE transactions SET self_pair_tx_id=(SELECT id FROM transactions WHERE description='self-saida')
      WHERE description='self-entrada';
  `);
}

test("cashflow: transferência entre contas próprias não vira aplicação", () => {
  const db = freshDb();
  june(db);
  const out = get(db, "/api/cashflow-statement?month=6&year=2026");
  assert.equal(out.income_total, 4200);
  assert.equal(out.expense_total, 1485.47);
  //> Só o resgate move a linha de investimento: −3000, não −1000.
  assert.equal(out.investment_net, -3000);
});

test("cashflow: aplicação de verdade continua entrando", () => {
  const db = freshDb();
  june(db);
  tx(db, { date: "2026-06-25", method: "transfer", amount_cents: 50000,
           description: "Aplicação RDB" });
  const out = get(db, "/api/cashflow-statement?month=6&year=2026");
  assert.equal(out.investment_net, -2500);
});

test("monthly: par SELF fica fora de receita e de despesa", () => {
  const db = freshDb();
  june(db);
  const row = get(db, "/api/monthly?present=1").find((r: any) => r.label === "06/2026");
  assert.equal(row.income, 4200);
  assert.equal(row.expenses, 1485.47);
});
