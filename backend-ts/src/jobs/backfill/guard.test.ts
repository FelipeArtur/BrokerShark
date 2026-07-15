import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initSchema } from "../../db/open.ts";
import { seedAccountsAndCategories } from "./seeds.ts";
import { hasUserOverlay } from "./guard.ts";

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  seedAccountsAndCategories(db);
  return db;
}

test("hasUserOverlay: DB recém-semeado (sem edições) = false", () => {
  const db = freshDb();
  assert.equal(hasUserOverlay(db), false);
});

test("hasUserOverlay: transação importada pela UI = true", () => {
  const db = freshDb();
  db.prepare(`INSERT INTO transactions
    (date, flow, method, account_id, amount_cents, description, import_batch_id)
    VALUES ('2026-03-01','expense','pix','nu-db',1000,'x','sess-1')`).run();
  assert.equal(hasUserOverlay(db), true);
});

test("hasUserOverlay: apelido editado pela UI = true", () => {
  const db = freshDb();
  db.prepare(`INSERT INTO transactions
    (date, flow, method, account_id, amount_cents, description, display_name)
    VALUES ('2026-03-01','expense','pix','nu-db',1000,'x','Almoço')`).run();
  assert.equal(hasUserOverlay(db), true);
});
