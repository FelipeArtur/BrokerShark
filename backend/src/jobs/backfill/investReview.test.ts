import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initSchema } from "../../db/open.ts";
import { reviewInvestments } from "./investReview.ts";
import { useTestConfig } from "../../testing/fixtures.ts";

useTestConfig();

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
  const c = addInv(db, { name: "Reserva", match_key: "ledger:derived-savings", type: "rdb", bank: "banco-a", source: "ledger" });
  addSnap(db, c, "2026-03-31", 0, "derived");
  const r = reviewInvestments(db);
  assert.deepEqual(r.violations, []);
  assert.equal(r.panorama.totalCents, 500000);
  assert.equal(r.panorama.byType[0].type, "tesouro");
});

test("reviewInvestments: posição ledger que não é a poupança derivada viola", () => {
  const db = db0();
  const p = addInv(db, { name: "Posição inesperada", match_key: "ledger:inesperada", type: "cdb", bank: "banco-b", source: "ledger" });
  addSnap(db, p, "2026-03-31", 1000, "derived");
  assert.ok(reviewInvestments(db).violations.some((v) => /ledger inesperada/.test(v)));
});

test("reviewInvestments: posição aberta sem snapshot viola", () => {
  const db = db0();
  addInv(db, { name: "Sem snap", match_key: "b3:nosnap", type: "acao", bank: "b3", source: "b3" });
  assert.ok(reviewInvestments(db).violations.some((v) => /sem nenhum snapshot/.test(v)));
});

test("reviewInvestments: poupança derivada: reconciliação mismatch → viola", () => {
  const db = db0();
  db.prepare("INSERT INTO accounts (id, bank, type, name) VALUES (?,?,?,?)")
    .run("conta-a", "Banco A", "checking", "Banco A Conta");
  const cx = addInv(db, { name: "Reserva", match_key: "ledger:derived-savings", type: "rdb", bank: "banco-a", source: "ledger" });
  db.prepare("INSERT INTO transactions (date,flow,method,account_id,amount_cents,description,investment_id) VALUES (?,?,?,?,?,?,?)")
    .run("2026-03-02", "expense", "transfer", "conta-a", 20000, "Aplicacao RDB", cx);
  addSnap(db, cx, "2026-03-31", 99999, "derived");
  const r = reviewInvestments(db);
  assert.ok(r.violations.some((v) => /reconcilia/.test(v)));
});

test("reviewInvestments: poupança derivada: reconciliação match → NÃO viola", () => {
  const db = db0();
  db.prepare("INSERT INTO accounts (id, bank, type, name) VALUES (?,?,?,?)")
    .run("conta-a", "Banco A", "checking", "Banco A Conta");
  const cx = addInv(db, { name: "Reserva", match_key: "ledger:derived-savings", type: "rdb", bank: "banco-a", source: "ledger" });
  db.prepare("INSERT INTO transactions (date,flow,method,account_id,amount_cents,description,investment_id) VALUES (?,?,?,?,?,?,?)")
    .run("2026-03-02", "expense", "transfer", "conta-a", 20000, "Aplicacao RDB", cx);
  addSnap(db, cx, "2026-03-31", 20000, "derived");
  const r = reviewInvestments(db);
  assert.ok(!r.violations.some((v) => /reconcilia/.test(v)));
});

test("reviewInvestments: snapshot com net negativo → viola", () => {
  const db = db0();
  const inv = addInv(db, { name: "Posição negativa", match_key: "b3:neg", type: "acao", bank: "b3", source: "b3" });
  addSnap(db, inv, "2026-03-31", -100, "b3");
  const r = reviewInvestments(db);
  assert.ok(r.violations.some((v) => /negativo/.test(v)));
});
