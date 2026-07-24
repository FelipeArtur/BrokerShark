import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "./migrate.ts";
import { initSchema } from "./open.ts";

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE migration_log (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL)");
  return db;
}

test("aplica migrations pendentes em ordem de nome", () => {
  const dir = mkdtempSync(join(tmpdir(), "mig-"));
  writeFileSync(join(dir, "0002_b.sql"), "CREATE TABLE b (y);");
  writeFileSync(join(dir, "0001_a.sql"), "CREATE TABLE a (x);");
  const db = freshDb();
  const ran = runMigrations(db, dir);
  assert.deepEqual(ran, ["0001_a.sql", "0002_b.sql"]);
  db.exec("INSERT INTO a (x) VALUES (1)");
  db.exec("INSERT INTO b (y) VALUES (2)");
  rmSync(dir, { recursive: true });
});

test("é idempotente — 2ª chamada é no-op", () => {
  const dir = mkdtempSync(join(tmpdir(), "mig-"));
  writeFileSync(join(dir, "0001_a.sql"), "CREATE TABLE a (x);");
  const db = freshDb();
  assert.deepEqual(runMigrations(db, dir), ["0001_a.sql"]);
  assert.deepEqual(runMigrations(db, dir), []);
  rmSync(dir, { recursive: true });
});

test("falha faz ROLLBACK e lança, sem registrar", () => {
  const dir = mkdtempSync(join(tmpdir(), "mig-"));
  writeFileSync(join(dir, "0001_bad.sql"), "CREATE TABLE oops (");
  const db = freshDb();
  assert.throws(() => runMigrations(db, dir), /0001_bad\.sql falhou/);
  const rows = db.prepare("SELECT name FROM migration_log").all();
  assert.equal(rows.length, 0);
  rmSync(dir, { recursive: true });
});

test("diretório sem .sql → retorna vazio", () => {
  const dir = mkdtempSync(join(tmpdir(), "mig-"));
  assert.deepEqual(runMigrations(freshDb(), dir), []);
  rmSync(dir, { recursive: true });
});

test("migrations reais: invoices ganha coluna due_date", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  runMigrations(db);
  const cols = (db.prepare("PRAGMA table_info(invoices)").all() as { name: string }[]).map((c) => c.name);
  assert.ok(cols.includes("due_date"), "esperava coluna due_date após migrations");
});
