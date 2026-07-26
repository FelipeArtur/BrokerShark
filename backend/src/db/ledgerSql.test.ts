import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initSchema } from "./open.ts";
import { runMigrations } from "./migrate.ts";
import { seedAccountsAndCategories } from "../jobs/backfill/seeds.ts";
import { consumptionExpense, realIncome } from "./ledgerSql.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "migrations");

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  runMigrations(db, MIGRATIONS_DIR);
  seedAccountsAndCategories(db);
  return db;
}

function tx(db: DatabaseSync, cols: Record<string, unknown>): void {
  const base: Record<string, unknown> = {
    date: "2026-06-10", flow: "expense", method: "pix", account_id: "nu-db",
    amount_cents: 1000, description: "teste",
    is_revenue: 0, is_settlement: 0, is_third_party: 0,
  };
  const all = { ...base, ...cols };
  const keys = Object.keys(all);
  db.prepare(
    `INSERT INTO transactions (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
  ).run(...keys.map(k => all[k] as never));
}

const descs = (db: DatabaseSync, where: string): string[] =>
  (db.prepare(`SELECT description FROM transactions WHERE ${where} ORDER BY description`)
    .all() as { description: string }[]).map(r => r.description);

// Um ledger com uma linha por caso que as regras precisam separar.
function ledger(): DatabaseSync {
  const db = freshDb();
  tx(db, { description: "mercado" });                                     // consumo puro
  tx(db, { description: "cinema", method: "credit" });                    // consumo no cartão
  tx(db, { description: "aplicacao", method: "transfer" });               // perna de investimento
  tx(db, { description: "perna-self", method: "transfer" });              // saída SELF (reescrita p/ transfer)
  tx(db, { description: "pagto-fatura", is_settlement: 1 });              // liquidação de fatura
  tx(db, { description: "gasto-de-terceiro", is_third_party: 1 });        // não é meu dinheiro
  tx(db, { description: "entre-contas", dest_account_id: "inter-db" });   // destino interno declarado
  tx(db, { description: "salario", flow: "income", method: "salary", is_revenue: 1 });
  tx(db, { description: "resgate", flow: "income", method: "transfer", is_revenue: 0 });
  tx(db, { description: "reembolso-de-terceiro", flow: "income", method: "pix", is_revenue: 1, is_third_party: 1 });
  return db;
}

test("despesa de consumo pega só o que saiu do bolso", () => {
  assert.deepEqual(descs(ledger(), consumptionExpense()), ["cinema", "mercado"]);
});

test("receita real pega só dinheiro que entrou de fora", () => {
  assert.deepEqual(descs(ledger(), realIncome()), ["salario"]);
});

test("as duas regras não se sobrepõem e deixam o resto de fora", () => {
  const db = ledger();
  const total = (db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n;
  const consumo = descs(db, consumptionExpense());
  const receita = descs(db, realIncome());
  assert.equal(consumo.filter(d => receita.includes(d)).length, 0);
  assert.ok(consumo.length + receita.length < total, "nem toda linha do ledger conta");
});

test("com apelido de tabela o recorte é idêntico", () => {
  const db = ledger();
  for (const rule of [consumptionExpense, realIncome]) {
    const bare = descs(db, rule());
    const aliased = (db.prepare(
      `SELECT t.description FROM transactions t WHERE ${rule("t")} ORDER BY t.description`,
    ).all() as { description: string }[]).map(r => r.description);
    assert.deepEqual(aliased, bare);
  }
});

test("apelido vazio não deixa ponto solto no SQL", () => {
  assert.ok(!consumptionExpense().includes(".flow"));
  assert.ok(realIncome("t").includes("t.flow"));
});
