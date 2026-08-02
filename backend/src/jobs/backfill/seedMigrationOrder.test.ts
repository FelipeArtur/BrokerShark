import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initSchema } from "../../db/open.ts";
import { runMigrations } from "../../db/migrate.ts";
import { seedAccounts } from "./seeds.ts";
import { useTestConfig } from "../../testing/fixtures.ts";

useTestConfig();

// Este arquivo travava a regra antiga: seed e migration inseriam as MESMAS 6
// macro categorias, e as duas ordens de execução (backfill roda migration antes
// do seed; alguns testes de rota rodam o seed antes) precisavam terminar sem
// duplicata.
//
// A regra virou outra quando o repositório ficou público: ledger novo nasce com
// ZERO categorias, porque taxonomia de gasto é decisão de quem usa. O que estes
// testes travam agora é o outro lado da mesma moeda — que nenhum dos dois
// caminhos deixe escapar a taxonomia pessoal do autor pra dentro de um banco
// recém-criado.

function categoryCount(db: DatabaseSync): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM categories").get() as { n: number }).n;
}

test("ordem real do backfill (initSchema → runMigrations → seedAccounts): nasce sem categoria", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  runMigrations(db);
  seedAccounts(db);

  assert.equal(categoryCount(db), 0);
});

test("ordem invertida (initSchema → seedAccounts → runMigrations): nasce sem categoria", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  seedAccounts(db);
  runMigrations(db);

  assert.equal(categoryCount(db), 0);
});

test("as contas do acervo continuam sendo semeadas", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  runMigrations(db);
  seedAccounts(db);

  const ids = (db.prepare("SELECT id FROM accounts").all() as { id: string }[])
    .map(r => r.id).sort();
  assert.deepEqual(ids, ["cartao-b", "conta-a", "conta-b"]);
});

test("num ledger que JÁ tinha categorias, a migration ainda consolida", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  //> Uma categoria antiga é o gatilho que faz a 0002 materializar as macro.
  db.prepare("INSERT INTO categories (name, flow) VALUES ('Carro', 'expense')").run();
  runMigrations(db);

  const names = (db.prepare("SELECT name FROM categories WHERE flow='expense' ORDER BY name")
    .all() as { name: string }[]).map(r => r.name);
  assert.ok(names.includes("Transporte"), "as macro entram quando há o que consolidar");
  assert.ok(!names.includes("Carro"), "e a antiga sai");
});
