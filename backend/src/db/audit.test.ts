import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initSchema } from "./open.ts";
import { runMigrations } from "./migrate.ts";
import { seedAccounts } from "../jobs/backfill/seeds.ts";
import { seedTestCategories } from "../testing/fixtures.ts";
import { auditLedger } from "./audit.ts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "migrations");

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  runMigrations(db, MIGRATIONS_DIR);
  seedAccounts(db);
  seedTestCategories(db);
  return db;
}

function checks(db: DatabaseSync): string[] {
  return auditLedger(db).map(v => v.check);
}

function tx(db: DatabaseSync, cols: Record<string, unknown>): number {
  const base: Record<string, unknown> = {
    date: "2026-06-10", flow: "expense", method: "pix", account_id: "nu-db",
    amount_cents: 1000, description: "teste", is_revenue: 0, is_settlement: 0, is_third_party: 0,
  };
  const all = { ...base, ...cols };
  const keys = Object.keys(all);
  return Number(db.prepare(
    `INSERT INTO transactions (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
  ).run(...keys.map(k => all[k] as never)).lastInsertRowid);
}

test("DB recém-semeado não tem violação", () => {
  assert.deepEqual(auditLedger(freshDb()), []);
});

test("SELF declarado sem par é violação (nasceria contando como gasto)", () => {
  const db = freshDb();
  tx(db, { counterpart: "SELF" });
  assert.ok(checks(db).includes("self-sem-par"));
});

test("par SELF não recíproco é violação", () => {
  const db = freshDb();
  const a = tx(db, { method: "transfer" });
  const b = tx(db, { flow: "income", method: "pix" });
  db.prepare("UPDATE transactions SET self_pair_tx_id=? WHERE id=?").run(b, a);
  // b não aponta de volta
  assert.ok(checks(db).includes("self-par-nao-reciproco"));
});

test("perna SELF de saída fora de method=transfer é violação (viraria despesa de consumo)", () => {
  const db = freshDb();
  const a = tx(db, { method: "pix" });
  const b = tx(db, { flow: "income", method: "pix" });
  db.prepare("UPDATE transactions SET self_pair_tx_id=? WHERE id=?").run(b, a);
  db.prepare("UPDATE transactions SET self_pair_tx_id=? WHERE id=?").run(a, b);
  assert.ok(checks(db).includes("self-saida-nao-transfer"));
});

test("perna SELF de entrada com is_revenue=1 é violação (inflaria receita)", () => {
  const db = freshDb();
  const a = tx(db, { method: "transfer" });
  const b = tx(db, { flow: "income", method: "pix", is_revenue: 1 });
  db.prepare("UPDATE transactions SET self_pair_tx_id=? WHERE id=?").run(b, a);
  db.prepare("UPDATE transactions SET self_pair_tx_id=? WHERE id=?").run(a, b);
  assert.ok(checks(db).includes("self-entrada-como-receita"));
});

test("perna SELF ligada a uma posição é violação (transferência viraria aplicação)", () => {
  const db = freshDb();
  const inv = Number(db.prepare(
    `INSERT INTO investments (name, match_key, type, bank, source)
     VALUES ('Caixinha', 'k1', 'RDB', 'nubank', 'ledger')`,
  ).run().lastInsertRowid);
  const a = tx(db, { method: "transfer", investment_id: inv });
  const b = tx(db, { flow: "income", method: "pix" });
  db.prepare("UPDATE transactions SET self_pair_tx_id=? WHERE id=?").run(b, a);
  db.prepare("UPDATE transactions SET self_pair_tx_id=? WHERE id=?").run(a, b);
  assert.ok(checks(db).includes("self-como-investimento"));
});

test("liquidação marcada como transferência é violação", () => {
  const db = freshDb();
  tx(db, { method: "transfer", is_settlement: 1 });
  assert.ok(checks(db).includes("liquidacao-mal-classificada"));
});

test("liquidação marcada como terceiro é violação", () => {
  const db = freshDb();
  tx(db, { is_settlement: 1, is_third_party: 1 });
  assert.ok(checks(db).includes("liquidacao-mal-classificada"));
});

test("pagamento de fatura em conta corrente NÃO é violação de conta", () => {
  const db = freshDb();
  const inv = Number(db.prepare(
    "INSERT INTO invoices (account_id, ref_month, total_cents, source_file) VALUES ('inter-cc','2026-05',1000,'x')",
  ).run().lastInsertRowid);
  tx(db, { invoice_id: inv, account_id: "inter-cc", method: "credit", amount_cents: 1000 });
  // a liquidação mora na conta corrente e aponta pra fatura — por desenho
  tx(db, { invoice_id: inv, account_id: "inter-db", method: "credit", amount_cents: 1000, is_settlement: 1 });
  assert.ok(!checks(db).includes("item-fatura-conta-errada"));
});

test("item de fatura em conta diferente da fatura é violação", () => {
  const db = freshDb();
  const inv = Number(db.prepare(
    "INSERT INTO invoices (account_id, ref_month, total_cents, source_file) VALUES ('inter-cc','2026-05',1000,'x')",
  ).run().lastInsertRowid);
  tx(db, { invoice_id: inv, account_id: "nu-db", method: "credit", amount_cents: 1000 });
  assert.ok(checks(db).includes("item-fatura-conta-errada"));
});

test("estorno na fatura abate o total — não é divergência", () => {
  const db = freshDb();
  const inv = Number(db.prepare(
    "INSERT INTO invoices (account_id, ref_month, total_cents, source_file) VALUES ('inter-cc','2026-05',700,'x')",
  ).run().lastInsertRowid);
  tx(db, { invoice_id: inv, account_id: "inter-cc", method: "credit", amount_cents: 1000 });
  tx(db, { invoice_id: inv, account_id: "inter-cc", method: "credit", amount_cents: 300, flow: "income", is_revenue: 0 });
  assert.ok(!checks(db).includes("fatura-total-diverge"));
});

test("total da fatura que não bate com os itens é violação", () => {
  const db = freshDb();
  const inv = Number(db.prepare(
    "INSERT INTO invoices (account_id, ref_month, total_cents, source_file) VALUES ('inter-cc','2026-05',5000,'x')",
  ).run().lastInsertRowid);
  tx(db, { invoice_id: inv, account_id: "inter-cc", method: "credit", amount_cents: 1000 });
  assert.ok(checks(db).includes("fatura-total-diverge"));
});

test("fatura sem itens não dispara divergência de total", () => {
  const db = freshDb();
  db.prepare("INSERT INTO invoices (account_id, ref_month, total_cents, source_file) VALUES ('inter-cc','2026-05',5000,'x')").run();
  assert.ok(!checks(db).includes("fatura-total-diverge"), "fatura aberta ainda sem itens é estado válido");
});

test("parcela com seq acima do total é violação", () => {
  const db = freshDb();
  tx(db, { installment_seq: 7, installment_total: 3 });
  assert.ok(checks(db).includes("parcela-seq-invalida"));
});

test("external_id duplicado é barrado pelo schema, não pela auditoria", () => {
  const db = freshDb();
  tx(db, { external_id: "uuid-1" });
  assert.throws(() => tx(db, { external_id: "uuid-1" }), /UNIQUE/);
});

test("transferência com destino igual à origem é violação", () => {
  const db = freshDb();
  tx(db, { method: "transfer", dest_account_id: "nu-db" });
  assert.ok(checks(db).includes("destino-igual-origem"));
});

test("posição aberta sem snapshot é violação", () => {
  const db = freshDb();
  db.prepare("INSERT INTO investments (name, match_key, type, bank, source) VALUES ('X','x','cdb','inter','b3')").run();
  assert.ok(checks(db).includes("posicao-sem-snapshot"));
});

test("posição fechada sem snapshot não é violação", () => {
  const db = freshDb();
  db.prepare("INSERT INTO investments (name, match_key, type, bank, source, closed_at) VALUES ('X','x','cdb','inter','b3','2026-01-01')").run();
  assert.ok(!checks(db).includes("posicao-sem-snapshot"));
});

test("snapshot com valor negativo é violação", () => {
  const db = freshDb();
  const id = Number(db.prepare(
    "INSERT INTO investments (name, match_key, type, bank, source) VALUES ('X','x','cdb','inter','b3')",
  ).run().lastInsertRowid);
  db.prepare("INSERT INTO position_snapshots (investment_id, ref_date, net_cents, source) VALUES (?,'2026-06-30',-1,'b3')").run(id);
  assert.ok(checks(db).includes("snapshot-negativo"));
});

test("lançamento com categoria de sentido oposto é violação", () => {
  const db = freshDb();
  const cat = db.prepare("SELECT id FROM categories WHERE flow='income' LIMIT 1").get() as any;
  tx(db, { flow: "expense", category_id: cat.id });
  assert.ok(checks(db).includes("categoria-sentido-errado"));
});

test("alvo de orçamento em categoria de receita é violação", () => {
  const db = freshDb();
  const cat = db.prepare("SELECT id FROM categories WHERE flow='income' LIMIT 1").get() as any;
  db.prepare("INSERT INTO category_budgets (category_id, ref_month, amount_cents) VALUES (?,'',1000)").run(cat.id);
  assert.ok(checks(db).includes("alvo-em-categoria-de-receita"));
});

test("cada violação reporta contagem e mensagem legível", () => {
  const db = freshDb();
  tx(db, { counterpart: "SELF" });
  tx(db, { counterpart: "SELF" });
  const v = auditLedger(db).find(x => x.check === "self-sem-par")!;
  assert.equal(v.count, 2);
  assert.ok(v.message.length > 10);
});
