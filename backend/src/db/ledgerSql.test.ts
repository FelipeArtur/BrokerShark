import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initSchema } from "./open.ts";
import { runMigrations } from "./migrate.ts";
import { seedAccounts } from "../jobs/backfill/seeds.ts";
import {
  consumptionExpense, realIncome, investmentOut, investmentIn,
} from "./ledgerSql.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "migrations");

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  runMigrations(db, MIGRATIONS_DIR);
  seedAccounts(db);
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

// Um par SELF como `selfPairs` o deixa: saída reescrita pra `method='transfer'`,
// entrada com `is_revenue=0` e método original, `self_pair_tx_id` cruzado.
function selfPair(db: DatabaseSync, name: string): void {
  tx(db, { description: `${name}-saida`, method: "transfer" });
  tx(db, { description: `${name}-entrada`, flow: "income", method: "pix",
           account_id: "inter-db", is_revenue: 0 });
  db.exec(`
    UPDATE transactions SET counterpart='SELF',
      self_pair_tx_id=(SELECT id FROM transactions WHERE description='${name}-entrada')
      WHERE description='${name}-saida';
    UPDATE transactions SET counterpart='SELF',
      self_pair_tx_id=(SELECT id FROM transactions WHERE description='${name}-saida')
      WHERE description='${name}-entrada';
  `);
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
  selfPair(db, "perna-self");                                             // par SELF: saída + entrada
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

test("aplicação pega só a perna de investimento, nunca a perna SELF de saída", () => {
  assert.deepEqual(descs(ledger(), investmentOut()), ["aplicacao"]);
});

test("resgate pega só a entrada de investimento, nunca a perna SELF de entrada", () => {
  assert.deepEqual(descs(ledger(), investmentIn()), ["resgate"]);
});

test("perna SELF de entrada com método reescrito continua fora do resgate", () => {
  // Blindagem: hoje a entrada SELF guarda pix/ted, e a regra sobreviveria só
  // por isso. Se um extrato entregar a entrada já como transferência, é o
  // `self_pair_tx_id` que precisa segurar.
  const db = ledger();
  db.exec("UPDATE transactions SET method='transfer' WHERE description='perna-self-entrada'");
  assert.deepEqual(descs(db, investmentIn()), ["resgate"]);
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
  for (const rule of [consumptionExpense, realIncome, investmentOut, investmentIn]) {
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
