import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initSchema } from "../../db/open.ts";
import { reviewInvestments } from "./investReview.ts";

function db0(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  return db;
}
const addInv = (db: DatabaseSync, o: any): number => Number(db.prepare(
  "INSERT INTO investments (name, match_key, type, bank, source) VALUES (?,?,?,?,?)",
).run(o.name, o.match_key, o.type, o.bank, o.source).lastInsertRowid);
const addSnap = (db: DatabaseSync, id: number, ref: string, net: number, src = "b3") =>
  db.prepare("INSERT INTO position_snapshots (investment_id, ref_date, net_cents, source) VALUES (?,?,?,?)")
    .run(id, ref, net, src);

test("reviewInvestments: carteira sã → sem violações + panorama", () => {
  const db = db0();
  const t = addInv(db, { name: "Tesouro X", match_key: "b3:tx", type: "tesouro", bank: "tesouro", source: "b3" });
  addSnap(db, t, "2026-03-31", 500000);
  const c = addInv(db, { name: "Caixinha Nubank", match_key: "ledger:caixinha-nubank", type: "rdb", bank: "nubank", source: "ledger" });
  addSnap(db, c, "2026-03-31", 0, "derived");
  const r = reviewInvestments(db);
  assert.deepEqual(r.violations, []);
  assert.equal(r.panorama.totalCents, 500000);
  assert.equal(r.panorama.byType[0].type, "tesouro");
});

test("reviewInvestments: posição ledger não-Caixinha viola", () => {
  const db = db0();
  const p = addInv(db, { name: "Porquinho?", match_key: "ledger:porquinho", type: "cdb", bank: "inter", source: "ledger" });
  addSnap(db, p, "2026-03-31", 1000, "derived");
  assert.ok(reviewInvestments(db).violations.some((v) => /ledger inesperada/.test(v)));
});

test("reviewInvestments: posição aberta sem snapshot viola", () => {
  const db = db0();
  addInv(db, { name: "Sem snap", match_key: "b3:nosnap", type: "acao", bank: "b3", source: "b3" });
  assert.ok(reviewInvestments(db).violations.some((v) => /sem nenhum snapshot/.test(v)));
});
