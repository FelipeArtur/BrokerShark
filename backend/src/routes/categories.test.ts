import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { deleteOrphanCategoryRules } from "./categories.ts";

test("deleteOrphanCategoryRules removes category rules pointing at a deleted category", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE rules (id INTEGER PRIMARY KEY, matcher TEXT, action TEXT, value TEXT, priority INTEGER, enabled INTEGER)");
  db.prepare("INSERT INTO rules (matcher, action, value, priority, enabled) VALUES ('posto x','category','7',50,1)").run();
  db.prepare("INSERT INTO rules (matcher, action, value, priority, enabled) VALUES ('mercado y','category','9',50,1)").run();
  deleteOrphanCategoryRules(db, 7);
  const left = db.prepare("SELECT value FROM rules WHERE action='category'").all() as any[];
  assert.deepEqual(left.map(r => r.value), ["9"]);
});

test("deleteOrphanCategoryRules leaves non-category rules untouched", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE rules (id INTEGER PRIMARY KEY, matcher TEXT, action TEXT, value TEXT, priority INTEGER, enabled INTEGER)");
  db.prepare("INSERT INTO rules (matcher, action, value, priority, enabled) VALUES ('rdb','investment_leg',NULL,100,1)").run();
  db.prepare("INSERT INTO rules (matcher, action, value, priority, enabled) VALUES ('posto x','category','7',50,1)").run();
  deleteOrphanCategoryRules(db, 7);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM rules WHERE action='investment_leg'").get() as any).n, 1);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM rules WHERE action='category'").get() as any).n, 0);
});
