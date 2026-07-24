import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { learnCategoryRule } from "./transactions.ts";

function db0(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE rules (id INTEGER PRIMARY KEY, matcher TEXT, match_field TEXT, action TEXT, value TEXT, priority INTEGER, enabled INTEGER DEFAULT 1);`);
  return db;
}

test("learnCategoryRule inserts a category rule from the merchant core", () => {
  const db = db0();
  learnCategoryRule(db, "POSTO SOL COSTA AZUL SALVADOR BRA", 7);
  const r = db.prepare("SELECT matcher, action, value FROM rules WHERE action='category'").get() as any;
  assert.equal(r.matcher, "posto sol costa azul");
  assert.equal(r.value, "7");
});

test("learnCategoryRule updates the value when the same merchant is re-categorized", () => {
  const db = db0();
  learnCategoryRule(db, "MAMMA JAMMA SALVADOR BRA", 3);
  learnCategoryRule(db, "MAMMA JAMMA SALVADOR BRA", 9);
  const rows = db.prepare("SELECT value FROM rules WHERE action='category' AND matcher='mamma jamma'").all() as any[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, "9");
});

test("learnCategoryRule ignores a blank merchant core", () => {
  const db = db0();
  learnCategoryRule(db, "   ", 4);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM rules").get() as any).n, 0);
});
