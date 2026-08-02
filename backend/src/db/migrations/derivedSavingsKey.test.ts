import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(join(HERE, "0004_derived_savings_key.sql"), "utf8");

function dbWith(matchKey: string | null): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE investments (id INTEGER PRIMARY KEY, name TEXT, match_key TEXT, source TEXT)");
  if (matchKey) {
    db.prepare("INSERT INTO investments (name, match_key, source) VALUES (?, ?, 'ledger')")
      .run("Caixinha Nubank", matchKey);
  }
  return db;
}

const keys = (db: DatabaseSync) =>
  (db.prepare("SELECT match_key FROM investments").all() as { match_key: string }[])
    .map(r => r.match_key);

test("a posição derivada de um ledger antigo ganha a chave nova", () => {
  const db = dbWith("ledger:caixinha-nubank");
  db.exec(MIGRATION);
  assert.deepEqual(keys(db), ["ledger:derived-savings"]);
});

test("a posição continua UMA — a migration renomeia, não duplica", () => {
  //> Sem a renomeação, o próximo import contaria as mesmas aplicações duas vezes.
  const db = dbWith("ledger:caixinha-nubank");
  db.exec(MIGRATION);
  assert.equal(keys(db).length, 1);
});

test("num ledger novo é no-op", () => {
  const db = dbWith(null);
  db.exec(MIGRATION);
  assert.deepEqual(keys(db), []);
});

test("posição de corretora não é tocada", () => {
  const db = dbWith("ledger:caixinha-nubank");
  db.prepare("INSERT INTO investments (name, match_key, source) VALUES ('Tesouro', 'b3:tesouro-2029', 'b3')").run();
  db.exec(MIGRATION);
  assert.deepEqual(keys(db).sort(), ["b3:tesouro-2029", "ledger:derived-savings"]);
});
