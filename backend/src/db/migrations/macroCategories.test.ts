import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(join(HERE, "0002_macro_categories.sql"), "utf8");

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, flow TEXT);
    CREATE TABLE category_budgets (category_id INTEGER, ref_month TEXT DEFAULT '', amount_cents INTEGER,
      PRIMARY KEY(category_id, ref_month),
      FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE CASCADE);
    CREATE TABLE transactions (id INTEGER PRIMARY KEY, flow TEXT, category_id INTEGER);
  `);
  db.exec("PRAGMA foreign_keys=ON");
  return db;
}

test("migration 0002: old expense cats collapse into the 6 macro, transactions reassigned", () => {
  const db = freshDb();
  const cat = db.prepare("INSERT INTO categories (name, flow) VALUES (?, ?)");
  for (const n of ["Alimentação", "Carro", "Jogos", "Igreja", "Dízimo", "Outro", "Educação"]) cat.run(n, "expense");
  for (const n of ["Salário"]) cat.run(n, "income");
  const idOf = (n: string) => (db.prepare("SELECT id FROM categories WHERE name=?").get(n) as any).id;
  const tx = db.prepare("INSERT INTO transactions (flow, category_id) VALUES ('expense', ?)");
  tx.run(idOf("Carro"));      // → Transporte
  tx.run(idOf("Jogos"));      // → Compras e Lazer
  tx.run(idOf("Igreja"));     // → Igreja/Dízimo
  tx.run(idOf("Educação"));   // → Compras e Lazer
  tx.run(idOf("Alimentação")); // stays

  db.exec(MIGRATION);

  const names = (db.prepare("SELECT name FROM categories WHERE flow='expense' ORDER BY name").all() as any[]).map(r => r.name);
  assert.deepEqual(names, ["Alimentação", "Compras e Lazer", "Compromissos e Transferências", "Igreja/Dízimo", "Saúde e Bem-Estar", "Transporte"]);
  const catOfTx = (i: number) => (db.prepare("SELECT name FROM categories WHERE id=(SELECT category_id FROM transactions WHERE id=?)").get(i) as any).name;
  assert.equal(catOfTx(1), "Transporte");
  assert.equal(catOfTx(2), "Compras e Lazer");
  assert.equal(catOfTx(3), "Igreja/Dízimo");
  assert.equal(catOfTx(4), "Compras e Lazer");
  assert.equal(catOfTx(5), "Alimentação");
  assert.equal((db.prepare("SELECT COUNT(*) n FROM categories WHERE flow='income'").get() as any).n, 1);
});

test("migration 0002 maps user-created categories (Saúde, Pagamentos) explicitly", () => {
  const db = freshDb();
  const cat = db.prepare("INSERT INTO categories (name, flow) VALUES (?, ?)");
  for (const n of ["Alimentação", "Saúde", "Pagamentos", "Saúdea"]) cat.run(n, "expense");
  const idOf = (n: string) => (db.prepare("SELECT id FROM categories WHERE name=?").get(n) as any).id;
  const tx = db.prepare("INSERT INTO transactions (flow, category_id) VALUES ('expense', ?)");
  tx.run(idOf("Saúde"));       // → Saúde e Bem-Estar (not the catch-all Compromissos)
  tx.run(idOf("Pagamentos"));  // → Compromissos e Transferências (user decision)

  db.exec(MIGRATION);

  const catOfTx = (i: number) => (db.prepare("SELECT name FROM categories WHERE id=(SELECT category_id FROM transactions WHERE id=?)").get(i) as any).name;
  assert.equal(catOfTx(1), "Saúde e Bem-Estar");
  assert.equal(catOfTx(2), "Compromissos e Transferências");
  const names = (db.prepare("SELECT name FROM categories WHERE flow='expense' ORDER BY name").all() as any[]).map(r => r.name);
  assert.deepEqual(names, ["Alimentação", "Compras e Lazer", "Compromissos e Transferências", "Igreja/Dízimo", "Saúde e Bem-Estar", "Transporte"]);
});

test("migration 0002 is a no-op on a fresh DB that already has only the 6 macro", () => {
  const db = freshDb();
  const cat = db.prepare("INSERT INTO categories (name, flow) VALUES (?, 'expense')");
  for (const n of ["Alimentação", "Transporte", "Saúde e Bem-Estar", "Compras e Lazer", "Compromissos e Transferências", "Igreja/Dízimo"]) cat.run(n);
  db.exec(MIGRATION);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM categories WHERE flow='expense'").get() as any).n, 6);
});
