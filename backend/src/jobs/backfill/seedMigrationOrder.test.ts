import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initSchema } from "../../db/open.ts";
import { runMigrations } from "../../db/migrate.ts";
import { seedAccountsAndCategories } from "./seeds.ts";

// Trava a Task 1 (WHERE NOT EXISTS em vez de INSERT OR IGNORE, tanto na migration
// 0002_macro_categories.sql quanto no seed): migration e seed inserem as mesmas
// 6 macro categorias de despesa, e ambos os caminhos (backfill real roda
// migration ANTES do seed; alguns testes de rota rodam o seed ANTES da migration)
// precisam terminar num DB sem duplicatas — 6 despesa + 5 receita = 11 no total.

const EXPENSE_MACRO = ["Alimentação", "Transporte", "Saúde e Bem-Estar",
  "Compras e Lazer", "Compromissos e Transferências", "Igreja/Dízimo"];

function assertNoDoubling(db: DatabaseSync): void {
  const expenseCount = (db.prepare(
    "SELECT COUNT(*) AS n FROM categories WHERE flow='expense'",
  ).get() as { n: number }).n;
  const incomeCount = (db.prepare(
    "SELECT COUNT(*) AS n FROM categories WHERE flow='income'",
  ).get() as { n: number }).n;

  assert.equal(expenseCount, 6);
  assert.equal(incomeCount, 5);
  assert.equal(expenseCount + incomeCount, 11);

  const expenseNames = (db.prepare(
    "SELECT name FROM categories WHERE flow='expense' ORDER BY name",
  ).all() as { name: string }[]).map((r) => r.name);
  assert.deepEqual(expenseNames, [...EXPENSE_MACRO].sort());
}

test("ordem real do backfill (initSchema → runMigrations → seedAccountsAndCategories): sem dobrar as 6 macro", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  runMigrations(db);
  seedAccountsAndCategories(db);

  assertNoDoubling(db);
});

test("ordem invertida (initSchema → seedAccountsAndCategories → runMigrations): sem dobrar as 6 macro", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  seedAccountsAndCategories(db);
  runMigrations(db);

  assertNoDoubling(db);
});
