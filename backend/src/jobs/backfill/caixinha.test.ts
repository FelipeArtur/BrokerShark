import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initSchema } from "../../db/open.ts";
import { runMigrations } from "../../db/migrate.ts";
import { seedAccountsAndCategories } from "./seeds.ts";
import { deriveCaixinha, rederiveCaixinha } from "./caixinha.ts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "../../db/migrations");

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  runMigrations(db, MIGRATIONS_DIR);
  seedAccountsAndCategories(db);
  return db;
}

function leg(db: DatabaseSync, date: string, flow: "expense" | "income", cents: number): number {
  return Number(db.prepare(`INSERT INTO transactions
    (date, flow, method, account_id, amount_cents, description, is_revenue, is_settlement, is_third_party)
    VALUES (?, ?, 'transfer', 'nu-db', ?, 'Aplicação RDB', 0, 0, 0)`)
    .run(date, flow, cents).lastInsertRowid);
}

const positions = (db: DatabaseSync) =>
  db.prepare("SELECT * FROM investments WHERE match_key='ledger:caixinha-nubank'").all() as any[];

test("sem perna nenhuma, a Caixinha não nasce", () => {
  const db = freshDb();
  const out = rederiveCaixinha(db, []);
  assert.equal(out.investmentId, null);
  assert.deepEqual(positions(db), [], "posição fantasma valendo zero não entra no patrimônio");
});

test("deriveCaixinha sem perna também não cria posição", () => {
  const db = freshDb();
  const out = deriveCaixinha(db, []);
  assert.equal(out.investmentId, null);
  assert.deepEqual(positions(db), []);
});

test("com pernas, a Caixinha nasce com snapshot mensal derivado", () => {
  const db = freshDb();
  const a = leg(db, "2026-04-10", "expense", 100000); // aplicação
  const b = leg(db, "2026-05-10", "income", 30000);   // resgate

  const out = rederiveCaixinha(db, [a, b]);
  assert.ok(out.investmentId);
  assert.equal(out.balanceCents, 70000);
  assert.equal(out.legs, 2);

  const snaps = db.prepare(
    "SELECT ref_date, net_cents FROM position_snapshots WHERE investment_id=? ORDER BY ref_date",
  ).all(out.investmentId) as any[];
  assert.deepEqual(snaps.map(s => ({ ref_date: s.ref_date, net_cents: s.net_cents })), [
    { ref_date: "2026-04-30", net_cents: 100000 },
    { ref_date: "2026-05-31", net_cents: 70000 },
  ]);
});

test("rederivar com a posição já existente recalcula sem duplicar", () => {
  const db = freshDb();
  const a = leg(db, "2026-04-10", "expense", 100000);
  const first = rederiveCaixinha(db, [a]);

  const b = leg(db, "2026-05-10", "expense", 50000);
  const second = rederiveCaixinha(db, [b]);

  assert.equal(second.investmentId, first.investmentId);
  assert.equal(positions(db).length, 1);
  assert.equal(second.balanceCents, 150000);
});

test("rederivar sem pernas novas mantém a posição que já existe", () => {
  const db = freshDb();
  const a = leg(db, "2026-04-10", "expense", 100000);
  const first = rederiveCaixinha(db, [a]);

  const again = rederiveCaixinha(db, []);
  assert.equal(again.investmentId, first.investmentId);
  assert.equal(again.balanceCents, 100000, "recalcula a partir das pernas já ligadas");
});

test("quando as pernas somem, a posição existente zera mas não é apagada", () => {
  const db = freshDb();
  const a = leg(db, "2026-04-10", "expense", 100000);
  const id = rederiveCaixinha(db, [a]).investmentId;

  db.prepare("DELETE FROM transactions WHERE id=?").run(a);
  const out = rederiveCaixinha(db, []);
  assert.equal(out.investmentId, id, "soft-close é a regra: posição não some");
  assert.equal(out.balanceCents, 0);
});
